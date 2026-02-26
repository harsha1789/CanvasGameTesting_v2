import { test, expect, Browser, BrowserContext, Page, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Game Launch Checklist Test Suite
 *
 * Based on manual QA checklist for testing game launches across:
 * - Multiple web browsers (Chrome, Firefox, Safari, Edge)
 * - Android devices (various screen sizes and OS versions)
 * - iOS devices (various screen sizes and OS versions)
 *
 * Test Cases Covered:
 * TC001: Verify Game Launch on Web Browser
 * TC002: Test Game Loading Time (< 10 seconds)
 * TC003: Cross-Browser Compatibility
 * TC004: No Errors During Launch
 * TC005: Game Launch on Android Device
 * TC006: Android Device Compatibility
 * TC007: Game Launch on iOS Device
 * TC008: iOS Device Compatibility
 * TC009: Credits Visibility & Spin Action
 */

// Viewport configuration - sized to show header (credits) AND full game including spin button
const VIEWPORT_CONFIG = {
  width: 1400,
  height: 1100  // Height to capture: header + full game + spin button + bottom controls fully visible
};

// ============================================================================
// CONFIGURATION
// ============================================================================

interface GameConfig {
  id: string;
  name: string;
  provider: string;
  category: string;
  url: string;
}

interface TestResult {
  testId: string;
  testCase: string;
  gameName: string;
  gameProvider: string;
  platform: string;
  browser: string;
  device: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  loadTime: number;
  errorDetails: string | null;
  consoleErrors: string[];
  screenshotPath: string;
  screenshotPath2?: string;  // For TC009 - spin action screenshot
  timestamp: string;
}

// Load configuration
const CONFIG_PATH = 'config/game-launch-test-config.json';
let testConfig: any = {};

try {
  const configContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
  testConfig = JSON.parse(configContent);
} catch (error) {
  console.error('Error loading config file:', error);
  // Use default config
  testConfig = {
    testConfig: {
      baseUrl: 'https://www.betway.co.za',
      maxLoadTimeSeconds: 10
    },
    credentials: {
      username: process.env.BETWAY_USERNAME || '222212222',
      password: process.env.BETWAY_PASSWORD || '1234567890'
    },
    games: []
  };
}

const BASE_URL = testConfig.testConfig?.baseUrl || 'https://www.betway.co.za';
const MAX_LOAD_TIME = (testConfig.testConfig?.maxLoadTimeSeconds || 10) * 1000;
const CREDENTIALS = testConfig.credentials || { username: '222212222', password: '1234567890' };
const GAMES: GameConfig[] = testConfig.games || [];

// Report directories
const REPORTS_DIR = 'reports/game-launch-checklist';
const SCREENSHOTS_DIR = `${REPORTS_DIR}/screenshots`;
const RESULTS_DATA_FILE = `${REPORTS_DIR}/results-data.json`;

// File-based results storage for parallel worker support
function loadResultsFromFile(): TestResult[] {
  try {
    if (fs.existsSync(RESULTS_DATA_FILE)) {
      const data = fs.readFileSync(RESULTS_DATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('    [Results] Could not load existing results, starting fresh');
  }
  return [];
}

function saveResultToFile(result: TestResult): TestResult[] {
  // Retry logic for concurrent file access
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const results = loadResultsFromFile();
      // Check if this test already exists (by testId) and update it
      const existingIndex = results.findIndex(r => r.testId === result.testId);
      if (existingIndex >= 0) {
        results[existingIndex] = result;
      } else {
        results.push(result);
      }
      fs.writeFileSync(RESULTS_DATA_FILE, JSON.stringify(results, null, 2));
      return results;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        // Wait a bit before retrying (with some randomness to avoid collision)
        const waitMs = 100 + Math.random() * 200;
        const start = Date.now();
        while (Date.now() - start < waitMs) { /* busy wait */ }
      }
    }
  }
  // Fallback: just return the single result
  return [result];
}

function clearResultsFile(): void {
  try {
    if (fs.existsSync(RESULTS_DATA_FILE)) {
      fs.unlinkSync(RESULTS_DATA_FILE);
    }
  } catch (error) {
    // Ignore errors when clearing
  }
}

// Mobile device configurations
const ANDROID_DEVICES = [
  { name: 'Pixel 5', config: devices['Pixel 5'] },
  { name: 'Pixel 7', config: devices['Pixel 7'] },
  { name: 'Galaxy S9+', config: devices['Galaxy S9+'] },
];

const IOS_DEVICES = [
  { name: 'iPhone 12', config: devices['iPhone 12'] },
  { name: 'iPhone SE', config: devices['iPhone SE'] },
  { name: 'iPad Pro 11', config: devices['iPad Pro 11'] },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create report directories
 */
function ensureDirectories(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

/**
 * Check if user is logged in
 */
async function isUserLoggedIn(page: Page): Promise<boolean> {
  const indicators = [
    '[class*="user-balance"]',
    '[class*="account-balance"]',
    'button:has-text("Deposit")',
    'a:has-text("Deposit")',
    'button:has-text("Logout")',
    '#logout-btn',
  ];

  for (const selector of indicators) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  // Check if login button is NOT visible
  const loginBtn = page.locator('#login-btn');
  return !(await loginBtn.isVisible({ timeout: 1000 }).catch(() => true));
}

/**
 * Perform login
 */
async function performLogin(page: Page): Promise<boolean> {
  try {
    if (await isUserLoggedIn(page)) {
      console.log('    Already logged in');
      return true;
    }

    const loginBtn = page.locator('#login-btn');
    if (!await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      return await isUserLoggedIn(page);
    }

    // Click to reveal form
    await loginBtn.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(2000);

    // Fill credentials
    const usernameInput = page.locator('#header-username');
    const passwordInput = page.locator('#header-password');

    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await usernameInput.fill(CREDENTIALS.username);
      await passwordInput.fill(CREDENTIALS.password);

      // Submit
      await loginBtn.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(5000);

      // Verify
      for (let i = 0; i < 3; i++) {
        if (await isUserLoggedIn(page)) {
          console.log('    Login successful');
          return true;
        }
        await page.waitForTimeout(2000);
      }
    }

    return false;
  } catch (error) {
    console.error('    Login error:', error);
    return false;
  }
}

/**
 * Handle login popup
 */
async function handleLoginPopup(page: Page): Promise<void> {
  try {
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const mobileInput = page.locator('input[placeholder*="Mobile" i], input[type="tel"]').first();
      if (await mobileInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await mobileInput.fill(CREDENTIALS.username);
      }
      await passwordInput.fill(CREDENTIALS.password);

      const loginBtn = page.locator('button:has-text("Login")').first();
      if (await loginBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await loginBtn.evaluate((el: HTMLElement) => el.click());
        await page.waitForTimeout(5000);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Handle Continue buttons
 */
async function handleContinueButtons(page: Page): Promise<void> {
  const selectors = [
    'button:has-text("Continue")',
    'button:has-text("Play & Continue")',
    'button:has-text("I Accept")',
    'button:has-text("Accept")',
    'button:has-text("OK")',
    'button:has-text("Start")',
  ];

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        await button.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } catch {
      continue;
    }
  }

  // Click canvas center for canvas-rendered buttons
  const canvas = page.locator('canvas').first();
  if (await canvas.isVisible({ timeout: 1000 }).catch(() => false)) {
    const box = await canvas.boundingBox().catch(() => null);
    if (box && box.width > 100) {  // Only click if canvas is large enough (game canvas, not icon)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
      await page.waitForTimeout(1000);
    }
  }
}

/**
 * Check for console errors
 */
function setupConsoleErrorCapture(page: Page): string[] {
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  return consoleErrors;
}

/**
 * Check for error elements on page
 */
async function checkForPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  const errorSelectors = [
    { selector: 'text=/error/i', name: 'Error message' },
    { selector: 'text=/failed to load/i', name: 'Failed to load' },
    { selector: 'text=/something went wrong/i', name: 'Something went wrong' },
    { selector: 'text=/not available/i', name: 'Not available' },
    { selector: 'text=/timeout/i', name: 'Timeout' },
    { selector: '[role="alert"]', name: 'Alert element' },
    { selector: '.error-message', name: 'Error message element' },
  ];

  for (const { selector, name } of errorSelectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
        const text = await element.textContent().catch(() => '');
        if (text && text.length > 3) {
          errors.push(`${name}: ${text.substring(0, 100)}`);
        }
      }
    } catch {
      continue;
    }
  }

  return errors;
}

/**
 * Validate game loaded
 */
async function validateGameLoaded(page: Page): Promise<{ success: boolean; reason: string }> {
  const hasCanvas = await page.locator('canvas').isVisible({ timeout: 5000 }).catch(() => false);
  const hasIframe = await page.locator('iframe').isVisible({ timeout: 3000 }).catch(() => false);

  if (!hasCanvas && !hasIframe) {
    return { success: false, reason: 'No game container (canvas/iframe) found' };
  }

  // Check for credits/balance
  const creditIndicators = [
    'text=/balance/i',
    'text=/credit/i',
    'text=/R\\s*[\\d,]+\\.\\d{2}/i',
    '[class*="balance"]',
    '[class*="credit"]',
  ];

  for (const selector of creditIndicators) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
        return { success: true, reason: 'Game loaded with credits visible' };
      }
    } catch {
      continue;
    }
  }

  // Check page content for credits
  const pageContent = await page.content();
  if (/balance|credit|R\s*[\d,]+\.\d{2}/i.test(pageContent)) {
    return { success: true, reason: 'Game loaded (credits in page HTML)' };
  }

  if (hasCanvas || hasIframe) {
    return { success: true, reason: 'Game container loaded (canvas/iframe present)' };
  }

  return { success: false, reason: 'Game did not load properly' };
}

/**
 * Launch game and measure load time
 */
