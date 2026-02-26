import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Betway All Games Validation Test Suite
 *
 * This script:
 * 1. Navigates to Betway and discovers all available games
 * 2. For each game: clicks Play, handles Continue buttons, validates launch
 * 3. Captures screenshots for success/error states
 * 4. Generates a comprehensive test report
 */

// Test report data structure
interface GameTestResult {
  gameName: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  screenshotPath: string;
  errorDetails: string | null;
  launchTime: number;
  timestamp: string;
}

// Global report array
const testResults: GameTestResult[] = [];
const REPORTS_DIR = 'reports/all-games-validation';
const SCREENSHOTS_DIR = `${REPORTS_DIR}/screenshots`;

// Ensure reports are generated even on process exit/crash
function saveReportsOnExit() {
  if (testResults.length > 0) {
    try {
      generateHTMLReport(testResults);
      generateJSONReport(testResults);
      console.log('\n📄 Reports saved on exit!');
    } catch (e) {
      console.error('Error saving reports:', e);
    }
  }
}

// Register exit handlers
process.on('SIGINT', () => {
  console.log('\n\n⚠️ Test interrupted! Saving partial results...');
  saveReportsOnExit();
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️ Test terminated! Saving partial results...');
  saveReportsOnExit();
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('\n\n❌ Uncaught exception:', error.message);
  saveReportsOnExit();
  process.exit(1);
});

