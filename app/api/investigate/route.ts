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

    const perplexityClient = getPerplexityClient();
    const openAIClient = getOpenAIClient();
    const geminiClient = getGeminiClient();

    // Use custom prompt if provided, otherwise use default
    // Replace placeholders in custom prompt
    let processedCustomPrompt = custom_prompt;
    if (processedCustomPrompt) {
      processedCustomPrompt = processedCustomPrompt.replace(/\{domainName\}/g, domainName);
      processedCustomPrompt = processedCustomPrompt.replace(/\{baseDomain\}/g, baseDomain);
    }

    const defaultPrompt = `Go online to ${domainName} and investigate what they do.

Based on your research, provide:
1. what are problems solved by ${domainName} & what are the solutions offered by ${domainName} 

give 3 answers with from 2 to 4 keywords 

more keywords for more specific answers
2. The primary client persona of the website and whether the business is B2B, B2C, or B2B + B2C

Format your response as follows:

Line 1: Problem 1 keywords (2-4 keywords, comma-separated) | Solution 1 keywords (2-4 keywords, comma-separated)
Line 2: Problem 2 keywords (2-4 keywords, comma-separated) | Solution 2 keywords (2-4 keywords, comma-separated)
Line 3: Problem 3 keywords (2-4 keywords, comma-separated) | Solution 3 keywords (2-4 keywords, comma-separated)
Line 4: persona | description | B2B/B2C/B2B + B2C

Example format:
data security challenges, compliance risks | enterprise encryption solutions, compliance management tools
scalability issues, performance bottlenecks | cloud infrastructure services, auto-scaling platforms
cost optimization, budget overruns | budget management software, resource allocation systems
persona | IT decision-makers at mid-sized tech companies | B2B

Important: Output ONLY the specified lines, nothing else.`;

    const prompt = processedCustomPrompt || defaultPrompt;

    // Helper function to parse model response
    const parseModelResponse = (content: string, modelName: string) => {
      console.log(`[${new Date().toISOString()}] ${modelName} raw response:`, content.substring(0, 500));
      
      const lines = content.split('\n').map((line) => line.trim()).filter((line) => line);
      console.log(`[${new Date().toISOString()}] ${modelName} returned ${lines.length} lines`);

      const problemsAndSolutions: Array<{
        problem: string;
        solution: string;
        problem_keywords: string[];
        solution_keywords: string[];
        index: number;
      }> = [];
      let personaInfo: string | null = null;
      let businessType = 'Unknown';

      // Parse problems and solutions (lines 1-3, 3 pairs)
      // Look for lines with "|" separator, skip lines that start with "Line X:" label
      let problemSolutionLineIndex = 0;
      for (let i = 0; i < lines.length && problemSolutionLineIndex < 3; i++) {
        let line = lines[i];
        
        // Remove "Line 1:", "Line 2:", "Line 3:" prefixes if present
        line = line.replace(/^Line\s*\d+\s*:\s*/i, '').trim();
        
        if (!line.includes('|')) {
          continue;
        }

        const parts = line.split('|').map((p) => p.trim());
        if (parts.length >= 2) {
          let problemText = parts[0];
          let solutionText = parts[1];
          
          // Remove any remaining "Line X" labels that might be in the text
          problemText = problemText.replace(/^Line\s*\d+\s*/i, '').trim();
          solutionText = solutionText.replace(/^Line\s*\d+\s*/i, '').trim();
          
          // Parse keywords (comma-separated, 2-4 keywords)
          const problemKeywords = problemText.split(',').map(k => k.trim()).filter(k => k && !k.match(/^Line\s*\d+$/i));
          const solutionKeywords = solutionText.split(',').map(k => k.trim()).filter(k => k && !k.match(/^Line\s*\d+$/i));

          if (problemKeywords.length > 0 && solutionKeywords.length > 0) {
            problemsAndSolutions.push({
              problem: problemText,
              solution: solutionText,
              problem_keywords: problemKeywords,
              solution_keywords: solutionKeywords,
              index: problemSolutionLineIndex + 1,
            });
            problemSolutionLineIndex++;
          }
        }
      }

      // Extract all keywords from problems and solutions
      const keywords: Array<{
        keyword: string;
        phrasing_index?: number;
        is_main?: boolean;
      }> = [];
      
      problemsAndSolutions.forEach((ps, idx) => {
        // Add problem keywords
        ps.problem_keywords.forEach((kw, kwIdx) => {
          keywords.push({
            keyword: kw,
            phrasing_index: idx * 2 + 1,
            is_main: idx === 0 && kwIdx === 0,
          });
        });
        // Add solution keywords
        ps.solution_keywords.forEach((kw, kwIdx) => {
          keywords.push({
            keyword: kw,
            phrasing_index: idx * 2 + 2,
            is_main: false,
          });
        });
      });

      // Parse persona (line 4 or any line containing "persona")
      // Look for persona line more flexibly
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Remove "Line 4:" or "Line X:" prefix if present
        line = line.replace(/^Line\s*\d+\s*:\s*/i, '').trim();
        
        // Check if line contains "persona" (case-insensitive)
        if (line.toLowerCase().includes('persona') || line.toLowerCase().startsWith('persona')) {
          const parts = line.split('|').map((p) => p.trim());
          
          // Try to find persona info in different formats
          if (parts.length >= 3) {
            personaInfo = parts[1];
            businessType = parts[2];
          } else if (parts.length >= 2) {
            // If only 2 parts, second might be persona description
            personaInfo = parts[1];
            // Try to extract business type from persona description
            const personaLower = personaInfo.toLowerCase();
            if (personaLower.includes('b2b + b2c') || personaLower.includes('b2b+b2c')) {
              businessType = 'B2B + B2C';
            } else if (personaLower.includes('b2b') && !personaLower.includes('b2c')) {
              businessType = 'B2B';
            } else if (personaLower.includes('b2c') && !personaLower.includes('b2b')) {
              businessType = 'B2C';
            } else {
              businessType = 'Unknown';
            }
          } else if (parts.length === 1 && line.toLowerCase().includes('persona')) {
            // If only one part, try to extract from the whole line
            const lineLower = line.toLowerCase();
            if (lineLower.includes('b2b + b2c') || lineLower.includes('b2b+b2c')) {
              businessType = 'B2B + B2C';
              personaInfo = line.replace(/persona\s*:?\s*/i, '').replace(/\s*\|\s*b2b.*$/i, '').trim();
            } else if (lineLower.includes('b2b')) {
              businessType = 'B2B';
              personaInfo = line.replace(/persona\s*:?\s*/i, '').replace(/\s*\|\s*b2b.*$/i, '').trim();
            } else if (lineLower.includes('b2c')) {
              businessType = 'B2C';
              personaInfo = line.replace(/persona\s*:?\s*/i, '').replace(/\s*\|\s*b2c.*$/i, '').trim();
            }
          }
          
          if (personaInfo) {
            break;
          }
        }
        
        // Also check for business type patterns in any line
        if (!personaInfo && !businessType) {
          const lineLower = line.toLowerCase();
          if (lineLower.includes('b2b + b2c') || lineLower.includes('b2b+b2c')) {
            businessType = 'B2B + B2C';
            if (line.includes('|')) {
              const parts = line.split('|').map((p) => p.trim());
              if (parts.length >= 2) {
                personaInfo = parts[1] || parts[0];
              }
            }
          } else if (lineLower.includes('b2b') && !lineLower.includes('b2c')) {
            businessType = 'B2B';
            if (line.includes('|')) {
              const parts = line.split('|').map((p) => p.trim());
              if (parts.length >= 2) {
                personaInfo = parts[1] || parts[0];
              }
            }
          } else if (lineLower.includes('b2c') && !lineLower.includes('b2b')) {
            businessType = 'B2C';
            if (line.includes('|')) {
              const parts = line.split('|').map((p) => p.trim());
              if (parts.length >= 2) {
                personaInfo = parts[1] || parts[0];
              }
            }
          }
        }
      }

      // Fallback if parsing failed
      if (problemsAndSolutions.length === 0 && keywords.length === 0) {
        keywords.push({
          keyword: `main offering ${domainName}`,
          phrasing_index: 1,
          is_main: true,
        });
      }

      if (!personaInfo) {
        personaInfo = 'General audience';
      }

      return {
        keywords,
        problems_and_solutions: problemsAndSolutions,
        persona: personaInfo,
        business_type: businessType,
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
      geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' }).generateContent(prompt).then(response => {
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
          model_name: 'gemini-2.0-flash-exp',
        };
      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error parsing Gemini response:`, error);
        results.gemini = { 
          error: error.message,
          raw_response: geminiResponse.value || 'No response received',
          model_name: 'gemini-2.0-flash-exp',
        };
      }
    } else {
      console.error(`[${new Date().toISOString()}] Gemini request failed:`, geminiResponse.reason);
      results.gemini = { 
        error: geminiResponse.reason?.message || 'Gemini request failed',
        raw_response: 'Request failed - no response received',
        model_name: 'gemini-2.0-flash-exp',
      };
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Error investigating website:', error);
    return NextResponse.json({ error: error.message || 'Failed to investigate website' }, { status: 500 });
  }
}

