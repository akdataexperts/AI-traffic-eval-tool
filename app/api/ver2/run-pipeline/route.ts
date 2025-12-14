import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { findSimilarPromptsWithDetails, PromptWithDetails } from '@/lib/mongodb';
import {
  analyzeWebsiteWithGpt4o,
  getDescriptionsFromAnalysis,
  selectTopPromptsWithGpt,
  filterPromptsWithGpt,
  groupPromptsWithGpt,
  WebsiteAnalysis,
  TOTAL_RESULTS_LIMIT,
} from '@/lib/domain-analysis';

// =============================================================================
// TYPES
// =============================================================================

interface PipelineRequest {
  websiteUrl: string;
  startStage?: number; // 1-6, defaults to 1
  endStage?: number;   // 1-6, defaults to 6
  prompts?: {
    stage1?: string;
    stage2?: string;
    stage4?: string;
    stage5?: string;
    stage6?: string;
  };
  // Previous results needed when starting from a stage > 1
  previousResults?: {
    stage1_website_analysis?: {
      analysis: string;
      model: string;
      prompt: string;
    };
    stage2_descriptions?: {
      descriptions: string[];
      model: string;
      prompt: string;
    };
    stage3_similar_prompts?: {
      prompts: Array<{ prompt: string; similarity: number; collection: string }>;
      total: number;
    };
    stage4_selected_prompts?: {
      prompts: string[];
      model: string;
      prompt: string;
    };
    stage5_filtered_prompts?: {
      prompts: string[];
      model: string;
      prompt: string;
    };
  };
}

