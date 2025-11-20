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

    // Calculate similarity scores
    console.log(`[${new Date().toISOString()}] Calculating similarity scores...`);
    const similarityResults: Array<{
      keyword: string;
      fileName: string;
      similarities: Array<{
        perplexity_keyword: string;
        phrasing_index?: number;
        is_main?: boolean;
        similarity_score: number;
      }>;
    }> = [];

    for (const excelKeywordData of excelKeywordEmbeddings) {
      if (!excelKeywordData.embedding) {
        console.warn(`[${new Date().toISOString()}] Skipping Excel keyword "${excelKeywordData.keyword}" - no embedding generated`);
        continue;
      }

      // Store embedding in a const to help TypeScript with type narrowing
      const excelEmbedding = excelKeywordData.embedding;

      const similarities = perplexityKeywordEmbeddings.map((perplexityKeywordData) => {
        if (!perplexityKeywordData.embedding) {
          return {
            perplexity_keyword: perplexityKeywordData.keyword,
            phrasing_index: perplexityKeywordData.phrasing_index,
            is_main: perplexityKeywordData.is_main,
            similarity_score: 0,
          };
        }

        const score = cosineSimilarity(excelEmbedding, perplexityKeywordData.embedding);
        return {
          perplexity_keyword: perplexityKeywordData.keyword,
          phrasing_index: perplexityKeywordData.phrasing_index,
          is_main: perplexityKeywordData.is_main,
          similarity_score: score,
        };
      });

      // Sort similarities by score (descending)
      similarities.sort((a, b) => b.similarity_score - a.similarity_score);

      similarityResults.push({
        keyword: excelKeywordData.keyword,
        fileName: excelKeywordData.fileName,
        similarities,
      });
    }

    console.log(`[${new Date().toISOString()}] Similarity calculation complete`);

    return NextResponse.json({
      success: true,
      results: similarityResults,
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error calculating similarities:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate similarities' },
      { status: 500 }
    );
  }
}

