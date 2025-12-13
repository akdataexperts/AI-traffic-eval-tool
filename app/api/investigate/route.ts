import { NextRequest, NextResponse } from 'next/server';
import { getPerplexityClient } from '@/lib/perplexity';
import { getOpenAIClient } from '@/lib/openai';
import { getGeminiClient } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const { website_url, custom_prompt } = await request.json();

    if (!website_url) {
      return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
    }

    // Normalize the URL
    let normalizedUrl = website_url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    const url = new URL(normalizedUrl);
    const baseDomain = `${url.protocol}//${url.host}`;
    const domainName = url.host.replace('www.', '');

    console.log(`[${new Date().toISOString()}] Investigating offerings for: ${domainName} using all three models`);

    if (!custom_prompt) {
      return NextResponse.json({ error: 'Custom prompt is required' }, { status: 400 });
    }

    const perplexityClient = getPerplexityClient();
    const openAIClient = getOpenAIClient();
    const geminiClient = getGeminiClient();

    // Replace placeholders in custom prompt
    const prompt = custom_prompt
      .replace(/\{domainName\}/g, domainName)
      .replace(/\{baseDomain\}/g, baseDomain);

    // Helper function to parse model response
    const parseModelResponse = (content: string, modelName: string) => {
      console.log(`[${new Date().toISOString()}] ${modelName} raw response:`, content.substring(0, 500));
      
      const keywords: Array<{
        keyword: string;
        phrasing_index?: number;
        is_main?: boolean;
      }> = [];

      // Parse keywords separated by | - can be on single line or multiple lines
      // Join all lines first, then split by |
      const allText = content.trim();
      
      // Split by | and clean up each keyword
      const keywordParts = allText
        .split('|')
        .map(k => k.trim())
        .filter(k => k && k.length > 0);
      
      // Extract keywords from the response
      keywordParts.forEach((keyword, index) => {
        // Clean up any extra whitespace or newlines
        const cleanKeyword = keyword.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanKeyword) {
          keywords.push({
            keyword: cleanKeyword,
            phrasing_index: index + 1,
            is_main: index === 0,
          });
        }
      });

      // Fallback if no keywords found
      if (keywords.length === 0) {
        keywords.push({
          keyword: `main offering ${domainName}`,
          phrasing_index: 1,
          is_main: true,
        });
      }

      return {
        keywords,
        problems_and_solutions: [],
        persona: 'General audience',
        business_type: 'Unknown',
      };
    };

    // Call all three models in parallel
    console.log(`[${new Date().toISOString()}] Sending investigation requests to all three models in parallel`);
    
    const [perplexityResponse, openaiResponse, geminiResponse] = await Promise.allSettled([
      // Perplexity Sonar
      perplexityClient.chat.completions.create({
        model: 'sonar',
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.1,
        max_tokens: 400,
      }).then(response => {
        if (!response || !response.choices || !response.choices[0].message.content) {
          throw new Error('Perplexity returned empty response');
        }
        return response.choices[0].message.content.trim();
      }),
      
      // OpenAI GPT with Web Search enabled
      openAIClient.responses.create({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' }],
        input: prompt,
      }).then(response => {
        if (!response || !response.output_text) {
          throw new Error('OpenAI returned empty response');
        }
        const content = response.output_text.trim();
        console.log(`[${new Date().toISOString()}] GPT raw response (first 500 chars):`, content.substring(0, 500));
        return content;
      }),
      
      // Gemini 2.5 Pro (Note: If Gemini 2.5 Pro is not available, adjust model name to available version)
      geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash-lite' }).generateContent(prompt).then(response => {
        const text = response.response.text();
        if (!text) {
          throw new Error('Gemini returned empty response');
        }
        const content = text.trim();
        console.log(`[${new Date().toISOString()}] Gemini raw response (first 500 chars):`, content.substring(0, 500));
        return content;
      }),
    ]);

    // Parse responses and store raw responses
    const results: {
      perplexity?: any;
      gpt?: any;
      gemini?: any;
    } = {};

    if (perplexityResponse.status === 'fulfilled') {
      try {
        const parsed = parseModelResponse(perplexityResponse.value, 'Perplexity Sonar');
        results.perplexity = {
          ...parsed,
          raw_response: perplexityResponse.value,
          model_name: 'sonar',
        };
      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error parsing Perplexity response:`, error);
        results.perplexity = { 
          error: error.message,
          raw_response: perplexityResponse.value || 'No response received',
          model_name: 'sonar',
        };
      }
    } else {
      console.error(`[${new Date().toISOString()}] Perplexity request failed:`, perplexityResponse.reason);
      results.perplexity = { 
        error: perplexityResponse.reason?.message || 'Perplexity request failed',
        raw_response: 'Request failed - no response received',
        model_name: 'sonar',
      };
    }

    if (openaiResponse.status === 'fulfilled') {
      try {
        const parsed = parseModelResponse(openaiResponse.value, 'GPT');
        results.gpt = {
          ...parsed,
          raw_response: openaiResponse.value,
          model_name: 'gpt-4o (with web_search_preview)',
        };
      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error parsing GPT response:`, error);
        results.gpt = { 
          error: error.message,
          raw_response: openaiResponse.value || 'No response received',
          model_name: 'gpt-4o (with web_search_preview)',
        };
      }
    } else {
      console.error(`[${new Date().toISOString()}] GPT request failed:`, openaiResponse.reason);
      results.gpt = { 
        error: openaiResponse.reason?.message || 'GPT request failed',
        raw_response: 'Request failed - no response received',
        model_name: 'gpt-4o (with web_search_preview)',
      };
    }

    if (geminiResponse.status === 'fulfilled') {
      try {
        const parsed = parseModelResponse(geminiResponse.value, 'Gemini');
        results.gemini = {
          ...parsed,
          raw_response: geminiResponse.value,
          model_name: 'gemini-2.0-flash-lite',
        };
      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error parsing Gemini response:`, error);
        results.gemini = { 
          error: error.message,
          raw_response: geminiResponse.value || 'No response received',
          model_name: 'gemini-2.0-flash-lite',
        };
      }
    } else {
      console.error(`[${new Date().toISOString()}] Gemini request failed:`, geminiResponse.reason);
      results.gemini = { 
        error: geminiResponse.reason?.message || 'Gemini request failed',
        raw_response: 'Request failed - no response received',
        model_name: 'gemini-2.0-flash-lite',
      };
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Error investigating website:', error);
    return NextResponse.json({ error: error.message || 'Failed to investigate website' }, { status: 500 });
  }
}

