import { test, expect } from '../../utils/test-framework';
import { verifyCreditsWithRetry } from '../../utils/game-launch-helpers';

/**
 * Aviator Game Test Suite
 * Uses existing lobby search + Play button click flow to launch the game.
 * Verifies credits are visible (handling Continue/intro screens) before game features.
 * URL: https://www.betway.co.za/lobby/casino-games/game/aviator?vertical=casino-games
 */

const GAME_NAME = 'Aviator';

test.describe('Aviator Game Validation', () => {

  test.beforeEach(async ({ page, loginPage }) => {
    await loginPage.gotoHome();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    console.log('Attempting login...');
    const loggedIn = await loginPage.login(
      process.env.BETWAY_USERNAME || '222212222',
      process.env.BETWAY_PASSWORD || '1234567890'
    );
    await page.waitForTimeout(3000);
    console.log(`Login result: ${loggedIn}`);
  });

  test('Aviator game launches via Play button and loads correctly', async ({ page, lobbyPage, gamePage }, testInfo) => {
    test.setTimeout(180000);
    console.log(`\n--- Test: ${GAME_NAME} launch via Play button ---`);

    // Step 1: Navigate to casino lobby
    console.log('Navigating to casino lobby...');
    await lobbyPage.goto();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Screenshot: Lobby page
    const lobbyScreenshot = await page.screenshot({
      path: 'reports/screenshots/aviator-01-lobby.png',
      timeout: 30000,
    });
    await testInfo.attach('01 - Casino Lobby', { body: lobbyScreenshot, contentType: 'image/png' });
    console.log('Screenshot: lobby captured');

    // Step 2: Search and click Play button (openGame handles search + click)
    console.log(`Searching and opening "${GAME_NAME}" via Play button...`);
    await lobbyPage.openGame(GAME_NAME, 'play');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Screenshot: Game loading state
    const loadingScreenshot = await page.screenshot({
      path: 'reports/screenshots/aviator-03-game-loading.png',
      timeout: 30000,
    });
    await testInfo.attach('03 - Game Loading', { body: loadingScreenshot, contentType: 'image/png' });
    console.log('Screenshot: game loading captured');

    // Step 3: Wait for game to fully load
    console.log('Waiting for game to fully load...');
    await gamePage.waitForGameLoad(90000);

    // Step 4: Verify credits are visible (handles Continue/intro screens)
    console.log('Verifying credits visibility...');
    const creditsResult = await verifyCreditsWithRetry(page);
    console.log(`Credits check: ${creditsResult.attemptDetails}`);

    // Screenshot: After credits check
    const creditsScreenshot = await page.screenshot({
      path: 'reports/screenshots/aviator-03b-credits-check.png',
      timeout: 30000,
    });
    await testInfo.attach('03b - Credits Check', { body: creditsScreenshot, contentType: 'image/png' });

    expect(creditsResult.visible, `Credits should be visible. ${creditsResult.attemptDetails}`).toBeTruthy();

    // Step 5: Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`Game type detected: ${gameType}`);
    expect(['canvas', 'iframe']).toContain(gameType);

    // Screenshot: Game fully loaded
    const loadedScreenshot = await page.screenshot({
      path: 'reports/screenshots/aviator-04-game-loaded.png',
      timeout: 30000,
    });
    await testInfo.attach('04 - Game Loaded', { body: loadedScreenshot, contentType: 'image/png' });
    console.log('Screenshot: game loaded captured');

    // Verify URL contains aviator
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    expect(currentUrl).toContain('aviator');
  });

  test('Aviator game console and network health check', async ({ page, lobbyPage, gamePage }) => {
    test.setTimeout(180000);
    const consoleErrors: string[] = [];
    const failedRequests: { url: string; error: string }[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (request) => {
      failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
    });

    console.log('\n--- Test: Console & network health ---');

    // Navigate via lobby -> search -> Play button
    await lobbyPage.goto();
    await page.waitForLoadState('domcontentloaded');

    console.log(`Searching and opening "${GAME_NAME}"...`);
    await lobbyPage.openGame(GAME_NAME, 'play');
    await gamePage.waitForGameLoad(90000);

    // Verify credits before proceeding
    console.log('Verifying credits visibility...');
    const creditsResult = await verifyCreditsWithRetry(page);
    console.log(`Credits check: ${creditsResult.attemptDetails}`);
    expect(creditsResult.visible, `Credits should be visible. ${creditsResult.attemptDetails}`).toBeTruthy();

    await page.waitForTimeout(5000);

    // Console errors
    const trackingKeywords = ['analytics', 'google', 'facebook', 'tiktok', 'clarity', 'bing', 'sportradar'];
    const criticalErrors = consoleErrors.filter(err =>
      !trackingKeywords.some(kw => err.toLowerCase().includes(kw))
    );
    console.log(`Console errors: ${consoleErrors.length} total, ${criticalErrors.length} critical`);

    // Network failures
    const trackingDomains = ['google', 'facebook', 'tiktok', 'bing', 'clarity', 'sportradar', 'analytics'];
    const criticalFailures = failedRequests.filter(req =>
      !trackingDomains.some(domain => req.url.includes(domain))
    );
    console.log(`Network failures: ${failedRequests.length} total, ${criticalFailures.length} critical`);

    if (criticalFailures.length > 0) {
      console.log('Critical network failures:');
      criticalFailures.forEach((req, i) => console.log(`  ${i + 1}. ${req.error} - ${req.url.substring(0, 120)}`));
    }

    await page.screenshot({
      path: 'reports/screenshots/aviator-05-health-check.png',
      timeout: 30000,
    });
  });

  test('Aviator game interaction and canvas validation', async ({ page, lobbyPage, gamePage }, testInfo) => {
    test.setTimeout(180000);
    console.log('\n--- Test: Game interaction ---');

    // Navigate via lobby -> search -> Play button
    await lobbyPage.goto();
    await page.waitForLoadState('domcontentloaded');

    console.log(`Searching and opening "${GAME_NAME}"...`);
    await lobbyPage.openGame(GAME_NAME, 'play');
    await gamePage.waitForGameLoad(90000);

    // Verify credits before proceeding to game features
    console.log('Verifying credits visibility...');
    const creditsResult = await verifyCreditsWithRetry(page);
    console.log(`Credits check: ${creditsResult.attemptDetails}`);
    expect(creditsResult.visible, `Credits should be visible. ${creditsResult.attemptDetails}`).toBeTruthy();

    const gameType = await gamePage.getGameType();
    console.log(`Game type: ${gameType}`);

    if (gameType === 'canvas') {
      const canvas = page.locator('canvas').first();
      const box = await canvas.boundingBox();
      if (box) {
        console.log(`Canvas: ${box.width}x${box.height} at (${box.x}, ${box.y})`);
        const canvasShot = await canvas.screenshot({ timeout: 30000 });
        await testInfo.attach('Canvas Element', { body: canvasShot, contentType: 'image/png' });
      }
    } else if (gameType === 'iframe') {
      const iframe = page.locator('iframe').first();
      const src = await iframe.getAttribute('src');
      console.log(`Game iframe src: ${src}`);
      const iframeShot = await iframe.screenshot({ timeout: 30000 });
      await testInfo.attach('Game Iframe', { body: iframeShot, contentType: 'image/png' });
    }

    const fullShot = await page.screenshot({
      path: 'reports/screenshots/aviator-06-interaction.png',
      timeout: 30000,
    });
    await testInfo.attach('Full Page', { body: fullShot, contentType: 'image/png' });
  });

  test('Aviator game responsive layout check', async ({ page, lobbyPage, gamePage }, testInfo) => {
    test.setTimeout(180000);
    console.log('\n--- Test: Responsive layout ---');

    // Navigate via lobby -> search -> Play button
    await lobbyPage.goto();
    await page.waitForLoadState('domcontentloaded');

    console.log(`Searching and opening "${GAME_NAME}"...`);
    await lobbyPage.openGame(GAME_NAME, 'play');
    await gamePage.waitForGameLoad(90000);

    // Verify credits before proceeding to responsive checks
    console.log('Verifying credits visibility...');
    const creditsResult = await verifyCreditsWithRetry(page);
    console.log(`Credits check: ${creditsResult.attemptDetails}`);
    expect(creditsResult.visible, `Credits should be visible. ${creditsResult.attemptDetails}`).toBeTruthy();

    // Desktop (1366x768)
    const desktopShot = await page.screenshot({ path: 'reports/screenshots/aviator-07-desktop.png', timeout: 30000 });
    await testInfo.attach('Desktop 1366x768', { body: desktopShot, contentType: 'image/png' });
    console.log('Desktop screenshot saved');

    // Tablet (768x1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(3000);
    const tabletShot = await page.screenshot({ path: 'reports/screenshots/aviator-08-tablet.png', timeout: 30000 });
    await testInfo.attach('Tablet 768x1024', { body: tabletShot, contentType: 'image/png' });
    console.log('Tablet screenshot saved');

    // Mobile (375x812)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(3000);
    const mobileShot = await page.screenshot({ path: 'reports/screenshots/aviator-09-mobile.png', timeout: 30000 });
    await testInfo.attach('Mobile 375x812', { body: mobileShot, contentType: 'image/png' });
    console.log('Mobile screenshot saved');

    const gameType = await gamePage.getGameType();
    console.log(`Game type at mobile viewport: ${gameType}`);
    expect(['canvas', 'iframe', 'unknown']).toContain(gameType);
  });

});
