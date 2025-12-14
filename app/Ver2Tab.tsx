'use client';

import { useState } from 'react';

// Types for Ver2 results
interface Ver2Results {
  stage1_website_analysis: { analysis: string; model: string; prompt: string } | null;
  stage2_descriptions: { descriptions: string[]; model: string; prompt: string } | null;
  stage3_similar_prompts: { prompts: Array<{ prompt: string; similarity: number; collection: string }>; total: number } | null;
  stage4_selected_prompts: { prompts: string[]; model: string; prompt: string } | null;
  stage5_filtered_prompts: { prompts: string[]; model: string; prompt: string } | null;
  stage6_grouped_prompts: { groups: Array<{ group_name: string; description: string; prompts: string[] }>; model: string; prompt: string } | null;
}

interface DomainResult {
  url: string;
  results: Ver2Results;
  error: string | null;
  isProcessing: boolean;
  currentStage: number;
}

interface WorkflowStage {
  id: number;
  name: string;
  description: string;
  model: string;
  hasLLM: boolean;
  promptKey: 'stage1' | 'stage2' | 'stage4' | 'stage5' | 'stage6' | null;
}

// Workflow stages definition
const workflowStages: WorkflowStage[] = [
  {
    id: 1,
    name: 'Analyze Website',
    description: 'Use GPT-4o with web search to analyze the website and extract brand info, offerings, ICP, industry, and country',
    model: 'gpt-4o (web search)',
    hasLLM: true,
    promptKey: 'stage1',
  },
  {
    id: 2,
    name: 'Generate Descriptions',
    description: 'Generate 5 search-query-style descriptions based on website analysis',
    model: 'gpt-5.1',
    hasLLM: true,
    promptKey: 'stage2',
  },
  {
    id: 3,
    name: 'Find Similar Prompts',
    description: 'Use vector search to find similar prompts from conversations database for each description',
    model: 'Vector Search (MongoDB)',
    hasLLM: false,
    promptKey: null,
  },
  {
    id: 4,
    name: 'Select Top Prompts',
    description: 'Use GPT to select the top 50 most relevant prompts from candidates',
    model: 'gpt-5.1',
    hasLLM: true,
    promptKey: 'stage4',
  },
  {
    id: 5,
    name: 'Filter Prompts',
    description: 'Filter out non-relevant prompts and remove duplicates',
    model: 'gpt-5.1',
    hasLLM: true,
    promptKey: 'stage5',
  },
  {
    id: 6,
    name: 'Group Prompts',
    description: 'Group filtered prompts into meaningful categories',
    model: 'gpt-4o',
    hasLLM: true,
    promptKey: 'stage6',
  },
];

// Default prompts
const defaultStage1Prompt = `Go online to {domain_name} and analyze the website to provide the following information:

1. Brand name: What is the brand of the website?

2. Main offering: What is the main products/service of the brand?

3. Ideal Customer Profile: Is this a B2B (Business-to-Business) or B2C (Business-to-Consumer) company?

4. Industry: What industry or industries does this company operate in?

5. Country: What is the primary country or countries where this company operates or serves customers?

Provide your analysis in a clear, structured format.`;

