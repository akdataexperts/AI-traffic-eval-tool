import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';

// Calculate cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { excelKeywords, perplexityKeywords } = body;

    if (!excelKeywords || !Array.isArray(excelKeywords) || excelKeywords.length === 0) {
      return NextResponse.json(
        { error: 'Excel keywords array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!perplexityKeywords || !Array.isArray(perplexityKeywords) || perplexityKeywords.length === 0) {
      return NextResponse.json(
        { error: 'Perplexity keywords array is required and must not be empty' },
        { status: 400 }
      );
    }

    console.log(`[${new Date().toISOString()}] Starting similarity calculation for ${excelKeywords.length} Excel keywords and ${perplexityKeywords.length} Perplexity keywords`);

    // Generate embeddings for Excel keywords
    console.log(`[${new Date().toISOString()}] Generating embeddings for Excel keywords...`);
    const excelKeywordEmbeddings: Array<{ keyword: string; fileName: string; embedding: number[] | null }> = [];
    
    for (const keywordData of excelKeywords) {
      const embedding = await generateEmbedding(keywordData.keyword);
      excelKeywordEmbeddings.push({
        keyword: keywordData.keyword,
        fileName: keywordData.fileName,
        embedding,
      });
      console.log(`[${new Date().toISOString()}] Generated embedding for Excel keyword: ${keywordData.keyword}`);
    }

    // Generate embeddings for Perplexity keywords
    console.log(`[${new Date().toISOString()}] Generating embeddings for Perplexity keywords...`);
    const perplexityKeywordEmbeddings: Array<{
      keyword: string;
      phrasing_index?: number;
      is_main?: boolean;
      embedding: number[] | null;
    }> = [];

    for (const perplexityKeyword of perplexityKeywords) {
      const embedding = await generateEmbedding(perplexityKeyword.keyword);
      perplexityKeywordEmbeddings.push({
        keyword: perplexityKeyword.keyword,
        phrasing_index: perplexityKeyword.phrasing_index,
        is_main: perplexityKeyword.is_main,
        embedding,
      });
      console.log(`[${new Date().toISOString()}] Generated embedding for Perplexity keyword: ${perplexityKeyword.keyword}`);
    }

    // Calculate similarity scores and create one-to-one matching
    console.log(`[${new Date().toISOString()}] Calculating similarity scores and creating one-to-one matches...`);
    
    // First, calculate all similarity scores
    interface SimilarityPair {
      excelIndex: number;
      perplexityIndex: number;
      score: number;
    }

    const allPairs: SimilarityPair[] = [];

    for (let excelIdx = 0; excelIdx < excelKeywordEmbeddings.length; excelIdx++) {
      const excelKeywordData = excelKeywordEmbeddings[excelIdx];
      if (!excelKeywordData.embedding) {
        console.warn(`[${new Date().toISOString()}] Skipping Excel keyword "${excelKeywordData.keyword}" - no embedding generated`);
        continue;
      }

      const excelEmbedding = excelKeywordData.embedding;

      for (let perplexityIdx = 0; perplexityIdx < perplexityKeywordEmbeddings.length; perplexityIdx++) {
        const perplexityKeywordData = perplexityKeywordEmbeddings[perplexityIdx];
        if (!perplexityKeywordData.embedding) {
          continue;
        }

        const score = cosineSimilarity(excelEmbedding, perplexityKeywordData.embedding);
        allPairs.push({
          excelIndex: excelIdx,
          perplexityIndex: perplexityIdx,
          score,
        });
      }
    }

    // Sort pairs by score (descending) to prioritize best matches
    allPairs.sort((a, b) => b.score - a.score);

    // Create one-to-one matching using greedy algorithm
    const matchedExcelIndices = new Set<number>();
    const matchedPerplexityIndices = new Set<number>();
    const matches = new Map<number, { perplexityIndex: number; score: number }>(); // excelIndex -> {perplexityIndex, score}

    for (const pair of allPairs) {
      // If both Excel and Perplexity keywords are unmatched, create a match
      if (!matchedExcelIndices.has(pair.excelIndex) && !matchedPerplexityIndices.has(pair.perplexityIndex)) {
        matchedExcelIndices.add(pair.excelIndex);
        matchedPerplexityIndices.add(pair.perplexityIndex);
        matches.set(pair.excelIndex, {
          perplexityIndex: pair.perplexityIndex,
          score: pair.score,
        });
      }
    }

    // Build similarity results with all LLM keywords, marking the matched one
    const similarityResults: Array<{
      keyword: string;
      fileName: string;
      similarities: Array<{
        perplexity_keyword: string;
        phrasing_index?: number;
        is_main?: boolean;
        similarity_score: number;
        is_matched?: boolean;
      }>;
    }> = [];

    const matchedScores: number[] = [];

    for (let excelIdx = 0; excelIdx < excelKeywordEmbeddings.length; excelIdx++) {
      const excelKeywordData = excelKeywordEmbeddings[excelIdx];
      const match = matches.get(excelIdx);

      // Calculate all similarities for this Excel keyword
      const excelEmbedding = excelKeywordData.embedding;
      const similarities = perplexityKeywordEmbeddings
        .map((perplexityKeywordData, perplexityIdx) => {
          if (!perplexityKeywordData.embedding || !excelEmbedding) {
            return null;
          }

          const score = cosineSimilarity(excelEmbedding, perplexityKeywordData.embedding);
          return {
            perplexity_keyword: perplexityKeywordData.keyword,
            phrasing_index: perplexityKeywordData.phrasing_index,
            is_main: perplexityKeywordData.is_main,
            similarity_score: score,
            is_matched: match?.perplexityIndex === perplexityIdx,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      // Sort by score descending
      similarities.sort((a, b) => b.similarity_score - a.similarity_score);

      similarityResults.push({
        keyword: excelKeywordData.keyword,
        fileName: excelKeywordData.fileName,
        similarities,
      });

      if (match) {
        matchedScores.push(match.score);
      } else {
        matchedScores.push(0);
      }
    }

    // Calculate total similarity score (average of all matched scores)
    const totalSimilarityScore = matchedScores.length > 0
      ? matchedScores.reduce((sum, score) => sum + score, 0) / matchedScores.length
      : 0;

    console.log(`[${new Date().toISOString()}] Similarity calculation complete. Total score: ${totalSimilarityScore.toFixed(4)}`);

    return NextResponse.json({
      success: true,
      results: similarityResults,
      total_score: totalSimilarityScore,
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error calculating similarities:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate similarities' },
      { status: 500 }
    );
  }
}

