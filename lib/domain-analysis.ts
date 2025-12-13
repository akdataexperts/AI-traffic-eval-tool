import { getOpenAIClient } from './openai';

// =============================================================================
// CONFIGURATION VARIABLES (matching Python domain_analysis.py)
// =============================================================================

export const VECTOR_SEARCH_NUM_CANDIDATES = 200;
export const VECTOR_SEARCH_LIMIT = 100;
export const TOTAL_RESULTS_LIMIT = 50;
export const GPT_SELECT_TOP_PROMPTS_LIMIT = 50;
export const ENABLE_PROMPT_FILTERING = true;

// =============================================================================
// TYPES
// =============================================================================

export interface WebsiteAnalysis {
  analysis: string;
  model?: string;
}

export interface PromptResult {
  first_prompt: string;
  similarityScore: number;
  collection: string;
}

export interface PromptGroup {
  group_name: string;
  description: string;
  prompt_indices: number[];
  prompt_count: number;
}

export interface GroupingResult {
  groups: PromptGroup[];
  total_groups: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DomainAnalysis] ${message}`);
}

function extractJsonFromResponse(content: string): string {
  // Try to extract JSON from response if it's wrapped in markdown or other text
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return content;
}

// =============================================================================
// STAGE 1: Analyze Website with GPT-4o (with web search)
// =============================================================================

export async function analyzeWebsiteWithGpt4o(
  websiteUrl: string,
  customPrompt?: string
): Promise<WebsiteAnalysis> {
  try {
    log(`Analyzing website: ${websiteUrl}`);
    
    const openai = getOpenAIClient();
    
    // Extract domain name from URL
    let normalizedUrl = websiteUrl;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    const url = new URL(normalizedUrl);
    const domainName = url.host.replace('www.', '');
    
    const defaultPrompt = `Go online to ${domainName} and analyze the website to provide the following information:

1. Brand name: What is the brand of the website?

2. Main offering: What is the main products/service of the brand?

3. Ideal Customer Profile: Is this a B2B (Business-to-Business) or B2C (Business-to-Consumer) company?

4. Industry: What industry or industries does this company operate in?

5. Country: What is the primary country or countries where this company operates or serves customers?

Provide your analysis in a clear, structured format.`;

    const prompt = customPrompt 
      ? customPrompt.replace(/\{domain_name\}/g, domainName)
      : defaultPrompt;
    
    try {
      // Try using responses API with web search
      const response = await openai.responses.create({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' as any }],
        input: prompt,
      } as any);
      
      const content = (response as any).output_text?.trim();
      
      if (!content) {
        throw new Error('GPT-4o returned empty response');
      }
      
      log(`Website analysis completed for ${domainName}`);
      return { analysis: content, model: 'gpt-4o (web_search_preview)' };
      
    } catch (e: any) {
      // Fallback to regular chat completions
      log(`Responses API failed, trying regular chat completions: ${e.message}`);
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });
      
      const content = response.choices[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('GPT-4o returned empty response');
      }
      
      log(`Website analysis completed for ${domainName} (fallback)`);
      return { analysis: content, model: 'gpt-4o (chat)' };
    }
  } catch (error: any) {
    log(`Error analyzing website: ${error.message}`);
    throw error;
  }
}

// =============================================================================
// STAGE 2: Generate Descriptions from Website Analysis
// =============================================================================

export async function getDescriptionsFromAnalysis(
  websiteAnalysis: WebsiteAnalysis,
  customPrompt?: string
): Promise<{ descriptions: string[]; model: string; prompt: string }> {
  try {
    log('Generating descriptions from website analysis');
    
    const openai = getOpenAIClient();
    const websiteAnalysisText = websiteAnalysis.analysis;
    
    if (!websiteAnalysisText) {
      throw new Error('No website analysis provided');
    }
    
    const defaultPrompt = `You are a marketing expert that identifies exactly what the company offers.

Here is an expert's analysis of the website:
{website_analysis}

Your task:
Create exactly 5 descriptions that describe:
- the problems the company solves
- the solutions the company provides
- the descriptions should be phrased like a google search query that would lead to the company's homepage

