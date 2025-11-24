import { NextRequest, NextResponse } from 'next/server';
import { getCollections } from '@/lib/mongodb';
import { generateEmbedding } from '@/lib/embeddings';

interface SearchResult {
  keyword: string;
  collection: string;
  first_prompt: string;
  similarityScore: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keywords }: { keywords: string[] } = body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json(
        { error: 'Keywords array is required' },
        { status: 400 }
      );
    }

    const collections = await getCollections();

    // Generate embeddings for all keywords in parallel
    const embeddingPromises = keywords.map(keyword => 
      generateEmbedding(keyword).then(embedding => ({ keyword, embedding }))
    );
    const keywordEmbeddings = await Promise.all(embeddingPromises);

    // Filter out keywords that failed to generate embeddings
    const validKeywordEmbeddings = keywordEmbeddings.filter(
      ({ embedding }) => embedding !== null
    ) as Array<{ keyword: string; embedding: number[] }>;

    if (validKeywordEmbeddings.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate embeddings for any keyword' },
        { status: 500 }
      );
    }

    const numCandidates = 600; // For 200 results, we need more candidates
    const initialLimit = 200; // Get more initially to filter down

    // Collection configurations
    const collectionConfigs = [
      { collection: collections.conversations, name: 'wc_included_conversations_collection' },
      { collection: collections.wc_4_8M, name: 'wc_4_8M_included_conversations_collection' },
      { collection: collections.lm, name: 'lm_included_conversations_collection' },
    ];

    // Search function for a single keyword and collection
    const searchKeywordCollection = async (
      keyword: string,
      embedding: number[],
      collection: any,
      collectionName: string
    ): Promise<SearchResult[]> => {
      try {
        const pipeline = [
          {
            $vectorSearch: {
              index: 'first_prompt_vector_index',
              path: 'first_prompt_vector',
              queryVector: embedding,
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
        ];

        const cursor = collection.aggregate(pipeline, { maxTimeMS: 30000 });
        const results = await cursor.toArray();

        // Map results to SearchResult format
        return results
          .filter((result: any) => result.first_prompt && typeof result.first_prompt === 'string')
          .map((result: any) => ({
            keyword,
            collection: collectionName,
            first_prompt: result.first_prompt,
            similarityScore: result.similarityScore || 0,
          }));
      } catch (error: any) {
        console.error(`Error searching collection ${collectionName} for keyword ${keyword}:`, error.message);
        return []; // Return empty array on error
      }
    };

    // For each keyword, search all collections in parallel
    const keywordSearchPromises = validKeywordEmbeddings.map(({ keyword, embedding }) => {
      // Create promises for all collections for this keyword
      const collectionSearchPromises = collectionConfigs.map(({ collection, name }) =>
        searchKeywordCollection(keyword, embedding, collection, name)
      );
      
      // Wait for all collections to complete, then combine and limit results
      return Promise.all(collectionSearchPromises).then(collectionResults => {
        // Flatten results from all collections
        const allKeywordResults = collectionResults.flat();
        // Sort by similarity score (descending) and limit to 200 per keyword
        allKeywordResults.sort((a, b) => b.similarityScore - a.similarityScore);
        return allKeywordResults.slice(0, 200);
      });
    });

    // Wait for all keyword searches to complete in parallel
    const allKeywordResults = await Promise.all(keywordSearchPromises);
    
    // Flatten all results and sort by similarity score (descending)
    const allResults = allKeywordResults.flat();
    allResults.sort((a, b) => b.similarityScore - a.similarityScore);

    return NextResponse.json({
      results: allResults,
      total: allResults.length,
    });
  } catch (error: any) {
    console.error('Error in search-keywords API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to search keywords' },
      { status: 500 }
    );
  }
}

