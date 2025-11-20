import { GoogleGenerativeAI } from '@google/generative-ai';

export function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not configured');
  }

  return new GoogleGenerativeAI(apiKey);
}