interface PipelineResponse {
  stage1_website_analysis: {
    analysis: string;
    model: string;
    prompt: string;
  } | null;
  stage2_descriptions: {
    descriptions: string[];
    model: string;
    prompt: string;
  } | null;
  stage3_similar_prompts: {
    prompts: Array<{ prompt: string; similarity: number; collection: string }>;
    total: number;
  } | null;
  stage4_selected_prompts: {
    prompts: string[];
    model: string;
    prompt: string;
  } | null;
  stage5_filtered_prompts: {
    prompts: string[];
    model: string;
    prompt: string;
  } | null;
  stage6_grouped_prompts: {
    groups: Array<{ group_name: string; description: string; prompts: string[] }>;
    model: string;
    prompt: string;
  } | null;
  error?: string;
  executedStages?: number[]; // Which stages were executed in this request
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Ver2Pipeline] ${message}`);
}

// =============================================================================
// MAIN PIPELINE API
// =============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: PipelineRequest = await request.json();
    const { websiteUrl, prompts, previousResults } = body;
    const startStage = body.startStage || 1;
    const endStage = body.endStage || 6;

    if (!websiteUrl) {
      return NextResponse.json(
        { error: 'Website URL is required' },
        { status: 400 }
      );
    }

    // Validate stage range
    if (startStage < 1 || startStage > 6 || endStage < 1 || endStage > 6 || startStage > endStage) {
      return NextResponse.json(
        { error: 'Invalid stage range. startStage and endStage must be between 1-6, and startStage <= endStage' },
        { status: 400 }
      );
    }

    log(`Starting pipeline for: ${websiteUrl} (stages ${startStage}-${endStage})`);

    const response: PipelineResponse = {
      stage1_website_analysis: previousResults?.stage1_website_analysis || null,
      stage2_descriptions: previousResults?.stage2_descriptions || null,
      stage3_similar_prompts: previousResults?.stage3_similar_prompts || null,
      stage4_selected_prompts: previousResults?.stage4_selected_prompts || null,
      stage5_filtered_prompts: previousResults?.stage5_filtered_prompts || null,
      stage6_grouped_prompts: null,
      executedStages: [],
    };

    // Variables to track data flow between stages
    let websiteAnalysis: WebsiteAnalysis | null = previousResults?.stage1_website_analysis 
      ? { analysis: previousResults.stage1_website_analysis.analysis, model: previousResults.stage1_website_analysis.model }
      : null;
    let descriptions: string[] = previousResults?.stage2_descriptions?.descriptions || [];
    let allPromptResults: PromptWithDetails[] = previousResults?.stage3_similar_prompts?.prompts.map(p => ({
      first_prompt: p.prompt,
      similarityScore: p.similarity,
      collection: p.collection,
    })) || [];
    let selectedPrompts: string[] = previousResults?.stage4_selected_prompts?.prompts || [];
    let filteredPrompts: string[] = previousResults?.stage5_filtered_prompts?.prompts || [];

    // =========================================================================
    // STAGE 1: Analyze Website with GPT-4o (web search)
    // =========================================================================
    if (startStage <= 1 && endStage >= 1) {
      log('Stage 1: Analyzing website...');
      const stage1Start = Date.now();
      
      try {
        websiteAnalysis = await analyzeWebsiteWithGpt4o(websiteUrl, prompts?.stage1);
        response.stage1_website_analysis = {
          analysis: websiteAnalysis.analysis,
          model: websiteAnalysis.model || 'gpt-4o',
          prompt: prompts?.stage1 || 'default',
        };
        response.executedStages?.push(1);
        log(`Stage 1 completed in ${Date.now() - stage1Start}ms`);
      } catch (error: any) {
        log(`Stage 1 failed: ${error.message}`);
        return NextResponse.json(
          { ...response, error: `Stage 1 failed: ${error.message}` },
          { status: 500 }
        );
      }
    } else if (startStage > 1 && !websiteAnalysis) {
      return NextResponse.json(
        { error: 'Stage 1 results (website analysis) are required to run stages 2-6' },
        { status: 400 }
      );
    }

    if (endStage === 1) {
      const totalDuration = Date.now() - startTime;
      log(`Pipeline completed successfully in ${totalDuration}ms (stages ${startStage}-${endStage})`);
      return NextResponse.json(response);
    }

    // =========================================================================
    // STAGE 2: Generate Descriptions from Analysis
    // =========================================================================
    if (startStage <= 2 && endStage >= 2) {
      log('Stage 2: Generating descriptions...');
      const stage2Start = Date.now();
      
      try {
        const stage2Result = await getDescriptionsFromAnalysis(websiteAnalysis!, prompts?.stage2);
        descriptions = stage2Result.descriptions;
        response.stage2_descriptions = {
          descriptions: stage2Result.descriptions,
          model: stage2Result.model,
          prompt: stage2Result.prompt,
        };
        response.executedStages?.push(2);
        log(`Stage 2 completed in ${Date.now() - stage2Start}ms - Generated ${descriptions.length} descriptions`);
      } catch (error: any) {
        log(`Stage 2 failed: ${error.message}`);
        return NextResponse.json(
          { ...response, error: `Stage 2 failed: ${error.message}` },
          { status: 500 }
        );
      }
    } else if (startStage > 2 && descriptions.length === 0) {
      return NextResponse.json(
        { error: 'Stage 2 results (descriptions) are required to run stages 3-6' },
        { status: 400 }
      );
    }

    if (endStage === 2) {
      const totalDuration = Date.now() - startTime;
      log(`Pipeline completed successfully in ${totalDuration}ms (stages ${startStage}-${endStage})`);
      return NextResponse.json(response);
    }

    // =========================================================================
    // STAGE 3: Find Similar Prompts (Vector Search)
    // =========================================================================
    if (startStage <= 3 && endStage >= 3) {
      log('Stage 3: Finding similar prompts via vector search...');
      const stage3Start = Date.now();
      
      try {
        // Process all descriptions in parallel
        const searchPromises = descriptions.map(async (desc) => {
          log(`Generating embedding for: "${desc}"`);
          const embedding = await generateEmbedding(desc);
          if (!embedding) {
            log(`Failed to generate embedding for: "${desc}"`);
            return [];
          }
          return findSimilarPromptsWithDetails(embedding, TOTAL_RESULTS_LIMIT);
        });

        const results = await Promise.all(searchPromises);
        
        // Combine all results
        allPromptResults = [];
        for (const descriptionResults of results) {
          allPromptResults.push(...descriptionResults);
        }

        // Remove duplicates by first_prompt while keeping highest similarity
        const uniqueMap = new Map<string, PromptWithDetails>();
        for (const r of allPromptResults) {
          const existing = uniqueMap.get(r.first_prompt);
          if (!existing || r.similarityScore > existing.similarityScore) {
            uniqueMap.set(r.first_prompt, r);
          }
        }
        allPromptResults = Array.from(uniqueMap.values());

        // Sort by similarity score
        allPromptResults.sort((a, b) => b.similarityScore - a.similarityScore);

        response.stage3_similar_prompts = {
          prompts: allPromptResults.map(r => ({
            prompt: r.first_prompt,
            similarity: r.similarityScore,
            collection: r.collection,
          })),
          total: allPromptResults.length,
        };
        response.executedStages?.push(3);
        
        log(`Stage 3 completed in ${Date.now() - stage3Start}ms - Found ${allPromptResults.length} unique prompts`);
      } catch (error: any) {
        log(`Stage 3 failed: ${error.message}`);
        return NextResponse.json(
          { ...response, error: `Stage 3 failed: ${error.message}` },
          { status: 500 }
        );
      }
    } else if (startStage > 3 && allPromptResults.length === 0) {
      return NextResponse.json(
        { error: 'Stage 3 results (similar prompts) are required to run stages 4-6' },
        { status: 400 }
      );
    }

    if (endStage === 3) {
      const totalDuration = Date.now() - startTime;
      log(`Pipeline completed successfully in ${totalDuration}ms (stages ${startStage}-${endStage})`);
      return NextResponse.json(response);
    }

    // =========================================================================
    // STAGE 4: Select Top Prompts with GPT
    // =========================================================================
    if (startStage <= 4 && endStage >= 4) {
      log('Stage 4: Selecting top prompts with GPT...');
      const stage4Start = Date.now();
      
      try {
        const stage4Result = await selectTopPromptsWithGpt(
          websiteAnalysis!,
          allPromptResults,
          prompts?.stage4
        );
        selectedPrompts = stage4Result.prompts;
        response.stage4_selected_prompts = {
          prompts: stage4Result.prompts,
          model: stage4Result.model,
          prompt: stage4Result.prompt,
        };
        response.executedStages?.push(4);
        log(`Stage 4 completed in ${Date.now() - stage4Start}ms - Selected ${selectedPrompts.length} prompts`);
      } catch (error: any) {
        log(`Stage 4 failed: ${error.message}`);
        return NextResponse.json(
          { ...response, error: `Stage 4 failed: ${error.message}` },
          { status: 500 }
        );
      }
    } else if (startStage > 4 && selectedPrompts.length === 0) {
      return NextResponse.json(
        { error: 'Stage 4 results (selected prompts) are required to run stages 5-6' },
        { status: 400 }
      );
    }

    if (endStage === 4) {
      const totalDuration = Date.now() - startTime;
      log(`Pipeline completed successfully in ${totalDuration}ms (stages ${startStage}-${endStage})`);
      return NextResponse.json(response);
    }

    // =========================================================================
    // STAGE 5: Filter Prompts with GPT
    // =========================================================================
    if (startStage <= 5 && endStage >= 5) {
      log('Stage 5: Filtering prompts with GPT...');
      const stage5Start = Date.now();
      
      try {
        const stage5Result = await filterPromptsWithGpt(
          selectedPrompts,
          websiteAnalysis!,
          prompts?.stage5
        );
        filteredPrompts = stage5Result.prompts;
        response.stage5_filtered_prompts = {
          prompts: stage5Result.prompts,
          model: stage5Result.model,
          prompt: stage5Result.prompt,
        };
        response.executedStages?.push(5);
        log(`Stage 5 completed in ${Date.now() - stage5Start}ms - Filtered to ${filteredPrompts.length} prompts`);
      } catch (error: any) {
        log(`Stage 5 failed: ${error.message}`);
        return NextResponse.json(
          { ...response, error: `Stage 5 failed: ${error.message}` },
          { status: 500 }
        );
      }

      // Handle case where all prompts were filtered out
      if (filteredPrompts.length === 0) {
        log('All prompts filtered out, using selected prompts as fallback');
        filteredPrompts = selectedPrompts.slice(0, 25);
        response.stage5_filtered_prompts = {
          prompts: filteredPrompts,
          model: 'fallback',
          prompt: 'All prompts filtered out, using selected prompts as fallback',
        };
      }
    } else if (startStage > 5 && filteredPrompts.length === 0) {
      return NextResponse.json(
        { error: 'Stage 5 results (filtered prompts) are required to run stage 6' },
        { status: 400 }
      );
    }

    if (endStage === 5) {
      const totalDuration = Date.now() - startTime;
      log(`Pipeline completed successfully in ${totalDuration}ms (stages ${startStage}-${endStage})`);
      return NextResponse.json(response);
    }

    // =========================================================================
    // STAGE 6: Group Prompts with GPT
    // =========================================================================
    if (startStage <= 6 && endStage >= 6) {
      log('Stage 6: Grouping prompts with GPT...');
      const stage6Start = Date.now();
      
      try {
        const stage6Result = await groupPromptsWithGpt(
          filteredPrompts,
          websiteAnalysis!,
          prompts?.stage6
        );
        response.stage6_grouped_prompts = {
          groups: stage6Result.groups,
          model: stage6Result.model,
          prompt: stage6Result.prompt,
        };
        response.executedStages?.push(6);
        log(`Stage 6 completed in ${Date.now() - stage6Start}ms - Created ${stage6Result.groups.length} groups`);
      } catch (error: any) {
        log(`Stage 6 failed: ${error.message}`);
        return NextResponse.json(
          { ...response, error: `Stage 6 failed: ${error.message}` },
          { status: 500 }
        );
      }
    }

    // =========================================================================
    // COMPLETE
    // =========================================================================
    const totalDuration = Date.now() - startTime;
    log(`Pipeline completed successfully in ${totalDuration}ms (stages ${startStage}-${endStage})`);

    return NextResponse.json(response);

  } catch (error: any) {
    log(`Pipeline failed with error: ${error.message}`);
    console.error('Pipeline error:', error);
    return NextResponse.json(
      { error: error.message || 'Pipeline failed' },
      { status: 500 }
    );
  }
}


