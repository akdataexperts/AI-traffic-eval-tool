'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';

interface InvestigationData {
  keywords: Array<{
    keyword: string;
    phrasing_index?: number;
    is_main?: boolean;
  }>;
  persona: string;
  business_type: string;
}

interface ModelInvestigationResult {
  keywords: Array<{
    keyword: string;
    phrasing_index?: number;
    is_main?: boolean;
  }>;
  problems_and_solutions: Array<{
    problem: string;
    solution: string;
    problem_keywords: string[];
    solution_keywords: string[];
    index: number;
  }>;
  persona: string;
  business_type: string;
  error?: string;
  raw_response?: string;
  model_name?: string;
}

interface InvestigationResults {
  perplexity?: ModelInvestigationResult;
  gpt?: ModelInvestigationResult;
  gemini?: ModelInvestigationResult;
}

interface PromptWithReasoning {
  prompt: string;
  reasoning: string;
}

interface PreviewData {
  offerings_with_prompts: Array<{
    offering: {
      keyword: string;
      phrasing_index?: number;
      is_main?: boolean;
    };
    candidate_prompts: string[];
    selected_prompts: PromptWithReasoning[];
    prompt_sent?: string;
  }>;
}

interface KeywordData {
  keyword: string;
  fileName: string;
}

interface SimilarityResult {
  keyword: string;
  fileName: string;
  similarities: Array<{
    perplexity_keyword: string;
    phrasing_index?: number;
    is_main?: boolean;
    similarity_score: number;
  }>;
}

interface ModelSimilarityResults {
  model: string;
  results: SimilarityResult[];
}

