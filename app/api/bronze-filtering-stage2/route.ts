import { NextRequest, NextResponse } from 'next/server';
import { getGeminiClient } from '@/lib/gemini';
import { getPerplexityClient } from '@/lib/perplexity';
import { getOpenAIClient } from '@/lib/openai';

interface RankingResult {
  prompt: string;
  keyword: string;
  collection: string;
  relevance_score: string;
  reason: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { 
      website_url, 
      expert_analysis, 
      prompts, 
      system_prompt, 
      user_prompt_template,
      selected_llm 
    } = await request.json();

    if (!website_url) {
      return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
    }

    if (!expert_analysis) {
      return NextResponse.json({ error: 'Expert analysis is required' }, { status: 400 });
    }

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      return NextResponse.json({ error: 'Prompts array is required' }, { status: 400 });
    }

    if (!system_prompt) {
      return NextResponse.json({ error: 'System prompt is required' }, { status: 400 });
    }

    if (!user_prompt_template) {
      return NextResponse.json({ error: 'User prompt template is required' }, { status: 400 });
    }

    if (!selected_llm) {
      return NextResponse.json({ error: 'Selected LLM is required' }, { status: 400 });
    }

    console.log(`[${new Date().toISOString()}] Bronze Filtering Stage 2: Ranking ${prompts.length} prompts using ${selected_llm}`);

    // Process prompts in batches of 100
    const batchSize = 100;
    const batches: typeof prompts[] = [];
    for (let i = 0; i < prompts.length; i += batchSize) {
      batches.push(prompts.slice(i, i + batchSize));
    }

    const allResults: RankingResult[] = [];
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[${new Date().toISOString()}] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} prompts)`);

      // Process all prompts in the batch in parallel
      const batchPromises = batch.map(async (promptData: any) => {
        try {
          // Build user prompt from template
          // If template already has >>>{prompt}<<<, just replace {prompt}
          // Otherwise, wrap it in >>> <<<
          let promptReplacement = promptData.first_prompt;
          if (!user_prompt_template.includes('>>>{prompt}<<<') && !user_prompt_template.includes('>>> {prompt} <<<')) {
            promptReplacement = `>>>${promptData.first_prompt}<<<`;
          }
          
          const userPrompt = user_prompt_template
            .replace(/\{website_url\}/g, website_url)
            .replace(/\{expert_analysis\}/g, expert_analysis)
            .replace(/\{prompt\}/g, promptReplacement);

          let responseText = '';
          let error: string | undefined = undefined;

          if (selected_llm === 'gemini') {
            const geminiClient = getGeminiClient();
            const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
            
            const fullPrompt = `${system_prompt}\n\n${userPrompt}`;
            
            try {
              const response = await model.generateContent(fullPrompt);
              responseText = response.response.text().trim();
            } catch (err: any) {
              error = err.message || 'Gemini request failed';
              console.error(`[${new Date().toISOString()}] Gemini error for prompt:`, error);
            }
          } else if (selected_llm === 'perplexity') {
            // Placeholder - disabled for now
            error = 'Perplexity is not yet enabled for ranking';
          } else if (selected_llm === 'gpt') {
            // Placeholder - disabled for now
            error = 'GPT is not yet enabled for ranking';
          }

          if (error) {
            return {
              prompt: promptData.first_prompt,
              keyword: promptData.keyword || '',
              collection: promptData.collection || '',
              relevance_score: 'None',
              reason: error,
              error: error,
            };
          }

          // Parse JSON response
          let relevance_score = 'None';
          let reason = 'LLM couldn\'t generate a response';

          try {
            // Try to extract JSON from the response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const jsonData = JSON.parse(jsonMatch[0]);
              relevance_score = jsonData['relevance score'] || jsonData.relevance_score || 'None';
              reason = jsonData.reason || 'No reason provided';
            } else {
              // Try to parse the entire response as JSON
              const jsonData = JSON.parse(responseText);
              relevance_score = jsonData['relevance score'] || jsonData.relevance_score || 'None';
              reason = jsonData.reason || 'No reason provided';
            }
          } catch (parseError) {
            // If JSON parsing fails, try to extract relevance score from text
            if (responseText.toLowerCase().includes('very relevant')) {
              relevance_score = 'Very relevant';
              reason = 'Extracted from response text';
            } else if (responseText.toLowerCase().includes('relevant') && !responseText.toLowerCase().includes('not relevant')) {
              relevance_score = 'Relevant';
              reason = 'Extracted from response text';
            } else if (responseText.toLowerCase().includes('not relevant')) {
              relevance_score = 'Not relevant';
              reason = 'Extracted from response text';
            } else {
              relevance_score = 'None';
              reason = 'Could not parse LLM response';
            }
          }

          return {
            prompt: promptData.first_prompt,
            keyword: promptData.keyword || '',
            collection: promptData.collection || '',
            relevance_score,
            reason,
          };
        } catch (err: any) {
          console.error(`[${new Date().toISOString()}] Error processing prompt:`, err);
          return {
            prompt: promptData.first_prompt || '',
            keyword: promptData.keyword || '',
            collection: promptData.collection || '',
            relevance_score: 'None',
            reason: err.message || 'Error processing prompt',
            error: err.message,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      allResults.push(...batchResults);
    }

    // Count results by relevance score
    const counts = {
      'Very relevant': allResults.filter(r => r.relevance_score === 'Very relevant').length,
      'Relevant': allResults.filter(r => r.relevance_score === 'Relevant').length,
      'Not relevant': allResults.filter(r => r.relevance_score === 'Not relevant').length,
      'None': allResults.filter(r => r.relevance_score === 'None').length,
    };

    return NextResponse.json({
      results: allResults,
      counts,
      total: allResults.length,
    });
  } catch (error: any) {
    console.error('Error in bronze filtering stage 2:', error);
    return NextResponse.json({ error: error.message || 'Failed to rank prompts' }, { status: 500 });
  }
}