Each description must follow all rules below:
- Begin with the "scope", 1-3 words. "scope" is the specific industry, platform, or problem area the company focuses on. If the company leverages a specific tool, it must be included in the "scope".
- Each description will have 1-3 keywords after the "scope".
- A description should not exceed 6 words - start with the "scope" and add some keywords that are relevant to the company.
- Each description should be different and reflect the specific industry, platform, or problem area.
- The descriptions must contain the scope term itself, not the word "scope."
- The scope in each description must mirror the terminology the website uses for its main offering.

Format your response as JSON with this exact structure:
{
  "descriptions": [
    "youtube revenues",
    "youtube localisation",
    "youtube content",
    "youtube auto-dubbing",
    "youtube growth automation"
  ]
}

Output ONLY valid JSON, no other text.`;

    const prompt = (customPrompt || defaultPrompt)
      .replace(/\{website_analysis\}/g, websiteAnalysisText);
    
    let content: string;
    let model = 'gpt-5.1';
    
    try {
      // Try gpt-5.1 with JSON response format (matching Python)
      const response = await openai.chat.completions.create({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      
      content = response.choices[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      log(`Error with gpt-5.1, trying gpt-4o fallback: ${e.message}`);
      model = 'gpt-4o';
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      });
      
      content = response.choices[0]?.message?.content?.trim() || '';
    }
    
    // Parse JSON response
    const jsonContent = extractJsonFromResponse(content);
    const resultData = JSON.parse(jsonContent);
    let descriptions: string[] = resultData.descriptions || [];
    
    // Ensure we have exactly 5 descriptions
    while (descriptions.length < 5) {
      descriptions.push('Company information and services');
    }
    
    log(`Generated ${descriptions.length} descriptions`);
    return { 
      descriptions: descriptions.slice(0, 5), 
      model,
      prompt 
    };
    
  } catch (error: any) {
    log(`Error generating descriptions: ${error.message}`);
    throw error;
  }
}

// =============================================================================
// STAGE 4: Select Top Prompts with GPT
// =============================================================================

export async function selectTopPromptsWithGpt(
  websiteAnalysis: WebsiteAnalysis,
  allResults: PromptResult[],
  customPrompt?: string,
  limit: number = GPT_SELECT_TOP_PROMPTS_LIMIT
): Promise<{ prompts: string[]; model: string; prompt: string }> {
  try {
    log(`Selecting top ${limit} prompts from ${allResults.length} candidates`);
    
    const openai = getOpenAIClient();
    
    // Deduplicate by first_prompt
    const uniqueResults: PromptResult[] = [];
    const seen = new Set<string>();
    for (const r of allResults) {
      const p = r.first_prompt;
      if (p && !seen.has(p)) {
        seen.add(p);
        uniqueResults.push(r);
      }
    }
    
    const promptsList = uniqueResults
      .map((r, i) => `${i + 1}. ${r.first_prompt}`)
      .join('\n');
    
    const websiteAnalysisText = websiteAnalysis.analysis;
    
    const defaultPrompt = `You are analyzing a website and need to select the most relevant user questions (prompts) that ChatGPT users would ask about this website. Your job is to go through the list of prompts and select the top ${limit} that would naturally lead users to the company's homepage.

Website Analysis:
{website_analysis}

Your task:
Select the TOP ${limit} most relevant prompts from the list below. The selections should:
- Prompts that represent user questions that would naturally lead to the company's homepage in the GPT response
- IMPORTANT: Be relevant to the specific offering of the website. General prompts are not good
- Represent contemporary questions that ChatGPT users would ask when searching for information about the company
- Be relevant to the company's main offering, industry, and target customers
- We need only high quality prompts that have a transactional intent that directly relate to the offering

Format your response as JSON with this exact structure:
{
  "selected_prompt_indices": [60, 7, 110, 25, 90, ...]
}

Output ONLY valid JSON, no other text.

