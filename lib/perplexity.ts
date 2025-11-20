import OpenAI from 'openai';

export function getPerplexityClient() {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY is not configured');
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.perplexity.ai',
  });
}