export default function Home() {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [investigationData, setInvestigationData] = useState<InvestigationData | null>(null);
  const [investigationResults, setInvestigationResults] = useState<InvestigationResults | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<KeywordData[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [similarityResults, setSimilarityResults] = useState<ModelSimilarityResults[] | null>(null);
  const [calculatingSimilarities, setCalculatingSimilarities] = useState(false);
  const [expandedRawResponses, setExpandedRawResponses] = useState<{ [key: string]: boolean }>({});
  const [investigationPrompt, setInvestigationPrompt] = useState(`Go online to {domainName} and investigate what they do.

Based on your research, provide:
1. what are problems solved by {domainName} & what are the solutions offered by {domainName} 

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

Important: Output ONLY the specified lines, nothing else.`);
  const [customPromptTemplate, setCustomPromptTemplate] = useState(`You are a marketing strategist analyzing search intent and user behavior.

Website Context:
- Offering: [OFFERING_LABEL] - [OFFERING_DESCRIPTION]
- Target Audience: [PERSONA]
- Business Type: [BUSINESS_TYPE]

Your task: Select ONLY the TOP 3 most relevant user questions from the list below that someone would ask ChatGPT when they need this offering.

CRITICAL REQUIREMENTS:
- ONLY select questions that are HIGHLY RELEVANT and closely match this specific offering
- Questions must indicate genuine purchase/engagement intent for THIS EXACT offering
- Questions must align with what the target audience would actually ask
- If there are NOT 3 questions that meet these high standards, return FEWER questions (1-2 or even 0)
- DO NOT force selections just to reach 3 - quality over quantity
- DO NOT select duplicate or very similar questions - each selected question must be distinct and unique

Think like a marketer:
- Which questions indicate genuine purchase/engagement intent for this offering?
- Which questions align with what the target audience would actually ask?
- Which questions represent contemporary search behavior on AI platforms?
- Prioritize questions that would naturally lead users to this offering

User questions to evaluate:

[CANDIDATE_PROMPTS]

For each of your selections (1-3, or fewer if needed), provide:
1. The question number
2. A brief marketing-focused explanation (15-25 words) of why this question is valuable for reaching the target audience

Format your response exactly as:
[number]. [reasoning]

If no questions meet the quality standards, respond with:
NONE

Important: Output ONLY your selections in the format above, nothing else.`);

  const handleInvestigate = async () => {
    if (!websiteUrl.trim()) {
      setError('Please enter a website URL');
      return;
    }

    setLoading(true);
    setError(null);
    setInvestigationData(null);
    setInvestigationResults(null);
    setPreviewData(null);
    setSimilarityResults(null);

    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
          website_url: websiteUrl,
          custom_prompt: investigationPrompt || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Investigation failed');
      }

      const data: InvestigationResults = await response.json();
      setInvestigationResults(data);
      
      // For backward compatibility, use Perplexity data as primary investigationData
      if (data.perplexity && !data.perplexity.error) {
        setInvestigationData(data.perplexity);
      } else if (data.gpt && !data.gpt.error) {
        setInvestigationData(data.gpt);
      } else if (data.gemini && !data.gemini.error) {
        setInvestigationData(data.gemini);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to investigate website');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePrompts = async () => {
    if (!investigationData) {
      setError('Please investigate a website first');
      return;
    }

    setLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      const response = await fetch('/api/generate-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investigation_data: investigationData,
          custom_prompt_template: customPromptTemplate,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Prompt generation failed');
      }

      const data = await response.json();
      setPreviewData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate prompts');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    setSelectedFiles(fileArray);
    setError(null);

    const extractedKeywords: KeywordData[] = [];

    for (const file of fileArray) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        // Look for sheet named "keyword" (case-insensitive)
        const keywordSheet = workbook.SheetNames.find(
          name => name.toLowerCase() === 'keyword'
        );

        if (!keywordSheet) {
          console.warn(`Sheet "keyword" not found in ${file.name}`);
          continue;
        }

        const worksheet = workbook.Sheets[keywordSheet];
        
        // Get cell A2 (row 2, column 1)
        const cellA2 = worksheet['A2'];
        
        if (!cellA2) {
          console.warn(`Cell A2 is empty in ${file.name}`);
          continue;
        }

        const keyword = cellA2.v?.toString().trim();
        
        if (keyword) {
          extractedKeywords.push({
            keyword,
            fileName: file.name,
          });
        } else {
          console.warn(`Keyword in A2 is empty in ${file.name}`);
        }
      } catch (err: any) {
        console.error(`Error processing file ${file.name}:`, err);
        setError(`Error processing ${file.name}: ${err.message}`);
      }
    }

    setKeywords(extractedKeywords);
    // Reset similarity results when keywords change
    setSimilarityResults(null);
  };

  const handleCalculateSimilarities = async () => {
    if (!investigationResults || !keywords.length) {
      setError('Please investigate a website and select Excel files with keywords first');
      return;
    }

    setCalculatingSimilarities(true);
    setError(null);

    try {
      // Calculate similarities for all three models
      const similarityPromises: Array<Promise<{ model: string; results: SimilarityResult[] }>> = [];

      if (investigationResults.perplexity && !investigationResults.perplexity.error) {
        similarityPromises.push(
          fetch('/api/calculate-similarities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excelKeywords: keywords,
              perplexityKeywords: investigationResults.perplexity.keywords,
            }),
          })
            .then(res => res.json())
            .then(data => ({ model: 'perplexity', results: data.results }))
        );
      }

      if (investigationResults.gpt && !investigationResults.gpt.error) {
        similarityPromises.push(
          fetch('/api/calculate-similarities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excelKeywords: keywords,
              perplexityKeywords: investigationResults.gpt.keywords,
            }),
          })
            .then(res => res.json())
            .then(data => ({ model: 'gpt', results: data.results }))
        );
      }

      if (investigationResults.gemini && !investigationResults.gemini.error) {
        similarityPromises.push(
          fetch('/api/calculate-similarities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excelKeywords: keywords,
              perplexityKeywords: investigationResults.gemini.keywords,
            }),
          })
            .then(res => res.json())
            .then(data => ({ model: 'gemini', results: data.results }))
        );
      }

      const allResults = await Promise.all(similarityPromises);
      
      // Store results with model information
      setSimilarityResults(allResults as any);
    } catch (err: any) {
      setError(err.message || 'Failed to calculate similarities');
    } finally {
      setCalculatingSimilarities(false);
    }
  };


  return (
    <main className="min-h-screen p-8 bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">AI Traffic Eval Tool</h1>

        {/* Input Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="mb-4">
            <label htmlFor="website-url" className="block text-sm font-medium text-gray-700 mb-2">
              Website URL
            </label>
            <div className="flex gap-2">
              <input
                id="website-url"
                type="text"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
              />
              <button
                onClick={handleInvestigate}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Investigate
              </button>
            </div>
          </div>

          {/* Investigation Prompt Editor */}
          <div className="mt-4">
            <label htmlFor="investigation-prompt" className="block text-sm font-medium text-gray-700 mb-2">
              Investigation Prompt (Editable)
            </label>
            <textarea
              id="investigation-prompt"
              value={investigationPrompt}
              onChange={(e) => setInvestigationPrompt(e.target.value)}
              rows={8}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              placeholder="Leave empty to use default prompt. Use {domainName} and {baseDomain} as placeholders."
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-2">
              Leave empty to use the default prompt. The prompt will be sent to all models (Perplexity, GPT, and Gemini) for website investigation.
              Use <code className="bg-gray-100 px-1 rounded">{"{domainName}"}</code> and <code className="bg-gray-100 px-1 rounded">{"{baseDomain}"}</code> as placeholders.
            </p>
          </div>
          
          {/* Excel File Selection */}
          <div className="mt-4">
            <label htmlFor="excel-files" className="block text-sm font-medium text-gray-700 mb-2">
              Select Excel Files (Keyword Sheets)
            </label>
            <div className="flex gap-2 items-center">
              <input
                id="excel-files"
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <label
                htmlFor="excel-files"
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-block"
              >
                Select Excel Files
              </label>
              {selectedFiles.length > 0 && (
                <span className="text-sm text-gray-600">
                  {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
                </span>
              )}
            </div>
            {keywords.length > 0 && (
              <p className="text-sm text-green-600 mt-2">
                ✓ Extracted {keywords.length} keyword{keywords.length !== 1 ? 's' : ''} from {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Investigation Results */}
        {investigationResults && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Website Analysis - All Models</h2>
            
            {/* Model Results Tabs */}
            <div className="mb-6 border-b border-gray-200">
              <div className="flex gap-4">
                {investigationResults.perplexity && (
                  <button className="px-4 py-2 border-b-2 border-blue-600 text-blue-600 font-semibold">
                    {investigationResults.perplexity.model_name || 'Perplexity Sonar'}
                  </button>
                )}
                {investigationResults.gpt && (
                  <button className="px-4 py-2 border-b-2 border-green-600 text-green-600 font-semibold">
                    {investigationResults.gpt.model_name || 'GPT'}
                  </button>
                )}
                {investigationResults.gemini && (
                  <button className="px-4 py-2 border-b-2 border-purple-600 text-purple-600 font-semibold">
                    {investigationResults.gemini.model_name || 'Gemini'}
                  </button>
                )}
              </div>
            </div>

            {/* Display results for each model */}
            {investigationResults.perplexity && !investigationResults.perplexity.error && (
              <div className="mb-8 p-4 border border-blue-200 rounded-lg bg-blue-50/30">
                <h3 className="text-xl font-semibold text-blue-900 mb-4">{investigationResults.perplexity.model_name || 'Perplexity Sonar'} Results</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Target Audience</h4>
                    <p className="text-gray-900">{investigationResults.perplexity.persona}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Business Type</h4>
                    <p className="text-gray-900">{investigationResults.perplexity.business_type}</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Keywords ({investigationResults.perplexity.keywords.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {investigationResults.perplexity.keywords.map((kw, idx) => (
                      <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                        {kw.keyword}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Raw Response */}
                {investigationResults.perplexity.raw_response && (
                  <div className="mt-4">
                    <button
                      onClick={() => setExpandedRawResponses(prev => ({ ...prev, perplexity: !prev.perplexity }))}
                      className="flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedRawResponses.perplexity ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {expandedRawResponses.perplexity ? 'Hide' : 'Show'} Raw Response
                    </button>
                    {expandedRawResponses.perplexity && (
                      <div className="mt-2 p-4 bg-gray-900 rounded-lg overflow-auto max-h-96">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                          {investigationResults.perplexity.raw_response}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {investigationResults.gpt && !investigationResults.gpt.error && (
              <div className="mb-8 p-4 border border-green-200 rounded-lg bg-green-50/30">
                <h3 className="text-xl font-semibold text-green-900 mb-4">{investigationResults.gpt.model_name || 'GPT'} Results</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Target Audience</h4>
                    <p className="text-gray-900">{investigationResults.gpt.persona}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Business Type</h4>
                    <p className="text-gray-900">{investigationResults.gpt.business_type}</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Keywords ({investigationResults.gpt.keywords.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {investigationResults.gpt.keywords.map((kw, idx) => (
                      <span key={idx} className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
                        {kw.keyword}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Raw Response */}
                {investigationResults.gpt.raw_response && (
                  <div className="mt-4">
                    <button
                      onClick={() => setExpandedRawResponses(prev => ({ ...prev, gpt: !prev.gpt }))}
                      className="flex items-center gap-2 text-sm font-medium text-green-700 hover:text-green-900"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedRawResponses.gpt ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {expandedRawResponses.gpt ? 'Hide' : 'Show'} Raw Response
                    </button>
                    {expandedRawResponses.gpt && (
                      <div className="mt-2 p-4 bg-gray-900 rounded-lg overflow-auto max-h-96">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                          {investigationResults.gpt.raw_response}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {investigationResults.gemini && !investigationResults.gemini.error && (
              <div className="mb-8 p-4 border border-purple-200 rounded-lg bg-purple-50/30">
                <h3 className="text-xl font-semibold text-purple-900 mb-4">{investigationResults.gemini.model_name || 'Gemini'} Results</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Target Audience</h4>
                    <p className="text-gray-900">{investigationResults.gemini.persona}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Business Type</h4>
                    <p className="text-gray-900">{investigationResults.gemini.business_type}</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Keywords ({investigationResults.gemini.keywords.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {investigationResults.gemini.keywords.map((kw, idx) => (
                      <span key={idx} className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-sm">
                        {kw.keyword}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Raw Response */}
                {investigationResults.gemini.raw_response && (
                  <div className="mt-4">
                    <button
                      onClick={() => setExpandedRawResponses(prev => ({ ...prev, gemini: !prev.gemini }))}
                      className="flex items-center gap-2 text-sm font-medium text-purple-700 hover:text-purple-900"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedRawResponses.gemini ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {expandedRawResponses.gemini ? 'Hide' : 'Show'} Raw Response
                    </button>
                    {expandedRawResponses.gemini && (
                      <div className="mt-2 p-4 bg-gray-900 rounded-lg overflow-auto max-h-96">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                          {investigationResults.gemini.raw_response}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Error messages for failed models */}
            {investigationResults.perplexity?.error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 mb-2">{investigationResults.perplexity.model_name || 'Perplexity Sonar'} Error: {investigationResults.perplexity.error}</p>
                {investigationResults.perplexity.raw_response && (
                  <div>
                    <button
                      onClick={() => setExpandedRawResponses(prev => ({ ...prev, perplexity: !prev.perplexity }))}
                      className="flex items-center gap-2 text-sm font-medium text-red-700 hover:text-red-900 mb-2"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedRawResponses.perplexity ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {expandedRawResponses.perplexity ? 'Hide' : 'Show'} Raw Response
                    </button>
                    {expandedRawResponses.perplexity && (
                      <div className="p-4 bg-gray-900 rounded-lg overflow-auto max-h-96">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                          {investigationResults.perplexity.raw_response}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {investigationResults.gpt?.error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 mb-2">{investigationResults.gpt.model_name || 'GPT'} Error: {investigationResults.gpt.error}</p>
                {investigationResults.gpt.raw_response && (
                  <div>
                    <button
                      onClick={() => setExpandedRawResponses(prev => ({ ...prev, gpt: !prev.gpt }))}
                      className="flex items-center gap-2 text-sm font-medium text-red-700 hover:text-red-900 mb-2"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedRawResponses.gpt ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {expandedRawResponses.gpt ? 'Hide' : 'Show'} Raw Response
                    </button>
                    {expandedRawResponses.gpt && (
                      <div className="p-4 bg-gray-900 rounded-lg overflow-auto max-h-96">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                          {investigationResults.gpt.raw_response}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {investigationResults.gemini?.error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 mb-2">{investigationResults.gemini.model_name || 'Gemini'} Error: {investigationResults.gemini.error}</p>
                {investigationResults.gemini.raw_response && (
                  <div>
                    <button
                      onClick={() => setExpandedRawResponses(prev => ({ ...prev, gemini: !prev.gemini }))}
                      className="flex items-center gap-2 text-sm font-medium text-red-700 hover:text-red-900 mb-2"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedRawResponses.gemini ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {expandedRawResponses.gemini ? 'Hide' : 'Show'} Raw Response
                    </button>
                    {expandedRawResponses.gemini && (
                      <div className="p-4 bg-gray-900 rounded-lg overflow-auto max-h-96">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                          {investigationResults.gemini.raw_response}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Keywords from Excel Files */}
            {keywords.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">Keywords from Excel Files</h3>
                  {investigationResults && (
                    <button
                      onClick={handleCalculateSimilarities}
                      disabled={calculatingSimilarities || loading}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      {calculatingSimilarities ? 'Calculating...' : 'Calculate Similarities'}
                    </button>
                  )}
                </div>
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {keywords.map((keywordData, index) => (
                      <div
                        key={index}
                        className="bg-white rounded-lg border border-purple-200 p-3 shadow-sm"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center font-semibold text-xs">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-900 font-medium break-words">{keywordData.keyword}</p>
                            <p className="text-xs text-gray-500 mt-1 truncate" title={keywordData.fileName}>
                              {keywordData.fileName}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-purple-200">
                    <p className="text-sm text-gray-600">
                      Total: <span className="font-semibold text-purple-700">{keywords.length}</span> keyword{keywords.length !== 1 ? 's' : ''} from <span className="font-semibold text-purple-700">{selectedFiles.length}</span> file{selectedFiles.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Similarity Results for All Models */}
            {similarityResults && similarityResults.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Keyword-Offering Similarity Scores (All Models)</h3>
                {similarityResults.map((modelResult, modelIndex) => (
                  <div key={modelIndex} className="mb-6">
                    <h4 className="text-md font-semibold text-gray-800 mb-3">
                      {investigationResults && 
                        (modelResult.model === 'perplexity' 
                          ? investigationResults.perplexity?.model_name || 'Perplexity Sonar'
                          : modelResult.model === 'gpt'
                          ? investigationResults.gpt?.model_name || 'GPT'
                          : investigationResults.gemini?.model_name || 'Gemini')
                      }
                    </h4>
                    <div className="space-y-4">
                      {modelResult.results.map((result, keywordIndex) => (
                        <div
                          key={keywordIndex}
                          className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                        >
                          {/* Keyword Header */}
                          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                                {keywordIndex + 1}
                              </div>
                              <div className="flex-1">
                                <h4 className="text-lg font-semibold text-gray-900">{result.keyword}</h4>
                                <p className="text-xs text-gray-500 mt-0.5">{result.fileName}</p>
                              </div>
                            </div>
                          </div>

                          {/* Similarity Scores Table */}
                          <div className="p-6">
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-gray-200">
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Model Keyword</th>
                                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Similarity Score</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {result.similarities.map((similarity, simIndex) => {
                                    const score = similarity.similarity_score;
                                    const scorePercentage = (score * 100).toFixed(2);
                                    // Color coding: high (>0.7), medium (0.5-0.7), low (<0.5)
                                    const scoreColor =
                                      score > 0.7
                                        ? 'text-green-700 bg-green-50 border-green-200'
                                        : score > 0.5
                                        ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                                        : 'text-gray-700 bg-gray-50 border-gray-200';

                                    return (
                                      <tr
                                        key={simIndex}
                                        className={`border-b border-gray-100 hover:bg-gray-50 ${
                                          similarity.is_main ? 'bg-emerald-50/30' : ''
                                        }`}
                                      >
                                        <td className="py-3 px-4">
                                          <div className="flex items-center gap-2">
                                            <span className="font-medium text-gray-900">
                                              {similarity.perplexity_keyword}
                                            </span>
                                            {similarity.is_main && (
                                              <span className="px-2 py-0.5 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-full">
                                                MAIN
                                              </span>
                                            )}
                                            {similarity.phrasing_index && (
                                              <span className="text-xs text-gray-500">
                                                (Phrasing {similarity.phrasing_index})
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                          <div className="flex items-center justify-center gap-2">
                                            <span
                                              className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}
                                            >
                                              {scorePercentage}%
                                            </span>
                                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                              <div
                                                className={`h-full ${
                                                  score > 0.7
                                                    ? 'bg-green-500'
                                                    : score > 0.5
                                                    ? 'bg-yellow-500'
                                                    : 'bg-gray-400'
                                                }`}
                                                style={{ width: `${Math.min(score * 100, 100)}%` }}
                                              />
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legacy Investigation Results (for backward compatibility) */}
        {investigationData && !investigationResults && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Website Analysis</h2>
            
            {/* Persona & Business Type */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Target Audience</h3>
                <p className="text-gray-900">{investigationData.persona}</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Business Type</h3>
                <p className="text-gray-900">{investigationData.business_type}</p>
              </div>
            </div>

            {/* Main Offering Keywords */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Main Offering Keywords</h3>
              <div className="grid grid-cols-1 gap-3">
                {investigationData.keywords
                  .sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0))
                  .map((keywordData, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border ${
                        keywordData.is_main
                          ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-300 ring-2 ring-emerald-200'
                          : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex-shrink-0 w-7 h-7 text-white rounded-full flex items-center justify-center font-semibold text-xs ${
                            keywordData.is_main ? 'bg-emerald-600' : 'bg-blue-600'
                          }`}
                        >
                          {keywordData.is_main ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            keywordData.phrasing_index || index + 1
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-gray-900">
                              {keywordData.keyword}
                            </h4>
                            {keywordData.is_main && (
                              <span className="px-2 py-0.5 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-full">
                                MAIN
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>


            {/* Custom Prompt Template */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Custom Gemini Prompt Template</h3>
              <textarea
                value={customPromptTemplate}
                onChange={(e) => setCustomPromptTemplate(e.target.value)}
                rows={15}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                placeholder="Enter custom prompt template..."
              />
              <p className="text-xs text-gray-500 mt-2">
                Use placeholders: [OFFERING_LABEL], [OFFERING_DESCRIPTION], [PERSONA], [BUSINESS_TYPE], [CANDIDATE_PROMPTS]
              </p>
            </div>

            {/* Generate Prompts Button */}
            <button
              onClick={handleGeneratePrompts}
              disabled={loading}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              Generate Prompts
            </button>
          </div>
        )}

        {/* Preview Results */}
        {previewData && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Prompt Analysis by Keyword</h2>
            
            <div className="space-y-8">
              {previewData.offerings_with_prompts
                .sort((a, b) => (b.offering.is_main ? 1 : 0) - (a.offering.is_main ? 1 : 0))
                .map((offeringData, offeringIndex) => {
                  const offering = offeringData.offering;
                  const selectedPrompts = offeringData.selected_prompts || [];
                  const promptSent = offeringData.prompt_sent || 'Prompt not available';

                  return (
                    <div
                      key={offeringIndex}
                      className={`rounded-lg overflow-hidden ${
                        offering.is_main
                          ? 'border-2 border-emerald-400 ring-2 ring-emerald-200'
                          : 'border border-gray-200'
                      }`}
                    >
                      {/* Phrasing Header */}
                      <div
                        className={`px-8 py-6 border-b border-gray-200 ${
                          offering.is_main
                            ? 'bg-gradient-to-r from-emerald-50 to-teal-50'
                            : 'bg-gradient-to-r from-blue-50 to-indigo-50'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`flex-shrink-0 w-10 h-10 text-white rounded-full flex items-center justify-center font-bold text-lg ${
                              offering.is_main ? 'bg-emerald-600' : 'bg-blue-600'
                            }`}
                          >
                            {offering.is_main ? (
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              offering.phrasing_index || offeringIndex + 1
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`text-xs font-semibold uppercase tracking-wide ${
                                  offering.is_main ? 'text-emerald-600' : 'text-blue-600'
                                }`}
                              >
                                {offering.is_main ? 'Main Keyword' : `Keyword ${offering.phrasing_index || offeringIndex + 1}`}
                              </span>
                              {offering.is_main && (
                                <span className="px-2 py-0.5 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-full">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 mb-1">
                              {offering.keyword}
                            </h3>
                          </div>
                        </div>
                      </div>

                      <div className="p-8 space-y-8">
                        {/* Prompt Sent to Gemini */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Prompt Sent to Gemini
                          </h4>
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                              {promptSent}
                            </pre>
                          </div>
                        </div>

                        {/* Gemini's Response */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Gemini&apos;s Response ({selectedPrompts.length} High-Quality Prompts Selected)
                          </h4>
                          {selectedPrompts.length === 0 ? (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
                              No highly relevant prompts found for this keyword. Try adjusting the keyword or using a different phrasing.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {selectedPrompts.map((item, idx) => (
                                <div key={idx} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                                  <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center font-semibold text-xs">
                                      {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-gray-900 font-medium mb-2">{item.prompt}</p>
                                      <p className="text-sm text-gray-600 italic">&quot;{item.reasoning}&quot;</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {(loading || calculatingSimilarities) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-900">
                  {calculatingSimilarities ? 'Calculating similarities...' : 'Processing...'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