test.describe('Betway All Games Validation', () => {

  test.beforeAll(async () => {
    // Create directories for reports and screenshots
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    console.log('📁 Report directories created');
  });

  test.afterAll(async () => {
    // Generate final HTML report
    generateHTMLReport(testResults);
    generateJSONReport(testResults);
    console.log('\n📊 Test execution complete!');
    console.log(`📄 HTML Report: ${REPORTS_DIR}/test-report.html`);
    console.log(`📄 JSON Report: ${REPORTS_DIR}/test-report.json`);
  });

  test('Discover and validate all games on Betway', async ({ page }) => {
    // Set longer timeout for this comprehensive test
    test.setTimeout(1800000); // 30 minutes

    // Step 1: Navigate to Betway and login
    console.log('\n🌐 Step 1: Navigating to Betway...');
    await page.goto('https://www.betway.co.za');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Step 2: Login
    console.log('\n🔐 Step 2: Logging in...');
    const loginSuccess = await performLogin(page);

    // Step 2.1: VERIFY login was successful
    console.log('\n🔍 Step 2.1: Verifying login status...');
    await page.waitForTimeout(3000);

    let isLoggedIn = await isUserLoggedIn(page);
    if (!isLoggedIn) {
      console.log('⚠️ First login attempt may have failed, retrying...');

      // Retry login
      await page.goto('https://www.betway.co.za');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      await performLogin(page);
      await page.waitForTimeout(5000);

      isLoggedIn = await isUserLoggedIn(page);
    }

    if (isLoggedIn) {
      console.log('✅ LOGIN VERIFIED - User is logged in');
    } else {
      console.log('⚠️ Login status could not be verified - proceeding anyway');
    }

    // Step 3: Navigate to Casino Games / Slots
    console.log('\n🎰 Step 3: Navigating to Casino Games...');
    await page.goto('https://www.betway.co.za/lobby/casino-games/slots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);

    // Step 3.1: Re-verify login after navigation
    console.log('  Re-verifying login after navigation...');
    isLoggedIn = await isUserLoggedIn(page);
    if (!isLoggedIn) {
      console.log('  ⚠️ User may have been logged out, attempting re-login...');
      await performLogin(page);
      await page.waitForTimeout(5000);
    }

    // Step 4: Discover all games
    console.log('\n🔍 Step 4: Discovering all games...');
    const games = await discoverAllGames(page);
    console.log(`Found ${games.length} games to test`);

    // Step 5: Test each game
    console.log('\n🎮 Step 5: Testing each game...');
    try {
      for (let i = 0; i < games.length; i++) {
        const game = games[i];
        console.log(`\n[${i + 1}/${games.length}] Testing: ${game.name}`);

        try {
          const result = await testGameLaunch(page, game, i);
          testResults.push(result);

          // Log result
          const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
          console.log(`${statusIcon} ${game.name}: ${result.status}`);
          if (result.errorDetails) {
            console.log(`   Error: ${result.errorDetails}`);
          }

          // Save intermediate report every 5 games (in case of crash)
          if ((i + 1) % 5 === 0) {
            generateHTMLReport(testResults);
            generateJSONReport(testResults);
            console.log(`   📄 Intermediate report saved (${i + 1} games tested)`);
          }
        } catch (gameError: any) {
          console.error(`   ❌ Error testing ${game.name}: ${gameError.message}`);
          testResults.push({
            gameName: game.name,
            status: 'FAIL',
            screenshotPath: '',
            errorDetails: `Test error: ${gameError.message}`,
            launchTime: 0,
            timestamp: new Date().toISOString()
          });
        }

        // Small delay between games to avoid rate limiting
        await page.waitForTimeout(2000);
      }
    } catch (loopError: any) {
      console.error(`\n❌ Test loop error: ${loopError.message}`);
      console.log('Saving partial results...');
      generateHTMLReport(testResults);
      generateJSONReport(testResults);
      throw loopError; // Re-throw to fail the test
    }

    // Summary
    const passed = testResults.filter(r => r.status === 'PASS').length;
    const failed = testResults.filter(r => r.status === 'FAIL').length;
    const skipped = testResults.filter(r => r.status === 'SKIP').length;

    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Games: ${testResults.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️ Skipped: ${skipped}`);
    console.log(`Pass Rate: ${((passed / testResults.length) * 100).toFixed(1)}%`);

    // Generate reports immediately after test completes (backup in case afterAll doesn't run)
    generateHTMLReport(testResults);
    generateJSONReport(testResults);
    console.log('\n📄 Reports generated successfully!');
    console.log(`📄 HTML: ${path.resolve(REPORTS_DIR, 'test-report.html')}`);
    console.log(`📄 JSON: ${path.resolve(REPORTS_DIR, 'test-report.json')}`);
  });

});

/**
 * Check if user is logged in by looking for user indicators
 */
async function isUserLoggedIn(page: any): Promise<boolean> {
  const loggedInIndicators = [
    // User account/profile indicators
    '[data-testid="user-balance"]',
    '[class*="user-balance"]',
    '[class*="account-balance"]',
    '[class*="wallet-balance"]',
    '.user-info',
    '.account-info',
    '.user-name',
    '.username-display',
    // Balance/wallet indicators (only visible when logged in)
    'text=/R\\s*[\\d,]+\\.\\d{2}/',  // South African Rand format
    'text=/wallet/i',
    // Deposit button (only shows when logged in)
    'button:has-text("Deposit")',
    'a:has-text("Deposit")',
    // My Account link
    'a:has-text("My Account")',
    'button:has-text("My Account")',
    // Logout button (definitive proof of being logged in)
    'button:has-text("Logout")',
    'a:has-text("Logout")',
    '#logout-btn',
  ];

  for (const selector of loggedInIndicators) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`  ✓ User is logged in (found: ${selector})`);
        return true;
      }
    } catch {
      // Continue checking
    }
  }

  // Also check if login button is NOT visible (means user is logged in)
  const loginBtn = page.locator('#login-btn');
  const loginBtnVisible = await loginBtn.isVisible({ timeout: 1000 }).catch(() => false);
  if (!loginBtnVisible) {
    // Login button not visible, check if we're on the site properly
    const isOnBetway = page.url().includes('betway');
    if (isOnBetway) {
      console.log('  ✓ Login button not visible - user likely logged in');
      return true;
    }
  }

  return false;
}

/**
 * Perform login to Betway
 */
async function performLogin(page: any): Promise<boolean> {
  try {
    // First check if already logged in
    console.log('  Checking login status...');
    if (await isUserLoggedIn(page)) {
      console.log('  ✓ Already logged in!');
      return true;
    }

    // Look for login button
    const loginBtn = page.locator('#login-btn');
    if (!await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  Login button not found, checking if logged in...');
      return await isUserLoggedIn(page);
    }

    // Step 1: Click login button to reveal the form
    console.log('  Step 1: Clicking login button to reveal form...');
    await loginBtn.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(2000);

    // Step 2: Wait for and fill the login form
    console.log('  Step 2: Filling login credentials...');
    const usernameInput = page.locator('#header-username');
    const passwordInput = page.locator('#header-password');

    // Wait for form to be visible
    if (!await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  ⚠️ Username input not visible after clicking login');
      // Try alternative form selectors
      const altUsername = page.locator('input[placeholder*="Mobile" i], input[type="tel"], input[name="username"]').first();
      const altPassword = page.locator('input[type="password"]').first();

      if (await altUsername.isVisible({ timeout: 3000 }).catch(() => false)) {
        await altUsername.fill(process.env.BETWAY_USERNAME || '222212222');
        await altPassword.fill(process.env.BETWAY_PASSWORD || '1234567890');
      } else {
        console.log('  ❌ Could not find login form');
        return false;
      }
    } else {
      // Fill the header login form
      await usernameInput.clear();
      await usernameInput.fill(process.env.BETWAY_USERNAME || '222212222');
      await page.waitForTimeout(500);

      await passwordInput.clear();
      await passwordInput.fill(process.env.BETWAY_PASSWORD || '1234567890');
      await page.waitForTimeout(500);
    }

    // Step 3: Click the login button to SUBMIT the form
    console.log('  Step 3: Clicking login button to submit...');

    // The login button should now be a submit button - use JavaScript click
    await loginBtn.evaluate((el: HTMLElement) => el.click());

    // Wait for login to process
    console.log('  Step 4: Waiting for login to complete...');
    await page.waitForTimeout(3000);

    // Step 5: Verify login was successful - wait up to 15 seconds
    console.log('  Step 5: Verifying login success...');
    for (let i = 0; i < 5; i++) {
      if (await isUserLoggedIn(page)) {
        console.log('  ✅ Login successful!');
        return true;
      }
      await page.waitForTimeout(3000);
      console.log(`    Waiting for login... (attempt ${i + 1}/5)`);
    }

    // Check if login failed (login button still visible)
    if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  ❌ Login may have failed - login button still visible');

      // Try clicking login again in case form wasn't submitted
      console.log('  Retrying login submission...');
      await loginBtn.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(5000);

      if (await isUserLoggedIn(page)) {
        console.log('  ✅ Login successful on retry!');
        return true;
      }
    }

    console.log('  ⚠️ Login status uncertain');
    return false;
  } catch (error) {
    console.log('  ❌ Login error:', error);
    return false;
  }
}

/**
 * Discover all games on the current page
 */
async function discoverAllGames(page: any): Promise<Array<{name: string, element: any}>> {
  const games: Array<{name: string, element: any}> = [];
  const seenNames = new Set<string>();

  try {
    // Scroll to load more games (infinite scroll handling)
    console.log('Scrolling to load all games...');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Method 1: Extract game names from game links (href contains game slug)
    const gameLinks = await page.locator('a[href*="/lobby/casino-games/game/"]').all();
    console.log(`Found ${gameLinks.length} game links`);

    for (const link of gameLinks) {
      try {
        const href = await link.getAttribute('href');
        if (href) {
          // Extract game name from URL: /lobby/casino-games/game/hot-hot-betway -> Hot Hot Betway
          const match = href.match(/\/game\/([^\/\?]+)/);
          if (match) {
            const slug = match[1];
            // Convert slug to title case: hot-hot-betway -> Hot Hot Betway
            const gameName = slug
              .split('-')
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');

            if (gameName && !seenNames.has(gameName.toLowerCase())) {
              seenNames.add(gameName.toLowerCase());
              games.push({ name: gameName, element: link });
            }
          }
        }
      } catch {
        // Skip problematic elements
      }
    }

    // Method 2: If no games found via links, try images with alt text
    if (games.length === 0) {
      const gameImages = await page.locator('img[alt]:not([alt=""])').all();
      console.log(`Trying ${gameImages.length} images with alt text`);

      for (const img of gameImages) {
        try {
          const alt = await img.getAttribute('alt');
          if (alt && alt.length > 2 && alt.length < 60) {
            const gameName = alt.trim();
            if (!seenNames.has(gameName.toLowerCase()) &&
                !gameName.toLowerCase().includes('logo') &&
                !gameName.toLowerCase().includes('banner')) {
              seenNames.add(gameName.toLowerCase());
              games.push({ name: gameName, element: img });
            }
          }
        } catch {
          // Skip problematic elements
        }
      }
    }

    console.log(`Discovered ${games.length} unique games`);

    // Limit to first 20 games for reasonable test time (adjust as needed)
    const maxGames = 20;
    return games.slice(0, maxGames);

  } catch (error) {
    console.log('Error discovering games:', error);
    return games;
  }
}

/**
 * Test a single game launch
 */
async function testGameLaunch(
  page: any,
  game: {name: string, element: any},
  index: number
): Promise<GameTestResult> {
  const startTime = Date.now();
  const safeGameName = game.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const screenshotName = `${String(index + 1).padStart(3, '0')}_${safeGameName}`;

  let result: GameTestResult = {
    gameName: game.name,
    status: 'FAIL',
    screenshotPath: '',
    errorDetails: null,
    launchTime: 0,
    timestamp: new Date().toISOString()
  };

  try {
    // Navigate back to slots page
    await page.goto('https://www.betway.co.za/lobby/casino-games/slots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Method 1: Try to get game URL from the element and navigate directly
    let gameUrl = '';
    try {
      gameUrl = await game.element.getAttribute('href');
    } catch {
      // Element might not have href
    }

    if (gameUrl && gameUrl.includes('/game/')) {
      // Navigate directly to game URL
      const fullUrl = gameUrl.startsWith('http') ? gameUrl : `https://www.betway.co.za${gameUrl}`;
      console.log(`  Navigating to: ${fullUrl}`);
      await page.goto(fullUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
    } else {
      // Method 2: Search for the game
      const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"], .search-input').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.click();
        await searchInput.clear();
        await searchInput.fill(game.name);
        await page.waitForTimeout(2000);

        // Find and click on the game
        const gameImage = page.locator(`img[alt*="${game.name}" i]`).first();

        if (!await gameImage.isVisible({ timeout: 5000 }).catch(() => false)) {
          result.status = 'SKIP';
          result.errorDetails = 'Game not found in search results';
          result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_skip.png`;
          await page.screenshot({ path: result.screenshotPath });
          return result;
        }

        // Hover and click Play button
        const box = await gameImage.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);
        }

        // Try to click Play button
        const playButton = page.locator('button[aria-label="Play"], button:has-text("Play")').first();
        if (await playButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await playButton.evaluate((el: HTMLElement) => el.click());
        } else {
          // Click on game image directly
          await gameImage.click({ force: true });
        }
      }
    }

    await page.waitForTimeout(3000);

    // STEP A: Handle login popup if it appears (BEFORE anything else)
    console.log('  Checking for login popup...');
    const loginPopupHandled = await handleLoginPopup(page);

    // STEP B: Verify user is logged in BEFORE proceeding
    console.log('  Verifying user is logged in...');
    let isLoggedIn = await isUserLoggedIn(page);

    if (!isLoggedIn) {
      console.log('  ⚠️ User not logged in, attempting login...');

      // Try to perform login from the game page
      await performLogin(page);

      // Wait and re-check
      await page.waitForTimeout(5000);
      isLoggedIn = await isUserLoggedIn(page);

      if (!isLoggedIn) {
        // Take screenshot showing login issue
        result.status = 'FAIL';
        result.errorDetails = 'LOGIN NOT COMPLETED - User not logged in before game validation';
        result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_login_failed.png`;
        await page.screenshot({ path: result.screenshotPath, fullPage: true });
        result.launchTime = Date.now() - startTime;
        console.log('  ❌ Login verification failed!');
        return result;
      }
    }

    console.log('  ✅ User logged in - proceeding with game validation');

    // STEP C: Handle Continue/Play & Continue buttons
    await handleContinueButtons(page);

    // Wait for game to load
    await page.waitForTimeout(5000);

    // Handle Continue buttons again (some games show them after initial load)
    await handleContinueButtons(page);

    // Wait more for game assets and UI to fully render
    await page.waitForTimeout(5000);

    // STEP D: Check for error states
    const errorCheck = await checkForErrors(page);
    if (errorCheck.hasError) {
      result.status = 'FAIL';
      result.errorDetails = errorCheck.errorMessage;
      result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_error.png`;
      await page.screenshot({ path: result.screenshotPath, fullPage: true });
      result.launchTime = Date.now() - startTime;
      return result;
    }

    // Final check for error popups that may have appeared
    const finalErrorCheck = await checkForErrors(page);
    if (finalErrorCheck.hasError) {
      result.status = 'FAIL';
      result.errorDetails = finalErrorCheck.errorMessage;
      result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_error.png`;
      await page.screenshot({ path: result.screenshotPath, fullPage: true });
      result.launchTime = Date.now() - startTime;
      return result;
    }

    // STEP E: Validate game loaded successfully - STRICT CHECK FOR CREDITS/BALANCE
    console.log('  Validating game loaded with credits visible...');
    const gameLoaded = await validateGameLoaded(page);

    if (gameLoaded.success) {
      result.status = 'PASS';
      result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_success.png`;
      await page.screenshot({ path: result.screenshotPath });
    } else {
      result.status = 'FAIL';
      result.errorDetails = gameLoaded.reason;
      result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_fail.png`;
      await page.screenshot({ path: result.screenshotPath, fullPage: true });
    }

    result.launchTime = Date.now() - startTime;

  } catch (error: any) {
    result.status = 'FAIL';
    result.errorDetails = error.message || 'Unknown error during game launch';
    result.screenshotPath = `${SCREENSHOTS_DIR}/${screenshotName}_exception.png`;

    try {
      await page.screenshot({ path: result.screenshotPath, fullPage: true });
    } catch {
      // Ignore screenshot errors
    }

    result.launchTime = Date.now() - startTime;
  }

  // Navigate back to slots for next game
  try {
    await page.goto('https://www.betway.co.za/lobby/casino-games/slots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  } catch {
    // Ignore navigation errors
  }

  return result;
}

/**
 * Handle Continue/Play & Continue/I Accept buttons
 */
async function handleContinueButtons(page: any): Promise<void> {
  const buttonSelectors = [
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    'button:has-text("Play & Continue")',
    'button:has-text("I Accept")',
    'button:has-text("I ACCEPT")',
    'button:has-text("Accept")',
    'button:has-text("OK")',
    'button:has-text("Start")',
    'button:has-text("START")',
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    for (const selector of buttonSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
          await button.click({ force: true }).catch(() => {});
          console.log(`  Clicked: ${selector}`);
          await page.waitForTimeout(2000);
        }
      } catch {
        // Continue to next selector
      }
    }

    // Also try clicking on canvas center (for canvas-rendered buttons)
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible({ timeout: 1000 }).catch(() => false)) {
      const box = await canvas.boundingBox();
      if (box) {
        // Click center-bottom where Continue buttons usually appear
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
        await page.waitForTimeout(1000);
      }
    }
  }
}

/**
 * Handle login popup that may appear when clicking on games
 */
async function handleLoginPopup(page: any): Promise<boolean> {
  try {
    // Check for any login popup/modal
    const passwordInput = page.locator('input[type="password"]').first();

    if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  🔐 Login popup detected!');

      // Step 1: Fill mobile/username
      console.log('    Filling username...');
      const usernameSelectors = [
        'input[placeholder*="Mobile" i]',
        'input[type="tel"]',
        'input[name="username"]',
        'input[name="mobile"]',
        'input[placeholder*="Phone" i]',
        'input[id*="username" i]',
        'input[id*="mobile" i]',
      ];

      let usernameFilled = false;
      for (const selector of usernameSelectors) {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
          await input.clear();
          await input.fill(process.env.BETWAY_USERNAME || '222212222');
          usernameFilled = true;
          console.log(`    ✓ Username filled using: ${selector}`);
          break;
        }
      }

      if (!usernameFilled) {
        console.log('    ⚠️ Could not find username input');
      }

      // Step 2: Fill password
      console.log('    Filling password...');
      await passwordInput.clear();
      await passwordInput.fill(process.env.BETWAY_PASSWORD || '1234567890');
      console.log('    ✓ Password filled');

      await page.waitForTimeout(1000);

      // Step 3: Click login button using JavaScript
      console.log('    Clicking login button...');
      const loginBtnSelectors = [
        'button:has-text("Login")',
        'button:has-text("LOG IN")',
        'button:has-text("Sign In")',
        'button[type="submit"]',
        'input[type="submit"]',
        '.login-btn',
        '#login-submit',
      ];

      let loginClicked = false;
      for (const selector of loginBtnSelectors) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.evaluate((el: HTMLElement) => el.click());
          loginClicked = true;
          console.log(`    ✓ Login button clicked: ${selector}`);
          break;
        }
      }

      if (!loginClicked) {
        // Try pressing Enter as fallback
        console.log('    Trying Enter key as fallback...');
        await passwordInput.press('Enter');
      }

      // Step 4: Wait for login to complete
      console.log('    Waiting for login to complete...');
      await page.waitForTimeout(5000);

      // Step 5: Verify login by checking if popup closed and user is logged in
      const popupStillVisible = await passwordInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!popupStillVisible) {
        console.log('    ✓ Login popup closed');

        // Verify user is logged in
        if (await isUserLoggedIn(page)) {
          console.log('  ✅ Login via popup successful!');
          return true;
        }
      } else {
        console.log('    ⚠️ Login popup still visible - login may have failed');
        // Try clicking login again
        for (const selector of loginBtnSelectors) {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.evaluate((el: HTMLElement) => el.click());
            await page.waitForTimeout(5000);
            break;
          }
        }
      }

      return await isUserLoggedIn(page);
    }

    return true; // No popup, continue
  } catch (error) {
    // Ignore login popup errors
  }
}

