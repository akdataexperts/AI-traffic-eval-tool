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
    const domainName = url.host.replace('www.', '');

    console.log(`[${new Date().toISOString()}] Bronze Filtering Stage 1: Getting additional info for ${domainName}`);

    const perplexityClient = getPerplexityClient();
    const openAIClient = getOpenAIClient();
    const geminiClient = getGeminiClient();

    // The prompt is always sent from the frontend (even if it's the default)
    // Replace placeholders in the prompt
    if (!custom_prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    
    const prompt = custom_prompt
      .replace(/\{domainName\}/g, domainName)
      .replace(/\{baseDomain\}/g, normalizedUrl);

    // Call all three models in parallel
    console.log(`[${new Date().toISOString()}] Sending bronze filtering stage 1 requests to all three models in parallel`);
    
    const [perplexityResponse, openaiResponse, geminiResponse] = await Promise.allSettled([
      // Perplexity Sonar
      perplexityClient.chat.completions.create({
        model: 'sonar',
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
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
      
      // Gemini
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

    // Parse responses
    const results: {
      perplexity?: any;
      gpt?: any;
      gemini?: any;
    } = {};

    if (perplexityResponse.status === 'fulfilled') {
      results.perplexity = {
        response: perplexityResponse.value,
        model_name: 'sonar',
      };
    } else {
      console.error(`[${new Date().toISOString()}] Perplexity request failed:`, perplexityResponse.reason);
      results.perplexity = { 
        error: perplexityResponse.reason?.message || 'Perplexity request failed',
        model_name: 'sonar',
      };
    }

    if (openaiResponse.status === 'fulfilled') {
      results.gpt = {
        response: openaiResponse.value,
        model_name: 'gpt-4o (with web_search_preview)',
      };
    } else {
      console.error(`[${new Date().toISOString()}] GPT request failed:`, openaiResponse.reason);
      results.gpt = { 
        error: openaiResponse.reason?.message || 'GPT request failed',
        model_name: 'gpt-4o (with web_search_preview)',
      };
    }

    if (geminiResponse.status === 'fulfilled') {
      results.gemini = {
        response: geminiResponse.value,
        model_name: 'gemini-2.0-flash-lite',
      };
    } else {
      console.error(`[${new Date().toISOString()}] Gemini request failed:`, geminiResponse.reason);
      results.gemini = { 
        error: geminiResponse.reason?.message || 'Gemini request failed',
        model_name: 'gemini-2.0-flash-lite',
      };
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Error in bronze filtering stage 1:', error);
    return NextResponse.json({ error: error.message || 'Failed to get additional website info' }, { status: 500 });
  }
}

