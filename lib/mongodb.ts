import { MongoClient, Collection } from 'mongodb';

// Two separate clients for wc and lm collections (different clusters)
let clientWc: MongoClient | null = null;
let clientLm: MongoClient | null = null;
let clientPromiseWc: Promise<MongoClient> | null = null;
let clientPromiseLm: Promise<MongoClient> | null = null;

export async function getMongoClientWc(): Promise<MongoClient> {
  if (clientWc) {
    return clientWc;
  }

  const uri = process.env.MONGODB_URI_temp_wc;
  if (!uri) {
    throw new Error('MONGODB_URI_temp_wc is not configured');
  }

  if (!clientPromiseWc) {
    clientPromiseWc = MongoClient.connect(uri);
  }

  clientWc = await clientPromiseWc;
  return clientWc;
}

export async function getMongoClientLm(): Promise<MongoClient> {
  if (clientLm) {
    return clientLm;
  }

  const uri = process.env.MONGODB_URI_temp_lm;
  if (!uri) {
    throw new Error('MONGODB_URI_temp_lm is not configured');
  }

  if (!clientPromiseLm) {
    clientPromiseLm = MongoClient.connect(uri);
  }

  clientLm = await clientPromiseLm;
  return clientLm;
}

// Legacy function for backward compatibility - uses wc client
export async function getMongoClient(): Promise<MongoClient> {
  return getMongoClientWc();
}