/**
 * Check for error states on the page
 */
async function checkForErrors(page: any): Promise<{hasError: boolean, errorMessage: string}> {
  const errorIndicators = [
    // Generic error messages
    { selector: 'text=/error/i', message: 'Error message detected' },
    { selector: 'text=/failed to load/i', message: 'Failed to load message' },
    { selector: 'text=/something went wrong/i', message: 'Something went wrong message' },
    { selector: 'text=/not available/i', message: 'Game not available' },
    { selector: 'text=/server.*not.*found/i', message: 'Server not found (DNS error)' },
    { selector: 'text=/connection.*refused/i', message: 'Connection refused' },
    { selector: 'text=/timeout/i', message: 'Timeout error' },
    { selector: 'text=/unable to load/i', message: 'Unable to load message' },
    { selector: 'text=/game.*unavailable/i', message: 'Game unavailable' },
    { selector: 'text=/session.*expired/i', message: 'Session expired' },
    { selector: 'text=/try again/i', message: 'Try again message (possible error)' },
    { selector: 'text=/oops/i', message: 'Oops error message' },
    { selector: 'text=/cannot.*connect/i', message: 'Cannot connect error' },
    { selector: 'text=/network.*error/i', message: 'Network error' },
    { selector: 'text=/loading.*failed/i', message: 'Loading failed' },
    { selector: 'text=/game.*error/i', message: 'Game error' },
    { selector: 'text=/technical.*difficulty/i', message: 'Technical difficulty' },
    { selector: 'text=/maintenance/i', message: 'Under maintenance' },
    // Error popup/modal selectors
    { selector: '.error-message', message: 'Error message element found' },
    { selector: '[class*="error-popup"]', message: 'Error popup found' },
    { selector: '[class*="error-modal"]', message: 'Error modal found' },
    { selector: '[class*="error-dialog"]', message: 'Error dialog found' },
    { selector: '.modal:has-text("error")', message: 'Modal with error text' },
    { selector: '.popup:has-text("error")', message: 'Popup with error text' },
    { selector: '[role="alertdialog"]', message: 'Alert dialog found' },
    { selector: '[role="alert"]', message: 'Alert element found' },
  ];

  for (const indicator of errorIndicators) {
    try {
      const element = page.locator(indicator.selector).first();
      if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
        const text = await element.textContent().catch(() => '');
        // Skip if it's just a minor text like "Bet" containing "bet"
        if (text.length > 5 || indicator.selector.includes('class') || indicator.selector.includes('role')) {
          return {
            hasError: true,
            errorMessage: `${indicator.message}: ${text.substring(0, 100)}`
          };
        }
      }
    } catch {
      // Continue checking
    }
  }

  // Check for blank/white screen
  const bodyBg = await page.evaluate(() => {
    const body = document.body;
    const style = window.getComputedStyle(body);
    return style.backgroundColor;
  }).catch(() => '');

  // Check if page is mostly blank
  const contentLength = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
  if (contentLength < 50) {
    // Might be a canvas game, check for canvas
    const hasCanvas = await page.locator('canvas').isVisible({ timeout: 1000 }).catch(() => false);
    const hasIframe = await page.locator('iframe').isVisible({ timeout: 1000 }).catch(() => false);

    if (!hasCanvas && !hasIframe) {
      return { hasError: true, errorMessage: 'Blank screen - no game content detected' };
    }
  }

  return { hasError: false, errorMessage: '' };
}

