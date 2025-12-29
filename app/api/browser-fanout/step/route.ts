import { NextRequest, NextResponse } from 'next/server';
import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Global state
let browserContext: BrowserContext | null = null;
let currentPage: Page | null = null;

function log(message: string) {
  console.log(`[${new Date().toISOString()}] [BrowserStep] ${message}`);
}

function getBrowserProfilePath(): string {
  const baseDir = process.env.USERPROFILE || process.env.HOME || os.tmpdir();
  const profileDir = path.join(baseDir, '.chatgpt-fanout-profile');

  try {
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
  } catch {
    const tempProfileDir = path.join(os.tmpdir(), `chatgpt-fanout-profile-${Date.now()}`);
    if (!fs.existsSync(tempProfileDir)) {
      fs.mkdirSync(tempProfileDir, { recursive: true });
    }
    return tempProfileDir;
  }

  return profileDir;
}

function extractFanoutQueries(data: any): { queries: any[]; model: string } {
  const queries: any[] = [];
  const seenQueries = new Set<string>();
  const modelSlug = data.default_model_slug || 'unknown';

  const extract = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) return;

    if (obj.metadata?.search_queries) {
      obj.metadata.search_queries.forEach((sq: any) => {
        const q = sq.q || sq.query;
        if (q && !seenQueries.has(q)) {
          seenQueries.add(q);
          queries.push({ query: q, type: sq.type || 'search' });
        }
      });
    }

    if (Array.isArray(obj.search_queries)) {
      obj.search_queries.forEach((sq: any) => {
        const q = sq.q || sq.query;
        if (q && !seenQueries.has(q)) {
          seenQueries.add(q);
          queries.push({ query: q, type: sq.type || 'search' });
        }
      });
    }

    if (obj.metadata?.search_model_queries?.queries) {
      obj.metadata.search_model_queries.queries.forEach((q: string) => {
        if (q && !seenQueries.has(q)) {
          seenQueries.add(q);
          queries.push({ query: q, type: 'search_model_query' });
        }
      });
    }

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
    const { action, query } = await request.json();
    log(`Action: ${action}`);

    switch (action) {
      case 'open': {
        // Close existing browser
        if (browserContext) {
          try { await browserContext.close(); } catch {}
        }

        const isServerless = !!process.env.VERCEL || !!process.env.RENDER;
        log(`Environment: ${isServerless ? 'Serverless' : 'Local'}, Headless: ${isServerless}`);

        // Find system Chrome
        let chromePath: string | undefined;
        if (!isServerless) {
          const paths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
          ].filter(p => p && fs.existsSync(p));
          if (paths.length > 0) {
            chromePath = paths[0];
            log(`Using Chrome: ${chromePath}`);
          }
        }

        const profilePath = getBrowserProfilePath();
        log(`Profile: ${profilePath}`);

        try {
          browserContext = await chromium.launchPersistentContext(profilePath, {
            headless: isServerless,
            executablePath: chromePath,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--window-size=1920,1080'],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
          });
          log(`✅ Browser created`);
        } catch (error: any) {
          return NextResponse.json({ success: false, error: `Browser launch failed: ${error.message}` });
        }

        currentPage = await browserContext.newPage();

        // Navigate to ChatGPT
        log('Navigating to ChatGPT...');
        await currentPage.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Set session token if provided
        const sessionToken = process.env.CHATGPT_SESSION_TOKEN;
        if (sessionToken) {
          log('Setting session token...');
          await currentPage.context().addCookies([{
            name: '__Secure-next-auth.session-token',
            value: sessionToken,
            domain: '.chatgpt.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
          }]);
          await currentPage.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
          log('✅ Authenticated');
        }

        // Wait for page and enter query
        const queryText = query || '';
        try {
          await currentPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await currentPage.waitForTimeout(2000);
          
          // ChatGPT uses a contenteditable div as the main input
          log('Waiting for input...');
          
          // Click on the input area first (the container with placeholder)
          const inputArea = await currentPage.$('div[id="composer-background"]') 
                         || await currentPage.$('div.ProseMirror')
                         || await currentPage.$('div[contenteditable="true"]')
                         || await currentPage.$('#prompt-textarea');
          
          if (inputArea) {
            await inputArea.click();
            await currentPage.waitForTimeout(500);
            
            // Type the query using keyboard
            await currentPage.keyboard.type(queryText, { delay: 20 });
            await currentPage.waitForTimeout(1000);
            log('✅ Query entered');

            // Submit
            const sendButton = await currentPage.$('button[data-testid="send-button"]');
            if (sendButton && await sendButton.isEnabled()) {
              await sendButton.click();
              log('✅ Clicked send button');
            } else {
              await currentPage.keyboard.press('Enter');
              log('Pressed Enter to submit');
            }

            await currentPage.waitForTimeout(3000);

            if (currentPage.url().includes('/c/')) {
              log('✅ Conversation created!');
            }
          } else {
            log('❌ Textarea not found');
          }
        } catch (e: any) {
          log(`Error: ${e.message}`);
        }

        return NextResponse.json({
          success: true,
          message: 'Browser opened',
          data: { url: currentPage.url() }
        });
      }

      case 'wait-for-response': {
        if (!currentPage || !browserContext) {
          return NextResponse.json({ success: false, error: 'Browser not open' });
        }

        let currentUrl: string;
        try {
          currentUrl = currentPage.url();
        } catch {
          browserContext = null;
          currentPage = null;
          return NextResponse.json({ success: false, error: 'Browser session expired' });
        }

        // Check for login page
        if (currentUrl.includes('/auth/login')) {
          return NextResponse.json({
            success: true,
            data: { needsLogin: true, currentUrl }
          });
        }

        // Try to submit if not yet submitted
        if (!currentUrl.includes('/c/')) {
          try {
            const textarea = await currentPage.$('textarea, #prompt-textarea');
            if (textarea) {
              await textarea.focus();
              await currentPage.keyboard.press('Enter');
              await currentPage.waitForTimeout(1000);
              currentUrl = currentPage.url();
            }
          } catch {}
        }

        const match = currentUrl.match(/\/c\/([a-zA-Z0-9-]+)/);
        if (match) {
          const convId = match[1];
          await currentPage.waitForTimeout(2000);

          const isGenerating = await currentPage.evaluate(() => {
            return !!(document.querySelector('button[aria-label*="Stop"]') || 
                     document.querySelector('[class*="result-streaming"]'));
          });

          return NextResponse.json({
            success: true,
            data: { conversationId: convId, isGenerating, currentUrl }
          });
        }

        return NextResponse.json({
          success: true,
          data: { conversationId: null, currentUrl }
        });
      }

      case 'extract': {
        if (!currentPage || !browserContext) {
          return NextResponse.json({ success: false, error: 'Browser not open' });
        }

        log('Extracting fan-out queries...');

        // Refresh to get full conversation JSON
        await currentPage.reload({ waitUntil: 'networkidle', timeout: 30000 });
        await currentPage.waitForTimeout(2000);

        const url = currentPage.url();
        const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
        const convId = match ? match[1] : null;

        if (!convId) {
          return NextResponse.json({ success: false, error: 'No conversation ID found' });
        }

        // Fetch conversation JSON via internal API
        const result = await currentPage.evaluate(async (cid) => {
          try {
            const sessRes = await fetch('/api/auth/session');
            const sess = await sessRes.json();
            if (!sess.accessToken) return { error: 'No access token' };

            const convRes = await fetch(`/backend-api/conversation/${cid}`, {
              headers: { 'Authorization': 'Bearer ' + sess.accessToken }
            });
            if (!convRes.ok) return { error: `API error: ${convRes.status}` };
            return { data: await convRes.json() };
          } catch (e: any) {
            return { error: e.message };
          }
        }, convId);

        if (result.error) {
          return NextResponse.json({ success: false, error: result.error });
        }

        const { queries, model } = extractFanoutQueries(result.data);
        log(`Found ${queries.length} queries`);

        return NextResponse.json({
          success: true,
          data: { fanoutQueries: queries, model, conversationId: convId }
        });
      }

      case 'close': {
        if (browserContext) {
          try { await browserContext.close(); } catch {}
        }
        browserContext = null;
        currentPage = null;
        return NextResponse.json({ success: true, message: 'Browser closed' });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    log(`Error: ${error.message}`);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
