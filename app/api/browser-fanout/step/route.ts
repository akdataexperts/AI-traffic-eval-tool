import { NextRequest, NextResponse } from 'next/server';
import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Global state to maintain browser session across requests
let browserContext: BrowserContext | null = null;
let currentPage: Page | null = null;
let capturedJsonData: any = null;
let capturedStreamingQueries: any[] = [];
let capturedModel: string = 'unknown';
let streamingComplete: boolean = false;
let screenshots: Array<{ timestamp: string; step: string; image: string }> = [];

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [BrowserStep] ${message}`);
}

function getBrowserProfilePath(): string {
  // Try to use home directory first (for local development)
  let baseDir: string;
  if (process.env.USERPROFILE) {
    baseDir = process.env.USERPROFILE;
  } else if (process.env.HOME) {
    baseDir = process.env.HOME;
  } else {
    // Fallback to temp directory for deployed environments
    baseDir = os.tmpdir();
  }

  const profileDir = path.join(baseDir, '.chatgpt-fanout-profile');

  // Ensure parent directory exists and create profile directory
  try {
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
  } catch (error: any) {
    // If that fails, try using temp directory with a unique name
    log(`Failed to create profile in ${baseDir}, using temp directory: ${error.message}`);
    const tempProfileDir = path.join(os.tmpdir(), `chatgpt-fanout-profile-${Date.now()}`);
    if (!fs.existsSync(tempProfileDir)) {
      fs.mkdirSync(tempProfileDir, { recursive: true });
    }
    return tempProfileDir;
  }

  return profileDir;
}

// Parse SSE data line and extract search queries
function parseSSELine(line: string): { queries: any[], model?: string } {
  const queries: any[] = [];
  let model: string | undefined;

  if (!line.startsWith('data: ') || line === 'data: [DONE]') {
    return { queries };
  }

  try {
    const jsonStr = line.slice(6); // Remove 'data: ' prefix
    const data = JSON.parse(jsonStr);

    // Extract model from message metadata
    if (data.message?.metadata?.model_slug) {
      model = data.message.metadata.model_slug;
    }

    // Check for search_queries in message metadata
    if (data.message?.metadata?.search_queries) {
      data.message.metadata.search_queries.forEach((sq: any) => {
        const q = sq.q || sq.query;
        if (q) {
          queries.push({ query: q, type: sq.type || 'search' });
        }
      });
    }

    // Check for search_model_queries
    if (data.message?.metadata?.search_model_queries?.queries) {
      data.message.metadata.search_model_queries.queries.forEach((q: string) => {
        if (q) {
          queries.push({ query: q, type: 'search_model_query' });
        }
      });
    }

    // Check for code content with search_query JSON
    if (data.message?.content?.content_type === 'code' &&
      typeof data.message?.content?.text === 'string') {
      try {
        const codeJson = JSON.parse(data.message.content.text);
        if (codeJson.search_query && Array.isArray(codeJson.search_query)) {
          codeJson.search_query.forEach((sq: any) => {
            const q = sq.q || sq.query;
            if (q) {
              queries.push({ query: q, type: 'code_search_query' });
            }
          });
        }
      } catch (e) { }
    }

  } catch (e) {
    // Not valid JSON, skip
  }

  return { queries, model };
}

// Extract fan-out queries from conversation data (for refresh method)
function extractFanoutQueries(data: any): { queries: any[]; model: string } {
  const queries: any[] = [];
  const seenQueries = new Set<string>();
  const modelSlug = data.default_model_slug || 'unknown';

  const extract = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) return;

    // Check metadata.search_queries
    if (obj.metadata && Array.isArray(obj.metadata.search_queries)) {
      obj.metadata.search_queries.forEach((sq: any) => {
        const q = sq.q || sq.query;
        if (q && !seenQueries.has(q)) {
          seenQueries.add(q);
          queries.push({ query: q, type: sq.type || 'search' });
        }
      });
    }

    // Check root search_queries
    if (Array.isArray(obj.search_queries)) {
      obj.search_queries.forEach((sq: any) => {
        const q = sq.q || sq.query;
        if (q && !seenQueries.has(q)) {
          seenQueries.add(q);
          queries.push({ query: q, type: sq.type || 'search' });
        }
      });
    }

    // Check search_model_queries
    if (obj.metadata?.search_model_queries?.queries) {
      obj.metadata.search_model_queries.queries.forEach((q: string) => {
        if (q && !seenQueries.has(q)) {
          seenQueries.add(q);
          queries.push({ query: q, type: 'search_model_query' });
        }
      });
    }

    // Check code content for JSON with search_query
    if (obj.content?.content_type === 'code' && typeof obj.content?.text === 'string') {
      try {
        const parsed = JSON.parse(obj.content.text);
        if (parsed.search_query && Array.isArray(parsed.search_query)) {
          parsed.search_query.forEach((sq: any) => {
            const q = sq.q || sq.query;
            if (q && !seenQueries.has(q)) {
              seenQueries.add(q);
              queries.push({ query: q, type: 'code_search_query' });
            }
          });
        }
      } catch (e) { }
    }

    // Recurse
    for (const key in obj) {
      if (key !== 'search_queries' && key !== 'metadata') {
        extract(obj[key]);
      }
    }
  };

  extract(data);
  return { queries, model: modelSlug };
}

export async function POST(request: NextRequest) {
  try {
    const { action, query, conversationId } = await request.json();

    log(`Action: ${action}`);

    switch (action) {
      case 'open': {
        // Close any existing browser
        if (browserContext) {
          try {
            await browserContext.close();
          } catch (e) { }
        }

        // Reset all captured data
        capturedJsonData = null;
        capturedStreamingQueries = [];
        capturedModel = 'unknown';
        streamingComplete = false;

        // Determine if we're in a serverless/deployed environment
        const isServerless = !!process.env.VERCEL || 
                            !!process.env.AWS_LAMBDA_FUNCTION_NAME || 
                            !!process.env.RAILWAY_ENVIRONMENT ||
                            !!process.env.RENDER; // Render environment
        
        // Allow showing browser if requested and not in strict serverless (Render can show browser with Xvfb)
        // For Render, we'll use headless but capture screenshots
        const userWantsVisible = showBrowser === true;
        const useHeadless = isServerless && !userWantsVisible; // Use headless unless user wants visible AND it's possible
        log(`Environment detected: ${process.env.VERCEL ? 'Vercel' : process.env.RENDER ? 'Render' : process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local'}`);
        log(`User requested visible browser: ${userWantsVisible}`);
        log(`Using headless mode: ${useHeadless}`);
        
        // Reset screenshots for new session
        screenshots = [];

        // Try to find system Chrome (only on Windows/Linux with Chrome installed)
        let chromePath: string | undefined;
        if (!isServerless) {
          const chromePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ].filter(p => p && fs.existsSync(p));

          if (chromePaths.length > 0) {
            chromePath = chromePaths[0];
            log(`Using system Chrome: ${chromePath}`);
          }
        }

        // If no system Chrome found, Playwright will use its bundled Chromium
        if (!chromePath) {
          log('No system Chrome found, using Playwright bundled Chromium');
        }

        const profilePath = getBrowserProfilePath();
        log(`Opening browser with profile: ${profilePath} (headless: ${useHeadless})`);

        // Try to verify Playwright browsers are available
        let playwrightExecutable: string | null = null;
        try {
          playwrightExecutable = await chromium.executablePath();
          log(`Playwright Chromium executable path: ${playwrightExecutable}`);
          if (!fs.existsSync(playwrightExecutable)) {
            log(`WARNING: Playwright executable not found at: ${playwrightExecutable}`);
            log(`Attempting to install browsers at runtime...`);
            // Try to install browsers at runtime (this might work on Render)
            const { execSync } = require('child_process');
            try {
              execSync('npx playwright install chromium', { 
                stdio: 'inherit',
                timeout: 300000 // 5 minutes
              });
              log(`✅ Browsers installed successfully at runtime`);
              // Get the path again after installation
              playwrightExecutable = await chromium.executablePath();
            } catch (installError: any) {
              log(`Failed to install browsers at runtime: ${installError.message}`);
            }
          } else {
            log(`✅ Playwright executable found and verified`);
          }
        } catch (e: any) {
          log(`WARNING: Could not get Playwright executable path: ${e.message}`);
        }

        try {
          browserContext = await chromium.launchPersistentContext(profilePath, {
            headless: useHeadless,
            executablePath: chromePath, // undefined = use Playwright's bundled Chromium
            args: [
              '--disable-blink-features=AutomationControlled',
              '--no-sandbox',
              '--window-size=1920,1080',
              '--disable-dev-shm-usage', // Helps with memory issues in containers
              '--disable-gpu', // Helps in headless/server environments
              '--disable-setuid-sandbox', // Additional sandbox flag for Linux
            ],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
          });
          log(`✅ Browser context created successfully`);
          
          currentPage = await browserContext.newPage();
          
          // Capture initial screenshot after page is created
          try {
            await currentPage.goto('about:blank');
            const screenshot = await currentPage.screenshot({ type: 'png', fullPage: false });
            screenshots.push({
              timestamp: new Date().toISOString(),
              step: 'Browser opened',
              image: screenshot.toString('base64')
            });
            log('Initial screenshot captured');
          } catch (e: any) {
            log(`Could not capture initial screenshot: ${e.message}`);
          }
        } catch (error: any) {
          // Log the full error for debugging
          log(`Browser launch error: ${error.message}`);
          log(`Error stack: ${error.stack || 'No stack trace'}`);
          
          // Check if it's a browser installation error
          if (error.message && (
            error.message.includes('Executable doesn\'t exist') ||
            error.message.includes('playwright install') ||
            error.message.includes('browserType.launch') ||
            error.message.includes('chromium') ||
            error.message.includes('BrowserType')
          )) {
            // Try to provide more helpful error message
            const isInstallError = error.message.includes('Executable doesn\'t exist') || 
                                   error.message.includes('playwright install');
            
            return NextResponse.json({
              success: false,
              error: isInstallError 
                ? 'Playwright browsers are not installed. The browsers should be installed during build, but may not be available at runtime. Check Render logs to verify browser installation completed successfully.'
                : `Browser launch failed: ${error.message}`,
              details: error.message,
              errorType: isInstallError ? 'installation' : 'launch',
              suggestion: isInstallError 
                ? 'Verify that "npx playwright install chromium" completed successfully during build. Check Render build logs.'
                : 'This may be a runtime issue. Check Render service logs for more details.'
            });
          }
          
          // For other errors, return more details
          return NextResponse.json({
            success: false,
            error: `Browser launch failed: ${error.message}`,
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }

        currentPage = await browserContext.newPage();

        // Set up streaming response capture BEFORE navigation using route
        log('Setting up streaming capture with route interception...');
        const seenQueries = new Set<string>();

        // Use route to intercept ALL requests and log them
        await currentPage.route('**/*', async (route) => {
          const request = route.request();
          const url = request.url();

          // Log all backend-api requests for debugging
          if (url.includes('backend-api')) {
            log(`[Route] ${request.method()} ${url.substring(0, 100)}...`);
          }

          // Continue the request normally
          await route.continue();
        });

        // Also listen for responses
        currentPage.on('response', async (response) => {
          const url = response.url();
          const method = response.request().method();

          // Log all backend-api responses
          if (url.includes('backend-api')) {
            log(`[Response] ${method} ${response.status()} ${url.substring(0, 80)}...`);
          }

          // Capture streaming conversation response (POST request)
          if (url.includes('/backend-api/conversation') &&
            !url.includes('/init') &&
            !url.includes('/message_feedback') &&
            method === 'POST') {
            log(`Intercepted POST conversation response: ${url}`);

            try {
              // Try to get body - may fail for streaming
              const body = await response.body().catch(() => null);
              if (body) {
                const text = body.toString('utf-8');
                const lines = text.split('\n');

                log(`Processing ${lines.length} SSE lines from POST...`);

                for (const line of lines) {
                  const { queries, model } = parseSSELine(line.trim());

                  if (model) {
                    capturedModel = model;
                    log(`Found model: ${model}`);
                  }

                  for (const q of queries) {
                    if (!seenQueries.has(q.query)) {
                      seenQueries.add(q.query);
                      capturedStreamingQueries.push(q);
                      log(`Captured query: "${q.query}"`);
                    }
                  }
                }

                if (text.includes('[DONE]')) {
                  streamingComplete = true;
                  log(`Streaming complete! Found ${capturedStreamingQueries.length} queries`);
                }
              } else {
                log(`Could not get body from streaming response`);
              }

            } catch (e) {
              log(`Error parsing streaming response: ${e}`);
            }
          }

          // Capture conversation JSON from GET requests (for refresh)
          if (url.includes('/backend-api/conversation/') &&
            !url.includes('/init') &&
            method === 'GET') {
            try {
              const contentType = response.headers()['content-type'] || '';
              if (contentType.includes('application/json')) {
                const json = await response.json();
                if (json && (json.mapping || json.title)) {
                  log(`Captured conversation JSON from GET: ${url}`);
                  capturedJsonData = json;

                  // Also extract queries from this JSON
                  const { queries, model } = extractFanoutQueries(json);
                  for (const q of queries) {
                    if (!seenQueries.has(q.query)) {
                      seenQueries.add(q.query);
                      capturedStreamingQueries.push(q);
                      log(`Extracted query from GET: "${q.query}"`);
                    }
                  }
                  if (model) capturedModel = model;
                }
              }
            } catch (e) {
              log(`Error parsing GET response: ${e}`);
            }
          }
        });

        // Navigate to ChatGPT with query
        const encodedQuery = encodeURIComponent(query || '');
        const url = `https://chatgpt.com/?hints=search&q=${encodedQuery}`;

        log(`Navigating to: ${url}`);
        await currentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Capture screenshot after navigation
        try {
          await currentPage.waitForTimeout(2000); // Wait for page to settle
          const screenshot = await currentPage.screenshot({ type: 'png', fullPage: false });
          screenshots.push({
            timestamp: new Date().toISOString(),
            step: 'Navigated to ChatGPT',
            image: screenshot.toString('base64')
          });
          log('Screenshot captured after navigation');
        } catch (e: any) {
          log(`Could not capture navigation screenshot: ${e.message}`);
        }

        // Logs to return to client
        const submissionLogs: string[] = [];
        const trackLog = (msg: string) => {
          log(msg);
          submissionLogs.push(msg);
        };

        // Wait for the page to fully load and the textarea to be ready
        trackLog('Waiting for ChatGPT interface to load...');

        try {
          // Wait for the textarea to be visible
          await currentPage.waitForSelector('textarea, #prompt-textarea', {
            timeout: 15000,
            state: 'visible'
          });

          trackLog('Textarea found, focusing...');

          // Focus the textarea
          await currentPage.focus('textarea, #prompt-textarea');
          await currentPage.waitForTimeout(500);

          // Ensure the query is registered by typing a space and deleting it
          // This triggers React state updates to enable the submit button
          await currentPage.keyboard.type(' ');
          await currentPage.keyboard.press('Backspace');
          trackLog('Triggered input events to enable submit button');

          await currentPage.waitForTimeout(500);

          // Method 1: Try pressing Enter (most reliable)
          trackLog('Attempting to submit via Enter key...');
          await currentPage.keyboard.press('Enter');

          // Check if submission happened (textarea cleared or URL changed)
          await currentPage.waitForTimeout(1000);

          const currentUrl = currentPage.url();
          const isSubmitted = currentUrl.includes('/c/'); // Conversation created

          if (isSubmitted) {
            trackLog('✅ Enter key worked! Conversation created.');
          } else {
            // Method 2: Click the button if Enter didn't work
            trackLog('Enter key might not have worked, trying to find Send button...');

            const sendButtonSelectors = [
              'button[data-testid="send-button"]',
              'button[aria-label="Send prompt"]',
              '[data-testid="fruitjuice-send-button"]',
              'button:has(svg[class*="lucide-arrow-up"])', // Common arrow icon class
              'button.mb-1.me-1', // Sometimes specific classes
              'button[class*="rounded-full"][class*="bg-black"]', // Black circle button
            ];

            let buttonClicked = false;
            for (const selector of sendButtonSelectors) {
              try {
                const button = await currentPage.$(selector);
                if (button && await button.isVisible() && await button.isEnabled()) {
                  await button.click();
                  trackLog(`✅ Clicked send button: ${selector}`);
                  buttonClicked = true;
                  break;
                }
              } catch (e) { }
            }

            if (!buttonClicked) {
              // Last resort: force click any button with an SVG inside the form
              trackLog('Trying generic button search...');
              await currentPage.evaluate(() => {
                const textarea = document.querySelector('textarea');
                if (textarea) {
                  const form = textarea.closest('form');
                  const button = form?.querySelector('button:not([disabled])');
                  if (button instanceof HTMLElement) button.click();
                }
              });
            }
          }

        } catch (e: any) {
          trackLog(`Warning: Auto-submit issues: ${e.message}`);
        }

        return NextResponse.json({
          success: true,
          message: 'Browser opened',
          data: { 
            url, 
            logs: submissionLogs,
            screenshots: screenshots,
            headless: useHeadless
          }
        });
      }

      case 'wait-for-response': {
        if (!currentPage || !browserContext) {
          return NextResponse.json({ success: false, error: 'Browser not open' });
        }

        log('Checking for conversation ID in URL...');

        // Check current URL for conversation ID
        const currentUrl = currentPage.url();
        log(`Current URL: ${currentUrl}`);

        // Check if we're on login page
        if (currentUrl.includes('/auth/login') || currentUrl.includes('login.openai.com')) {
          log('Login page detected - user needs to log in');
          return NextResponse.json({
            success: true,
            message: 'Login required',
            data: {
              conversationId: null,
              needsLogin: true,
              currentUrl,
              streamingQueries: [],
              streamingComplete: false
            }
          });
        }

        // Look for conversation ID in URL
        const match = currentUrl.match(/\/c\/([a-zA-Z0-9-]+)/);

        if (match) {
          const convId = match[1];
          log(`Found conversation ID: ${convId}`);

          // Wait a bit to ensure response is complete
          await currentPage.waitForTimeout(2000);

          // Check if still generating
          const isGenerating = await currentPage.evaluate(() => {
            const stopButton = document.querySelector('button[aria-label*="Stop"]');
            const streaming = document.querySelector('[class*="result-streaming"]');
            return !!(stopButton || streaming);
          });

          if (isGenerating) {
            log('Response still generating...');
          } else {
            log('Response appears complete');
          }

          log(`Streaming queries captured so far: ${capturedStreamingQueries.length}`);
          
          // Capture screenshot of current state
          let currentScreenshot: string | null = null;
          if (currentPage) {
            try {
              const screenshot = await currentPage.screenshot({ type: 'png', fullPage: false });
              currentScreenshot = screenshot.toString('base64');
              screenshots.push({
                timestamp: new Date().toISOString(),
                step: isGenerating ? 'Response generating' : 'Response complete',
                image: currentScreenshot
              });
              log('Screenshot captured of current state');
            } catch (e: any) {
              log(`Could not capture screenshot: ${e.message}`);
            }
          }

          return NextResponse.json({
            success: true,
            message: 'Conversation found',
            data: {
              conversationId: convId,
              isGenerating,
              currentUrl,
              streamingQueries: capturedStreamingQueries,
              streamingComplete,
              model: capturedModel,
              screenshot: currentScreenshot,
              screenshots: screenshots
            }
          });
        } else {
          log('No conversation ID found in URL yet');
          return NextResponse.json({
            success: true,
            message: 'No conversation yet',
            data: {
              conversationId: null,
              currentUrl,
              streamingQueries: capturedStreamingQueries,
              streamingComplete: false
            }
          });
        }
      }

      case 'get-streaming-data': {
        // New action to get captured streaming data without other checks
        log(`Getting streaming data: ${capturedStreamingQueries.length} queries, complete: ${streamingComplete}`);

        return NextResponse.json({
          success: true,
          message: 'Streaming data retrieved',
          data: {
            fanoutQueries: capturedStreamingQueries,
            model: capturedModel,
            streamingComplete,
            queryCount: capturedStreamingQueries.length
          }
        });
      }

      case 'refresh': {
        if (!currentPage || !browserContext) {
          return NextResponse.json({ success: false, error: 'Browser not open' });
        }

        log('Refreshing page to capture full JSON...');

        // Refresh the page
        await currentPage.reload({ waitUntil: 'networkidle', timeout: 30000 });

        // Wait for network to settle
        await currentPage.waitForTimeout(3000);

        // Get conversation ID from URL
        const url = currentPage.url();
        const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
        const convId = match ? match[1] : null;

        log(`Page refreshed. JSON captured: ${capturedJsonData ? 'Yes' : 'No'}`);

        return NextResponse.json({
          success: true,
          message: 'Page refreshed',
          data: {
            conversationId: convId,
            jsonCaptured: !!capturedJsonData,
            streamingQueries: capturedStreamingQueries,
            streamingComplete
          }
        });
      }

      case 'extract-queries': {
        if (!currentPage || !browserContext) {
          return NextResponse.json({ success: false, error: 'Browser not open' });
        }

        log('Extracting queries via direct API (Chrome extension method)...');

        // Get conversation ID from URL
        const url = currentPage.url();
        const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
        const convId = match ? match[1] : conversationId;

        if (!convId) {
          return NextResponse.json({ success: false, error: 'No conversation ID found in URL' });
        }

        log(`Using conversation ID: ${convId}`);

        // Execute script in browser to fetch data
        const result = await currentPage.evaluate(async (cid) => {
          try {
            // 1. Get session token
            const sessRes = await fetch('/api/auth/session');
            if (!sessRes.ok) return { error: 'Failed to fetch session' };
            const sess = await sessRes.json();

            if (!sess.accessToken) {
              return { error: 'No access token found (not logged in?)' };
            }

            // 2. Fetch conversation details directly
            const convRes = await fetch(`/backend-api/conversation/${cid}`, {
              headers: {
                'Authorization': `Bearer ${sess.accessToken}`,
                'Content-Type': 'application/json'
              }
            });

            if (!convRes.ok) return { error: `API error: ${convRes.status}` };

            const data = await convRes.json();
            return { json: data };
          } catch (e: any) {
            return { error: e.message };
          }
        }, convId);

        if (result.error) {
          log(`Direct API fetch failed: ${result.error}`);
          return NextResponse.json({ success: false, error: result.error });
        }

        if (result.json) {
          log('✅ Successfully fetched conversation JSON via direct API');
          capturedJsonData = result.json; // Update cache

          const { queries, model } = extractFanoutQueries(result.json);
          log(`Extracted ${queries.length} queries via direct API`);

          return NextResponse.json({
            success: true,
            message: 'Queries extracted via direct API',
            data: {
              json: result.json,
              fanoutQueries: queries,
              model,
              conversationId: convId,
              source: 'direct_api'
            }
          });
        }

        return NextResponse.json({ success: false, error: 'Unknown error fetching data' });
      }

      case 'find-json': {
        if (!currentPage || !browserContext) {
          return NextResponse.json({ success: false, error: 'Browser not open' });
        }

        log('Finding conversation JSON...');

        // First, check if we have streaming queries - use those!
        if (capturedStreamingQueries.length > 0) {
          log(`Using ${capturedStreamingQueries.length} queries from streaming capture`);
          return NextResponse.json({
            success: true,
            message: 'Queries found from streaming capture',
            data: {
              json: capturedJsonData || { streaming: true },
              fanoutQueries: capturedStreamingQueries,
              model: capturedModel,
              source: 'streaming'
            }
          });
        }

        // If we have captured JSON from refresh, use that
        if (capturedJsonData) {
          log('Using captured JSON data from refresh');
          const { queries, model } = extractFanoutQueries(capturedJsonData);
          return NextResponse.json({
            success: true,
            message: 'JSON found from network capture',
            data: {
              json: capturedJsonData,
              fanoutQueries: queries,
              model,
              source: 'refresh'
            }
          });
        }

        // Try to fetch via API as fallback
        log('Trying to fetch via internal API...');

        // Get conversation ID from URL
        const url = currentPage.url();
        const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
        const convId = match ? match[1] : conversationId;

        if (!convId) {
          return NextResponse.json({ success: false, error: 'No conversation ID found' });
        }

        const result = await currentPage.evaluate(async (cid) => {
          try {
            // Get session token
            const sessRes = await fetch('/api/auth/session');
            const sess = await sessRes.json();

            if (!sess.accessToken) {
              return { error: 'No access token' };
            }

            // Fetch conversation
            const convRes = await fetch(`/backend-api/conversation/${cid}`, {
              headers: {
                'Authorization': 'Bearer ' + sess.accessToken,
                'Content-Type': 'application/json'
              }
            });

            if (!convRes.ok) {
              return { error: `API error: ${convRes.status}` };
            }

            return { data: await convRes.json() };
          } catch (e: any) {
            return { error: e.message };
          }
        }, convId);

        if (result.error) {
          return NextResponse.json({ success: false, error: result.error });
        }

        capturedJsonData = result.data;
        const { queries, model } = extractFanoutQueries(result.data);

        return NextResponse.json({
          success: true,
          message: 'JSON found via API',
          data: {
            json: result.data,
            fanoutQueries: queries,
            model,
            source: 'api'
          }
        });
      }

      case 'close': {
        log('Closing browser...');

        if (browserContext) {
          try {
            await browserContext.close();
          } catch (e) { }
        }

        browserContext = null;
        currentPage = null;
        capturedJsonData = null;
        capturedStreamingQueries = [];
        capturedModel = 'unknown';
        streamingComplete = false;

        return NextResponse.json({
          success: true,
          message: 'Browser closed'
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` });
    }

  } catch (error: any) {
    log(`Error: ${error.message}`);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