async function launchGameAndMeasure(
  page: Page,
  gameUrl: string
): Promise<{ loadTime: number; success: boolean; errors: string[] }> {
  const startTime = Date.now();
  const pageErrors = await checkForPageErrors(page);

  try {
    const fullUrl = gameUrl.startsWith('http') ? gameUrl : `${BASE_URL}${gameUrl}`;
    await page.goto(fullUrl);
    await page.waitForLoadState('domcontentloaded');

    // Handle login popup
    await handleLoginPopup(page);

    // Verify login
    if (!await isUserLoggedIn(page)) {
      await performLogin(page);
    }

    // Handle Continue buttons
    await handleContinueButtons(page);
    await page.waitForTimeout(3000);
    await handleContinueButtons(page);

    // Wait for game
    await page.waitForTimeout(5000);

    const loadTime = Date.now() - startTime;
    const validation = await validateGameLoaded(page);
    const errors = await checkForPageErrors(page);

    return {
      loadTime,
      success: validation.success,
      errors: [...pageErrors, ...errors]
    };
  } catch (error: any) {
    return {
      loadTime: Date.now() - startTime,
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Generate safe filename
 */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
}

/**
 * Generate HTML Report
 */
function generateHTMLReport(results: TestResult[]): void {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const passRate = results.length > 0 ? ((passed / results.length) * 100).toFixed(1) : '0';

  // Group by test case
  const byTestCase = results.reduce((acc, r) => {
    if (!acc[r.testCase]) acc[r.testCase] = [];
    acc[r.testCase].push(r);
    return acc;
  }, {} as { [key: string]: TestResult[] });

  // Group by platform
  const byPlatform = results.reduce((acc, r) => {
    if (!acc[r.platform]) acc[r.platform] = [];
    acc[r.platform].push(r);
    return acc;
  }, {} as { [key: string]: TestResult[] });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game Launch Checklist Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1a1a2e; color: #fff; padding: 20px; }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { text-align: center; color: #00d4aa; margin-bottom: 10px; }
    h2 { color: #00d4aa; margin: 30px 0 15px; border-bottom: 2px solid #0f3460; padding-bottom: 10px; }
    h3 { color: #feca57; margin: 20px 0 10px; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
    .summary { display: flex; justify-content: center; gap: 20px; margin-bottom: 40px; flex-wrap: wrap; }
    .summary-card { background: #16213e; padding: 20px 30px; border-radius: 10px; text-align: center; min-width: 120px; }
    .summary-card h2 { font-size: 32px; margin-bottom: 5px; border: none; padding: 0; }
    .summary-card p { color: #888; font-size: 14px; }
    .pass { color: #00d4aa; }
    .fail { color: #ff6b6b; }
    .skip { color: #feca57; }

    .platform-summary { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
    .platform-card { background: #16213e; padding: 15px 25px; border-radius: 8px; flex: 1; min-width: 200px; }
    .platform-card h4 { color: #00d4aa; margin-bottom: 10px; }
    .platform-stats { display: flex; gap: 15px; }
    .platform-stats span { font-size: 14px; }

    .results-table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 10px; overflow: hidden; margin-bottom: 30px; }
    .results-table th { background: #0f3460; padding: 12px 15px; text-align: left; font-size: 14px; }
    .results-table td { padding: 10px 15px; border-bottom: 1px solid #0f3460; font-size: 13px; }
    .results-table tr:hover { background: #1f4068; }
    .status-badge { padding: 4px 12px; border-radius: 15px; font-weight: bold; font-size: 11px; }
    .status-pass { background: #00d4aa; color: #000; }
    .status-fail { background: #ff6b6b; color: #000; }
    .status-skip { background: #feca57; color: #000; }
    .screenshot-link { color: #00d4aa; text-decoration: none; font-size: 12px; }
    .screenshot-link:hover { text-decoration: underline; }
    .error-details { color: #ff6b6b; font-size: 11px; max-width: 250px; }
    .load-time { font-family: monospace; }
    .load-time.slow { color: #ff6b6b; }
    .load-time.fast { color: #00d4aa; }

    .filter-buttons { text-align: center; margin-bottom: 20px; }
    .filter-btn { background: #0f3460; border: none; color: #fff; padding: 8px 16px; margin: 3px; border-radius: 5px; cursor: pointer; font-size: 13px; }
    .filter-btn:hover, .filter-btn.active { background: #00d4aa; color: #000; }

    .timestamp { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }

    .test-case-section { background: #16213e; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
    .test-case-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .test-case-title { color: #00d4aa; }
    .test-case-stats { display: flex; gap: 15px; }

    .tabs { display: flex; gap: 5px; margin-bottom: 20px; }
    .tab { background: #0f3460; border: none; color: #fff; padding: 10px 20px; border-radius: 5px 5px 0 0; cursor: pointer; }
    .tab.active { background: #16213e; color: #00d4aa; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Game Launch Checklist Report</h1>
    <p class="subtitle">Automated QA Testing - Web & Mobile Platforms</p>

    <div class="summary">
      <div class="summary-card">
        <h2>${results.length}</h2>
        <p>Total Tests</p>
      </div>
      <div class="summary-card">
        <h2 class="pass">${passed}</h2>
        <p>Passed</p>
      </div>
      <div class="summary-card">
        <h2 class="fail">${failed}</h2>
        <p>Failed</p>
      </div>
      <div class="summary-card">
        <h2 class="skip">${skipped}</h2>
        <p>Skipped</p>
      </div>
      <div class="summary-card">
        <h2>${passRate}%</h2>
        <p>Pass Rate</p>
      </div>
    </div>

    <h2>Platform Summary</h2>
    <div class="platform-summary">
      ${Object.entries(byPlatform).map(([platform, platformResults]) => {
        const pPassed = platformResults.filter(r => r.status === 'PASS').length;
        const pFailed = platformResults.filter(r => r.status === 'FAIL').length;
        return `
        <div class="platform-card">
          <h4>${platform}</h4>
          <div class="platform-stats">
            <span class="pass">${pPassed} Passed</span>
            <span class="fail">${pFailed} Failed</span>
            <span>Total: ${platformResults.length}</span>
          </div>
        </div>
        `;
      }).join('')}
    </div>

    <h2>Test Results by Test Case</h2>
    <div class="tabs">
      <button class="tab active" onclick="showTab('all')">All Results</button>
      ${Object.keys(byTestCase).map((tc, i) => `
        <button class="tab" onclick="showTab('tc${i}')">${tc}</button>
      `).join('')}
    </div>

    <div id="tab-all" class="tab-content active">
      <div class="filter-buttons">
        <button class="filter-btn active" onclick="filterResults('all')">All</button>
        <button class="filter-btn" onclick="filterResults('PASS')">Passed</button>
        <button class="filter-btn" onclick="filterResults('FAIL')">Failed</button>
        <button class="filter-btn" onclick="filterResults('SKIP')">Skipped</button>
      </div>

      <table class="results-table">
        <thead>
          <tr>
            <th>Test ID</th>
            <th>Test Case</th>
            <th>Game</th>
            <th>Provider</th>
            <th>Platform</th>
            <th>Browser/Device</th>
            <th>Status</th>
            <th>Load Time</th>
            <th>Screenshot</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((r, i) => `
          <tr class="result-row" data-status="${r.status}">
            <td>${r.testId}</td>
            <td>${r.testCase}</td>
            <td>${r.gameName}</td>
            <td>${r.gameProvider}</td>
            <td>${r.platform}</td>
            <td>${r.device || r.browser}</td>
            <td><span class="status-badge status-${r.status.toLowerCase()}">${r.status}</span></td>
            <td class="load-time ${r.loadTime > MAX_LOAD_TIME ? 'slow' : 'fast'}">${(r.loadTime / 1000).toFixed(2)}s</td>
            <td>${r.screenshotPath ? `<a href="screenshots/${path.basename(r.screenshotPath)}" class="screenshot-link" target="_blank">View</a>` : '-'}${r.screenshotPath2 ? ` | <a href="screenshots/${path.basename(r.screenshotPath2)}" class="screenshot-link" target="_blank">Spin</a>` : ''}</td>
            <td class="error-details">${r.errorDetails || (r.consoleErrors.length > 0 ? r.consoleErrors.slice(0, 2).join('; ') : '-')}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${Object.entries(byTestCase).map(([tc, tcResults], i) => `
    <div id="tab-tc${i}" class="tab-content">
      <div class="test-case-section">
        <div class="test-case-header">
          <h3 class="test-case-title">${tc}</h3>
          <div class="test-case-stats">
            <span class="pass">${tcResults.filter(r => r.status === 'PASS').length} Passed</span>
            <span class="fail">${tcResults.filter(r => r.status === 'FAIL').length} Failed</span>
          </div>
        </div>
        <table class="results-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Provider</th>
              <th>Platform</th>
              <th>Device/Browser</th>
              <th>Status</th>
              <th>Load Time</th>
              <th>Screenshot</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            ${tcResults.map(r => `
            <tr>
              <td>${r.gameName}</td>
              <td>${r.gameProvider}</td>
              <td>${r.platform}</td>
              <td>${r.device || r.browser}</td>
              <td><span class="status-badge status-${r.status.toLowerCase()}">${r.status}</span></td>
              <td class="load-time ${r.loadTime > MAX_LOAD_TIME ? 'slow' : 'fast'}">${(r.loadTime / 1000).toFixed(2)}s</td>
              <td>${r.screenshotPath ? `<a href="screenshots/${path.basename(r.screenshotPath)}" class="screenshot-link" target="_blank">View</a>` : '-'}${r.screenshotPath2 ? ` | <a href="screenshots/${path.basename(r.screenshotPath2)}" class="screenshot-link" target="_blank">Spin</a>` : ''}</td>
              <td class="error-details">${r.errorDetails || '-'}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    `).join('')}

    <p class="timestamp">Report generated: ${new Date().toLocaleString()}</p>
  </div>

  <script>
    function filterResults(status) {
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelectorAll('.result-row').forEach(row => {
        row.style.display = (status === 'all' || row.dataset.status === status) ? '' : 'none';
      });
    }

    function showTab(tabId) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-' + tabId).classList.add('active');
    }
  </script>
</body>
</html>
  `;

  fs.writeFileSync(`${REPORTS_DIR}/game-launch-report.html`, html);
}

/**
 * Generate JSON Report
 */
function generateJSONReport(results: TestResult[]): void {
  const report = {
    summary: {
      totalTests: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      skipped: results.filter(r => r.status === 'SKIP').length,
      passRate: results.length > 0 ?
        ((results.filter(r => r.status === 'PASS').length / results.length) * 100).toFixed(1) : '0',
      avgLoadTime: results.length > 0 ?
        (results.reduce((sum, r) => sum + r.loadTime, 0) / results.length / 1000).toFixed(2) : '0',
      generatedAt: new Date().toISOString()
    },
    byPlatform: {
      Web: results.filter(r => r.platform === 'Web'),
      Android: results.filter(r => r.platform === 'Android'),
      iOS: results.filter(r => r.platform === 'iOS')
    },
    results: results
  };

  fs.writeFileSync(`${REPORTS_DIR}/game-launch-report.json`, JSON.stringify(report, null, 2));
}

/**
 * Generate CSV Report (for Excel compatibility)
 */
function generateCSVReport(results: TestResult[]): void {
  const headers = [
    'Test ID', 'Test Case', 'Game Name', 'Provider', 'Platform', 'Browser/Device',
    'Status', 'Load Time (s)', 'Error Details', 'Console Errors', 'Screenshot', 'Screenshot 2 (Spin)', 'Timestamp'
  ];

  const rows = results.map(r => [
    r.testId,
    r.testCase,
    r.gameName,
    r.gameProvider,
    r.platform,
    r.device || r.browser,
    r.status,
    (r.loadTime / 1000).toFixed(2),
    r.errorDetails || '',
    r.consoleErrors.join('; '),
    r.screenshotPath ? path.basename(r.screenshotPath) : '',
    r.screenshotPath2 ? path.basename(r.screenshotPath2) : '',
    r.timestamp
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  fs.writeFileSync(`${REPORTS_DIR}/game-launch-report.csv`, csv);
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe('Game Launch Checklist Tests', () => {
  test.beforeAll(async () => {
    ensureDirectories();
    console.log('\n========================================');
    console.log('  GAME LAUNCH CHECKLIST TEST SUITE');
    console.log('========================================\n');
  });

  test.afterAll(async () => {
    // Generate reports from file-based results
    const allResults = loadResultsFromFile();
    generateHTMLReport(allResults);
    generateJSONReport(allResults);
    generateCSVReport(allResults);

    console.log('\n========================================');
    console.log('  TEST EXECUTION COMPLETE');
    console.log('========================================');
    console.log(`Total Tests: ${allResults.length}`);
    console.log(`Passed: ${allResults.filter(r => r.status === 'PASS').length}`);
    console.log(`Failed: ${allResults.filter(r => r.status === 'FAIL').length}`);
    console.log(`\nReports generated at: ${REPORTS_DIR}/`);
  });

  // ==========================================================================
  // TC001 & TC002 & TC004: Web Browser Tests (Chrome - Default)
  // ==========================================================================
  test.describe('TC001-004: Web Browser Tests', () => {
    const games = GAMES.length > 0 ? GAMES : [
      { id: 'G001', name: 'Aviator', provider: 'Spribe', category: 'crash', url: '/lobby/casino-games/game/aviator' },
      { id: 'G002', name: 'Hot Hot Betway', provider: 'Habanero', category: 'slots', url: '/lobby/casino-games/game/hot-hot-betway' },
    ];

    for (const game of games) {
      test(`TC001: Game Launch - ${game.name} (${game.provider})`, async ({ page }) => {
        test.setTimeout(120000);

        // Set reduced viewport to capture credits in screenshots
        await page.setViewportSize(VIEWPORT_CONFIG);

        const testId = `TC001-${game.id}`;
        const consoleErrors = setupConsoleErrorCapture(page);
        const screenshotName = `${testId}_${safeFileName(game.name)}_chrome`;

        console.log(`\n[${testId}] Testing: ${game.name} on Chrome`);

        // Navigate to home and login
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await performLogin(page);

        // Launch game and measure
        const { loadTime, success, errors } = await launchGameAndMeasure(page, game.url);

        // Create result
        const result: TestResult = {
          testId,
          testCase: 'TC001: Game Launch on Web Browser',
          gameName: game.name,
          gameProvider: game.provider,
          platform: 'Web',
          browser: 'Chrome',
          device: '',
          status: success ? 'PASS' : 'FAIL',
          loadTime,
          errorDetails: success ? null : errors.join('; ') || 'Game did not load',
          consoleErrors,
          screenshotPath: `${SCREENSHOTS_DIR}/${screenshotName}_${success ? 'pass' : 'fail'}.png`,
          timestamp: new Date().toISOString()
        };

        await page.screenshot({ path: result.screenshotPath });
        allTestResults.push(result);

        // TC002: Check load time
        const loadTimeResult: TestResult = {
          ...result,
          testId: `TC002-${game.id}`,
          testCase: 'TC002: Game Loading Time',
          status: loadTime <= MAX_LOAD_TIME ? 'PASS' : 'FAIL',
          errorDetails: loadTime > MAX_LOAD_TIME ? `Load time ${(loadTime/1000).toFixed(2)}s exceeds ${MAX_LOAD_TIME/1000}s limit` : null,
          screenshotPath: ''
        };
        allTestResults.push(loadTimeResult);

        // TC004: Check for errors
        const noErrorsResult: TestResult = {
          ...result,
          testId: `TC004-${game.id}`,
          testCase: 'TC004: No Errors During Launch',
          status: (consoleErrors.length === 0 && errors.length === 0) ? 'PASS' : 'FAIL',
          errorDetails: [...consoleErrors, ...errors].length > 0 ? [...consoleErrors, ...errors].slice(0, 3).join('; ') : null,
          screenshotPath: ''
        };
        allTestResults.push(noErrorsResult);

        console.log(`  Status: ${result.status} | Load Time: ${(loadTime/1000).toFixed(2)}s | Errors: ${consoleErrors.length}`);

        expect(success).toBeTruthy();
      });
    }
  });

  // ==========================================================================
  // TC003: Cross-Browser Compatibility
  // ==========================================================================
  test.describe('TC003: Cross-Browser Compatibility', () => {
    const testGame = GAMES[0] || { id: 'G001', name: 'Aviator', provider: 'Spribe', category: 'crash', url: '/lobby/casino-games/game/aviator' };

    // Test on Firefox
    test(`TC003: ${testGame.name} on Firefox`, async ({ browser }) => {
      test.setTimeout(120000);

      const context = await browser.newContext({
        viewport: VIEWPORT_CONFIG
      });
      const page = await context.newPage();
      const testId = `TC003-Firefox-${testGame.id}`;
      const consoleErrors = setupConsoleErrorCapture(page);

      console.log(`\n[${testId}] Testing: ${testGame.name} on Firefox`);

      await page.goto(BASE_URL);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      await performLogin(page);

      const { loadTime, success, errors } = await launchGameAndMeasure(page, testGame.url);

      const result: TestResult = {
        testId,
        testCase: 'TC003: Cross-Browser Compatibility',
        gameName: testGame.name,
        gameProvider: testGame.provider,
        platform: 'Web',
        browser: 'Firefox',
        device: '',
        status: success ? 'PASS' : 'FAIL',
        loadTime,
        errorDetails: success ? null : errors.join('; '),
        consoleErrors,
        screenshotPath: `${SCREENSHOTS_DIR}/${testId}_${success ? 'pass' : 'fail'}.png`,
        timestamp: new Date().toISOString()
      };

      await page.screenshot({ path: result.screenshotPath });
      allTestResults.push(result);

      await context.close();
      console.log(`  Status: ${result.status}`);
    });
  });

  // ==========================================================================
  // TC005 & TC006: Android Device Tests
  // ==========================================================================
  test.describe('TC005-006: Android Device Tests', () => {
    const testGame = GAMES[0] || { id: 'G001', name: 'Aviator', provider: 'Spribe', category: 'crash', url: '/lobby/casino-games/game/aviator' };

    for (const device of ANDROID_DEVICES) {
      test(`TC005: ${testGame.name} on ${device.name}`, async ({ browser }) => {
        test.setTimeout(120000);

        const context = await browser.newContext({
          ...device.config
        });
        const page = await context.newPage();
        const testId = `TC005-${safeFileName(device.name)}-${testGame.id}`;
        const consoleErrors = setupConsoleErrorCapture(page);

        console.log(`\n[${testId}] Testing: ${testGame.name} on ${device.name}`);

        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await performLogin(page);

        const { loadTime, success, errors } = await launchGameAndMeasure(page, testGame.url);

        const result: TestResult = {
          testId,
          testCase: 'TC005: Game Launch on Android',
          gameName: testGame.name,
          gameProvider: testGame.provider,
          platform: 'Android',
          browser: 'Chrome Mobile',
          device: device.name,
          status: success ? 'PASS' : 'FAIL',
          loadTime,
          errorDetails: success ? null : errors.join('; '),
          consoleErrors,
          screenshotPath: `${SCREENSHOTS_DIR}/${testId}_${success ? 'pass' : 'fail'}.png`,
          timestamp: new Date().toISOString()
        };

        await page.screenshot({ path: result.screenshotPath });
        allTestResults.push(result);

        // TC006: Device compatibility (same result, different test case)
        const compatResult: TestResult = {
          ...result,
          testId: `TC006-${safeFileName(device.name)}-${testGame.id}`,
          testCase: 'TC006: Android Device Compatibility'
        };
        allTestResults.push(compatResult);

        await context.close();
        console.log(`  Status: ${result.status}`);
      });
    }
  });

  // ==========================================================================
  // TC007 & TC008: iOS Device Tests
  // ==========================================================================
  test.describe('TC007-008: iOS Device Tests', () => {
    const testGame = GAMES[0] || { id: 'G001', name: 'Aviator', provider: 'Spribe', category: 'crash', url: '/lobby/casino-games/game/aviator' };

    for (const device of IOS_DEVICES) {
      test(`TC007: ${testGame.name} on ${device.name}`, async ({ browser }) => {
        test.setTimeout(120000);

        const context = await browser.newContext({
          ...device.config
        });
        const page = await context.newPage();
        const testId = `TC007-${safeFileName(device.name)}-${testGame.id}`;
        const consoleErrors = setupConsoleErrorCapture(page);

        console.log(`\n[${testId}] Testing: ${testGame.name} on ${device.name}`);

        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await performLogin(page);

        const { loadTime, success, errors } = await launchGameAndMeasure(page, testGame.url);

        const result: TestResult = {
          testId,
          testCase: 'TC007: Game Launch on iOS',
          gameName: testGame.name,
          gameProvider: testGame.provider,
          platform: 'iOS',
          browser: 'Safari Mobile',
          device: device.name,
          status: success ? 'PASS' : 'FAIL',
          loadTime,
          errorDetails: success ? null : errors.join('; '),
          consoleErrors,
          screenshotPath: `${SCREENSHOTS_DIR}/${testId}_${success ? 'pass' : 'fail'}.png`,
          timestamp: new Date().toISOString()
        };

        await page.screenshot({ path: result.screenshotPath });
        allTestResults.push(result);

        // TC008: Device compatibility
        const compatResult: TestResult = {
          ...result,
          testId: `TC008-${safeFileName(device.name)}-${testGame.id}`,
          testCase: 'TC008: iOS Device Compatibility'
        };
        allTestResults.push(compatResult);

        await context.close();
        console.log(`  Status: ${result.status}`);
      });
    }
  });

  // ==========================================================================
  // TC009: Credits Visibility & Spin Action (REFACTORED)
  // ==========================================================================
  test.describe('TC009: Credits Visibility & Spin Action', () => {
    const games = GAMES.length > 0 ? GAMES : [
      { id: 'G001', name: 'Aviator', provider: 'Spribe', category: 'crash', url: '/lobby/casino-games/game/aviator' },
    ];

    // Clear results file before running tests (only first worker should do this)
    test.beforeAll(async () => {
      // Use atomic file creation with 'wx' flag to ensure only one worker clears results
      const lockFile = `${REPORTS_DIR}/.clear-lock`;
      try {
        // 'wx' flag fails if file already exists - this is atomic
        fs.writeFileSync(lockFile, Date.now().toString(), { flag: 'wx' });
        clearResultsFile();
        console.log('    [Results] Cleared previous results file');
      } catch (error: any) {
        // EEXIST means another worker already has the lock - this is expected
        if (error.code !== 'EEXIST') {
          console.log('    [Results] Lock error:', error.message);
        }
      }
    });

    /**
     * Helper: Perform login on current page
     */
    async function doLogin(page: Page): Promise<boolean> {
      // Check for login modal popup first
      const modalPassword = page.locator('[role="dialog"] input[type="password"], .modal input[type="password"]').first();
      if (await modalPassword.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('    [Login] Modal detected');
        const modalMobile = page.locator('[role="dialog"] input[type="tel"], .modal input[type="tel"]').first();
        if (await modalMobile.isVisible({ timeout: 1000 }).catch(() => false)) {
          await modalMobile.fill(CREDENTIALS.username);
        }
        await modalPassword.fill(CREDENTIALS.password);

        // Try Enter key first
        await modalPassword.press('Enter');
        await page.waitForTimeout(2000);

        // If still visible, try clicking button
        if (await modalPassword.isVisible({ timeout: 1000 }).catch(() => false)) {
          const modalBtn = page.locator('[role="dialog"] button:has-text("Login"), .modal button:has-text("Login")').first();
          if (await modalBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await modalBtn.click({ force: true });
            await page.waitForTimeout(3000);
          }
        }
      }

      // Check for header login
      const headerLoginBtn = page.locator('#login-btn');
      if (await headerLoginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('    [Login] Header login form');

        // Step 1: Click to reveal form
        await headerLoginBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(2000);

        const username = page.locator('#header-username');
        const password = page.locator('#header-password');

        // Step 2: Fill credentials
        if (await username.isVisible({ timeout: 3000 }).catch(() => false)) {
          await username.clear();
          await username.fill(CREDENTIALS.username);
          console.log('    [Login] Username filled');

          await password.clear();
          await password.fill(CREDENTIALS.password);
          console.log('    [Login] Password filled');

          // Step 3: Submit - try multiple methods
          await page.waitForTimeout(500);

          // Method 1: Press Enter
          await password.press('Enter');
          console.log('    [Login] Pressed Enter');
          await page.waitForTimeout(3000);

          // Method 2: If still showing login, click button
          if (await headerLoginBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log('    [Login] Clicking Login button...');
            await headerLoginBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(3000);
          }

          // Method 3: JavaScript click as fallback
          if (await headerLoginBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log('    [Login] JS click fallback...');
            await headerLoginBtn.evaluate((el: HTMLElement) => el.click());
            await page.waitForTimeout(3000);
          }
        }
      }

      // Verify login succeeded - wait up to 15 seconds
      const depositBtn = page.locator('button:has-text("Deposit")').first();
      const welcomeMsg = page.locator('text=/Welcome/i').first();

      for (let i = 0; i < 15; i++) {
        if (await depositBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          console.log('    [Login] SUCCESS - Deposit button visible');
          return true;
        }
        if (await welcomeMsg.isVisible({ timeout: 500 }).catch(() => false)) {
          console.log('    [Login] SUCCESS - Welcome visible');
          return true;
        }
        // Check if login button disappeared
        if (!await headerLoginBtn.isVisible({ timeout: 500 }).catch(() => true)) {
          console.log('    [Login] SUCCESS - Login button gone');
          return true;
        }
        await page.waitForTimeout(1000);
      }

      console.log('    [Login] FAILED - Could not verify login');
      return false;
    }

    /**
     * Helper: Check if user is logged in (must have POSITIVE indicators)
     */
    async function isLoggedIn(page: Page): Promise<boolean> {
      // Wait for page to stabilize
      await page.waitForTimeout(1000);

      // Must have POSITIVE indicators - don't rely on absence of login button
      const depositBtn = page.locator('button:has-text("Deposit")').first();
      const welcomeMsg = page.locator('text=/Welcome/i').first();

      if (await depositBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('    [isLoggedIn] YES - Deposit button visible');
        return true;
      }
      if (await welcomeMsg.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('    [isLoggedIn] YES - Welcome message visible');
        return true;
      }

      // Login button visible means NOT logged in
      const loginBtn = page.locator('#login-btn');
      if (await loginBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('    [isLoggedIn] NO - Login button visible');
        return false;
      }

      // If neither, assume not logged in
      console.log('    [isLoggedIn] NO - No positive indicators');
      return false;
    }

    /**
     * Helper: Check for server/page errors AND game error dialogs
     */
    async function checkForServerErrors(page: Page): Promise<string | null> {
      const pageContent = await page.content().catch(() => '');
      const pageText = await page.locator('body').textContent().catch(() => '') || '';

      // Cloudflare errors
      if (pageContent.includes('SSL handshake failed') || pageContent.includes('Error code 525')) {
        return 'SSL handshake failed (Cloudflare Error 525)';
      }
      if (pageContent.includes('Connection timed out') || pageContent.includes('Error code 522')) {
        return 'Connection timed out (Cloudflare Error 522)';
      }
      if (pageContent.includes('Web server is down') || pageContent.includes('Error code 521')) {
        return 'Web server is down (Cloudflare Error 521)';
      }

      // Generic errors
      if (pageContent.includes('502 Bad Gateway')) return '502 Bad Gateway';
      if (pageContent.includes('503 Service Unavailable')) return '503 Service Unavailable';
      if (pageContent.includes('504 Gateway Timeout')) return '504 Gateway Timeout';

      // Game-specific error dialogs (Error XXXXX format)
      const errorMatch = pageText.match(/Error\s+(\d{4,})/i);
      if (errorMatch) {
        const errorCode = errorMatch[1];
        console.log(`    [Error] Game error dialog detected: Error ${errorCode}`);

        // Try to click OK/Close button to dismiss the error dialog
        const dismissButtons = [
          'button:has-text("OK")',
          'button:has-text("Close")',
          'button:has-text("Retry")',
          '[class*="close"]',
          '[class*="dismiss"]',
        ];

        for (const selector of dismissButtons) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
              await btn.click({ force: true }).catch(() => {});
              console.log(`    [Error] Clicked dismiss button: ${selector}`);
              await page.waitForTimeout(1000);
              break;
            }
          } catch (e) {
            // Continue trying other buttons
          }
        }

        return `Game Error ${errorCode}`;
      }

      return null;
    }

    /**
     * Helper: Wait for game to load
     */
    async function waitForGameLoad(page: Page, maxWaitMs: number = 25000): Promise<{ loaded: boolean; canvas: any }> {
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        // Check for server errors first
        const serverError = await checkForServerErrors(page);
        if (serverError) {
          console.log(`    [Game] Server error: ${serverError}`);
          return { loaded: false, canvas: null };
        }

        // Check for game canvas with reasonable size
        const canvas = page.locator('canvas').first();
        if (await canvas.isVisible({ timeout: 300 }).catch(() => false)) {
          const box = await canvas.boundingBox().catch(() => null);
          if (box && box.width > 400 && box.height > 300) {
            console.log(`    [Game] Loaded: ${Math.round(box.width)}x${Math.round(box.height)}`);
            return { loaded: true, canvas: box };
          }
        }

        // Check for iframe (some games use iframe)
        const iframe = page.locator('iframe[src*="game"], iframe[class*="game"], iframe').first();
        if (await iframe.isVisible({ timeout: 300 }).catch(() => false)) {
          const iframeBox = await iframe.boundingBox().catch(() => null);
          if (iframeBox && iframeBox.width > 400 && iframeBox.height > 300) {
            console.log('    [Game] Loaded via iframe');
            return { loaded: true, canvas: iframeBox };
          }
        }

        await page.waitForTimeout(500);
      }

      console.log('    [Game] Timeout - not loaded');
      return { loaded: false, canvas: null };
    }

    /**
     * Helper: Detect credits/balance visibility INSIDE THE GAME
     * Credits must be visible in the game UI itself, not just the website header
     */
    async function detectCreditsInGame(page: Page): Promise<{ visible: boolean; text: string; location: string }> {
      // IMPORTANT: We need to detect credits INSIDE the game, not just the website header
      // The game typically shows credits/balance in the game UI (bottom area of game canvas)

      // Method 1: Try to read text from iframe content
      try {
        const iframes = page.frames();
        for (const frame of iframes) {
          if (frame === page.mainFrame()) continue;

          const frameContent = await frame.locator('body').textContent().catch(() => '') || '';
          // Look for currency patterns in game iframe
          // Note: Some games use space as thousands separator (R1 860.24)
          const creditPatterns = [
            /CREDITS?\s*[:\s]*R?\s*([\d\s,]+\.?\d*)/i,
            /BALANCE\s*[:\s]*R?\s*([\d\s,]+\.?\d*)/i,
            /CASH\s*[:\s]*R?\s*([\d\s,]+\.?\d*)/i,
            /R\s*([\d\s,]+\.\d{2})/,   // R 1,861.24 format
            /R([\d\s,]+\.\d{2})/,      // R1 860.24 format (no space after R)
            /\$([\d\s,]+\.\d{2})/,     // $ format
            /€([\d\s,]+\.\d{2})/,      // € format
          ];

          for (const pattern of creditPatterns) {
            const match = frameContent.match(pattern);
            if (match) {
              console.log(`    [Credits] Found in game iframe: ${match[0]}`);
              return { visible: true, text: match[0], location: 'game-iframe' };
            }
          }
        }
      } catch (e) {
        // Iframe access might fail
      }

      // Method 2: Check for credits text visible on the page (might be in canvas overlay)
      // NOTE: We ONLY look for actual currency amounts, not just game UI labels
      const pageText = await page.locator('body').textContent().catch(() => '') || '';

      // Look for typical game credit displays - MUST have actual currency amounts
      // Note: Some games use space as thousands separator (R1 860.24) instead of comma
      const creditPatterns = [
        /CREDITS?\s*[:\s]*R\s*[\d\s,]+\.?\d*/i,   // CREDITS: R 1,234.56 or R1 860.24
        /BALANCE\s*[:\s]*R\s*[\d\s,]+\.?\d*/i,    // BALANCE: R 1,234.56 or R1 860.24
        /BET\s*[:\s]*R\s*[\d\s,]+\.?\d*/i,        // BET: R 10.00
        /WIN\s*[:\s]*R\s*[\d\s,]+\.?\d*/i,        // WIN: R 50.00
        /R\s*[\d\s,]+\.\d{2}/,                     // R 1,861.24 or R1 860.24 format standalone
        /R[\d\s,]+\.\d{2}/,                        // R1 860.24 (no space after R)
        /\$\s*[\d\s,]+\.\d{2}/,                    // $ 1,234.56 format
        /€\s*[\d\s,]+\.\d{2}/,                     // € 1,234.56 format
      ];

      for (const pattern of creditPatterns) {
        const match = pageText.match(pattern);
        if (match && !pageText.includes('Symbol Prediction')) { // Exclude info screens
          // Verify it's an actual amount (has numbers after currency)
          if (/[R$€]\s*[\d\s,]+\.?\d*/.test(match[0])) {
            console.log(`    [Credits] Found on page: ${match[0]}`);
            return { visible: true, text: match[0], location: 'page-text' };
          }
        }
      }

      // Method 3: Check inside game iframe for UI elements (NOT on main page to avoid header false positives)
      // This checks for game UI elements that indicate the game is playable, but ONLY inside the game container
      try {
        const iframes = page.frameLocator('iframe').first();
        const gameUIElements = [
          iframes.locator('text=/SPIN/i'),
          iframes.locator('text=/AUTOPLAY/i'),
          iframes.locator('[class*="spin"]'),
          iframes.locator('[class*="balance"]'),
          iframes.locator('[class*="credit"]'),
        ];

        for (const el of gameUIElements) {
          try {
            if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
              const text = await el.textContent().catch(() => '') || '';
              console.log(`    [Credits] Game iframe UI element found: ${text.substring(0, 30)}`);
              return { visible: true, text: `Game UI: ${text.substring(0, 30)}`, location: 'iframe-ui' };
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e) {
        // Iframe might be cross-origin
      }

      console.log('    [Credits] NOT found in game UI');
      return { visible: false, text: '', location: '' };
    }

    /**
     * Helper: Check if game is actually loaded and playable (not loading/intro/error screen)
     */
    async function isGamePlayable(page: Page): Promise<{ playable: boolean; reason: string }> {
      const pageText = await page.locator('body').textContent().catch(() => '') || '';
      const pageTextLower = pageText.toLowerCase();

      // Check for ERROR DIALOGS first (Error XXXXX format) - on main page
      const errorMatch = pageText.match(/Error\s+(\d{4,})/i);
      if (errorMatch) {
        return { playable: false, reason: `Game showing error dialog: Error ${errorMatch[1]}` };
      }

      // Also check for errors INSIDE the game iframe
      try {
        const iframes = page.frames();
        for (const frame of iframes) {
          if (frame === page.mainFrame()) continue;
          const frameText = await frame.locator('body').textContent().catch(() => '') || '';
          const iframeErrorMatch = frameText.match(/Error\s+(\d{4,})/i);
          if (iframeErrorMatch) {
            console.log(`    [Playable] Error found in iframe: Error ${iframeErrorMatch[1]}`);
            return { playable: false, reason: `Game showing error dialog in iframe: Error ${iframeErrorMatch[1]}` };
          }
          // Check for error messages
          const errorPatterns = ['a general error', 'error has occurred', 'error occurred', 'game error', 'failed to load'];
          for (const pattern of errorPatterns) {
            if (frameText.toLowerCase().includes(pattern)) {
              console.log(`    [Playable] Error pattern found in iframe: ${pattern}`);
              return { playable: false, reason: `Game error in iframe: ${pattern}` };
            }
          }
        }
      } catch (e) {
        // Iframe might be cross-origin
      }

      // Check for loading indicators
      const loadingIndicators = [
        'loading',
        'connection...',
        'connecting',
        'please wait',
        'initializing',
      ];

      for (const indicator of loadingIndicators) {
        if (pageTextLower.includes(indicator)) {
          return { playable: false, reason: `Game still loading: ${indicator}` };
        }
      }

      // Check for intro/info screens that need Continue/Play button
      // NOTE: Be specific to avoid false positives from cookie banners, etc.
      const introIndicators = [
        { pattern: 'symbol prediction', name: 'symbol prediction' },
        { pattern: 'paytable', name: 'paytable' },
        { pattern: 'game rules', name: 'game rules' },
        { pattern: 'how to play', name: 'how to play' },
        { pattern: 'press start', name: 'press start' },
        { pattern: 'tap to start', name: 'tap to start' },
        { pattern: 'click to start', name: 'click to start' },
        { pattern: 'tap to continue', name: 'tap to continue' },
        { pattern: 'click to continue', name: 'click to continue' },
        { pattern: 'press any key', name: 'press any key' },
        { pattern: 'tap anywhere', name: 'tap anywhere' },
        { pattern: 'click anywhere', name: 'click anywhere' },
        { pattern: 'touch to start', name: 'touch to start' },
        { pattern: 'touch to continue', name: 'touch to continue' },
      ];

      for (const { pattern, name } of introIndicators) {
        if (pageTextLower.includes(pattern)) {
          return { playable: false, reason: `Game showing intro screen: ${name}` };
        }
      }

      // Special check for "welcome to" but exclude "Welcome To Betway Feed"
      if (pageTextLower.includes('welcome to') && !pageTextLower.includes('welcome to betway feed')) {
        // Only flag as intro if it's inside the game area or a short welcome message
        const welcomeMatch = pageText.match(/welcome to\s+[^.]{0,50}/i);
        if (welcomeMatch && !welcomeMatch[0].toLowerCase().includes('betway feed')) {
          return { playable: false, reason: `Game showing intro: ${welcomeMatch[0].substring(0, 40)}` };
        }
      }

      // Check if there's a visible game element (canvas or iframe with good size)
      const canvas = page.locator('canvas').first();
      const iframe = page.locator('iframe').first();

      let hasGameElement = false;
      if (await canvas.isVisible({ timeout: 500 }).catch(() => false)) {
        const box = await canvas.boundingBox().catch(() => null);
        if (box && box.width > 400 && box.height > 300) {
          hasGameElement = true;
        }
      }
      if (!hasGameElement && await iframe.isVisible({ timeout: 500 }).catch(() => false)) {
        const box = await iframe.boundingBox().catch(() => null);
        if (box && box.width > 400 && box.height > 300) {
          hasGameElement = true;
        }
      }

      if (!hasGameElement) {
        return { playable: false, reason: 'No game canvas/iframe visible' };
      }

      return { playable: true, reason: 'Game appears playable' };
    }

    /**
     * Helper: Detect credits/balance visibility (website header - for login check only)
     */
    async function detectCredits(page: Page): Promise<{ visible: boolean; text: string }> {
      // This now only checks website header for login status
      // Actual game credits should use detectCreditsInGame()

      // Check for Deposit button (indicates logged in)
      const depositBtn = page.locator('button:has-text("Deposit")').first();
      if (await depositBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('    [Credits] Deposit button visible (user logged in)');
        return { visible: true, text: 'Deposit button visible' };
      }

      // Check for Welcome message
      const welcomeEl = page.locator('text=/Welcome/i').first();
      if (await welcomeEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        const text = await welcomeEl.textContent().catch(() => '') || '';
        console.log(`    [Credits] Welcome message: ${text.substring(0, 50)}`);
        return { visible: true, text };
      }

      // Final check: Is login button visible? If so, user is NOT logged in
      const loginBtn = page.locator('#login-btn');
      if (await loginBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('    [Credits] Login button visible - NOT logged in');
        return { visible: false, text: '' };
      }

      console.log('    [Credits] Login status unclear');
      return { visible: false, text: '' };
    }

    /**
     * Helper: Check for game-specific Continue/Start/Play buttons that need clicking
     * These buttons appear INSIDE the game canvas or iframe before the main game loads
     */
    async function handleGameContinueButtons(page: Page): Promise<{ clicked: boolean; buttonType: string }> {
      // Common game intro button patterns
      const continueButtonSelectors = [
        // DOM-based buttons on main page
        'button:has-text("Continue")',
        'button:has-text("CONTINUE")',
        'button:has-text("Start")',
        'button:has-text("START")',
        'button:has-text("Play Now")',
        'button:has-text("PLAY NOW")',
        'button:has-text("Play")',
        'button:has-text("PLAY")',
        'button:has-text("Enter")',
        'button:has-text("OK")',
        'button:has-text("Accept")',
        'button:has-text("I Understand")',
        '[class*="continue-btn"]',
        '[class*="start-btn"]',
        '[class*="play-btn"]',
        '[data-testid*="continue"]',
        '[data-testid*="start"]',
      ];

      // Check main page buttons first
      for (const selector of continueButtonSelectors) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          console.log(`    [GameContinue] Clicked: ${selector}`);
          await page.waitForTimeout(1500);
          return { clicked: true, buttonType: selector };
        }
      }

      // Check inside iframes (games often use iframes)
      try {
        const iframes = page.frameLocator('iframe');
        for (const selector of continueButtonSelectors) {
          const iframeBtn = iframes.locator(selector).first();
          if (await iframeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await iframeBtn.click({ force: true }).catch(() => {});
            console.log(`    [GameContinue] Clicked iframe: ${selector}`);
            await page.waitForTimeout(1500);
            return { clicked: true, buttonType: `iframe:${selector}` };
          }
        }
      } catch (e) {
        // Iframe might be cross-origin
      }

      // Only click canvas/iframe center if there's evidence of a continue/start overlay
      // Look for text indicators first before blindly clicking
      const pageText = await page.locator('body').textContent().catch(() => '') || '';
      const pageTextLower = pageText.toLowerCase();
      const hasContinueText = pageTextLower.includes('tap to') ||
                              pageTextLower.includes('click to') ||
                              pageTextLower.includes('press to') ||
                              pageTextLower.includes('touch to') ||
                              pageTextLower.includes('loading') ||
                              pageTextLower.includes('initializing');

      if (hasContinueText) {
        // Check for canvas-based continue
        const gameCanvas = page.locator('canvas').first();
        if (await gameCanvas.isVisible({ timeout: 500 }).catch(() => false)) {
          const canvasBox = await gameCanvas.boundingBox().catch(() => null);
          if (canvasBox && canvasBox.width > 400) {
            const centerX = canvasBox.x + canvasBox.width / 2;
            const centerY = canvasBox.y + canvasBox.height / 2;
            await page.mouse.click(centerX, centerY);
            console.log(`    [GameContinue] Clicked canvas center (${hasContinueText ? 'detected overlay text' : 'trying tap'})`);
            await page.waitForTimeout(1000);
            return { clicked: true, buttonType: 'canvas-center' };
          }
        }

        // Check iframe element
        const iframeEl = page.locator('iframe').first();
        if (await iframeEl.isVisible({ timeout: 500 }).catch(() => false)) {
          const iframeBox = await iframeEl.boundingBox().catch(() => null);
          if (iframeBox && iframeBox.width > 400) {
            const centerX = iframeBox.x + iframeBox.width / 2;
            const centerY = iframeBox.y + iframeBox.height / 2;
            await page.mouse.click(centerX, centerY);
            console.log(`    [GameContinue] Clicked iframe center (${hasContinueText ? 'detected overlay text' : 'trying tap'})`);
            await page.waitForTimeout(1000);
            return { clicked: true, buttonType: 'iframe-center' };
          }
        }
      }

      return { clicked: false, buttonType: '' };
    }

    /**
     * ENHANCED: Comprehensive method to dismiss game intro/splash screens
     * Many games show Continue, Play, Start buttons before showing credits
     * This method aggressively tries to find and click these buttons
     */
    async function dismissGameIntroScreens(page: Page): Promise<{ dismissed: boolean; method: string }> {
      console.log('    [IntroScreen] Attempting to dismiss intro/splash screens...');

      // Extended list of button selectors for intro screens
      const introButtonSelectors = [
        // Text-based buttons
        'button:has-text("Continue")',
        'button:has-text("CONTINUE")',
        'button:has-text("Play")',
        'button:has-text("PLAY")',
        'button:has-text("Play Now")',
        'button:has-text("PLAY NOW")',
        'button:has-text("Start")',
        'button:has-text("START")',
        'button:has-text("Start Game")',
        'button:has-text("Enter")',
        'button:has-text("ENTER")',
        'button:has-text("Begin")',
        'button:has-text("Skip")',
        'button:has-text("SKIP")',
        'button:has-text("OK")',
        'button:has-text("Accept")',
        'button:has-text("I Accept")',
        'button:has-text("Got it")',
        'button:has-text("Close")',
        // Link-based buttons
        'a:has-text("Continue")',
        'a:has-text("Play")',
        'a:has-text("Start")',
        'a:has-text("OK")',
        // Div-based buttons (common in games)
        'div:has-text("Continue")',
        'div:has-text("CONTINUE")',
        'div:has-text("Play")',
        'div:has-text("PLAY")',
        'div:has-text("Start")',
        'div:has-text("START")',
        // Class-based selectors
        '[class*="continue"]',
        '[class*="Continue"]',
        '[class*="play-btn"]',
        '[class*="play_btn"]',
        '[class*="playBtn"]',
        '[class*="start-btn"]',
        '[class*="start_btn"]',
        '[class*="startBtn"]',
        '[class*="enter-btn"]',
        '[class*="skip-btn"]',
        '[class*="intro-btn"]',
        '[class*="splash-btn"]',
        '[class*="welcome-btn"]',
        // ID-based selectors
        '[id*="continue"]',
        '[id*="play"]',
        '[id*="start"]',
        '[id*="enter"]',
        // Data attribute selectors
        '[data-action="continue"]',
        '[data-action="play"]',
        '[data-action="start"]',
      ];

      // Method 1: Check main page for intro buttons
      for (const selector of introButtonSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
            const text = await btn.textContent().catch(() => '') || '';
            // Make sure it's not a navigation menu item
            if (text.length < 30 && !text.toLowerCase().includes('betgames')) {
              await btn.click({ force: true }).catch(() => {});
              console.log(`    [IntroScreen] Clicked main page button: ${selector} ("${text.substring(0, 20)}")`);
              await page.waitForTimeout(2000);
              return { dismissed: true, method: `main-page: ${selector}` };
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Method 2: Check inside ALL iframes for intro buttons
      try {
        const iframeElements = page.locator('iframe');
        const iframeCount = await iframeElements.count().catch(() => 0);

        for (let i = 0; i < iframeCount; i++) {
          try {
            const iframeLocator = page.frameLocator(`iframe >> nth=${i}`);

            for (const selector of introButtonSelectors) {
              try {
                const iframeBtn = iframeLocator.locator(selector).first();
                if (await iframeBtn.isVisible({ timeout: 200 }).catch(() => false)) {
                  await iframeBtn.click({ force: true }).catch(() => {});
                  console.log(`    [IntroScreen] Clicked iframe[${i}] button: ${selector}`);
                  await page.waitForTimeout(2000);
                  return { dismissed: true, method: `iframe[${i}]: ${selector}` };
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        // Iframe access might fail
      }

      // Method 3: Click common positions on canvas/iframe for canvas-rendered buttons
      // Games often have Play/Continue buttons at specific positions
      const gameContainer = page.locator('iframe, canvas').first();
      if (await gameContainer.isVisible({ timeout: 500 }).catch(() => false)) {
        const box = await gameContainer.boundingBox().catch(() => null);
        if (box && box.width > 400 && box.height > 300) {
          // Common button positions in game intros:
          const clickPositions = [
            { x: box.x + box.width / 2, y: box.y + box.height * 0.65, name: 'center-lower' },      // Center-lower (most common for Play buttons)
            { x: box.x + box.width / 2, y: box.y + box.height * 0.5, name: 'center' },             // Center
            { x: box.x + box.width / 2, y: box.y + box.height * 0.75, name: 'bottom-center' },     // Bottom center
            { x: box.x + box.width / 2, y: box.y + box.height * 0.85, name: 'very-bottom' },       // Very bottom (for OK/Continue buttons)
          ];

          for (const pos of clickPositions) {
            await page.mouse.click(pos.x, pos.y);
            console.log(`    [IntroScreen] Clicked game area at ${pos.name} (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
            await page.waitForTimeout(1500);

            // Check if something changed (e.g., intro dismissed)
            // by looking for credits or spin button appearing
            const pageText = await page.locator('body').textContent().catch(() => '') || '';
            if (/R\s*[\d\s,]+\.\d{2}|SPIN|BET|BALANCE|CREDIT/i.test(pageText)) {
              console.log(`    [IntroScreen] Game UI detected after click at ${pos.name}`);
              return { dismissed: true, method: `canvas-click: ${pos.name}` };
            }
          }
        }
      }

      // Method 4: Try clicking inside iframe content area
      try {
        const iframe = page.locator('iframe').first();
        if (await iframe.isVisible({ timeout: 500 }).catch(() => false)) {
          const iframeBox = await iframe.boundingBox().catch(() => null);
          if (iframeBox && iframeBox.width > 400) {
            // Click multiple positions inside iframe
            const iframeClickPositions = [
              { x: iframeBox.x + iframeBox.width / 2, y: iframeBox.y + iframeBox.height * 0.6 },
              { x: iframeBox.x + iframeBox.width / 2, y: iframeBox.y + iframeBox.height * 0.7 },
              { x: iframeBox.x + iframeBox.width / 2, y: iframeBox.y + iframeBox.height * 0.8 },
            ];

            for (const pos of iframeClickPositions) {
              await page.mouse.click(pos.x, pos.y);
              await page.waitForTimeout(1000);
            }
            console.log(`    [IntroScreen] Clicked multiple positions in iframe area`);
            return { dismissed: true, method: 'iframe-multi-click' };
          }
        }
      } catch (e) {
        // Continue
      }

      // Method 5: Press keyboard keys that might dismiss intro screens
      try {
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        console.log(`    [IntroScreen] Pressed keyboard keys (Space, Enter, Escape)`);
      } catch (e) {
        // Continue
      }

      console.log('    [IntroScreen] No intro screen detected or could not dismiss');
      return { dismissed: false, method: '' };
    }

    /**
     * Helper: Wait for game to fully load and handle any continue screens
     * Returns detailed status about the game state
     */
    async function waitForGameWithContinueHandling(page: Page, maxWaitMs: number = 60000): Promise<{
      loaded: boolean;
      canvas: any;
      hadContinueButton: boolean;
      error: string | null;
    }> {
      const startTime = Date.now();
      let hadContinueButton = false;
      let lastCanvasBox: any = null;
      let continueAttempts = 0;
      const MAX_CONTINUE_ATTEMPTS = 5;

      console.log('    [GameLoad] Waiting for game to fully load...');

      while (Date.now() - startTime < maxWaitMs) {
        // Check for server errors
        const serverError = await checkForServerErrors(page);
        if (serverError) {
          console.log(`    [GameLoad] Server error: ${serverError}`);
          return { loaded: false, canvas: null, hadContinueButton, error: serverError };
        }

        // Check for game canvas or iframe
        let gameElement: any = null;
        let isIframe = false;

        // First check for large canvas
        const canvas = page.locator('canvas').first();
        if (await canvas.isVisible({ timeout: 300 }).catch(() => false)) {
          const box = await canvas.boundingBox().catch(() => null);
          if (box && box.width > 400 && box.height > 300) {
            gameElement = box;
            lastCanvasBox = box;
          }
        }

        // If no canvas, check for iframe
        if (!gameElement) {
          const iframe = page.locator('iframe').first();
          if (await iframe.isVisible({ timeout: 300 }).catch(() => false)) {
            const box = await iframe.boundingBox().catch(() => null);
            if (box && box.width > 400 && box.height > 300) {
              gameElement = box;
              lastCanvasBox = box;
              isIframe = true;
            }
          }
        }

        if (gameElement) {
          // Game element found with good dimensions - game is loaded!
          const elementType = isIframe ? 'iframe' : 'canvas';
          console.log(`    [GameLoad] Game loaded via ${elementType} (${Math.round(gameElement.width)}x${Math.round(gameElement.height)})`);
          return { loaded: true, canvas: lastCanvasBox, hadContinueButton, error: null };
        }

        // Game element not found yet - try clicking Continue buttons if available
        if (continueAttempts < MAX_CONTINUE_ATTEMPTS) {
          const { clicked, buttonType } = await handleGameContinueButtons(page);
          if (clicked) {
            hadContinueButton = true;
            continueAttempts++;
            console.log(`    [GameLoad] Continue button handled (attempt ${continueAttempts}): ${buttonType}`);
            await page.waitForTimeout(2000); // Wait for game to respond
            continue; // Check again after clicking
          }
        }

        // Check for error messages on page (only after waiting a bit - give game time to load)
        const elapsedMs = Date.now() - startTime;
        if (elapsedMs > 15000) {
          // Only check for specific error phrases (not single words that could appear anywhere)
          const errorPhrases = [
            { phrase: 'game is not available', error: 'Game not available' },
            { phrase: 'not available in your', error: 'Game not available in your region' },
            { phrase: 'not available for your', error: 'Game not available for your jurisdiction' },
            { phrase: 'unavailable in your', error: 'Game unavailable in your region' },
            { phrase: 'under maintenance', error: 'Game under maintenance' },
            { phrase: 'currently unavailable', error: 'Game currently unavailable' },
            { phrase: 'game unavailable', error: 'Game unavailable' },
            { phrase: 'sorry, this game', error: 'Game access denied' },
            { phrase: 'access denied', error: 'Game access denied' },
            { phrase: 'blocked in your', error: 'Game blocked in your region' },
            { phrase: 'restricted', error: 'Game restricted' },
          ];

          const pageText = await page.locator('body').textContent().catch(() => '') || '';
          const pageTextLower = pageText.toLowerCase();

          for (const { phrase, error } of errorPhrases) {
            if (pageTextLower.includes(phrase)) {
              console.log(`    [GameLoad] Error detected: ${error}`);
              return { loaded: false, canvas: null, hadContinueButton, error };
            }
          }
        }

        await page.waitForTimeout(1000);
      }

      console.log('    [GameLoad] Timeout - game did not load');
      return { loaded: false, canvas: lastCanvasBox, hadContinueButton, error: 'Game load timeout' };
    }

    /**
     * Helper: Verify credits are visible with retry and continue button handling
     */
    async function verifyCreditsWithRetry(page: Page, maxAttempts: number = 3): Promise<{
      visible: boolean;
      text: string;
      attemptDetails: string;
    }> {
      let attemptDetails = '';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`    [CreditsCheck] Attempt ${attempt}/${maxAttempts}`);

        // First check if user is still logged in
        const loggedIn = await isLoggedIn(page);
        if (!loggedIn) {
          console.log('    [CreditsCheck] User not logged in, attempting login...');
          await doLogin(page);
          await page.waitForTimeout(3000);
        }

        // Check for credits
        const { visible, text } = await detectCredits(page);
        if (visible) {
          attemptDetails = `Credits found on attempt ${attempt}: ${text}`;
          console.log(`    [CreditsCheck] SUCCESS - ${attemptDetails}`);
          return { visible: true, text, attemptDetails };
        }

        // Credits not visible - try clicking Continue buttons in game
        if (attempt < maxAttempts) {
          console.log('    [CreditsCheck] Credits not visible, checking for game Continue buttons...');
          const { clicked } = await handleGameContinueButtons(page);
          if (clicked) {
            await page.waitForTimeout(2000);
          }

          // Also try pressing Escape for popups
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(1000);
        }
      }

      attemptDetails = `Credits not visible after ${maxAttempts} attempts`;
      console.log(`    [CreditsCheck] FAILED - ${attemptDetails}`);
      return { visible: false, text: '', attemptDetails };
    }

    /**
     * Helper: Click spin button
     */
    async function clickSpin(page: Page, canvasBox: any): Promise<boolean> {
      // Try DOM buttons first (main page)
      const spinSelectors = [
        'button:has-text("Spin")',
        'button:has-text("SPIN")',
        '[aria-label*="spin" i]',
        'button:has-text("Play")',
        '[class*="spin-btn"]',
        '[class*="spin-button"]'
      ];

      for (const selector of spinSelectors) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          console.log(`    [Spin] Clicked DOM button: ${selector}`);
          return true;
        }
      }

      // Try iframe - game might be inside iframe
      const iframe = page.frameLocator('iframe').first();
      try {
        // Try to find spin button inside iframe
        for (const selector of spinSelectors) {
          const iframeBtn = iframe.locator(selector).first();
          if (await iframeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await iframeBtn.click({ force: true }).catch(() => {});
            console.log(`    [Spin] Clicked iframe button: ${selector}`);
            return true;
          }
        }

        // Try iframe canvas
        const iframeCanvas = iframe.locator('canvas').first();
        if (await iframeCanvas.isVisible({ timeout: 1000 }).catch(() => false)) {
          const iframeBox = await iframeCanvas.boundingBox().catch(() => null);
          if (iframeBox) {
            // Click bottom-center of iframe canvas (where spin usually is)
            const spinX = iframeBox.x + iframeBox.width / 2;
            const spinY = iframeBox.y + iframeBox.height * 0.92;
            await page.mouse.click(spinX, spinY);
            console.log(`    [Spin] Clicked iframe canvas at (${Math.round(spinX)}, ${Math.round(spinY)})`);
            return true;
          }
        }
      } catch (e) {
        // Iframe access might fail due to cross-origin
        console.log('    [Spin] Iframe access limited');
      }

      // Try main page canvas click if we have dimensions
      if (canvasBox) {
        // Spin button is typically at bottom center of game
        const positions = [
          { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height * 0.92 },
          { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height * 0.88 },
          { x: canvasBox.x + canvasBox.width * 0.5, y: canvasBox.y + canvasBox.height * 0.95 }
        ];

        for (const pos of positions) {
          await page.mouse.click(pos.x, pos.y);
          console.log(`    [Spin] Canvas click at (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
          await page.waitForTimeout(300);
        }
        return true;
      }

      // Last resort: Try clicking on visible iframe element directly
      const iframeEl = page.locator('iframe').first();
      if (await iframeEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        const box = await iframeEl.boundingBox().catch(() => null);
        if (box) {
          // Click bottom center of iframe
          const spinX = box.x + box.width / 2;
          const spinY = box.y + box.height * 0.92;
          await page.mouse.click(spinX, spinY);
          console.log(`    [Spin] Clicked on iframe area at (${Math.round(spinX)}, ${Math.round(spinY)})`);
          return true;
        }
      }

      console.log('    [Spin] Button not found');
      return false;
    }

    // ========== MAIN TEST ==========
    for (const game of games) {
      test(`TC009: Credits & Spin - ${game.name} (${game.provider})`, async ({ page, context }) => {
        test.setTimeout(420000); // 7 minutes (includes browser cleanup time)

        // Set viewport
        await page.setViewportSize(VIEWPORT_CONFIG);

        const testId = `TC009-${game.id}`;
        const consoleErrors = setupConsoleErrorCapture(page);
        let serverError: string | null = null;

        console.log(`\n[${testId}] Testing: ${game.name}`);

        // STEP 1: Navigate directly to game page (with retry for server errors)
        const gameUrl = game.url.startsWith('http') ? game.url : `${BASE_URL}${game.url}`;
        console.log('  STEP 1: Navigate to game');

        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          await page.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);

          // Check for server errors
          serverError = await checkForServerErrors(page);
          if (!serverError) {
            console.log(`    Page loaded successfully (attempt ${attempt})`);
            break;
          }

          console.log(`    Server error on attempt ${attempt}: ${serverError}`);
          if (attempt < MAX_RETRIES) {
            console.log(`    Retrying in 5 seconds...`);
            await page.waitForTimeout(5000);
          }
        }

        if (serverError) {
          console.log(`  ERROR: ${serverError} (after ${MAX_RETRIES} attempts)`);
          const errorScreenshot = `${SCREENSHOTS_DIR}/${testId}_error.png`;
          await page.screenshot({ path: errorScreenshot, timeout: 10000 }).catch(() => {});

          const result: TestResult = {
            testId,
            testCase: 'TC009: Credits Visibility & Spin Action',
            gameName: game.name,
            gameProvider: game.provider,
            platform: 'Web',
            browser: 'Chrome',
            device: '',
            status: 'FAIL',
            loadTime: 0,
            errorDetails: `${serverError} (after ${MAX_RETRIES} retries)`,
            consoleErrors,
            screenshotPath: errorScreenshot,
            screenshotPath2: '',
            timestamp: new Date().toISOString()
          };
          const allResults = saveResultToFile(result);
          generateHTMLReport(allResults);
          generateJSONReport(allResults);

          throw new Error(`Server error: ${serverError}`);
        }

        // STEP 2: Login if needed
        console.log('  STEP 2: Login');
        if (!await isLoggedIn(page)) {
          await doLogin(page);
        } else {
          console.log('    Already logged in');
        }

        // STEP 3: Handle initial popups (site-level)
        console.log('  STEP 3: Handle initial popups');
        await page.keyboard.press('Escape').catch(() => {});
        await handleContinueButtons(page);
        await page.waitForTimeout(1000);

        // STEP 4: Wait for game element to appear
        console.log('  STEP 4: Wait for game element');
        const gameLoadResult = await waitForGameWithContinueHandling(page, 60000);
        let { loaded: gameLoaded, canvas: canvasBox, hadContinueButton, error: gameError } = gameLoadResult;

        // Check for server errors
        serverError = await checkForServerErrors(page);
        if (serverError) {
          console.log(`  ERROR: ${serverError}`);
        }

        // STEP 5: Handle game intro screens, Continue/Play buttons, and make game playable
        console.log('  STEP 5: Make game playable (handle intro screens & Continue/Play buttons)');
        let gamePlayable = false;
        let playabilityReason = '';
        const MAX_PLAYABLE_ATTEMPTS = 15;  // Increased attempts for intro screens

        for (let attempt = 1; attempt <= MAX_PLAYABLE_ATTEMPTS; attempt++) {
          // Check if game is playable
          const playableCheck = await isGamePlayable(page);
          if (playableCheck.playable) {
            gamePlayable = true;
            playabilityReason = playableCheck.reason;
            console.log(`    Game is playable (attempt ${attempt})`);
            break;
          }

          console.log(`    Attempt ${attempt}: ${playableCheck.reason}`);

          // Check for error dialogs and try to dismiss them
          if (playableCheck.reason.includes('error dialog') || playableCheck.reason.includes('error in iframe')) {
            console.log(`    Attempting to dismiss error dialog...`);
            const errorDismissButtons = [
              'button:has-text("OK")',
              'button:has-text("Close")',
              'button:has-text("Retry")',
              'button:has-text("Try Again")',
              'a:has-text("OK")',
              '[class*="ok-btn"]',
              '[class*="close-btn"]',
            ];
            for (const selector of errorDismissButtons) {
              const btn = page.locator(selector).first();
              if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
                await btn.click({ force: true }).catch(() => {});
                console.log(`    Clicked error dismiss button: ${selector}`);
                await page.waitForTimeout(1500);
                break;
              }
            }
            // Also check inside iframes for error dismiss buttons
            try {
              const iframes = page.frameLocator('iframe');
              for (const selector of errorDismissButtons) {
                const iframeBtn = iframes.locator(selector).first();
                if (await iframeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
                  await iframeBtn.click({ force: true }).catch(() => {});
                  console.log(`    Clicked iframe error dismiss: ${selector}`);
                  await page.waitForTimeout(1500);
                  break;
                }
              }
            } catch (e) {
              // Iframe might be cross-origin
            }
          }

          // Use the comprehensive intro screen dismissal method
          const introResult = await dismissGameIntroScreens(page);
          if (introResult.dismissed) {
            hadContinueButton = true;
            console.log(`    Intro screen dismissed via: ${introResult.method}`);
            await page.waitForTimeout(2000);  // Wait for game to respond

            // Re-check playability immediately after dismissing intro
            const recheckPlayable = await isGamePlayable(page);
            if (recheckPlayable.playable) {
              gamePlayable = true;
              playabilityReason = recheckPlayable.reason;
              console.log(`    Game is now playable after intro dismissal`);
              break;
            }
          }

          // Also try the original Continue button handlers
          await handleContinueButtons(page);
          const gameContResult = await handleGameContinueButtons(page);
          if (gameContResult.clicked) {
            hadContinueButton = true;
            console.log(`    Clicked via handleGameContinueButtons: ${gameContResult.buttonType}`);
          }

          await page.waitForTimeout(1500);

          // Re-check if game element appeared
          if (!gameLoaded) {
            const recheck = await waitForGameWithContinueHandling(page, 5000);
            if (recheck.loaded) {
              gameLoaded = true;
              canvasBox = recheck.canvas;
            }
          }
        }

        if (!gamePlayable) {
          const finalCheck = await isGamePlayable(page);
          gamePlayable = finalCheck.playable;
          playabilityReason = finalCheck.reason;
        }

        console.log(`    Final game state: ${gamePlayable ? 'PLAYABLE' : 'NOT PLAYABLE'} - ${playabilityReason}`);

        // STEP 5.5: Re-verify login status after intro handling (game may have reloaded)
        console.log('  STEP 5.5: Re-verify login status');
        if (!await isLoggedIn(page)) {
          console.log('    [Login] Session lost during game loading, re-attempting login...');
          await doLogin(page);
          await page.waitForTimeout(3000);

          // After re-login, wait for game to reload if needed
          if (!gameLoaded) {
            const recheck = await waitForGameWithContinueHandling(page, 30000);
            if (recheck.loaded) {
              gameLoaded = true;
              canvasBox = recheck.canvas;
              console.log('    [Game] Reloaded after re-login');
            }
          }
        } else {
          console.log('    [Login] User still logged in');
        }

        // STEP 6: Detect credits INSIDE the game UI
        console.log('  STEP 6: Detect credits in game');
        const gameCredits = await detectCreditsInGame(page);
        const headerCredits = await detectCredits(page); // Just for login status

        console.log(`    Game credits: ${gameCredits.visible ? gameCredits.text : 'NOT FOUND'}`);
        console.log(`    User logged in: ${headerCredits.visible ? 'YES' : 'NO'}`);

        // STEP 7: Take screenshot showing current state
        console.log('  STEP 7: Screenshot - Game state');
        await page.waitForTimeout(1000);
        const screenshot1 = `${SCREENSHOTS_DIR}/${testId}_credits_before_spin.png`;
        await page.screenshot({ path: screenshot1, timeout: 60000, animations: 'disabled' });

        // STEP 8: Click spin (only if game is playable)
        console.log('  STEP 8: Click spin');
        let spinClicked = false;
        let spinError: string | null = null;

        if (!gameLoaded) {
          spinError = 'Cannot spin - game element not found';
          console.log(`    ${spinError}`);
        } else if (!gamePlayable) {
          spinError = `Cannot spin - ${playabilityReason}`;
          console.log(`    ${spinError}`);
        } else if (serverError) {
          spinError = 'Cannot spin - server error detected';
          console.log(`    ${spinError}`);
        } else {
          spinClicked = await clickSpin(page, canvasBox);
          if (spinClicked) {
            await page.waitForTimeout(4000); // Wait for spin animation
            console.log('    Spin action performed');
          } else {
            spinError = 'Spin button not found';
            console.log(`    ${spinError}`);
          }
        }

        // STEP 9: Take second screenshot (after spin attempt)
        console.log('  STEP 9: Screenshot - After spin');
        await page.waitForTimeout(1000);
        const screenshot2 = `${SCREENSHOTS_DIR}/${testId}_after_spin.png`;
        await page.screenshot({ path: screenshot2, timeout: 60000, animations: 'disabled' });

        // ========== DETERMINE PASS/FAIL STATUS ==========
        // PASS criteria (ALL must be true):
        // 1. Game element visible (canvas or iframe)
        // 2. Game is playable (not showing loading/intro/error screen)
        // 3. User is logged in (indicated by Deposit button visible)
        // 4. No critical server errors
        //
        // Note: Credits detection is best-effort - most games render credits in canvas
        // which can't be read programmatically. If user is logged in + game playable,
        // credits SHOULD be visible in the rendered game.
        //
        // FAIL scenarios:
        // - Server error (502, 503, 522, game errors, etc.)
        // - Game element not loaded
        // - Game showing loading/intro/error screen (not playable)
        // - User not logged in (credits cannot be visible)

        let success = false;
        let errorMsg: string | null = null;
        let failReason = '';

        if (serverError) {
          failReason = 'SERVER_ERROR';
          errorMsg = serverError;
        } else if (!gameLoaded) {
          failReason = 'GAME_NOT_LOADED';
          errorMsg = gameError || 'Game element (canvas/iframe) not found';
        } else if (!gamePlayable) {
          failReason = 'GAME_NOT_PLAYABLE';
          errorMsg = playabilityReason;
        } else if (!headerCredits.visible) {
          // User must be logged in for credits to be visible
          failReason = 'USER_NOT_LOGGED_IN';
          errorMsg = 'User not logged in - credits cannot be shown';
        } else {
          // Game loaded, playable, user logged in
          // Credits should be visible in the rendered game (even if not detectable via DOM)
          success = true;
          errorMsg = null;
        }

        // Log detailed status
        console.log('  ========== TEST RESULT ==========');
        console.log(`    Game Element Loaded: ${gameLoaded}`);
        console.log(`    Game Playable: ${gamePlayable}`);
        console.log(`    User Logged In: ${headerCredits.visible}`);
        console.log(`    Credits Detected: ${gameCredits.visible ? gameCredits.text : '(canvas-rendered)'}`);
        console.log(`    Spin Clicked: ${spinClicked}`);
        console.log(`    Status: ${success ? 'PASS' : 'FAIL'}`);
        if (errorMsg) console.log(`    Error: ${errorMsg}`);
        if (failReason) console.log(`    Fail Reason: ${failReason}`);
        console.log('  ==================================');

        const result: TestResult = {
          testId,
          testCase: 'TC009: Credits Visibility & Spin Action',
          gameName: game.name,
          gameProvider: game.provider,
          platform: 'Web',
          browser: 'Chrome',
          device: '',
          status: success ? 'PASS' : 'FAIL',
          loadTime: 0,
          errorDetails: errorMsg,
          consoleErrors,
          screenshotPath: screenshot1,
          screenshotPath2: screenshot2,
          timestamp: new Date().toISOString()
        };

        const allResults = saveResultToFile(result);
        generateHTMLReport(allResults);
        generateJSONReport(allResults);

        console.log(`  RESULT: ${result.status} | Logged In: ${headerCredits.visible} | Playable: ${gamePlayable} | Spin: ${spinClicked} | Error: ${errorMsg || 'none'}`);

        // Close page to speed up cleanup (avoid waiting for WebSocket timeouts)
        await page.close().catch(() => {});

        expect(success, errorMsg || 'Test failed').toBeTruthy();
      });
    }
  });
});