/**
 * Validate that the game has loaded successfully
 * STRICT VALIDATION: Game must show credits/balance to pass
 */
async function validateGameLoaded(page: any): Promise<{success: boolean, reason: string}> {
  // First, check if game container exists (canvas or iframe)
  const hasCanvas = await page.locator('canvas').isVisible({ timeout: 5000 }).catch(() => false);
  const hasIframe = await page.locator('iframe').isVisible({ timeout: 3000 }).catch(() => false);

  if (!hasCanvas && !hasIframe) {
    return { success: false, reason: 'No game container found (no canvas or iframe)' };
  }

  // Wait additional time for game assets to load
  await page.waitForTimeout(5000);

  // REQUIRED: Check for credits/balance display
  // This is the STRICT validation - game must show credits to pass
  const creditsIndicators = [
    // Text-based selectors for credits/balance
    { selector: 'text=/balance[:\\s]*R?\\s*[\\d,.]+/i', name: 'Balance with amount' },
    { selector: 'text=/credit[s]?[:\\s]*[\\d,.]+/i', name: 'Credits with amount' },
    { selector: 'text=/R\\s*[\\d,]+\\.\\d{2}/i', name: 'South African Rand amount' },
    { selector: 'text=/\\$\\s*[\\d,]+\\.\\d{2}/i', name: 'Dollar amount' },
    { selector: 'text=/€\\s*[\\d,]+\\.\\d{2}/i', name: 'Euro amount' },
    { selector: 'text=/balance/i', name: 'Balance text' },
    { selector: 'text=/credit/i', name: 'Credits text' },
    { selector: 'text=/coins/i', name: 'Coins text' },
    { selector: 'text=/cash/i', name: 'Cash text' },
    { selector: 'text=/wallet/i', name: 'Wallet text' },
    // Class-based selectors
    { selector: '[class*="balance"]', name: 'Balance class element' },
    { selector: '[class*="credit"]', name: 'Credit class element' },
    { selector: '[class*="coin"]', name: 'Coin class element' },
    { selector: '[class*="wallet"]', name: 'Wallet class element' },
    { selector: '[class*="money"]', name: 'Money class element' },
    { selector: '[class*="amount"]', name: 'Amount class element' },
    // Data attribute selectors
    { selector: '[data-testid*="balance"]', name: 'Balance test ID' },
    { selector: '[data-testid*="credit"]', name: 'Credit test ID' },
  ];

  let creditsFound = false;
  let foundIndicator = '';

  for (const indicator of creditsIndicators) {
    try {
      const element = page.locator(indicator.selector).first();
      if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
        creditsFound = true;
        foundIndicator = indicator.name;
        break;
      }
    } catch {
      // Continue checking
    }
  }

  // For iframe games, check inside the iframe for credits
  if (!creditsFound && hasIframe) {
    try {
      const iframes = await page.locator('iframe').all();
      for (const iframe of iframes) {
        try {
          const frame = await iframe.contentFrame();
          if (frame) {
            // Check for credits inside iframe
            for (const indicator of creditsIndicators.slice(0, 10)) { // Check first 10 indicators
              try {
                const element = frame.locator(indicator.selector).first();
                if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
                  creditsFound = true;
                  foundIndicator = `${indicator.name} (in iframe)`;
                  break;
                }
              } catch {
                // Continue
              }
            }
            if (creditsFound) break;
          }
        } catch {
          // Iframe access error, continue
        }
      }
    } catch {
      // Iframe error
    }
  }

  // For canvas games, we can't check text inside canvas
  // But we can verify the canvas is rendering (not blank)
  if (!creditsFound && hasCanvas) {
    try {
      const canvas = page.locator('canvas').first();
      const box = await canvas.boundingBox();

      if (box && box.width > 100 && box.height > 100) {
        // Canvas exists with reasonable size
        // Check if there's any UI overlay with credits near the canvas
        const pageContent = await page.content();
        const hasCreditsInPage = /balance|credit|coin|R\s*[\d,]+\.\d{2}|\$\s*[\d,]+\.\d{2}/i.test(pageContent);

        if (hasCreditsInPage) {
          creditsFound = true;
          foundIndicator = 'Credits found in page HTML (canvas game)';
        } else {
          // For pure canvas games, check if canvas is actually rendering (not blank)
          // Take a small sample of the canvas to verify it's not all one color
          const isRendering = await page.evaluate(() => {
            const canvas = document.querySelector('canvas') as HTMLCanvasElement;
            if (!canvas) return false;

            try {
              const ctx = canvas.getContext('2d');
              if (!ctx) return true; // Assume rendering if we can't access context (WebGL)

              const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
              const data = imageData.data;

              // Check if all pixels are the same color (blank canvas)
              const firstR = data[0], firstG = data[1], firstB = data[2];
              let hasVariation = false;

              for (let i = 4; i < Math.min(data.length, 1000); i += 4) {
                if (Math.abs(data[i] - firstR) > 10 ||
                    Math.abs(data[i + 1] - firstG) > 10 ||
                    Math.abs(data[i + 2] - firstB) > 10) {
                  hasVariation = true;
                  break;
                }
              }

              return hasVariation;
            } catch {
              return true; // Assume rendering if we can't access (WebGL games)
            }
          }).catch(() => true);

          if (isRendering) {
            // Canvas is rendering something, but no credits visible
            // This might be a loading screen or the game doesn't show credits overlay
            // We'll mark this as a potential issue but give benefit of doubt for now
            return {
              success: false,
              reason: 'Canvas game loaded but NO CREDITS/BALANCE visible on screen'
            };
          }
        }
      }
    } catch {
      // Canvas check error
    }
  }

  if (creditsFound) {
    return { success: true, reason: `Game loaded successfully - ${foundIndicator}` };
  }

  return { success: false, reason: 'NO CREDITS/BALANCE VISIBLE - game may not have loaded properly' };
}