All available prompts:
{prompts_list}`;

    const prompt = (customPrompt || defaultPrompt)
      .replace(/\{website_analysis\}/g, websiteAnalysisText)
      .replace(/\{prompts_list\}/g, promptsList);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    
    const content = response.choices[0]?.message?.content?.trim() || '';
    const jsonContent = extractJsonFromResponse(content);
    const resultData = JSON.parse(jsonContent);
    const indices: number[] = resultData.selected_prompt_indices || [];
    
    // Map indices (1-based) to actual prompts
    const selected: string[] = [];
    for (const idx of indices.slice(0, limit)) {
      const listIndex = idx - 1; // Convert to 0-based
      if (listIndex >= 0 && listIndex < uniqueResults.length) {
        selected.push(uniqueResults[listIndex].first_prompt);
      }
    }
    
    // Fill if needed
    for (const r of uniqueResults) {
      if (!selected.includes(r.first_prompt) && selected.length < limit) {
        selected.push(r.first_prompt);
      }
    }
    
    log(`Selected ${selected.length} prompts`);
    return { 
      prompts: selected.slice(0, limit), 
      model: 'gpt-5.1',
      prompt 
    };
    
  } catch (error: any) {
    log(`Error selecting prompts: ${error.message}`);
    // Fallback: return first N prompts
    const uniquePrompts = [...new Set(allResults.map(r => r.first_prompt))];
    return { 
      prompts: uniquePrompts.slice(0, limit), 
      model: 'fallback',
      prompt: '' 
    };
  }
}

// =============================================================================
// STAGE 5: Filter Prompts with GPT
// =============================================================================

export async function filterPromptsWithGpt(
  prompts: string[],
  websiteAnalysis: WebsiteAnalysis,
  customPrompt?: string
): Promise<{ prompts: string[]; model: string; prompt: string }> {
  try {
    if (!ENABLE_PROMPT_FILTERING) {
      log('Prompt filtering is disabled, keeping all prompts');
      return { prompts, model: 'disabled', prompt: '' };
    }
    
    if (!prompts.length) {
      return { prompts: [], model: 'empty', prompt: '' };
    }
    
    log(`Filtering ${prompts.length} prompts`);
    
    const openai = getOpenAIClient();
    const websiteAnalysisText = websiteAnalysis.analysis;
    
    const promptsList = prompts
      .map((p, i) => `${i + 1}. ${p}`)
      .join('\n');
    
    const defaultPrompt = `I'm doing SEO for my website and I want to study the prompts that are directly related to my offering.

Website Analysis:
{website_analysis}

INSTRUCTIONS:
Review the prompts below and remove any that are not relevant to my offering. I am only interested in prompts that are directly connected to my products and services and represent questions a potential customer would ask.

IMPORTANT: In addition to filtering based on relevance, check for duplicate or similar prompts — including differences in capitalization, spacing, punctuation, or slightly varied wording that expresses the same meaning. If such duplicates exist, keep only one instance — but only if it is relevant.
Return ONLY the numbers of prompts that should be KEPT (the good ones).

Format your response as JSON:
{
  "keep_prompt_numbers": [1, 3, 5, 7, ...]
}

Output ONLY valid JSON, no other text.