export async function getCollections(): Promise<{
  conversations: Collection;
  wc_4_8M: Collection;
  lm: Collection;
}> {
  // Match the backend database.py structure
  // Backend uses:
  // - database_temp_wc["conversations-db"] for wc collections (MONGODB_URI_temp_wc)
  // - database_temp_lm["conversations-db"] for lm collection (MONGODB_URI_temp_lm)
  
  const mongoClientWc = await getMongoClientWc();
  const mongoClientLm = await getMongoClientLm();
  
  const dbWc = mongoClientWc.db('conversations-db');
  const dbLm = mongoClientLm.db('conversations-db');
  
  return {
    conversations: dbWc.collection('wc_included_conversations_collection'),
    wc_4_8M: dbWc.collection('wc_4_8M_included_conversations_collection'),
    lm: dbLm.collection('lm_included_conversations_collection'),
  };
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [MongoDB] ${message}`);
}

// Interface for detailed prompt results (for Ver2 pipeline)
export interface PromptWithDetails {
  first_prompt: string;
  similarityScore: number;
  collection: string;
}

// Configuration matching Python domain_analysis.py
const VECTOR_SEARCH_NUM_CANDIDATES = 200;
const VECTOR_SEARCH_LIMIT = 100;
const TOTAL_RESULTS_LIMIT = 50;

/**
 * Find similar prompts with full details (similarity score and collection name).
 * This matches the Python find_similar_prompts_with_conversations function.
 */
export async function findSimilarPromptsWithDetails(
  summaryEmbedding: number[],
  topK: number = TOTAL_RESULTS_LIMIT
): Promise<PromptWithDetails[]> {
  try {
    log(`Starting findSimilarPromptsWithDetails with topK=${topK}`);
    
    const collections = await getCollections();
    const allResults: PromptWithDetails[] = [];

    const searchCollection = async (collection: Collection, collectionName: string): Promise<PromptWithDetails[]> => {
      try {
        log(`Starting detailed search for collection: ${collectionName}`);
        
        const pipeline = [
          {
            $vectorSearch: {
              index: 'first_prompt_vector_index',
              path: 'first_prompt_vector',
              queryVector: summaryEmbedding,
              numCandidates: VECTOR_SEARCH_NUM_CANDIDATES,
              limit: VECTOR_SEARCH_LIMIT,
            },
          },
          {
            $project: {
              first_prompt: 1,
              similarityScore: { $meta: 'vectorSearchScore' },
              prompt_length: { $strLenCP: '$first_prompt' },
            },
          },
          {
            $match: {
              prompt_length: { $lte: 500 },
            },
          },
        ];

        const startTime = Date.now();
        const cursor = collection.aggregate(pipeline, { maxTimeMS: 30000 });
        const results = await cursor.toArray();
        const duration = Date.now() - startTime;
        log(`✓ ${collectionName} detailed search completed in ${duration}ms, found ${results.length} results`);
        
        return results.map(r => ({
          first_prompt: r.first_prompt,
          similarityScore: r.similarityScore,
          collection: collectionName,
        }));
      } catch (error: any) {
        log(`✗ ERROR searching ${collectionName}: ${error.message}`);
        return [];
      }
    };

    // Search in all three collections in parallel
    log('Starting parallel detailed searches across 3 collections...');
    const startTime = Date.now();
    const results = await Promise.all([
      searchCollection(collections.conversations, 'wc_included_conversations_collection'),
      searchCollection(collections.wc_4_8M, 'wc_4_8M_included_conversations_collection'),
      searchCollection(collections.lm, 'lm_included_conversations_collection'),
    ]);
    const duration = Date.now() - startTime;
    log(`All detailed collection searches completed in ${duration}ms`);

    // Combine all results
    for (const collectionResults of results) {
      allResults.push(...collectionResults);
    }

    // Sort by similarity score (highest first) and truncate
    allResults.sort((a, b) => b.similarityScore - a.similarityScore);
    
    log(`Total results: ${allResults.length}, returning top ${topK}`);
    return allResults.slice(0, topK);
  } catch (error: any) {
    log(`FATAL ERROR in findSimilarPromptsWithDetails: ${error.message}`);
    console.error('Error finding similar prompts with details:', error);
    return [];
  }
}

export async function findSimilarPrompts(
  summaryEmbedding: number[],
  topK: number = 100
): Promise<string[]> {
  try {
    log(`Starting findSimilarPrompts with topK=${topK}`);
    log(`Embedding length: ${summaryEmbedding.length}`);
    
    const collections = await getCollections();
    log('Collections retrieved successfully');
    const allPrompts: string[] = [];

    const numCandidates = Math.max(100, topK * 3);
    const initialLimit = Math.max(50, topK * 2);
    log(`numCandidates: ${numCandidates}, initialLimit: ${initialLimit}`);

    // Search each collection with a fresh pipeline
    // MongoDB requires $vectorSearch to be the absolute first stage
    const searchCollection = async (collection: Collection, collectionName: string) => {
      try {
        log(`Starting search for collection: ${collectionName}`);
        
        // Build pipeline as a const array to ensure it's not modified
        // This matches the exact structure from the backend Python code
        const pipeline = [
          {
            $vectorSearch: {
              index: 'first_prompt_vector_index',
              path: 'first_prompt_vector',
              queryVector: summaryEmbedding,
              numCandidates: numCandidates,
              limit: initialLimit,
            },
          },
          {
            $project: {
              first_prompt: 1,
              similarityScore: { $meta: 'vectorSearchScore' },
              prompt_length: { $strLenCP: '$first_prompt' },
            },
          },
          {
            $match: {
              prompt_length: { $lte: 500 },
            },
          },
          {
            $limit: topK,
          },
        ];

        log(`Pipeline constructed for ${collectionName}`);
        log(`Pipeline length: ${pipeline.length}`);
        log(`First stage keys: ${Object.keys(pipeline[0]).join(', ')}`);
        log(`First stage has $vectorSearch: ${!!pipeline[0].$vectorSearch}`);
        log(`$vectorSearch index: ${pipeline[0].$vectorSearch?.index}`);
        log(`$vectorSearch path: ${pipeline[0].$vectorSearch?.path}`);
        log(`$vectorSearch numCandidates: ${pipeline[0].$vectorSearch?.numCandidates}`);
        log(`$vectorSearch limit: ${pipeline[0].$vectorSearch?.limit}`);
        log(`$vectorSearch queryVector length: ${pipeline[0].$vectorSearch?.queryVector?.length}`);

        // Verify pipeline structure
        if (!pipeline[0] || !pipeline[0].$vectorSearch) {
          log(`ERROR: Pipeline for ${collectionName} does not start with $vectorSearch`);
          log(`First stage: ${JSON.stringify(pipeline[0], null, 2)}`);
          return [];
        }

        log(`Calling aggregate() for ${collectionName}...`);
        const startTime = Date.now();
        const cursor = collection.aggregate(pipeline, { maxTimeMS: 10000 });
        log(`Aggregate cursor created for ${collectionName}, calling toArray()...`);
        const results = await cursor.toArray();
        const duration = Date.now() - startTime;
        log(`✓ ${collectionName} search completed in ${duration}ms, found ${results.length} results`);
        return results;
      } catch (error: any) {
        log(`✗ ERROR searching ${collectionName}: ${error.message}`);
        log(`  Error code: ${error.code}`);
        log(`  Error codeName: ${error.codeName}`);
        log(`  Error stack: ${error.stack}`);
        log(`  Full error: ${JSON.stringify(error, null, 2)}`);
        // Return empty array on error to allow other collections to continue
        return [];
      }
    };

    // Search in all three collections in parallel
    log('Starting parallel searches across 3 collections...');
    const searchPromises = [
      searchCollection(collections.conversations, 'wc_included_conversations_collection'),
      searchCollection(collections.wc_4_8M, 'wc_4_8M_included_conversations_collection'),
      searchCollection(collections.lm, 'lm_included_conversations_collection'),
    ];

    const startTime = Date.now();
    const results = await Promise.all(searchPromises);
    const duration = Date.now() - startTime;
    log(`All collection searches completed in ${duration}ms`);

    log('Processing results...');
    for (let i = 0; i < results.length; i++) {
      const collectionName = [
        'wc_included_conversations_collection',
        'wc_4_8M_included_conversations_collection',
        'lm_included_conversations_collection'
      ][i];
      const collectionResults = results[i];
      log(`Processing ${collectionName}: ${collectionResults.length} results`);
      
      for (const result of collectionResults) {
        if (result.first_prompt && typeof result.first_prompt === 'string') {
          allPrompts.push(result.first_prompt);
        }
      }
    }

    log(`Total prompts collected: ${allPrompts.length}`);
    // Remove duplicates and return
    const uniquePrompts = Array.from(new Set(allPrompts)).slice(0, topK);
    log(`Final unique prompts: ${uniquePrompts.length}`);
    log('findSimilarPrompts completed successfully');
    return uniquePrompts;
  } catch (error: any) {
    log(`FATAL ERROR in findSimilarPrompts: ${error.message}`);
    log(`  Error stack: ${error.stack}`);
    log(`  Full error: ${JSON.stringify(error, null, 2)}`);
    console.error('Error finding similar prompts:', error);
    return [];
  }
}