/**
 * Generate HTML test report
 */
function generateHTMLReport(results: GameTestResult[]): void {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const passRate = results.length > 0 ? ((passed / results.length) * 100).toFixed(1) : '0';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Betway Games Validation Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1a1a2e; color: #fff; padding: 20px; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { text-align: center; color: #00d4aa; margin-bottom: 30px; }
    .summary { display: flex; justify-content: center; gap: 30px; margin-bottom: 40px; flex-wrap: wrap; }
    .summary-card { background: #16213e; padding: 20px 40px; border-radius: 10px; text-align: center; }
    .summary-card h2 { font-size: 36px; margin-bottom: 5px; }
    .summary-card p { color: #888; }
    .pass { color: #00d4aa; }
    .fail { color: #ff6b6b; }
    .skip { color: #feca57; }
    .results-table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 10px; overflow: hidden; }
    .results-table th { background: #0f3460; padding: 15px; text-align: left; }
    .results-table td { padding: 12px 15px; border-bottom: 1px solid #0f3460; }
    .results-table tr:hover { background: #1f4068; }
    .status-badge { padding: 5px 15px; border-radius: 20px; font-weight: bold; font-size: 12px; }
    .status-pass { background: #00d4aa; color: #000; }
    .status-fail { background: #ff6b6b; color: #000; }
    .status-skip { background: #feca57; color: #000; }
    .screenshot-link { color: #00d4aa; text-decoration: none; }
    .screenshot-link:hover { text-decoration: underline; }
    .error-details { color: #ff6b6b; font-size: 12px; max-width: 300px; }
    .timestamp { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
    .filter-buttons { text-align: center; margin-bottom: 20px; }
    .filter-btn { background: #0f3460; border: none; color: #fff; padding: 10px 20px; margin: 5px; border-radius: 5px; cursor: pointer; }
    .filter-btn:hover, .filter-btn.active { background: #00d4aa; color: #000; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎰 Betway Games Validation Report</h1>

    <div class="summary">
      <div class="summary-card">
        <h2>${results.length}</h2>
        <p>Total Games</p>
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

    <div class="filter-buttons">
      <button class="filter-btn active" onclick="filterResults('all')">All</button>
      <button class="filter-btn" onclick="filterResults('PASS')">Passed</button>
      <button class="filter-btn" onclick="filterResults('FAIL')">Failed</button>
      <button class="filter-btn" onclick="filterResults('SKIP')">Skipped</button>
    </div>

    <table class="results-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Game Name</th>
          <th>Status</th>
          <th>Launch Time</th>
          <th>Screenshot</th>
          <th>Error Details</th>
        </tr>
      </thead>
      <tbody>
        ${results.map((r, i) => `
        <tr class="result-row" data-status="${r.status}">
          <td>${i + 1}</td>
          <td>${escapeHtml(r.gameName)}</td>
          <td><span class="status-badge status-${r.status.toLowerCase()}">${r.status}</span></td>
          <td>${(r.launchTime / 1000).toFixed(1)}s</td>
          <td><a href="screenshots/${path.basename(r.screenshotPath)}" class="screenshot-link" target="_blank">View Screenshot</a></td>
          <td class="error-details">${r.errorDetails ? escapeHtml(r.errorDetails) : '-'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>

    <p class="timestamp">Report generated: ${new Date().toLocaleString()}</p>
  </div>

  <script>
    function filterResults(status) {
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');

      document.querySelectorAll('.result-row').forEach(row => {
        if (status === 'all' || row.dataset.status === status) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>
  `;

  fs.writeFileSync(`${REPORTS_DIR}/test-report.html`, html);
}

/**
 * Generate JSON test report
 */
function generateJSONReport(results: GameTestResult[]): void {
  const report = {
    summary: {
      totalGames: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      skipped: results.filter(r => r.status === 'SKIP').length,
      passRate: results.length > 0 ?
        ((results.filter(r => r.status === 'PASS').length / results.length) * 100).toFixed(1) : '0',
      generatedAt: new Date().toISOString()
    },
    results: results
  };

  fs.writeFileSync(`${REPORTS_DIR}/test-report.json`, JSON.stringify(report, null, 2));
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: {[key: string]: string} = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