Prompts to review:
{prompts_list}`;

    const prompt = (customPrompt || defaultPrompt)
      .replace(/\{website_analysis\}/g, websiteAnalysisText)
      .replace(/\{prompts_list\}/g, promptsList);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      top_p: 1,
      response_format: { type: 'json_object' },
    });
    
    const content = response.choices[0]?.message?.content?.trim() || '';
    const jsonContent = extractJsonFromResponse(content);
    const resultData = JSON.parse(jsonContent);
    const keepNumbers: number[] = resultData.keep_prompt_numbers || [];
    
    // Convert 1-based numbers to filtered prompts
    const filteredPrompts: string[] = [];
    for (const num of keepNumbers) {
      const idx = num - 1; // Convert to 0-based
      if (idx >= 0 && idx < prompts.length) {
        filteredPrompts.push(prompts[idx]);
      }
    }
    
    log(`Filtered to ${filteredPrompts.length} prompts (from ${prompts.length})`);
    return { 
      prompts: filteredPrompts, 
      model: 'gpt-5.1',
      prompt 
    };
    
  } catch (error: any) {
    log(`Error filtering prompts: ${error.message}`);
    // Fallback: return all prompts
    return { prompts, model: 'fallback', prompt: '' };
  }
}

// =============================================================================
// STAGE 6: Group Prompts with GPT
// =============================================================================

export async function groupPromptsWithGpt(
  prompts: string[],
  websiteAnalysis: WebsiteAnalysis,
  customPrompt?: string
): Promise<{ groups: Array<{ group_name: string; description: string; prompts: string[] }>; model: string; prompt: string }> {
  try {
    if (!prompts.length) {
      return { groups: [], model: 'empty', prompt: '' };
    }
    
    log(`Grouping ${prompts.length} prompts`);
    
    const openai = getOpenAIClient();
    const websiteAnalysisText = websiteAnalysis.analysis;
    
    const promptsList = prompts
      .map((p, i) => `${i + 1}. ${p}`)
      .join('\n');
    
    const defaultPrompt = `You are an expert at categorizing user questions and prompts. Your task is to analyze a list of prompts and group them into meaningful categories that are relevant to the website.

Website Analysis:
{website_analysis}

Your task:
1. Analyze all the prompts in the context of the website analysis above
2. Group them into meaningful categories that are relevant to this website's brand, offering, ICP, industry, and target audience
3. Create 3-7 distinct groups based on similar themes, intents, or topics that make sense for this specific website
4. Examine each prompt - If it has a transactional intent and the website's owner might find it useful for SEO purposes then assign the prompt to one of the groups. If it is not transactional and not useful for SEO purposes, do not assign it to any group.
5. Name each group with a clear, descriptive title (2-5 words) that reflects the website's context

Format your response as a valid JSON with the following structure:
{
    "groups": [
        {
            "group_name": "Group Name",
            "description": "Brief description of what this group represents",
            "prompt_indices": [1, 3, 5, ...],
            "prompt_count": X
        },
        ...
    ],
    "total_groups": X
}

Output ONLY valid JSON, no other text.

Here are the prompts:
{prompts_list}`;

    const prompt = (customPrompt || defaultPrompt)
      .replace(/\{website_analysis\}/g, websiteAnalysisText)
      .replace(/\{prompts_list\}/g, promptsList);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    });
    
    const content = response.choices[0]?.message?.content?.trim() || '';
    const jsonContent = extractJsonFromResponse(content);
    const resultData: GroupingResult = JSON.parse(jsonContent);
    
    // Map indices to actual prompts
    const groups: Array<{ group_name: string; description: string; prompts: string[] }> = [];
    
    if (resultData.groups && Array.isArray(resultData.groups)) {
      for (const group of resultData.groups) {
        const groupPrompts: string[] = [];
        for (const idx of group.prompt_indices || []) {
          const listIndex = idx - 1; // Convert to 0-based
          if (listIndex >= 0 && listIndex < prompts.length) {
            groupPrompts.push(prompts[listIndex]);
          }
        }
        
        if (groupPrompts.length > 0) {
          groups.push({
            group_name: group.group_name || 'Unnamed Group',
            description: group.description || '',
            prompts: groupPrompts,
          });
        }
      }
    }
    
    // Fallback if grouping failed
    if (groups.length === 0) {
      log('Grouping failed, creating single group with all prompts');
      groups.push({
        group_name: 'All Prompts',
        description: 'User questions about the website',
        prompts: prompts.slice(0, 25),
      });
    }
    
    log(`Grouped prompts into ${groups.length} groups`);
    return { 
      groups, 
      model: 'gpt-4o',
      prompt 
    };
    
  } catch (error: any) {
    log(`Error grouping prompts: ${error.message}`);
    // Fallback: single group
    return { 
      groups: [{
        group_name: 'All Prompts',
        description: 'User questions about the website',
        prompts: prompts.slice(0, 25),
      }], 
      model: 'fallback',
      prompt: '' 
    };
  }
}