const defaultStage2Prompt = `You are a marketing expert that identifies exactly what the company offers.

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
- The scope in each description must mirror the terminology the website uses for its main offering. If the site refers to its main offering using labels such as "software", "platform", "tool", "service", "solution", "suite", etc., then that exact term must appear in the scope for each description. The goal is to include the "scope" of the website and additional keywords that are related to the company.

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

const defaultStage4Prompt = `You are analyzing a website and need to select the most relevant user questions (prompts) that ChatGPT users would ask about this website. Your job is to go through the list of prompts and select the top 50 that would naturally lead users to the company's homepage.

        Website Analysis:
        {website_analysis}

        Your task:
        Select the TOP 50 most relevant prompts from the list below. The selections should:
        - Prompts that represent user questions that would naturally lead to the company's homepage in the GPT response
        - IMPORTANT: Be relevant to the specific offering of the website. General prompts are not good
        - Represent contemporary questions that ChatGPT users would ask when searching for information about the company
        - Be relevant to the company's main offering, industry, and target customers
        - We need only high quality prompts that have a transactional intent that directly relate to the offering. Prompts that don't directly relate to the offering and are too general are not good
        - If there are less than 50 good prompts, return fewer (but at least try to find 50)

        How to Perform the Task:

        Before selecting any prompt, follow this reasoning process:

        1. Identify the Company Attributes
        - Brand name
        - Main offering (what the company actually provides)
        - Ideal Customer Profile (who would realistically use and pay for this)
        - Industry the company operates in
        - Country or geographic market (if relevant)

        2. Evaluate Each Prompt
        For each prompt in the list, answer the following internally:

        ❗ Is the prompt directly related to the specific offering of the company?

        ❗ Does the prompt reflect the perspective of the ideal customer (e.g., potential buyer, partner, adopter)?

        ❗ Is the prompt clearly aligned with the company's industry?

        ❗ Is the prompt specific enough to realistically lead to the company's homepage in a GPT answer?

        If the answer to all of these questions is YES → it is relevant.
        If ANY answer is NO → it must be excluded.

        3. Select Top 50
        - Prioritize prompts with high relevance
        - Arrange the prompts according to relevancy, most relevant at the top of the list
        - Ensure diversity in the selected prompts (different aspects of the business)
        - Return exactly 50 prompts if possible, fewer if not enough good ones exist

        Format your response as JSON with this exact structure, the length of selected_prompt_indices should be 50:
        {
          "selected_prompt_indices": [60, 7, 110, 25, 90, 15, 80, 105, 3, 18, 65, 115, 70, 22, 12, 50, 85, 100, 30, 45, 40, 95, 35, 75, 55]
        }

        Output ONLY valid JSON, no other text. The prompt_indices should be the numbers from the list below (1-based indexing).

        All available prompts (user questions):
        {prompts_list}`;

const defaultStage5Prompt = `I'm doing SEO for my website and I want to study the prompts that are directly related to my offering.

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

const defaultStage6Prompt = `You are an expert at categorizing user questions and prompts. Your task is to analyze a list of prompts and group them into meaningful categories that are relevant to the website.

        Website Analysis:
        {website_analysis}

        IMPORTANT: The groups you create should be relevant to this specific website. Consider the website's brand, main offering, ideal customer profile (ICP), industry, and country when creating categories. The topics and themes should align with what this website offers and who it serves.

        Your task:
        1. Analyze all the prompts in the context of the website analysis above
        2. Group them into meaningful categories that are relevant to this website's brand, offering, ICP, industry, and target audience
        3. Create 3-7 distinct groups based on similar themes, intents, or topics that make sense for this specific website
        4. Examine each prompt - If it has a transactional intent and the website's owner might find it useful for SEO purposes then assign the prompt to one of the groups. If it is not transactional and not useful for SEO purposes, do not assign it to any group. 
        5. Name each group with a clear, descriptive title (2-5 words) that reflects the website's context
        6. Provide a brief explanation for each group that shows how it relates to the website

        When creating groups, consider:
        - Similar topics or themes that are relevant to this website's offerings
        - Similar user intents (commercial, informational, etc.) in the context of this website
        - Similar product/service categories that align with the website's main offering
        - Similar user needs or problems being solved that relate to this website's target audience
        - The website's industry, ICP (B2B/B2C), and geographic focus

        Guidelines for grouping:
        - Create 3-7 distinct groups (not too many, not too few) that are relevant to this website
        - Each group should have at least 2 prompts unless there's a clearly unique outlier
        - Group names should be descriptive, professional, and relevant to the website's context
        - A prompt can be assigned to only one group. 
        - If the prompt is not relevant to potential customer intent, do not assign it to any group.
        - IMPORTANT: In addition to filtering based on relevance, check for duplicate or similar prompts — including differences in capitalization, spacing, punctuation, or slightly varied wording that expresses the same meaning. If such duplicates exist, keep only one instance — but only if it is relevant.
        - Focus on the core intent or theme that relates to the website, not minor details
        - Ensure all groups make sense in the context of the website analysis provided above

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

        Where:
        - group_name: A clear, descriptive name for the group (2-5 words)
        - description: One sentence explaining what prompts in this group have in common
        - prompt_indices: Array of prompt numbers (1-based) that belong to this group
        - prompt_count: Number of prompts in this group
        - total_groups: Total number of groups created

        Make sure prompts are not assigned to more than one group.

        Output ONLY valid JSON, no other text.

        Here are the prompts:
        {prompts_list}`;

