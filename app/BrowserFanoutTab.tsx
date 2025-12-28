'use client';

import { useState } from 'react';

// Types for browser-based fanout tracking
interface FanoutQuery {
  query: string;
  searchEngine: string;
  type: string;
  results: never[];
  searchTime: number;
}

interface StepResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

export default function BrowserFanoutTab() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  // Step-by-step state
  const [browserOpen, setBrowserOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [jsonData, setJsonData] = useState<any>(null);
  const [fanoutQueries, setFanoutQueries] = useState<FanoutQuery[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [stepLogs, setStepLogs] = useState<string[]>([]);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [screenshots, setScreenshots] = useState<Array<{ timestamp: string; step: string; image: string }>>([]);
  const [showBrowser, setShowBrowser] = useState(false);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setStepLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const clearState = () => {
    setBrowserOpen(false);
    setConversationId(null);
    setJsonData(null);
    setFanoutQueries([]);
    setModel(null);
    setStepLogs([]);
    setError(null);
    setDataSource(null);
    setScreenshots([]);
  };

  // Step 1: Open Browser
  const handleOpenBrowser = async () => {
    if (!query.trim()) {
      setError('Please enter a query first');
      return;
    }

    setIsLoading(true);
    setCurrentStep('Opening browser...');
    clearState();
    addLog('Opening browser with ChatGPT...');
    addLog('🔄 Streaming capture enabled - queries will be captured as ChatGPT responds');

    try {
      const response = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', query: query.trim() }),
      });

      const data: StepResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to open browser');
      }

      setBrowserOpen(true);
      if (data.data?.screenshots && data.data.screenshots.length > 0) {
        setScreenshots(data.data.screenshots);
        addLog(`📸 Captured ${data.data.screenshots.length} initial screenshot(s)`);
      }
      addLog(`✅ Browser opened successfully`);
      
      // Show browser mode
      if (data.data?.usingBrowserless) {
        addLog(`🌐 Using Browserless.io cloud browser (stealth mode enabled)`);
        addLog(`✅ Better anti-detection - less likely to trigger Cloudflare`);
      } else {
        addLog(`💻 Using local Playwright browser`);
      }
      
      addLog(`Navigating to: ${data.data?.url}`);
      addLog(`📸 Screenshots will be captured to show browser activity`);
      addLog(`⏳ Wait for ChatGPT to respond, then click "Check Response"`);
    } catch (err: any) {
      setError(err.message);
      addLog(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setCurrentStep('');
    }
  };

  // Step 2: Check Response (and get streaming data)
  const handleCheckResponse = async () => {
    if (!browserOpen) {
      setError('Please open the browser first');
      return;
    }

    setIsLoading(true);
    setCurrentStep('Checking response...');
    addLog('Checking for response and captured queries...');

    try {
      const response = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wait-for-response' }),
      });

      const data: StepResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to check response');
      }

      // Handle login requirement
      if (data.data?.needsLogin) {
        addLog(`⚠️ Login required - please log in to ChatGPT`);
        return;
      }

      // Update conversation ID
      if (data.data?.conversationId) {
        setConversationId(data.data.conversationId);
        addLog(`✅ Conversation ID: ${data.data.conversationId}`);
      } else {
        addLog(`⚠️ No conversation ID yet - wait for ChatGPT to respond`);
      }

      // Check for streaming queries
      if (data.data?.streamingQueries && data.data.streamingQueries.length > 0) {
        const queries = data.data.streamingQueries;
        setFanoutQueries(queries.map((q: any) => ({
          query: q.query,
          searchEngine: 'ChatGPT Web Search',
          type: q.type || 'search',
          results: [],
          searchTime: 0,
        })));
        setModel(data.data.model || 'unknown');
        setDataSource('streaming');
        
        addLog(`🎉 Captured ${queries.length} fan-out queries from streaming!`);
        queries.forEach((q: any, i: number) => {
          addLog(`  ${i + 1}. "${q.query}"`);
        });
        addLog(`Model: ${data.data.model || 'unknown'}`);
        addLog(`✅ No refresh needed - queries captured during streaming!`);
      } else if (data.data?.isGenerating) {
        addLog(`⏳ Response still generating... click again when done`);
      } else if (data.data?.conversationId) {
        addLog(`✅ Response complete`);
        addLog(`ℹ️ No streaming queries captured - try "Refresh + Extract"`);
      }

    } catch (err: any) {
      setError(err.message);
      addLog(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setCurrentStep('');
    }
  };

  // Extract without refresh (try to get JSON from current page state)
  const handleExtractOnly = async () => {
    if (!browserOpen) {
      setError('Please open the browser first');
      return;
    }

    setIsLoading(true);
    setCurrentStep('Extracting...');
    addLog('Extracting fan-out queries from current page (no refresh)...');

    try {
      const findResponse = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'find-json' }),
      });

      const findData: StepResponse = await findResponse.json();

      if (!findData.success) {
        throw new Error(findData.error || 'Failed to find JSON');
      }

      setJsonData(findData.data?.json || null);
      setModel(findData.data?.model || null);
      setDataSource(findData.data?.source || 'extract-only');
      
      // Extract fanout queries
      if (findData.data?.fanoutQueries && findData.data.fanoutQueries.length > 0) {
        setFanoutQueries(findData.data.fanoutQueries.map((q: any) => ({
          query: q.query,
          searchEngine: 'ChatGPT Web Search',
          type: q.type || 'search',
          results: [],
          searchTime: 0,
        })));
        addLog(`🎉 Found ${findData.data.fanoutQueries.length} fan-out queries!`);
        findData.data.fanoutQueries.forEach((q: any, i: number) => {
          addLog(`  ${i + 1}. "${q.query}"`);
        });
        addLog(`Model: ${findData.data?.model || 'unknown'}`);
        addLog(`Source: ${findData.data?.source || 'extract-only'}`);
      } else {
        addLog('⚠️ No fan-out queries found. Try "Refresh + Extract" if needed.');
      }

    } catch (err: any) {
      setError(err.message);
      addLog(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setCurrentStep('');
    }
  };

  // Step 3: Refresh + Extract (fallback if streaming didn't capture)
  const handleRefreshAndExtract = async () => {
    if (!browserOpen) {
      setError('Please open the browser first');
      return;
    }

    setIsLoading(true);
    setCurrentStep('Refreshing and extracting...');
    addLog('Refreshing page to capture full conversation JSON...');

    try {
      // First refresh
      const refreshResponse = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      });

      const refreshData: StepResponse = await refreshResponse.json();

      if (!refreshData.success) {
        throw new Error(refreshData.error || 'Failed to refresh page');
      }

      addLog(`✅ Page refreshed`);
      if (refreshData.data?.conversationId) {
        setConversationId(refreshData.data.conversationId);
      }

      // Then find JSON
      addLog('Extracting fan-out queries...');
      const findResponse = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'find-json' }),
      });

      const findData: StepResponse = await findResponse.json();

      if (!findData.success) {
        throw new Error(findData.error || 'Failed to find JSON');
      }

      setJsonData(findData.data?.json || null);
      setModel(findData.data?.model || null);
      setDataSource(findData.data?.source || 'unknown');
      
      // Extract fanout queries
      if (findData.data?.fanoutQueries && findData.data.fanoutQueries.length > 0) {
        setFanoutQueries(findData.data.fanoutQueries.map((q: any) => ({
          query: q.query,
          searchEngine: 'ChatGPT Web Search',
          type: q.type || 'search',
          results: [],
          searchTime: 0,
        })));
        addLog(`🎉 Found ${findData.data.fanoutQueries.length} fan-out queries!`);
        findData.data.fanoutQueries.forEach((q: any, i: number) => {
          addLog(`  ${i + 1}. "${q.query}"`);
        });
        addLog(`Model: ${findData.data?.model || 'unknown'}`);
        addLog(`Source: ${findData.data?.source || 'unknown'}`);
      } else {
        addLog('No fan-out queries found');
      }

    } catch (err: any) {
      setError(err.message);
      addLog(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setCurrentStep('');
    }
  };

  // Show JSON modal
  const [showJsonModal, setShowJsonModal] = useState(false);

  // Helper function to wait
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Auto-run: Execute all steps automatically
  const handleAutoRun = async () => {
    if (!query.trim()) {
      setError('Please enter a query first');
      return;
    }

    setIsAutoRunning(true);
    setIsLoading(true);
    setError(null);
    clearState();
    addLog('🚀 Starting automatic run...');
    addLog('This will open the browser, wait for ChatGPT to respond, and capture queries automatically.');

    try {
      // Step 1: Open Browser
      setCurrentStep('Step 1: Opening browser...');
      addLog('📋 Step 1: Opening browser...');
      
      const openResponse = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', query: query.trim() }),
      });

      const openData: StepResponse = await openResponse.json();

      if (!openData.success) {
        throw new Error(openData.error || 'Failed to open browser');
      }

      setBrowserOpen(true);
      addLog(`✅ Browser opened successfully`);
      addLog(`Navigating to: ${openData.data?.url}`);
      
      // Wait a bit for page to load
      await wait(3000);
      addLog('⏳ Waiting for ChatGPT to start responding...');

      // Step 2: Poll for response and streaming queries
      setCurrentStep('Step 2: Waiting for response and checking for queries...');
      addLog('📋 Step 2: Polling for response and streaming queries...');
      
      const maxAttempts = 60; // Maximum 3 minutes (60 * 3 seconds)
      let attempts = 0;
      let foundQueries = false;

      while (attempts < maxAttempts && !foundQueries) {
        attempts++;
        addLog(`⏳ Checking response (attempt ${attempts}/${maxAttempts})...`);

        const checkResponse = await fetch('/api/browser-fanout/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'wait-for-response' }),
        });

        const checkData: StepResponse = await checkResponse.json();

        if (!checkData.success) {
          // Check if it's a session expiry
          if (checkData.error?.includes('session expired') || checkData.error?.includes('Browser session expired')) {
            addLog(`⚠️ Browser session expired (Browserless timeout)`);
            addLog(`💡 Browserless free tier has a 30-second session limit.`);
            addLog(`🔄 Please click "Auto Run" to start a new session.`);
            setBrowserOpen(false);
            setIsAutoRunning(false);
            setIsLoading(false);
            setCurrentStep('');
            return;
          }
          throw new Error(checkData.error || 'Failed to check response');
        }

        // Handle login requirement
        if (checkData.data?.needsLogin) {
          addLog(`⚠️ Login required - please log in to ChatGPT manually`);
          addLog(`⏸️ Auto-run paused. Please log in and click "Auto Run" again to continue.`);
          setIsAutoRunning(false);
          setIsLoading(false);
          setCurrentStep('');
          return;
        }

        // Update conversation ID
        if (checkData.data?.conversationId && !conversationId) {
          setConversationId(checkData.data.conversationId);
          addLog(`✅ Conversation ID: ${checkData.data.conversationId}`);
        }

        // Check for streaming queries
        if (checkData.data?.streamingQueries && checkData.data.streamingQueries.length > 0) {
          const queries = checkData.data.streamingQueries;
          setFanoutQueries(queries.map((q: any) => ({
            query: q.query,
            searchEngine: 'ChatGPT Web Search',
            type: q.type || 'search',
            results: [],
            searchTime: 0,
          })));
          setModel(checkData.data.model || 'unknown');
          setDataSource('streaming');
          
          addLog(`🎉 Captured ${queries.length} fan-out queries from streaming!`);
          queries.forEach((q: any, i: number) => {
            addLog(`  ${i + 1}. "${q.query}"`);
          });
          addLog(`Model: ${checkData.data.model || 'unknown'}`);
          addLog(`✅ Success! Queries captured during streaming - no refresh needed!`);
          foundQueries = true;
          break;
        } else if (checkData.data?.isGenerating) {
          addLog(`⏳ Response still generating... waiting 3 seconds...`);
          await wait(3000); // Wait 3 seconds before next check
        } else if (checkData.data?.conversationId) {
          // Response is complete but no streaming queries found
          addLog(`✅ Response complete, but no streaming queries found`);
          addLog(`📋 Step 3: Trying extraction without refresh first...`);
          break;
        } else {
          // No conversation ID yet - check page status
          if (checkData.data?.pageStatus) {
            addLog(`📄 Page status: ${checkData.data.pageStatus}`);
            if (checkData.data?.actionMessage) {
              addLog(`ℹ️ ${checkData.data.actionMessage}`);
            }
            if (checkData.data?.needsAction) {
              addLog(`⚠️ Action needed: ${checkData.data.actionMessage}`);
              // If login is required, pause auto-run
              if (checkData.data.pageStatus === 'login_required') {
                addLog(`⏸️ Auto-run paused. Please log in to ChatGPT manually, then click "Auto Run" again.`);
                setIsAutoRunning(false);
                setIsLoading(false);
                setCurrentStep('');
                return;
              }
            }
          }
          
          // Update screenshots if provided (capture every 5 attempts to show progress, or if page status changed)
          if (checkData.data?.screenshot) {
            // Capture screenshot every 5 attempts, or if it's the first one, or if page status indicates something important
            const shouldCapture = attempts === 1 || 
                                 attempts % 5 === 0 || 
                                 (checkData.data?.pageStatus && ['login_required', 'query_not_submitted'].includes(checkData.data.pageStatus));
            
            if (shouldCapture) {
              setScreenshots(prev => {
                // Check if we already have a recent screenshot with the same image to avoid duplicates
                const recentScreenshot = prev.length > 0 ? prev[prev.length - 1] : null;
                const isDuplicate = recentScreenshot && recentScreenshot.image === checkData.data.screenshot;
                
                if (!isDuplicate) {
                  const stepName = checkData.data?.pageStatus 
                    ? `Attempt ${attempts} - ${checkData.data.pageStatus}`
                    : `Checking... (attempt ${attempts})`;
                  return [...prev, {
                    timestamp: new Date().toISOString(),
                    step: stepName,
                    image: checkData.data.screenshot
                  }];
                }
                return prev;
              });
            }
          }
          if (checkData.data?.screenshots && Array.isArray(checkData.data.screenshots)) {
            setScreenshots(prev => {
              const existing = new Set(prev.map(s => s.timestamp));
              const newScreenshots = checkData.data.screenshots.filter((s: any) => !existing.has(s.timestamp));
              return [...prev, ...newScreenshots];
            });
          }
          
          // Still waiting for response
          await wait(3000);
        }
      }

      // Step 3: If no streaming queries, try extraction without refresh first
      if (!foundQueries) {
        setCurrentStep('Step 3: Extracting without refresh...');
        addLog('📋 Step 3: No streaming queries found, trying extraction without refresh...');

        // Try to extract without refresh first
        const findResponse = await fetch('/api/browser-fanout/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'find-json' }),
        });

        const findData: StepResponse = await findResponse.json();

        if (findData.success && findData.data?.fanoutQueries && findData.data.fanoutQueries.length > 0) {
          // Success! Found queries without refresh
          setJsonData(findData.data?.json || null);
          setModel(findData.data?.model || null);
          setDataSource(findData.data?.source || 'extract-only');
          
          setFanoutQueries(findData.data.fanoutQueries.map((q: any) => ({
            query: q.query,
            searchEngine: 'ChatGPT Web Search',
            type: q.type || 'search',
            results: [],
            searchTime: 0,
          })));
          addLog(`🎉 Found ${findData.data.fanoutQueries.length} fan-out queries without refresh!`);
          findData.data.fanoutQueries.forEach((q: any, i: number) => {
            addLog(`  ${i + 1}. "${q.query}"`);
          });
          addLog(`Model: ${findData.data?.model || 'unknown'}`);
          addLog(`Source: ${findData.data?.source || 'extract-only'}`);
        } else {
          // Extraction without refresh didn't work, try refresh + extract as fallback
          addLog('⚠️ Extraction without refresh didn\'t find queries, trying refresh + extract...');
          setCurrentStep('Step 3 (fallback): Refreshing and extracting...');
          
          const refreshResponse = await fetch('/api/browser-fanout/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'refresh' }),
          });

          const refreshData: StepResponse = await refreshResponse.json();

          if (!refreshData.success) {
            throw new Error(refreshData.error || 'Failed to refresh page');
          }

          addLog(`✅ Page refreshed`);
          if (refreshData.data?.conversationId) {
            setConversationId(refreshData.data.conversationId);
          }

          // Wait a bit for page to reload
          await wait(2000);

          // Then find JSON after refresh
          addLog('Extracting fan-out queries after refresh...');
          const findAfterRefreshResponse = await fetch('/api/browser-fanout/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'find-json' }),
          });

          const findAfterRefreshData: StepResponse = await findAfterRefreshResponse.json();

          if (!findAfterRefreshData.success) {
            throw new Error(findAfterRefreshData.error || 'Failed to find JSON');
          }

          setJsonData(findAfterRefreshData.data?.json || null);
          setModel(findAfterRefreshData.data?.model || null);
          setDataSource(findAfterRefreshData.data?.source || 'refresh');
          
          // Extract fanout queries
          if (findAfterRefreshData.data?.fanoutQueries && findAfterRefreshData.data.fanoutQueries.length > 0) {
            setFanoutQueries(findAfterRefreshData.data.fanoutQueries.map((q: any) => ({
              query: q.query,
              searchEngine: 'ChatGPT Web Search',
              type: q.type || 'search',
              results: [],
              searchTime: 0,
            })));
            addLog(`🎉 Found ${findAfterRefreshData.data.fanoutQueries.length} fan-out queries via refresh!`);
            findAfterRefreshData.data.fanoutQueries.forEach((q: any, i: number) => {
              addLog(`  ${i + 1}. "${q.query}"`);
            });
            addLog(`Model: ${findAfterRefreshData.data?.model || 'unknown'}`);
            addLog(`Source: ${findAfterRefreshData.data?.source || 'refresh'}`);
          } else {
            addLog('⚠️ No fan-out queries found after refresh');
          }
        }
      }

      addLog('✅ Auto-run completed!');
      setCurrentStep('');

    } catch (err: any) {
      setError(err.message);
      addLog(`❌ Error during auto-run: ${err.message}`);
      setCurrentStep('');
    } finally {
      setIsLoading(false);
      setIsAutoRunning(false);
    }
  };

  // Close browser
  const handleCloseBrowser = async () => {
    setIsLoading(true);
    setCurrentStep('Closing browser...');
    addLog('Closing browser...');

    try {
      await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      });
      
      setBrowserOpen(false);
      setConversationId(null);
      addLog('Browser closed');
    } catch (err: any) {
      addLog(`Error closing browser: ${err.message}`);
    } finally {
      setIsLoading(false);
      setCurrentStep('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-lg shadow-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">🌐 Browser Fanout Exploration (Streaming Capture)</h2>
        <p className="opacity-90">
          Captures fan-out queries in real-time as ChatGPT streams the response - no refresh needed!
        </p>
      </div>

      {/* How it works */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <h4 className="font-semibold text-orange-800 mb-2">How it works (Streaming Capture):</h4>
        <ol className="text-sm text-orange-700 space-y-1 list-decimal list-inside">
          <li><strong>Open Browser</strong> - Opens ChatGPT with streaming capture enabled</li>
          <li><strong>Check Response</strong> - Check if queries were captured during streaming</li>
          <li><strong>Refresh + Extract</strong> - Fallback: refresh page to get full JSON (only if streaming missed queries)</li>
        </ol>
        <p className="text-xs text-green-700 mt-3 font-medium">
          ✨ <strong>New:</strong> Queries are now captured as ChatGPT responds - often no refresh needed!
        </p>
        
        {/* Browserless.io Info */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mt-3">
          <p className="text-xs text-purple-800 font-semibold mb-1">🌐 Cloud Browser (Browserless.io):</p>
          <p className="text-xs text-purple-700">
            Set <code className="bg-purple-100 px-1 rounded">BROWSERLESS_TOKEN</code> in environment variables to use Browserless.io cloud browser.
            This provides <strong>stealth mode</strong> to avoid Cloudflare detection!
          </p>
          <p className="text-xs text-purple-600 mt-1">
            Get your token at <a href="https://browserless.io" target="_blank" rel="noopener noreferrer" className="underline font-medium">browserless.io</a> (free tier: 1,000 sessions/month)
          </p>
        </div>
        
        {/* Session Token Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2">
          <p className="text-xs text-blue-800 font-semibold mb-1">🔐 ChatGPT Authentication:</p>
          <p className="text-xs text-blue-700">
            Set <code className="bg-blue-100 px-1 rounded">CHATGPT_SESSION_TOKEN</code> for auto-login.
            Get it from ChatGPT cookies: DevTools → Application → Cookies → <code className="bg-blue-100 px-1 rounded">__Secure-next-auth.session-token</code>
          </p>
        </div>
      </div>

      {/* Query Input */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Enter Your Query</h3>
          <button
            onClick={handleAutoRun}
            disabled={isLoading || isAutoRunning || !query.trim()}
            className={`px-6 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              isAutoRunning
                ? 'bg-orange-500 text-white border-2 border-orange-600 animate-pulse'
                : isLoading || !query.trim()
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500 to-red-600 text-white border-2 border-orange-600 hover:from-orange-600 hover:to-red-700 shadow-lg'
            }`}
          >
            {isAutoRunning ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Running...</span>
              </>
            ) : (
              <>
                <span>🚀</span>
                <span>Auto Run</span>
              </>
            )}
          </button>
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a query, e.g., 'What are the best project management tools for remote teams in 2024?'"
          className="w-full h-24 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none text-gray-900"
          disabled={isAutoRunning}
        />
        {isAutoRunning && (
          <p className="mt-2 text-sm text-orange-600">
            ⏳ Auto-run in progress... This may take a few minutes. Check the logs below for progress.
          </p>
        )}
      </div>

      {/* Step-by-Step Buttons */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">📋 Controls</h3>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Step 1: Open Browser */}
          <button
            onClick={handleOpenBrowser}
            disabled={isLoading || browserOpen || isAutoRunning}
            className={`p-4 rounded-lg font-medium transition-all flex flex-col items-center gap-2 ${
              browserOpen 
                ? 'bg-green-100 text-green-700 border-2 border-green-500'
                : isLoading 
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-50 text-blue-700 border-2 border-blue-300 hover:bg-blue-100'
            }`}
          >
            <span className="text-2xl">🌐</span>
            <span className="text-sm">1. Open Browser</span>
            {browserOpen && <span className="text-xs text-green-600">✓ Open</span>}
          </button>

          {/* Step 2: Check Response */}
          <button
            onClick={handleCheckResponse}
            disabled={isLoading || !browserOpen || isAutoRunning}
            className={`p-4 rounded-lg font-medium transition-all flex flex-col items-center gap-2 ${
              fanoutQueries.length > 0 && dataSource === 'streaming'
                ? 'bg-green-100 text-green-700 border-2 border-green-500'
                : !browserOpen
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : isLoading
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-purple-50 text-purple-700 border-2 border-purple-300 hover:bg-purple-100'
            }`}
          >
            <span className="text-2xl">⏳</span>
            <span className="text-sm">2. Check Response</span>
            {fanoutQueries.length > 0 && dataSource === 'streaming' && (
              <span className="text-xs text-green-600">✓ {fanoutQueries.length} queries</span>
            )}
          </button>

          {/* Extract Only (without refresh) */}
          <button
            onClick={handleExtractOnly}
            disabled={isLoading || !browserOpen || isAutoRunning}
            className={`p-4 rounded-lg font-medium transition-all flex flex-col items-center gap-2 ${
              fanoutQueries.length > 0 && dataSource === 'extract-only'
                ? 'bg-green-100 text-green-700 border-2 border-green-500'
                : !browserOpen
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : isLoading
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-cyan-50 text-cyan-700 border-2 border-cyan-300 hover:bg-cyan-100'
            }`}
          >
            <span className="text-2xl">🔍</span>
            <span className="text-sm">Extract Only</span>
            {fanoutQueries.length > 0 && dataSource === 'extract-only' && (
              <span className="text-xs text-green-600">✓ Found</span>
            )}
          </button>

          {/* Step 3: Refresh + Extract (fallback) */}
          <button
            onClick={handleRefreshAndExtract}
            disabled={isLoading || !browserOpen || isAutoRunning}
            className={`p-4 rounded-lg font-medium transition-all flex flex-col items-center gap-2 ${
              fanoutQueries.length > 0 && dataSource === 'refresh'
                ? 'bg-green-100 text-green-700 border-2 border-green-500'
                : !browserOpen
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : isLoading
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-yellow-50 text-yellow-700 border-2 border-yellow-300 hover:bg-yellow-100'
            }`}
          >
            <span className="text-2xl">🔄</span>
            <span className="text-sm">Refresh + Extract</span>
            {fanoutQueries.length > 0 && dataSource === 'refresh' && (
              <span className="text-xs text-green-600">✓ Found</span>
            )}
          </button>

          {/* Show JSON */}
          <button
            onClick={() => setShowJsonModal(true)}
            disabled={!jsonData && fanoutQueries.length === 0}
            className={`p-4 rounded-lg font-medium transition-all flex flex-col items-center gap-2 ${
              !jsonData && fanoutQueries.length === 0
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-green-50 text-green-700 border-2 border-green-300 hover:bg-green-100'
            }`}
          >
            <span className="text-2xl">📄</span>
            <span className="text-sm">Show Data</span>
          </button>
        </div>

        {/* Close Browser Button */}
        {browserOpen && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={handleCloseBrowser}
              disabled={isLoading}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-all"
            >
              ❌ Close Browser
            </button>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-blue-700">{currentStep}</span>
          </div>
        )}
      </div>

      {/* Status Display */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">📊 Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Browser</div>
            <div className={browserOpen ? 'text-green-600' : 'text-gray-400'}>
              {browserOpen ? '✓ Open' : '○ Closed'}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Conversation</div>
            <div className={conversationId ? 'text-green-600 font-mono text-xs truncate' : 'text-gray-400'}>
              {conversationId ? conversationId.substring(0, 12) + '...' : '—'}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Model</div>
            <div className={model ? 'text-purple-600' : 'text-gray-400'}>
              {model || '—'}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Fan-out Queries</div>
            <div className={fanoutQueries.length > 0 ? 'text-orange-600 font-bold' : 'text-gray-400'}>
              {fanoutQueries.length}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Source</div>
            <div className={dataSource ? (dataSource === 'streaming' ? 'text-green-600' : 'text-blue-600') : 'text-gray-400'}>
              {dataSource === 'streaming' ? '⚡ Streaming' : dataSource || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">📝 Logs</h3>
        <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-sm">
          {stepLogs.length === 0 ? (
            <div className="text-gray-500">No logs yet. Click &quot;Open Browser&quot; to start.</div>
          ) : (
            stepLogs.map((log, index) => (
              <div key={index} className={`${
                log.includes('✅') || log.includes('🎉') ? 'text-green-400' : 
                log.includes('⚠️') ? 'text-yellow-400' : 
                log.includes('Error') ? 'text-red-400' : 
                log.includes('⚡') ? 'text-cyan-400' :
                'text-green-400'
              }`}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Screenshots Display - Show prominently */}
      {screenshots.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6 border-2 border-orange-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">
              📸 Browser View ({screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''})
            </h3>
            <span className="text-xs text-gray-500">
              Latest: {new Date(screenshots[screenshots.length - 1].timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {screenshots.map((screenshot, index) => (
              <div key={index} className="border-2 border-gray-300 rounded-lg overflow-hidden hover:border-orange-400 transition-colors">
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-2 border-b border-gray-200">
                  <div className="text-sm font-medium text-gray-800">{screenshot.step}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(screenshot.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div className="bg-gray-900 p-2">
                  <img
                    src={`data:image/png;base64,${screenshot.image}`}
                    alt={screenshot.step}
                    className="w-full h-auto rounded border border-gray-600 shadow-lg"
                    loading="lazy"
                  />
                </div>
              </div>
            ))}
          </div>
          {screenshots.length > 0 && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700">
                💡 <strong>Tip:</strong> Screenshots show what the browser sees. The latest screenshot is at the end.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Fan-out Queries Results */}
      {fanoutQueries.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            🔍 Fan-out Queries Captured ({fanoutQueries.length})
            {dataSource === 'streaming' && (
              <span className="ml-2 text-sm font-normal text-green-600">⚡ via Streaming</span>
            )}
          </h3>
          <div className="space-y-3">
            {fanoutQueries.map((fanout, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg"
              >
                <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-orange-200 text-orange-700 font-semibold text-sm">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-gray-800">
                    &quot;{fanout.query}&quot;
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Type: {fanout.type}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* JSON Modal */}
      {showJsonModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">📄 Captured Data</h3>
              <button
                onClick={() => setShowJsonModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              <div className="mb-4">
                <h4 className="font-medium text-gray-700 mb-2">Fan-out Queries ({fanoutQueries.length})</h4>
                <pre className="text-xs font-mono bg-gray-100 p-4 rounded-lg overflow-auto">
                  {JSON.stringify(fanoutQueries.map(q => q.query), null, 2)}
                </pre>
              </div>
              {jsonData && (
                <div>
                  <h4 className="font-medium text-gray-700 mb-2">Full JSON</h4>
                  <pre className="text-xs font-mono bg-gray-100 p-4 rounded-lg overflow-auto max-h-96">
                    {JSON.stringify(jsonData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

