'use client';

import { useState } from 'react';

interface FanoutQuery {
  query: string;
  type: string;
}

export default function BrowserFanoutTab() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [fanoutQueries, setFanoutQueries] = useState<FanoutQuery[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

  const handleAutoRun = async () => {
    if (!query.trim()) {
      setError('Please enter a query first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setConversationId(null);
    setFanoutQueries([]);
    setModel(null);
    setLogs([]);

    addLog('🚀 Starting...');

    try {
      // Step 1: Open browser and submit query
      setCurrentStep('Opening browser...');
      addLog('Opening browser and submitting query...');

      const openRes = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', query: query.trim() }),
      });
      const openData = await openRes.json();

      if (!openData.success) throw new Error(openData.error);
      addLog('✅ Browser opened');

      // Step 2: Wait for response
      setCurrentStep('Waiting for response...');
      addLog('Waiting for ChatGPT to respond...');

      const maxAttempts = 30;
      let convId: string | null = null;

      for (let i = 0; i < maxAttempts; i++) {
        addLog(`⏳ Checking (${i + 1}/${maxAttempts})...`);

        const checkRes = await fetch('/api/browser-fanout/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'wait-for-response' }),
        });
        const checkData = await checkRes.json();

        if (!checkData.success) throw new Error(checkData.error);

        if (checkData.data?.needsLogin) {
          addLog('⚠️ Login required. Please log in to ChatGPT and try again.');
          setIsLoading(false);
          setCurrentStep('');
          return;
        }

        if (checkData.data?.conversationId) {
          convId = checkData.data.conversationId;
          setConversationId(convId);

          if (!checkData.data.isGenerating) {
            addLog('✅ Response complete');
            break;
          }
          addLog('⏳ Still generating...');
        }

        await wait(2000);
      }

      if (!convId) {
        throw new Error('Timed out waiting for response');
      }

      // Step 3: Extract queries
      setCurrentStep('Extracting queries...');
      addLog('Extracting fan-out queries...');

      const extractRes = await fetch('/api/browser-fanout/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract' }),
      });
      const extractData = await extractRes.json();

      if (!extractData.success) throw new Error(extractData.error);

      if (extractData.data?.fanoutQueries?.length > 0) {
        setFanoutQueries(extractData.data.fanoutQueries);
        setModel(extractData.data.model);
        addLog(`🎉 Found ${extractData.data.fanoutQueries.length} fan-out queries!`);
        extractData.data.fanoutQueries.forEach((q: FanoutQuery, i: number) => {
          addLog(`  ${i + 1}. "${q.query}"`);
        });
      } else {
        addLog('⚠️ No fan-out queries found');
      }

      addLog('✅ Done!');
    } catch (err: any) {
      setError(err.message);
      addLog(`❌ Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setCurrentStep('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-lg shadow-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">🌐 Browser Fanout Exploration</h2>
        <p className="opacity-90">Captures fan-out queries from ChatGPT web searches.</p>
      </div>

      {/* Info */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <h4 className="font-semibold text-orange-800 mb-2">How it works:</h4>
        <ol className="text-sm text-orange-700 space-y-1 list-decimal list-inside">
          <li>Opens ChatGPT and submits your query</li>
          <li>Waits for response to complete</li>
          <li>Extracts fan-out queries from the conversation</li>
        </ol>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
          <p className="text-xs text-blue-700">
            <strong>Tip:</strong> Set <code className="bg-blue-100 px-1 rounded">CHATGPT_SESSION_TOKEN</code> for auto-login.
          </p>
        </div>
      </div>

      {/* Query Input */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Enter Your Query</h3>
          <button
            onClick={handleAutoRun}
            disabled={isLoading || !query.trim()}
            className={`px-6 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              isLoading
                ? 'bg-orange-500 text-white animate-pulse'
                : !query.trim()
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500 to-red-600 text-white hover:from-orange-600 hover:to-red-700 shadow-lg'
            }`}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running...
              </>
            ) : (
              <>🚀 Auto Run</>
            )}
          </button>
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a query, e.g., 'What are the best project management tools for remote teams in 2024?'"
          className="w-full h-24 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none text-gray-900"
          disabled={isLoading}
        />
        {currentStep && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-blue-700">{currentStep}</span>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">📊 Status</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Conversation</div>
            <div className={conversationId ? 'text-green-600 font-mono text-xs truncate' : 'text-gray-400'}>
              {conversationId ? conversationId.substring(0, 12) + '...' : '—'}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Model</div>
            <div className={model ? 'text-purple-600' : 'text-gray-400'}>{model || '—'}</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium text-gray-600">Queries Found</div>
            <div className={fanoutQueries.length > 0 ? 'text-orange-600 font-bold' : 'text-gray-400'}>
              {fanoutQueries.length}
            </div>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">📝 Logs</h3>
        <div className="bg-gray-900 rounded-lg p-4 max-h-48 overflow-y-auto font-mono text-sm">
          {logs.length === 0 ? (
            <div className="text-gray-500">No logs yet.</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={
                log.includes('✅') || log.includes('🎉') ? 'text-green-400' :
                log.includes('⚠️') || log.includes('❌') ? 'text-yellow-400' :
                'text-gray-300'
              }>{log}</div>
            ))
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {fanoutQueries.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            🔍 Fan-out Queries ({fanoutQueries.length})
          </h3>
          <div className="space-y-3">
            {fanoutQueries.map((q, i) => (
              <div key={i} className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-200 text-orange-700 font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium text-gray-800">&quot;{q.query}&quot;</div>
                  <div className="text-xs text-gray-500">Type: {q.type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