const createEmptyResults = (): Ver2Results => ({
  stage1_website_analysis: null,
  stage2_descriptions: null,
  stage3_similar_prompts: null,
  stage4_selected_prompts: null,
  stage5_filtered_prompts: null,
  stage6_grouped_prompts: null,
});

const ResultTextArea = ({ content, label, count }: { content: string; label?: string; count?: number }) => (
  <div className="space-y-1">
    {(label || count !== undefined) && (
      <div className="flex justify-between text-xs text-gray-500">
        {label && <span>{label}</span>}
        {count !== undefined && <span>Count: {count}</span>}
      </div>
    )}
    <textarea
      readOnly
      value={content}
      rows={8}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-xs text-gray-900 resize-y"
    />
  </div>
);

export default function Ver2Tab() {
  // Domain URLs (simple list)
  const [domainUrls, setDomainUrls] = useState<string[]>(['']);

  // Results per domain
  const [domainResults, setDomainResults] = useState<{ [url: string]: DomainResult }>({});

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentProcessingStage, setCurrentProcessingStage] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Shared editable prompts
  const [stage1Prompt, setStage1Prompt] = useState(defaultStage1Prompt);
  const [stage2Prompt, setStage2Prompt] = useState(defaultStage2Prompt);
  const [stage4Prompt, setStage4Prompt] = useState(defaultStage4Prompt);
  const [stage5Prompt, setStage5Prompt] = useState(defaultStage5Prompt);
  const [stage6Prompt, setStage6Prompt] = useState(defaultStage6Prompt);

  // UI state
  const [expandedStages, setExpandedStages] = useState<{ [key: number]: boolean }>({});

  // Helper functions for domain URLs
  const addDomainUrl = () => {
    setDomainUrls([...domainUrls, '']);
  };

  const removeDomainUrl = (index: number) => {
    if (domainUrls.length <= 1) return;
    const newUrls = domainUrls.filter((_, i) => i !== index);
    setDomainUrls(newUrls);
  };

  const updateDomainUrl = (index: number, value: string) => {
    const newUrls = [...domainUrls];
    newUrls[index] = value;
    setDomainUrls(newUrls);
  };

  const getPromptValue = (promptKey: string | null): string => {
    switch (promptKey) {
      case 'stage1': return stage1Prompt;
      case 'stage2': return stage2Prompt;
      case 'stage4': return stage4Prompt;
      case 'stage5': return stage5Prompt;
      case 'stage6': return stage6Prompt;
      default: return '';
    }
  };

  const setPromptValue = (promptKey: string | null, value: string) => {
    switch (promptKey) {
      case 'stage1': setStage1Prompt(value); break;
      case 'stage2': setStage2Prompt(value); break;
      case 'stage4': setStage4Prompt(value); break;
      case 'stage5': setStage5Prompt(value); break;
      case 'stage6': setStage6Prompt(value); break;
    }
  };

  // Get valid domain URLs
  const getValidDomains = () => domainUrls.filter(url => url.trim());

  // Reset stages from a given stage onwards for all domains
  const resetStagesFrom = (fromStage: number) => {
    setDomainResults(prev => {
      const newResults = { ...prev };
      for (const url of Object.keys(newResults)) {
        const domainResult = { ...newResults[url] };
        const results = { ...domainResult.results };

        if (fromStage <= 1) results.stage1_website_analysis = null;
        if (fromStage <= 2) results.stage2_descriptions = null;
        if (fromStage <= 3) results.stage3_similar_prompts = null;
        if (fromStage <= 4) results.stage4_selected_prompts = null;
        if (fromStage <= 5) results.stage5_filtered_prompts = null;
        if (fromStage <= 6) results.stage6_grouped_prompts = null;

        domainResult.results = results;
        domainResult.currentStage = fromStage - 1;
        domainResult.error = null;
        newResults[url] = domainResult;
      }
      return newResults;
    });
  };

  // Run pipeline for a single domain
  const runPipelineForDomain = async (url: string, startStage: number, endStage: number): Promise<DomainResult> => {
    const existingResult = domainResults[url];
    const previousResults = existingResult ? {
      stage1_website_analysis: existingResult.results.stage1_website_analysis || undefined,
      stage2_descriptions: existingResult.results.stage2_descriptions || undefined,
      stage3_similar_prompts: existingResult.results.stage3_similar_prompts || undefined,
      stage4_selected_prompts: existingResult.results.stage4_selected_prompts || undefined,
      stage5_filtered_prompts: existingResult.results.stage5_filtered_prompts || undefined,
    } : undefined;

    try {
      const response = await fetch('/api/ver2/run-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl: url.trim(),
          startStage,
          endStage,
          prompts: {
            stage1: stage1Prompt,
            stage2: stage2Prompt,
            stage4: stage4Prompt,
            stage5: stage5Prompt,
            stage6: stage6Prompt,
          },
          previousResults: startStage > 1 ? previousResults : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          url,
          results: existingResult?.results || createEmptyResults(),
          error: data.error || 'Pipeline failed',
          isProcessing: false,
          currentStage: existingResult?.currentStage || 0,
        };
      }

      return {
        url,
        results: {
          stage1_website_analysis: data.stage1_website_analysis || existingResult?.results.stage1_website_analysis || null,
          stage2_descriptions: data.stage2_descriptions || existingResult?.results.stage2_descriptions || null,
          stage3_similar_prompts: data.stage3_similar_prompts || existingResult?.results.stage3_similar_prompts || null,
          stage4_selected_prompts: data.stage4_selected_prompts || existingResult?.results.stage4_selected_prompts || null,
          stage5_filtered_prompts: data.stage5_filtered_prompts || existingResult?.results.stage5_filtered_prompts || null,
          stage6_grouped_prompts: data.stage6_grouped_prompts || existingResult?.results.stage6_grouped_prompts || null,
        },
        error: data.error || null,
        isProcessing: false,
        currentStage: endStage === 6 ? 7 : endStage,
      };
    } catch (err: any) {
      return {
        url,
        results: existingResult?.results || createEmptyResults(),
        error: err.message || 'An error occurred',
        isProcessing: false,
        currentStage: existingResult?.currentStage || 0,
      };
    }
  };

  // Run pipeline for all domains in parallel
  const runPipeline = async (startStage: number = 1, endStage: number = 6) => {
    const validDomains = getValidDomains();
    if (validDomains.length === 0) {
      setError('Please enter at least one domain URL');
      return;
    }

    // Reset stages from startStage onwards
    resetStagesFrom(startStage);

    setIsProcessing(true);
    setError(null);
    setCurrentProcessingStage(startStage);

    // Initialize processing state for all domains
    const initialResults: { [url: string]: DomainResult } = {};
    for (const url of validDomains) {
      initialResults[url] = {
        url,
        results: domainResults[url]?.results || createEmptyResults(),
        error: null,
        isProcessing: true,
        currentStage: startStage - 1,
      };
    }
    setDomainResults(prev => ({ ...prev, ...initialResults }));

    // Run all domains in parallel
    const promises = validDomains.map(url => runPipelineForDomain(url, startStage, endStage));
    const results = await Promise.all(promises);

    // Update results
    const finalResults: { [url: string]: DomainResult } = {};
    for (const result of results) {
      finalResults[result.url] = result;
    }
    setDomainResults(prev => ({ ...prev, ...finalResults }));

    setIsProcessing(false);
    setCurrentProcessingStage(endStage === 6 ? 7 : endStage);
  };

  // Check if a stage can be run
  const canRunStage = (stageId: number): boolean => {
    if (stageId === 1) return true;
    const validDomains = getValidDomains();
    if (validDomains.length === 0) return false;

    // Check if at least one domain has the previous stage completed
    for (const url of validDomains) {
      const result = domainResults[url];
      if (!result) continue;

      const prevStageCompleted = (() => {
        switch (stageId) {
          case 2: return !!result.results.stage1_website_analysis;
          case 3: return !!result.results.stage2_descriptions;
          case 4: return !!result.results.stage3_similar_prompts;
          case 5: return !!result.results.stage4_selected_prompts;
          case 6: return !!result.results.stage5_filtered_prompts;
          default: return false;
        }
      })();

      if (prevStageCompleted) return true;
    }
    return false;
  };

  // Get stage status across all domains
  const getStageStatus = (stageId: number): 'pending' | 'processing' | 'partial' | 'completed' => {
    const validDomains = getValidDomains();
    if (validDomains.length === 0) return 'pending';

    let completedCount = 0;
    let processingCount = 0;

    for (const url of validDomains) {
      const result = domainResults[url];
      if (!result) continue;

      if (result.isProcessing && result.currentStage >= stageId - 1) {
        processingCount++;
        continue;
      }

      const stageCompleted = (() => {
        switch (stageId) {
          case 1: return !!result.results.stage1_website_analysis;
          case 2: return !!result.results.stage2_descriptions;
          case 3: return !!result.results.stage3_similar_prompts;
          case 4: return !!result.results.stage4_selected_prompts;
          case 5: return !!result.results.stage5_filtered_prompts;
          case 6: return !!result.results.stage6_grouped_prompts;
          default: return false;
        }
      })();

      if (stageCompleted) completedCount++;
    }

    if (processingCount > 0) return 'processing';
    if (completedCount === validDomains.length && completedCount > 0) return 'completed';
    if (completedCount > 0) return 'partial';
    return 'pending';
  };

  // Get results for a specific stage from all domains
  const getResultsForStage = (stageId: number) => {
    const validDomains = getValidDomains();
    const results: { url: string; result: DomainResult }[] = [];

    for (const url of validDomains) {
      const result = domainResults[url];
      if (result) {
        results.push({ url, result });
      }
    }

    return results;
  };

  // Get the actual model used from results for a stage (from any domain that has results)
  const getActualModelForStage = (stageId: number): string | null => {
    const validDomains = getValidDomains();

    for (const url of validDomains) {
      const result = domainResults[url];
      if (!result) continue;

      switch (stageId) {
        case 1:
          if (result.results.stage1_website_analysis?.model) {
            return result.results.stage1_website_analysis.model;
          }
          break;
        case 2:
          if (result.results.stage2_descriptions?.model) {
            return result.results.stage2_descriptions.model;
          }
          break;
        case 4:
          if (result.results.stage4_selected_prompts?.model) {
            return result.results.stage4_selected_prompts.model;
          }
          break;
        case 5:
          if (result.results.stage5_filtered_prompts?.model) {
            return result.results.stage5_filtered_prompts.model;
          }
          break;
        case 6:
          if (result.results.stage6_grouped_prompts?.model) {
            return result.results.stage6_grouped_prompts.model;
          }
          break;
      }
    }

    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header with Domain Inputs */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">GPT Traffic Preview Workflow</h2>
            <p className="text-gray-600 mt-1">
              Analyze multiple websites in parallel through a 6-stage pipeline.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runPipeline(1, 6)}
              disabled={isProcessing || getValidDomains().length === 0}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : (
                'Run All Stages'
              )}
            </button>
          </div>
        </div>

        {/* Domain URL Inputs */}
        <div className="space-y-2 mb-4">
          <label className="block text-sm font-medium text-gray-700">Domain URLs</label>
          {domainUrls.map((url, index) => (
            <div key={index} className="flex gap-2 items-center">
              <span className="w-6 h-6 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                {index + 1}
              </span>
              <input
                type="text"
                value={url}
                onChange={(e) => updateDomainUrl(index, e.target.value)}
                placeholder="https://example.com"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                disabled={isProcessing}
              />
              {domainUrls.length > 1 && (
                <button
                  onClick={() => removeDomainUrl(index)}
                  disabled={isProcessing}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                  title="Remove domain"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addDomainUrl}
            disabled={isProcessing}
            className="px-3 py-1.5 text-purple-600 hover:bg-purple-50 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            + Add Domain
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Workflow Progress Overview */}
        <div className="flex flex-wrap items-center justify-center gap-2 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg">
          {workflowStages.map((stage, index) => {
            const status = getStageStatus(stage.id);
            return (
              <div key={stage.id} className="flex items-center">
                <div className={`flex flex-col items-center p-2 rounded-lg border-2 min-w-[100px] ${status === 'completed' ? 'bg-green-100 border-green-500' :
                  status === 'processing' ? 'bg-purple-100 border-purple-500' :
                    status === 'partial' ? 'bg-yellow-100 border-yellow-500' :
                      'bg-white border-gray-200'
                  }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs mb-1 ${status === 'completed' ? 'bg-green-500 text-white' :
                    status === 'processing' ? 'bg-purple-500 text-white animate-pulse' :
                      status === 'partial' ? 'bg-yellow-500 text-white' :
                        'bg-gray-300 text-gray-700'
                    }`}>
                    {status === 'completed' ? '✓' : status === 'processing' ? '...' : stage.id}
                  </div>
                  <span className="text-[10px] font-semibold text-gray-700 text-center">{stage.name}</span>
                </div>
                {index < workflowStages.length - 1 && (
                  <div className={`w-4 h-0.5 ${status === 'completed' ? 'bg-green-500' : 'bg-gray-300'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline Stages */}
      <div className="space-y-4">
        {workflowStages.map((stage) => {
          const status = getStageStatus(stage.id);
          const canRun = canRunStage(stage.id);
          const stageResults = getResultsForStage(stage.id);
          const actualModel = getActualModelForStage(stage.id);
          const displayModel = actualModel || stage.model;

          return (
            <div key={stage.id} className="bg-white rounded-lg shadow-lg overflow-hidden">
              {/* Stage Header */}
              <div
                className={`p-4 cursor-pointer flex items-center justify-between ${status === 'completed' ? 'bg-green-50' :
                  status === 'processing' ? 'bg-purple-50' :
                    status === 'partial' ? 'bg-yellow-50' : 'bg-gray-50'
                  }`}
                onClick={() => setExpandedStages(prev => ({ ...prev, [stage.id]: !prev[stage.id] }))}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${status === 'completed' ? 'bg-green-500 text-white' :
                    status === 'processing' ? 'bg-purple-500 text-white animate-pulse' :
                      status === 'partial' ? 'bg-yellow-500 text-white' :
                        'bg-gray-300 text-gray-700'
                    }`}>
                    {status === 'completed' ? '✓' : status === 'processing' ? '...' : stage.id}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{stage.name}</h3>
                    <p className="text-sm text-gray-600">{stage.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${actualModel ? 'bg-green-100 text-green-700' : stage.hasLLM ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`} title={actualModel ? 'Actual model used in API call' : 'Expected model'}>
                    {displayModel}
                  </span>

                  {/* Run Stage button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      runPipeline(stage.id, stage.id);
                    }}
                    disabled={isProcessing || !canRun}
                    className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    title={!canRun ? 'Complete previous stages first' : 'Run this stage only'}
                  >
                    Run Stage
                  </button>

                  {/* Run From Here button */}
                  {stage.id < 6 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        runPipeline(stage.id, 6);
                      }}
                      disabled={isProcessing || !canRun}
                      className="px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
                      title={!canRun ? 'Complete previous stages first' : 'Run from this stage to the end'}
                    >
                      Run → End
                    </button>
                  )}

                  <svg
                    className={`w-5 h-5 text-gray-500 transition-transform ${expandedStages[stage.id] ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Stage Content */}
              {expandedStages[stage.id] && (
                <div className="p-4 border-t border-gray-200">
                  {/* Prompt Editor for LLM stages */}
                  {stage.hasLLM && stage.promptKey && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Prompt Template (Shared across all domains)
                      </label>
                      <textarea
                        value={getPromptValue(stage.promptKey)}
                        onChange={(e) => setPromptValue(stage.promptKey, e.target.value)}
                        rows={8}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-xs text-gray-900"
                        disabled={isProcessing}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Placeholders:
                        {stage.promptKey === 'stage1' && <code className="bg-gray-100 px-1 rounded ml-1">{"{domain_name}"}</code>}
                        {stage.promptKey === 'stage2' && <code className="bg-gray-100 px-1 rounded ml-1">{"{website_analysis}"}</code>}
                        {(stage.promptKey === 'stage4' || stage.promptKey === 'stage5' || stage.promptKey === 'stage6') && (
                          <>
                            <code className="bg-gray-100 px-1 rounded ml-1">{"{website_analysis}"}</code>
                            <code className="bg-gray-100 px-1 rounded ml-1">{"{prompts_list}"}</code>
                          </>
                        )}
                      </p>
                    </div>
                  )}

                  {/* Stage 3 - Vector Search Configuration */}
                  {stage.id === 3 && (
                    <div className="mb-4 space-y-3">
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <h5 className="font-semibold text-gray-900 mb-2 text-sm">Vector Search Configuration</h5>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="font-mono bg-gray-200 px-1 rounded">numCandidates: 200</span> — ANN search scope</div>
                          <div><span className="font-mono bg-gray-200 px-1 rounded">searchLimit: 100</span> — Results per collection</div>
                          <div><span className="font-mono bg-gray-200 px-1 rounded">totalResultsLimit: 50</span> — Per description limit</div>
                          <div><span className="font-mono bg-gray-200 px-1 rounded">collections: 3</span> — Parallel searches</div>
                        </div>
                      </div>
                      <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <h5 className="font-semibold text-orange-800 text-sm">🔄 Deduplication: Exact Match</h5>
                        <p className="text-xs text-orange-700">Exact duplicates removed, keeping highest similarity score.</p>
                      </div>
                    </div>
                  )}

                  {/* Deduplication notes for other stages */}
                  {stage.id === 4 && (
                    <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <h5 className="font-semibold text-orange-800 text-sm">🔄 Deduplication: Before GPT Selection</h5>
                      <p className="text-xs text-orange-700">Exact duplicates removed using a Set before sending to GPT.</p>
                    </div>
                  )}

                  {stage.id === 5 && (
                    <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <h5 className="font-semibold text-orange-800 text-sm">🔄 Deduplication: Semantic (GPT-based)</h5>
                      <p className="text-xs text-orange-700">GPT removes semantic duplicates (case, punctuation, wording variations).</p>
                    </div>
                  )}

                  {stage.id === 6 && (
                    <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <h5 className="font-semibold text-orange-800 text-sm">🔄 Deduplication: Final Pass</h5>
                      <p className="text-xs text-orange-700">Final semantic deduplication during grouping. Non-transactional prompts excluded.</p>
                    </div>
                  )}

                  {/* Results for each domain */}
                  {stageResults.length > 0 && (
                    <div className="space-y-3">
                      {stageResults.map(({ url, result }) => {
                        const hasResult = (() => {
                          switch (stage.id) {
                            case 1: return !!result.results.stage1_website_analysis;
                            case 2: return !!result.results.stage2_descriptions;
                            case 3: return !!result.results.stage3_similar_prompts;
                            case 4: return !!result.results.stage4_selected_prompts;
                            case 5: return !!result.results.stage5_filtered_prompts;
                            case 6: return !!result.results.stage6_grouped_prompts;
                            default: return false;
                          }
                        })();

                        if (!hasResult && !result.isProcessing && !result.error) return null;

                        return (
                          <div key={url} className={`p-3 rounded-lg border ${result.error ? 'bg-red-50 border-red-200' :
                            result.isProcessing ? 'bg-purple-50 border-purple-200' :
                              hasResult ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                            }`}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">{url}</span>
                              {result.isProcessing && <span className="text-xs text-purple-600 animate-pulse">Processing...</span>}
                              {result.error && <span className="text-xs text-red-600">Error: {result.error}</span>}
                            </div>

                            {/* Stage 1 Result */}
                            {stage.id === 1 && result.results.stage1_website_analysis && (
                              <ResultTextArea
                                content={result.results.stage1_website_analysis.analysis}
                              />
                            )}

                            {/* Stage 2 Result */}
                            {stage.id === 2 && result.results.stage2_descriptions && (
                              <ResultTextArea
                                content={result.results.stage2_descriptions.descriptions.map((desc, idx) => `${idx + 1}. ${desc}`).join('\n')}
                                count={result.results.stage2_descriptions.descriptions.length}
                              />
                            )}

                            {/* Stage 3 Result */}
                            {stage.id === 3 && result.results.stage3_similar_prompts && (
                              <ResultTextArea
                                label={`Found ${result.results.stage3_similar_prompts.total} prompts`}
                                content={result.results.stage3_similar_prompts.prompts.map((item, idx) => `${idx + 1}. ${item.prompt} [${(item.similarity * 100).toFixed(1)}%]`).join('\n')}
                              />
                            )}

                            {/* Stage 4 Result */}
                            {stage.id === 4 && result.results.stage4_selected_prompts && (
                              <ResultTextArea
                                label={`Selected ${result.results.stage4_selected_prompts.prompts.length} prompts`}
                                content={result.results.stage4_selected_prompts.prompts.map((prompt, idx) => `${idx + 1}. ${prompt}`).join('\n')}
                              />
                            )}

                            {/* Stage 5 Result */}
                            {stage.id === 5 && result.results.stage5_filtered_prompts && (
                              <ResultTextArea
                                label={`Filtered to ${result.results.stage5_filtered_prompts.prompts.length} prompts`}
                                content={result.results.stage5_filtered_prompts.prompts.map((prompt, idx) => `${idx + 1}. ${prompt}`).join('\n')}
                              />
                            )}

                            {/* Stage 6 Result */}
                            {stage.id === 6 && result.results.stage6_grouped_prompts && (
                              <ResultTextArea
                                label={`Groups: ${result.results.stage6_grouped_prompts.groups.length}`}
                                content={result.results.stage6_grouped_prompts.groups.map(group =>
                                  `[${group.group_name}] - ${group.description} (${group.prompts.length})\n` +
                                  group.prompts.map(p => `- ${p}`).join('\n')
                                ).join('\n\n')}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* No results message */}
                  {stageResults.every(({ result }) => {
                    const hasResult = (() => {
                      switch (stage.id) {
                        case 1: return !!result.results.stage1_website_analysis;
                        case 2: return !!result.results.stage2_descriptions;
                        case 3: return !!result.results.stage3_similar_prompts;
                        case 4: return !!result.results.stage4_selected_prompts;
                        case 5: return !!result.results.stage5_filtered_prompts;
                        case 6: return !!result.results.stage6_grouped_prompts;
                        default: return false;
                      }
                    })();
                    return !hasResult && !result.isProcessing;
                  }) && (
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-center">
                        <p className="text-xs text-gray-500">
                          {canRun
                            ? 'Click "Run Stage" to execute this stage, or "Run → End" to run from here to the end.'
                            : getValidDomains().length === 0
                              ? 'Add domain URLs above to start.'
                              : 'Complete previous stages first.'}
                        </p>
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Instructions Panel */}
      <div className="bg-blue-50 rounded-lg shadow-lg p-4 border border-blue-200">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">📝 How to Use</h3>
        <div className="grid grid-cols-2 gap-4 text-sm text-blue-700">
          <div>
            <p className="font-semibold mb-1">Running Stages:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li><strong>Run All Stages</strong>: Runs all 6 stages for all domains in parallel</li>
              <li><strong>Run Stage</strong>: Runs only that stage for all domains</li>
              <li><strong>Run → End</strong>: Runs from that stage to stage 6</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-1">Tips:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Edit prompts before running stages (shared across domains)</li>
              <li>Add multiple domains with &quot;+ Add Domain&quot;</li>
              <li>All domains are processed in parallel</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

