'use client';

import { useState, useEffect } from 'react';
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
    is_matched?: boolean;
  }>;
}

interface ModelSimilarityResults {
  model: string;
  results: SimilarityResult[];
  total_score?: number;
}

interface SearchResult {
  keyword: string;
  collection: string;
  first_prompt: string;
  similarityScore: number;
}

interface WebsiteEntry {
  id: string;
  url: string;
  excelFiles: File[];
  keywords: KeywordData[];
  investigationResults: InvestigationResults | null;
  similarityResults: ModelSimilarityResults[] | null;
  isProcessing: boolean;
  error: string | null;
}

export default function Home() {
  const [websiteEntries, setWebsiteEntries] = useState<WebsiteEntry[]>([
    { id: '1', url: '', excelFiles: [], keywords: [], investigationResults: null, similarityResults: null, isProcessing: false, error: null }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRawResponses, setExpandedRawResponses] = useState<{ [key: string]: boolean }>({});
  const [expandedWebsiteResults, setExpandedWebsiteResults] = useState<{ [key: string]: boolean }>({});
  const [activeLLMTab, setActiveLLMTab] = useState<{ [key: string]: string }>({});
  const [expandedSimilarityKeywords, setExpandedSimilarityKeywords] = useState<{ [key: string]: boolean }>({});
  const [expandedKeywordsComparison, setExpandedKeywordsComparison] = useState<{ [key: string]: boolean }>({});
  const [selectedKeywords, setSelectedKeywords] = useState<{ [key: string]: string[] }>({});
  const [searchResults, setSearchResults] = useState<{ [key: string]: SearchResult[] }>({});
  const [isSearching, setIsSearching] = useState<{ [key: string]: boolean }>({});
  const [expandedSearchKeywords, setExpandedSearchKeywords] = useState<{ [key: string]: boolean }>({});
  const [expandedSearchCollections, setExpandedSearchCollections] = useState<{ [key: string]: boolean }>({});
  const [investigationPrompt, setInvestigationPrompt] = useState(`Prohibited:
No sentences
No explanations
No descriptions
No narrative text
No labels like “Keywords” or numbering
no duplicates

Go online to {domainName} and identify exactly what the company offers.

If the company has multiple products or product lines, select the primary ones that define the core value of the business.

Determine the specific industry, platform, or problem area the company focuses on. If leaving this vague would make the service resemble a more general category, define it precisely. Call this {scope}.

Create keywords that describe:

the problems the company solves

the solutions it provides

Produce exactly five entries.

Each entry must follow all rules below:

Begin with {scope}.

Add 2 to 5 keywords after {scope}.

Entries move from general to specific.

Later entries contain more keywords.

Format the final output as five entries separated by |, exactly like this:

youtube revenues | youtube localisation | youtube content | youtube auto-dubbing | youtube growth automation

Output only the final list of keyword combinations.`);
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

  // Helper functions for managing website entries
  const addWebsiteEntry = () => {
    const newId = Date.now().toString();
    setWebsiteEntries([...websiteEntries, {
      id: newId,
      url: '',
      excelFiles: [],
      keywords: [],
      investigationResults: null,
      similarityResults: null,
      isProcessing: false,
      error: null,
    }]);
  };

  const removeWebsiteEntry = (id: string) => {
    setWebsiteEntries(websiteEntries.filter(entry => entry.id !== id));
  };

  const updateWebsiteEntry = (id: string, updates: Partial<WebsiteEntry>) => {
    setWebsiteEntries(prevEntries => 
      prevEntries.map(entry =>
        entry.id === id ? { ...entry, ...updates } : entry
      )
    );
  };

  const handleFileSelectForEntry = async (entryId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    updateWebsiteEntry(entryId, { excelFiles: fileArray, error: null });

    const extractedKeywords: KeywordData[] = [];

    for (const file of fileArray) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        const keywordSheet = workbook.SheetNames.find(
          name => name.toLowerCase() === 'keyword'
        );

        if (!keywordSheet) {
          console.warn(`Sheet "keyword" not found in ${file.name}`);
          continue;
        }

        const worksheet = workbook.Sheets[keywordSheet];
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
        }
      } catch (err: any) {
        console.error(`Error processing file ${file.name}:`, err);
        updateWebsiteEntry(entryId, { error: `Error processing ${file.name}: ${err.message}` });
      }
    }

    updateWebsiteEntry(entryId, { keywords: extractedKeywords, similarityResults: null, excelFiles: fileArray });
  };

  const handleInvestigateAll = async () => {
    const validEntries = websiteEntries.filter(entry => entry.url.trim());
    if (validEntries.length === 0) {
      setError('Please enter at least one website URL');
      return;
    }

    setError(null);
    setLoading(true);

    // Clear search results and reset selected keywords for entries being investigated
    const entriesToClear = new Set(validEntries.map(e => e.id));
    setSearchResults(prev => {
      const cleared: { [key: string]: SearchResult[] } = {};
      Object.keys(prev).forEach(key => {
        const [entryId] = key.split('-');
        if (!entriesToClear.has(entryId)) {
          cleared[key] = prev[key];
        }
      });
      return cleared;
    });

    // Process all websites in parallel
    const investigationPromises = validEntries.map(async (entry) => {
      updateWebsiteEntry(entry.id, { isProcessing: true, error: null });
      
      try {
        const response = await fetch('/api/investigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            website_url: entry.url,
            custom_prompt: investigationPrompt || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Investigation failed');
        }

        const data: InvestigationResults = await response.json();
        updateWebsiteEntry(entry.id, { 
          investigationResults: data,
          isProcessing: false,
        });
      } catch (err: any) {
        updateWebsiteEntry(entry.id, { 
          error: err.message || 'Failed to investigate website',
          isProcessing: false,
        });
      }
    });

    await Promise.all(investigationPromises);
    setLoading(false);
  };

  const handleCalculateSimilaritiesForAll = async () => {
    const entriesWithData = websiteEntries.filter(
      entry => entry.investigationResults && entry.keywords.length > 0
    );

    if (entriesWithData.length === 0) {
      setError('Please investigate websites and select Excel files first');
      return;
    }

    setError(null);
    setLoading(true);

    // Process all entries in parallel
    const similarityPromises = entriesWithData.map(async (entry) => {
      const investigationResults = entry.investigationResults!;
      const keywords = entry.keywords;

      const modelPromises: Array<Promise<{ model: string; results: SimilarityResult[]; total_score?: number }>> = [];

      if (investigationResults.perplexity && !investigationResults.perplexity.error) {
        modelPromises.push(
          fetch('/api/calculate-similarities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excelKeywords: keywords,
              perplexityKeywords: investigationResults.perplexity.keywords,
            }),
          })
            .then(res => res.json())
            .then(data => ({ model: 'perplexity', results: data.results, total_score: data.total_score }))
        );
      }

      if (investigationResults.gpt && !investigationResults.gpt.error) {
        modelPromises.push(
          fetch('/api/calculate-similarities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excelKeywords: keywords,
              perplexityKeywords: investigationResults.gpt.keywords,
            }),
          })
            .then(res => res.json())
            .then(data => ({ model: 'gpt', results: data.results, total_score: data.total_score }))
        );
      }

      if (investigationResults.gemini && !investigationResults.gemini.error) {
        modelPromises.push(
          fetch('/api/calculate-similarities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              excelKeywords: keywords,
              perplexityKeywords: investigationResults.gemini.keywords,
            }),
          })
            .then(res => res.json())
            .then(data => ({ model: 'gemini', results: data.results, total_score: data.total_score }))
        );
      }

      try {
        const allResults = await Promise.all(modelPromises);
        updateWebsiteEntry(entry.id, { similarityResults: allResults });
      } catch (err: any) {
        updateWebsiteEntry(entry.id, { error: err.message || 'Failed to calculate similarities' });
      }
    });

    await Promise.all(similarityPromises);
    setLoading(false);
  };

  // Note: handleGeneratePrompts removed - functionality can be re-added per website entry if needed

  const handleSearchKeywords = async (entryId: string, model: string, keywords: string[]) => {
    if (keywords.length === 0) {
      setError('Please select at least one keyword to search');
      return;
    }

    const searchKey = `${entryId}-${model}`;
    setIsSearching(prev => ({ ...prev, [searchKey]: true }));
    setError(null);

    try {
      const response = await fetch('/api/search-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }

      const data = await response.json();
      setSearchResults(prev => ({ ...prev, [searchKey]: data.results || [] }));
    } catch (err: any) {
      setError(err.message || 'Failed to search keywords');
      setSearchResults(prev => ({ ...prev, [searchKey]: [] }));
    } finally {
      setIsSearching(prev => ({ ...prev, [searchKey]: false }));
    }
  };

  const toggleKeywordSelection = (entryId: string, model: string, keyword: string) => {
    const key = `${entryId}-${model}`;
    setSelectedKeywords(prev => {
      const current = prev[key] || [];
      if (current.includes(keyword)) {
        return { ...prev, [key]: current.filter(k => k !== keyword) };
      } else {
        return { ...prev, [key]: [...current, keyword] };
      }
    });
  };

  // Initialize all keywords as selected when investigation results are available
  // This runs whenever investigation results change, ensuring fresh keywords are selected
  useEffect(() => {
    const newSelectedKeywords: { [key: string]: string[] } = {};
    
    websiteEntries.forEach(entry => {
      if (entry.investigationResults) {
        if (entry.investigationResults.perplexity && !entry.investigationResults.perplexity.error) {
          const key = `${entry.id}-perplexity`;
          const currentKeywords = entry.investigationResults.perplexity.keywords.map(kw => kw.keyword);
          // Always set to current keywords from investigation results (fresh results)
          newSelectedKeywords[key] = currentKeywords;
        }
        if (entry.investigationResults.gpt && !entry.investigationResults.gpt.error) {
          const key = `${entry.id}-gpt`;
          const currentKeywords = entry.investigationResults.gpt.keywords.map(kw => kw.keyword);
          // Always set to current keywords from investigation results (fresh results)
          newSelectedKeywords[key] = currentKeywords;
        }
        if (entry.investigationResults.gemini && !entry.investigationResults.gemini.error) {
          const key = `${entry.id}-gemini`;
          const currentKeywords = entry.investigationResults.gemini.keywords.map(kw => kw.keyword);
          // Always set to current keywords from investigation results (fresh results)
          newSelectedKeywords[key] = currentKeywords;
        }
      } else {
        // If investigation results are cleared, also clear selected keywords for this entry
        ['perplexity', 'gpt', 'gemini'].forEach(model => {
          const key = `${entry.id}-${model}`;
          // Clear the key by not including it in newSelectedKeywords
          // We'll handle removal separately
        });
      }
    });

    // Update selected keywords - replace with fresh keywords from investigation results
    setSelectedKeywords(prev => {
      const updated = { ...prev };
      
      // First, remove keys for entries that no longer have investigation results
      websiteEntries.forEach(entry => {
        if (!entry.investigationResults) {
          ['perplexity', 'gpt', 'gemini'].forEach(model => {
            const key = `${entry.id}-${model}`;
            delete updated[key];
          });
        }
      });
      
      // Then, update with new keywords from investigation results
      Object.keys(newSelectedKeywords).forEach(key => {
        updated[key] = newSelectedKeywords[key];
      });
      
      return updated;
    });
  }, [websiteEntries]);

  return (
    <main className="min-h-screen p-8 bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">AI Traffic Eval Tool</h1>

        {/* Investigation Prompt Editor */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <label htmlFor="investigation-prompt" className="block text-sm font-medium text-gray-700 mb-2">
            Investigation Prompt (Editable)
          </label>
          <textarea
            id="investigation-prompt"
            value={investigationPrompt}
            onChange={(e) => setInvestigationPrompt(e.target.value)}
            rows={8}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm text-gray-900"
            placeholder="Leave empty to use default prompt. Use {domainName} and {baseDomain} as placeholders."
            disabled={loading}
          />
          <p className="text-xs text-gray-500 mt-2">
            Leave empty to use the default prompt. The prompt will be sent to all models (Perplexity, GPT, and Gemini) for website investigation.
            Use <code className="bg-gray-100 px-1 rounded">{"{domainName}"}</code> and <code className="bg-gray-100 px-1 rounded">{"{baseDomain}"}</code> as placeholders.
          </p>
        </div>

        {/* Website Entries Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Website Entries</h2>
            <div className="flex gap-2">
              <button
                onClick={handleInvestigateAll}
                disabled={loading || websiteEntries.filter(e => e.url.trim()).length === 0}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : 'Investigate All'}
              </button>
              <button
                onClick={handleCalculateSimilaritiesForAll}
                disabled={loading || websiteEntries.filter(e => e.investigationResults && e.keywords.length > 0).length === 0}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Calculate Similarities All
              </button>
              <button
                onClick={addWebsiteEntry}
                disabled={loading}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + Add Website
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {websiteEntries.map((entry, index) => (
              <div key={entry.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                    {index + 1}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Website URL
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={entry.url}
                          onChange={(e) => updateWebsiteEntry(entry.id, { url: e.target.value })}
                          placeholder="https://example.com"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                          disabled={loading || entry.isProcessing}
                        />
                        {websiteEntries.length > 1 && (
                          <button
                            onClick={() => removeWebsiteEntry(entry.id)}
                            disabled={loading || entry.isProcessing}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Excel Files (Keyword Sheets)
                      </label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          multiple
                          onChange={(e) => handleFileSelectForEntry(entry.id, e)}
                          className="hidden"
                          id={`excel-files-${entry.id}`}
                          disabled={loading || entry.isProcessing}
                        />
                        <label
                          htmlFor={`excel-files-${entry.id}`}
                          className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-block"
                        >
                          Select Excel Files
                        </label>
                        {entry.excelFiles.length > 0 && (
                          <span className="text-sm text-gray-600">
                            {entry.excelFiles.length} file{entry.excelFiles.length !== 1 ? 's' : ''} selected
                          </span>
                        )}
                      </div>
                      {entry.keywords.length > 0 && (
                        <p className="text-sm text-green-600 mt-2">
                          ✓ Extracted {entry.keywords.length} keyword{entry.keywords.length !== 1 ? 's' : ''} from {entry.excelFiles.length} file{entry.excelFiles.length !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>

                    {entry.error && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                        {entry.error}
                      </div>
                    )}

                    {entry.isProcessing && (
                      <div className="flex items-center gap-2 text-blue-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm">Processing...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Similarity Summary Table - At the Top */}
        {websiteEntries.filter(e => e.similarityResults && e.similarityResults.length > 0).length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Similarity Summary</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b-2 border-indigo-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Website</th>
                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Model</th>
                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Total Score</th>
                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Keywords Matched</th>
                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Total Keywords</th>
                  </tr>
                </thead>
                <tbody>
                  {websiteEntries
                    .filter(e => e.similarityResults && e.similarityResults.length > 0)
                    .map((entry) => {
                      const investigationResults = entry.investigationResults;
                      return entry.similarityResults!.map((modelResult, idx) => {
                        const totalScore = modelResult.total_score ?? 0;
                        const scorePercentage = (totalScore * 100).toFixed(2);
                        const scoreColor =
                          totalScore > 0.7
                            ? 'text-green-700 bg-green-50 border-green-200'
                            : totalScore > 0.5
                            ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                            : 'text-gray-700 bg-gray-50 border-gray-200';
                        
                        // Count matched keywords (Excel keywords that have at least one matched LLM keyword)
                        const matchedCount = modelResult.results.filter(result => 
                          result.similarities.some(s => s.is_matched)
                        ).length;
                        
                        const modelName = investigationResults && 
                          (modelResult.model === 'perplexity' 
                            ? investigationResults.perplexity?.model_name || 'Perplexity Sonar'
                            : modelResult.model === 'gpt'
                            ? investigationResults.gpt?.model_name || 'GPT'
                            : investigationResults.gemini?.model_name || 'Gemini');
                        
                        return (
                          <tr key={`${entry.id}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-4">
                              <div className="text-sm font-medium text-gray-900 truncate max-w-xs" title={entry.url}>
                                {entry.url || 'Unknown URL'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="text-sm font-medium text-gray-900">{modelName}</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
                                {scorePercentage}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="text-sm font-medium text-gray-900">{matchedCount}</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="text-sm font-medium text-gray-900">{entry.keywords.length}</span>
                            </td>
                          </tr>
                        );
                      });
                    })
                    .flat()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Results for Each Website Entry */}
        {websiteEntries.filter(e => e.investigationResults || e.similarityResults).length > 0 && (
          <div className="space-y-6">
            {websiteEntries.map((entry) => {
              // Show entry if it has investigation results OR similarity results
              if (!entry.investigationResults && !entry.similarityResults) return null;
              const investigationResults = entry.investigationResults;
              const isExpanded = expandedWebsiteResults[entry.id] || false;
              // Get active tab or default to first available model
              const getDefaultTab = () => {
                if (investigationResults?.perplexity) return 'perplexity';
                if (investigationResults?.gpt) return 'gpt';
                if (investigationResults?.gemini) return 'gemini';
                return '';
              };
              const activeTab = activeLLMTab[entry.id] || getDefaultTab();
              
              return (
                <div key={entry.id} className="bg-white rounded-lg shadow-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-semibold text-gray-900">
                      Results for: {entry.url || 'Unknown URL'}
                    </h2>
                    <button
                      onClick={() => setExpandedWebsiteResults(prev => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <svg
                        className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {isExpanded ? 'Collapse' : 'Expand'} Results
                    </button>
                  </div>

                  {isExpanded && (
                    <>

                  {/* Investigation Results */}
                  {investigationResults && (
                    <div className="mb-6">
                      <h3 className="text-xl font-semibold text-gray-900 mb-4">Website Analysis - All Models</h3>
            
                      {/* Model Results Tabs */}
                      <div className="mb-6 border-b border-gray-200">
                        <div className="flex gap-4">
                          {investigationResults.perplexity && (
                            <button
                              onClick={() => setActiveLLMTab(prev => ({ ...prev, [entry.id]: 'perplexity' }))}
                              className={`px-4 py-2 border-b-2 font-semibold transition-colors ${
                                activeTab === 'perplexity'
                                  ? 'border-blue-600 text-blue-600'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              }`}
                            >
                              {investigationResults.perplexity.model_name || 'Perplexity Sonar'}
                            </button>
                          )}
                          {investigationResults.gpt && (
                            <button
                              onClick={() => setActiveLLMTab(prev => ({ ...prev, [entry.id]: 'gpt' }))}
                              className={`px-4 py-2 border-b-2 font-semibold transition-colors ${
                                activeTab === 'gpt'
                                  ? 'border-green-600 text-green-600'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              }`}
                            >
                              {investigationResults.gpt.model_name || 'GPT'}
                            </button>
                          )}
                          {investigationResults.gemini && (
                            <button
                              onClick={() => setActiveLLMTab(prev => ({ ...prev, [entry.id]: 'gemini' }))}
                              className={`px-4 py-2 border-b-2 font-semibold transition-colors ${
                                activeTab === 'gemini'
                                  ? 'border-purple-600 text-purple-600'
                                  : 'border-transparent text-gray-500 hover:text-gray-700'
                              }`}
                            >
                              {investigationResults.gemini.model_name || 'Gemini'}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Display results for active model only */}
                      {activeTab === 'perplexity' && investigationResults.perplexity && !investigationResults.perplexity.error && (
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
                
                {/* Keywords Comparison - Collapsible */}
                {((entry.keywords.length > 0) || (entry.similarityResults && entry.similarityResults.find(sr => sr.model === 'perplexity'))) && (() => {
                  const keywordsComparisonKey = `${entry.id}-perplexity-keywords-comparison`;
                  const isKeywordsComparisonExpanded = expandedKeywordsComparison[keywordsComparisonKey] || false;
                  
                  return (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <button
                        onClick={() => setExpandedKeywordsComparison(prev => ({ ...prev, [keywordsComparisonKey]: !prev[keywordsComparisonKey] }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg hover:from-indigo-100 hover:to-purple-100 transition-colors"
                      >
                        <h4 className="text-lg font-semibold text-gray-900">Keywords Comparison</h4>
                        <svg
                          className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordsComparisonExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isKeywordsComparisonExpanded && (
                        <div className="mt-4 space-y-6">
                          {/* Keywords from Excel Files */}
                          {entry.keywords.length > 0 && (
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900 mb-3">Keywords from Excel Files</h4>
                              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {entry.keywords.map((keywordData, index) => (
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
                                    Total: <span className="font-semibold text-purple-700">{entry.keywords.length}</span> keyword{entry.keywords.length !== 1 ? 's' : ''} from <span className="font-semibold text-purple-700">{entry.excelFiles.length}</span> file{entry.excelFiles.length !== 1 ? 's' : ''}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Similarity Results for Perplexity */}
                          {entry.similarityResults && entry.similarityResults.find(sr => sr.model === 'perplexity') && (() => {
                  const modelResult = entry.similarityResults!.find(sr => sr.model === 'perplexity')!;
                  const totalScore = modelResult.total_score ?? 0;
                  const scorePercentage = (totalScore * 100).toFixed(2);
                  const scoreColor =
                    totalScore > 0.7
                      ? 'text-green-700 bg-green-50 border-green-200'
                      : totalScore > 0.5
                      ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                      : 'text-gray-700 bg-gray-50 border-gray-200';
                  
                  return (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Keyword-Offering Similarity Scores</h4>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm text-gray-600 font-medium">Total Similarity Score:</span>
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
                            {scorePercentage}%
                          </span>
                          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                totalScore > 0.7
                                  ? 'bg-green-500'
                                  : totalScore > 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-gray-400'
                              }`}
                              style={{ width: `${Math.min(totalScore * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        {modelResult.results.map((result, keywordIndex) => {
                          const keywordKey = `${entry.id}-perplexity-${keywordIndex}`;
                          const isKeywordExpanded = expandedSimilarityKeywords[keywordKey] || false;
                          
                          return (
                            <div
                              key={keywordIndex}
                              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                            >
                              <button
                                onClick={() => setExpandedSimilarityKeywords(prev => ({ ...prev, [keywordKey]: !prev[keywordKey] }))}
                                className="w-full bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4 hover:from-indigo-100 hover:to-purple-100 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                                    {keywordIndex + 1}
                                  </div>
                                  <div className="flex-1 text-left">
                                    <h4 className="text-lg font-semibold text-gray-900">{result.keyword}</h4>
                                    <p className="text-xs text-gray-500 mt-0.5">{result.fileName}</p>
                                  </div>
                                  <svg
                                    className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordExpanded ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </button>
                              {isKeywordExpanded && (
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
                                          const scoreColor =
                                            score > 0.7
                                              ? 'text-green-700 bg-green-50 border-green-200'
                                              : score > 0.5
                                              ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                                              : 'text-gray-700 bg-gray-50 border-gray-200';
                                          const isMatched = similarity.is_matched ?? false;
                                          
                                          return (
                                            <tr
                                              key={simIndex}
                                              className={`border-b border-gray-100 hover:bg-gray-50 ${
                                                isMatched 
                                                  ? 'bg-blue-100 border-l-4 border-blue-500' 
                                                  : similarity.is_main 
                                                  ? 'bg-emerald-50/30' 
                                                  : ''
                                              }`}
                                            >
                                              <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium text-gray-900">
                                                    {similarity.perplexity_keyword}
                                                  </span>
                                                  {isMatched && (
                                                    <span className="px-2 py-0.5 text-xs font-bold text-blue-700 bg-blue-200 rounded-full">
                                                      MATCHED
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-3 px-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                  <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
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
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Keyword Search Section - At the bottom */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Search Keywords in Database</h4>
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-3">Select keywords to search in 3 collections:</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                      {investigationResults.perplexity.keywords.map((kw, idx) => {
                        const searchKey = `${entry.id}-perplexity`;
                        const selected = selectedKeywords[searchKey] || [];
                        const isSelected = selected.includes(kw.keyword);
                        return (
                          <label
                            key={idx}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-blue-100 border-blue-500'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleKeywordSelection(entry.id, 'perplexity', kw.keyword)}
                              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-900 flex-1">{kw.keyword}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => {
                        const searchKey = `${entry.id}-perplexity`;
                        const selected = selectedKeywords[searchKey] || [];
                        handleSearchKeywords(entry.id, 'perplexity', selected);
                      }}
                      disabled={isSearching[`${entry.id}-perplexity`] || (selectedKeywords[`${entry.id}-perplexity`] || []).length === 0}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSearching[`${entry.id}-perplexity`] ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Searching...
                        </>
                      ) : (
                        'Search Keywords'
                      )}
                    </button>
                  </div>
                  
                  {/* Search Results - Hierarchical: Keyword → Collection → Prompts */}
                  {searchResults[`${entry.id}-perplexity`] && searchResults[`${entry.id}-perplexity`].length > 0 && (() => {
                    const results = searchResults[`${entry.id}-perplexity`];
                    
                    // Group results by keyword, then by collection
                    const groupedResults: { [keyword: string]: { [collection: string]: SearchResult[] } } = {};
                    results.forEach(result => {
                      if (!groupedResults[result.keyword]) {
                        groupedResults[result.keyword] = {};
                      }
                      if (!groupedResults[result.keyword][result.collection]) {
                        groupedResults[result.keyword][result.collection] = [];
                      }
                      groupedResults[result.keyword][result.collection].push(result);
                    });

                    return (
                      <div className="mt-4">
                        <h5 className="text-md font-semibold text-gray-900 mb-3">
                          Results ({results.length} prompts)
                        </h5>
                        <div className="space-y-2">
                          {Object.entries(groupedResults).map(([keyword, collections]) => {
                            const keywordKey = `${entry.id}-perplexity-keyword-${keyword}`;
                            const isKeywordExpanded = expandedSearchKeywords[keywordKey] || false;
                            const totalPrompts = Object.values(collections).reduce((sum, prompts) => sum + prompts.length, 0);
                            
                            return (
                              <div key={keyword} className="border border-gray-200 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => setExpandedSearchKeywords(prev => ({ ...prev, [keywordKey]: !prev[keywordKey] }))}
                                  className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <svg
                                      className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordExpanded ? 'rotate-90' : ''}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span className="font-semibold text-gray-900">{keyword}</span>
                                    <span className="text-sm text-gray-600">({totalPrompts} prompts)</span>
                                  </div>
                                </button>
                                
                                {isKeywordExpanded && (
                                  <div className="bg-white">
                                    {Object.entries(collections).map(([collection, prompts]) => {
                                      const collectionKey = `${keywordKey}-collection-${collection}`;
                                      const isCollectionExpanded = expandedSearchCollections[collectionKey] || false;
                                      
                                      return (
                                        <div key={collection} className="border-t border-gray-200">
                                          <button
                                            onClick={() => setExpandedSearchCollections(prev => ({ ...prev, [collectionKey]: !prev[collectionKey] }))}
                                            className="w-full flex items-center justify-between px-6 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                                          >
                                            <div className="flex items-center gap-3">
                                              <svg
                                                className={`w-4 h-4 text-gray-600 transition-transform ${isCollectionExpanded ? 'rotate-90' : ''}`}
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                              </svg>
                                              <span className="font-medium text-gray-900">{collection}</span>
                                              <span className="text-sm text-gray-600">({prompts.length} prompts)</span>
                                            </div>
                                          </button>
                                          
                                          {isCollectionExpanded && (
                                            <div className="px-6 py-3 space-y-2 max-h-96 overflow-y-auto">
                                              {prompts.map((result, idx) => (
                                                <div
                                                  key={idx}
                                                  className="p-3 bg-white border border-gray-200 rounded-lg text-sm"
                                                >
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                                      Score: {(result.similarityScore * 100).toFixed(1)}%
                                                    </span>
                                                  </div>
                                                  <p className="text-gray-900 mt-1">{result.first_prompt}</p>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
                      )}
                      {activeTab === 'gpt' && investigationResults.gpt && !investigationResults.gpt.error && (
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
                
                {/* Keywords Comparison - Collapsible */}
                {((entry.keywords.length > 0) || (entry.similarityResults && entry.similarityResults.find(sr => sr.model === 'gpt'))) && (() => {
                  const keywordsComparisonKey = `${entry.id}-gpt-keywords-comparison`;
                  const isKeywordsComparisonExpanded = expandedKeywordsComparison[keywordsComparisonKey] || false;
                  
                  return (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <button
                        onClick={() => setExpandedKeywordsComparison(prev => ({ ...prev, [keywordsComparisonKey]: !prev[keywordsComparisonKey] }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg hover:from-indigo-100 hover:to-purple-100 transition-colors"
                      >
                        <h4 className="text-lg font-semibold text-gray-900">Keywords Comparison</h4>
                        <svg
                          className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordsComparisonExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isKeywordsComparisonExpanded && (
                        <div className="mt-4 space-y-6">
                          {/* Keywords from Excel Files */}
                          {entry.keywords.length > 0 && (
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900 mb-3">Keywords from Excel Files</h4>
                              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {entry.keywords.map((keywordData, index) => (
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
                                    Total: <span className="font-semibold text-purple-700">{entry.keywords.length}</span> keyword{entry.keywords.length !== 1 ? 's' : ''} from <span className="font-semibold text-purple-700">{entry.excelFiles.length}</span> file{entry.excelFiles.length !== 1 ? 's' : ''}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Similarity Results for GPT */}
                          {entry.similarityResults && entry.similarityResults.find(sr => sr.model === 'gpt') && (() => {
                  const modelResult = entry.similarityResults!.find(sr => sr.model === 'gpt')!;
                  const totalScore = modelResult.total_score ?? 0;
                  const scorePercentage = (totalScore * 100).toFixed(2);
                  const scoreColor =
                    totalScore > 0.7
                      ? 'text-green-700 bg-green-50 border-green-200'
                      : totalScore > 0.5
                      ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                      : 'text-gray-700 bg-gray-50 border-gray-200';
                  
                  return (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Keyword-Offering Similarity Scores</h4>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm text-gray-600 font-medium">Total Similarity Score:</span>
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
                            {scorePercentage}%
                          </span>
                          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                totalScore > 0.7
                                  ? 'bg-green-500'
                                  : totalScore > 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-gray-400'
                              }`}
                              style={{ width: `${Math.min(totalScore * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        {modelResult.results.map((result, keywordIndex) => {
                          const keywordKey = `${entry.id}-gpt-${keywordIndex}`;
                          const isKeywordExpanded = expandedSimilarityKeywords[keywordKey] || false;
                          
                          return (
                            <div
                              key={keywordIndex}
                              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                            >
                              <button
                                onClick={() => setExpandedSimilarityKeywords(prev => ({ ...prev, [keywordKey]: !prev[keywordKey] }))}
                                className="w-full bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4 hover:from-indigo-100 hover:to-purple-100 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                                    {keywordIndex + 1}
                                  </div>
                                  <div className="flex-1 text-left">
                                    <h4 className="text-lg font-semibold text-gray-900">{result.keyword}</h4>
                                    <p className="text-xs text-gray-500 mt-0.5">{result.fileName}</p>
                                  </div>
                                  <svg
                                    className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordExpanded ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </button>
                              {isKeywordExpanded && (
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
                                          const scoreColor =
                                            score > 0.7
                                              ? 'text-green-700 bg-green-50 border-green-200'
                                              : score > 0.5
                                              ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                                              : 'text-gray-700 bg-gray-50 border-gray-200';
                                          const isMatched = similarity.is_matched ?? false;
                                          
                                          return (
                                            <tr
                                              key={simIndex}
                                              className={`border-b border-gray-100 hover:bg-gray-50 ${
                                                isMatched 
                                                  ? 'bg-blue-100 border-l-4 border-blue-500' 
                                                  : similarity.is_main 
                                                  ? 'bg-emerald-50/30' 
                                                  : ''
                                              }`}
                                            >
                                              <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium text-gray-900">
                                                    {similarity.perplexity_keyword}
                                                  </span>
                                                  {isMatched && (
                                                    <span className="px-2 py-0.5 text-xs font-bold text-blue-700 bg-blue-200 rounded-full">
                                                      MATCHED
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-3 px-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                  <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
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
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Keyword Search Section - At the bottom */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Search Keywords in Database</h4>
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-3">Select keywords to search in 3 collections:</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                      {investigationResults.gpt.keywords.map((kw, idx) => {
                        const searchKey = `${entry.id}-gpt`;
                        const selected = selectedKeywords[searchKey] || [];
                        const isSelected = selected.includes(kw.keyword);
                        return (
                          <label
                            key={idx}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-green-100 border-green-500'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleKeywordSelection(entry.id, 'gpt', kw.keyword)}
                              className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-900 flex-1">{kw.keyword}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => {
                        const searchKey = `${entry.id}-gpt`;
                        const selected = selectedKeywords[searchKey] || [];
                        handleSearchKeywords(entry.id, 'gpt', selected);
                      }}
                      disabled={isSearching[`${entry.id}-gpt`] || (selectedKeywords[`${entry.id}-gpt`] || []).length === 0}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSearching[`${entry.id}-gpt`] ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Searching...
                        </>
                      ) : (
                        'Search Keywords'
                      )}
                    </button>
                  </div>
                  
                  {/* Search Results - Hierarchical: Keyword → Collection → Prompts */}
                  {searchResults[`${entry.id}-gpt`] && searchResults[`${entry.id}-gpt`].length > 0 && (() => {
                    const results = searchResults[`${entry.id}-gpt`];
                    
                    // Group results by keyword, then by collection
                    const groupedResults: { [keyword: string]: { [collection: string]: SearchResult[] } } = {};
                    results.forEach(result => {
                      if (!groupedResults[result.keyword]) {
                        groupedResults[result.keyword] = {};
                      }
                      if (!groupedResults[result.keyword][result.collection]) {
                        groupedResults[result.keyword][result.collection] = [];
                      }
                      groupedResults[result.keyword][result.collection].push(result);
                    });

                    return (
                      <div className="mt-4">
                        <h5 className="text-md font-semibold text-gray-900 mb-3">
                          Results ({results.length} prompts)
                        </h5>
                        <div className="space-y-2">
                          {Object.entries(groupedResults).map(([keyword, collections]) => {
                            const keywordKey = `${entry.id}-gpt-keyword-${keyword}`;
                            const isKeywordExpanded = expandedSearchKeywords[keywordKey] || false;
                            const totalPrompts = Object.values(collections).reduce((sum, prompts) => sum + prompts.length, 0);
                            
                            return (
                              <div key={keyword} className="border border-gray-200 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => setExpandedSearchKeywords(prev => ({ ...prev, [keywordKey]: !prev[keywordKey] }))}
                                  className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <svg
                                      className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordExpanded ? 'rotate-90' : ''}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span className="font-semibold text-gray-900">{keyword}</span>
                                    <span className="text-sm text-gray-600">({totalPrompts} prompts)</span>
                                  </div>
                                </button>
                                
                                {isKeywordExpanded && (
                                  <div className="bg-white">
                                    {Object.entries(collections).map(([collection, prompts]) => {
                                      const collectionKey = `${keywordKey}-collection-${collection}`;
                                      const isCollectionExpanded = expandedSearchCollections[collectionKey] || false;
                                      
                                      return (
                                        <div key={collection} className="border-t border-gray-200">
                                          <button
                                            onClick={() => setExpandedSearchCollections(prev => ({ ...prev, [collectionKey]: !prev[collectionKey] }))}
                                            className="w-full flex items-center justify-between px-6 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                                          >
                                            <div className="flex items-center gap-3">
                                              <svg
                                                className={`w-4 h-4 text-gray-600 transition-transform ${isCollectionExpanded ? 'rotate-90' : ''}`}
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                              </svg>
                                              <span className="font-medium text-gray-900">{collection}</span>
                                              <span className="text-sm text-gray-600">({prompts.length} prompts)</span>
                                            </div>
                                          </button>
                                          
                                          {isCollectionExpanded && (
                                            <div className="px-6 py-3 space-y-2 max-h-96 overflow-y-auto">
                                              {prompts.map((result, idx) => (
                                                <div
                                                  key={idx}
                                                  className="p-3 bg-white border border-gray-200 rounded-lg text-sm"
                                                >
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                                      Score: {(result.similarityScore * 100).toFixed(1)}%
                                                    </span>
                                                  </div>
                                                  <p className="text-gray-900 mt-1">{result.first_prompt}</p>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
                      )}
                      {activeTab === 'gemini' && investigationResults.gemini && !investigationResults.gemini.error && (
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
                
                {/* Keywords Comparison - Collapsible */}
                {((entry.keywords.length > 0) || (entry.similarityResults && entry.similarityResults.find(sr => sr.model === 'gemini'))) && (() => {
                  const keywordsComparisonKey = `${entry.id}-gemini-keywords-comparison`;
                  const isKeywordsComparisonExpanded = expandedKeywordsComparison[keywordsComparisonKey] || false;
                  
                  return (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <button
                        onClick={() => setExpandedKeywordsComparison(prev => ({ ...prev, [keywordsComparisonKey]: !prev[keywordsComparisonKey] }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg hover:from-indigo-100 hover:to-purple-100 transition-colors"
                      >
                        <h4 className="text-lg font-semibold text-gray-900">Keywords Comparison</h4>
                        <svg
                          className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordsComparisonExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isKeywordsComparisonExpanded && (
                        <div className="mt-4 space-y-6">
                          {/* Keywords from Excel Files */}
                          {entry.keywords.length > 0 && (
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900 mb-3">Keywords from Excel Files</h4>
                              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {entry.keywords.map((keywordData, index) => (
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
                                    Total: <span className="font-semibold text-purple-700">{entry.keywords.length}</span> keyword{entry.keywords.length !== 1 ? 's' : ''} from <span className="font-semibold text-purple-700">{entry.excelFiles.length}</span> file{entry.excelFiles.length !== 1 ? 's' : ''}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Similarity Results for Gemini */}
                          {entry.similarityResults && entry.similarityResults.find(sr => sr.model === 'gemini') && (() => {
                  const modelResult = entry.similarityResults!.find(sr => sr.model === 'gemini')!;
                  const totalScore = modelResult.total_score ?? 0;
                  const scorePercentage = (totalScore * 100).toFixed(2);
                  const scoreColor =
                    totalScore > 0.7
                      ? 'text-green-700 bg-green-50 border-green-200'
                      : totalScore > 0.5
                      ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                      : 'text-gray-700 bg-gray-50 border-gray-200';
                  
                  return (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Keyword-Offering Similarity Scores</h4>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm text-gray-600 font-medium">Total Similarity Score:</span>
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
                            {scorePercentage}%
                          </span>
                          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                totalScore > 0.7
                                  ? 'bg-green-500'
                                  : totalScore > 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-gray-400'
                              }`}
                              style={{ width: `${Math.min(totalScore * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        {modelResult.results.map((result, keywordIndex) => {
                          const keywordKey = `${entry.id}-gemini-${keywordIndex}`;
                          const isKeywordExpanded = expandedSimilarityKeywords[keywordKey] || false;
                          
                          return (
                            <div
                              key={keywordIndex}
                              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                            >
                              <button
                                onClick={() => setExpandedSimilarityKeywords(prev => ({ ...prev, [keywordKey]: !prev[keywordKey] }))}
                                className="w-full bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4 hover:from-indigo-100 hover:to-purple-100 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                                    {keywordIndex + 1}
                                  </div>
                                  <div className="flex-1 text-left">
                                    <h4 className="text-lg font-semibold text-gray-900">{result.keyword}</h4>
                                    <p className="text-xs text-gray-500 mt-0.5">{result.fileName}</p>
                                  </div>
                                  <svg
                                    className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordExpanded ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </button>
                              {isKeywordExpanded && (
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
                                          const scoreColor =
                                            score > 0.7
                                              ? 'text-green-700 bg-green-50 border-green-200'
                                              : score > 0.5
                                              ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                                              : 'text-gray-700 bg-gray-50 border-gray-200';
                                          const isMatched = similarity.is_matched ?? false;
                                          
                                          return (
                                            <tr
                                              key={simIndex}
                                              className={`border-b border-gray-100 hover:bg-gray-50 ${
                                                isMatched 
                                                  ? 'bg-blue-100 border-l-4 border-blue-500' 
                                                  : similarity.is_main 
                                                  ? 'bg-emerald-50/30' 
                                                  : ''
                                              }`}
                                            >
                                              <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium text-gray-900">
                                                    {similarity.perplexity_keyword}
                                                  </span>
                                                  {isMatched && (
                                                    <span className="px-2 py-0.5 text-xs font-bold text-blue-700 bg-blue-200 rounded-full">
                                                      MATCHED
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-3 px-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                  <span className={`px-3 py-1 rounded-lg border font-semibold text-sm ${scoreColor}`}>
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
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Keyword Search Section - At the bottom */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Search Keywords in Database</h4>
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-3">Select keywords to search in 3 collections:</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                      {investigationResults.gemini.keywords.map((kw, idx) => {
                        const searchKey = `${entry.id}-gemini`;
                        const selected = selectedKeywords[searchKey] || [];
                        const isSelected = selected.includes(kw.keyword);
                        return (
                          <label
                            key={idx}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-purple-100 border-purple-500'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleKeywordSelection(entry.id, 'gemini', kw.keyword)}
                              className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                            />
                            <span className="text-sm text-gray-900 flex-1">{kw.keyword}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => {
                        const searchKey = `${entry.id}-gemini`;
                        const selected = selectedKeywords[searchKey] || [];
                        handleSearchKeywords(entry.id, 'gemini', selected);
                      }}
                      disabled={isSearching[`${entry.id}-gemini`] || (selectedKeywords[`${entry.id}-gemini`] || []).length === 0}
                      className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSearching[`${entry.id}-gemini`] ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Searching...
                        </>
                      ) : (
                        'Search Keywords'
                      )}
                    </button>
                  </div>
                  
                  {/* Search Results - Hierarchical: Keyword → Collection → Prompts */}
                  {searchResults[`${entry.id}-gemini`] && searchResults[`${entry.id}-gemini`].length > 0 && (() => {
                    const results = searchResults[`${entry.id}-gemini`];
                    
                    // Group results by keyword, then by collection
                    const groupedResults: { [keyword: string]: { [collection: string]: SearchResult[] } } = {};
                    results.forEach(result => {
                      if (!groupedResults[result.keyword]) {
                        groupedResults[result.keyword] = {};
                      }
                      if (!groupedResults[result.keyword][result.collection]) {
                        groupedResults[result.keyword][result.collection] = [];
                      }
                      groupedResults[result.keyword][result.collection].push(result);
                    });

                    return (
                      <div className="mt-4">
                        <h5 className="text-md font-semibold text-gray-900 mb-3">
                          Results ({results.length} prompts)
                        </h5>
                        <div className="space-y-2">
                          {Object.entries(groupedResults).map(([keyword, collections]) => {
                            const keywordKey = `${entry.id}-gemini-keyword-${keyword}`;
                            const isKeywordExpanded = expandedSearchKeywords[keywordKey] || false;
                            const totalPrompts = Object.values(collections).reduce((sum, prompts) => sum + prompts.length, 0);
                            
                            return (
                              <div key={keyword} className="border border-gray-200 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => setExpandedSearchKeywords(prev => ({ ...prev, [keywordKey]: !prev[keywordKey] }))}
                                  className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <svg
                                      className={`w-5 h-5 text-gray-600 transition-transform ${isKeywordExpanded ? 'rotate-90' : ''}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span className="font-semibold text-gray-900">{keyword}</span>
                                    <span className="text-sm text-gray-600">({totalPrompts} prompts)</span>
                                  </div>
                                </button>
                                
                                {isKeywordExpanded && (
                                  <div className="bg-white">
                                    {Object.entries(collections).map(([collection, prompts]) => {
                                      const collectionKey = `${keywordKey}-collection-${collection}`;
                                      const isCollectionExpanded = expandedSearchCollections[collectionKey] || false;
                                      
                                      return (
                                        <div key={collection} className="border-t border-gray-200">
                                          <button
                                            onClick={() => setExpandedSearchCollections(prev => ({ ...prev, [collectionKey]: !prev[collectionKey] }))}
                                            className="w-full flex items-center justify-between px-6 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                                          >
                                            <div className="flex items-center gap-3">
                                              <svg
                                                className={`w-4 h-4 text-gray-600 transition-transform ${isCollectionExpanded ? 'rotate-90' : ''}`}
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                              </svg>
                                              <span className="font-medium text-gray-900">{collection}</span>
                                              <span className="text-sm text-gray-600">({prompts.length} prompts)</span>
                                            </div>
                                          </button>
                                          
                                          {isCollectionExpanded && (
                                            <div className="px-6 py-3 space-y-2 max-h-96 overflow-y-auto">
                                              {prompts.map((result, idx) => (
                                                <div
                                                  key={idx}
                                                  className="p-3 bg-white border border-gray-200 rounded-lg text-sm"
                                                >
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                                      Score: {(result.similarityScore * 100).toFixed(1)}%
                                                    </span>
                                                  </div>
                                                  <p className="text-gray-900 mt-1">{result.first_prompt}</p>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
                      )}
            
                      {/* Error messages for failed models */}
                      {activeTab === 'perplexity' && investigationResults.perplexity?.error && (
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
                      {activeTab === 'gpt' && investigationResults.gpt?.error && (
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
                      {activeTab === 'gemini' && investigationResults.gemini?.error && (
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
                    </div>
                  )}


                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Preview Results - TODO: Re-implement with new structure if needed */}
        {false && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Prompt Analysis by Keyword</h2>
            
            <div className="space-y-8">
              {/* Preview functionality removed - can be re-added per website entry if needed */}
            </div>
          </div>
        )}

        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-900">Processing...</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

