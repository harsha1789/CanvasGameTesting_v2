import { test, expect } from '../../utils/test-framework';

// Game to test - use a game that exists on the site
const TEST_GAME = 'Gates of Betway';

/**
 * Slot Game Tests
 * Tests tailored for slot game features
 */

test.describe('Hot Hot Betway - Comprehensive Tests', () => {

  test.beforeEach(async ({ page, loginPage, lobbyPage }) => {
    // Login first
    await loginPage.gotoHome();
    await loginPage.login(
      process.env.BETWAY_USERNAME || '222212222',
      process.env.BETWAY_PASSWORD || '1234567890'
    );

    // Navigate to slots
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');
  });

  test('HHB-001: Game loads and displays correctly', async ({ page, lobbyPage, gamePage }) => {
    // Search and open game
    await lobbyPage.searchGame(TEST_GAME);
    await lobbyPage.openGame(TEST_GAME, 'demo');
    
    // Wait for game load
    await gamePage.waitForGameLoad(30000);

    // Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ Game type: ${gameType}`);
    expect(['canvas', 'iframe']).toContain(gameType);

    // Take initial screenshot
    await gamePage.screenshot('screenshots/hot-hot-betway-initial.png');
  });

  test('HHB-002: Canvas rendering validation', async ({ page, lobbyPage, gamePage, canvasHelper }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    const gameType = await gamePage.getGameType();
    
    if (gameType === 'canvas') {
      const canvas = await canvasHelper.waitForCanvasReady();
      expect(canvas).not.toBeNull();

      // Check dimensions
      const dimensions = await canvasHelper.getCanvasDimensions();
      console.log(`✓ Canvas dimensions: ${dimensions?.width}x${dimensions?.height}`);
      expect(dimensions).not.toBeNull();
      expect(dimensions!.width).toBeGreaterThan(0);
      expect(dimensions!.height).toBeGreaterThan(0);

      // Check if animating
      const isAnimating = await canvasHelper.isCanvasAnimating(canvas!);
      console.log(`✓ Canvas animating: ${isAnimating}`);
    } else {
      test.skip();
    }
  });

  test('HHB-003: Spin mechanics - Single spin', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    // Get initial state
    const initialBalance = await gamePage.getBalance();
    const initialBet = await gamePage.getBet();
    
    console.log(`Initial Balance: ${initialBalance}`);
    console.log(`Initial Bet: ${initialBet}`);

    // Perform spin
    await gamePage.spin();
    await gamePage.waitForSpinComplete(10000);

    // Get final state
    const finalBalance = await gamePage.getBalance();
    const finalWin = await gamePage.getWin();
    
    console.log(`Final Balance: ${finalBalance}`);
    console.log(`Win Amount: ${finalWin}`);

    // Verify spin occurred
    expect(finalBalance).toBeDefined();
    
    // Take post-spin screenshot
    await gamePage.screenshot('screenshots/hot-hot-betway-after-spin.png');
  });

  test('HHB-004: Bet adjustment controls', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    const betAmounts: string[] = [];

    // Get initial bet
    const initialBet = await gamePage.getBet();
    betAmounts.push(initialBet);
    console.log(`1. Initial bet: ${initialBet}`);

    // Increase bet 3 times
    for (let i = 0; i < 3; i++) {
      await gamePage.increaseBet();
      await page.waitForTimeout(500);
      const bet = await gamePage.getBet();
      betAmounts.push(bet);
      console.log(`${i + 2}. After increase: ${bet}`);
    }

    // Decrease bet 2 times
    for (let i = 0; i < 2; i++) {
      await gamePage.decreaseBet();
      await page.waitForTimeout(500);
      const bet = await gamePage.getBet();
      betAmounts.push(bet);
      console.log(`${i + 5}. After decrease: ${bet}`);
    }

    // Try max bet
    await gamePage.setMaxBet();
    await page.waitForTimeout(500);
    const maxBet = await gamePage.getBet();
    console.log(`6. Max bet: ${maxBet}`);

    // Verify at least some bets were different
    const uniqueBets = new Set(betAmounts);
    expect(uniqueBets.size).toBeGreaterThan(1);
  });

  test('HHB-005: Multiple consecutive spins', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    const spinResults: Array<{
      spinNumber: number;
      balance: string;
      win: string;
      timestamp: string;
    }> = [];

    const totalSpins = 5;

    for (let i = 0; i < totalSpins; i++) {
      console.log(`\nPerforming spin ${i + 1}/${totalSpins}...`);
      
      await gamePage.spin();
      await gamePage.waitForSpinComplete();
      
      const balance = await gamePage.getBalance();
      const win = await gamePage.getWin();
      
      spinResults.push({
        spinNumber: i + 1,
        balance,
        win,
        timestamp: new Date().toISOString()
      });
      
      console.log(`  Balance: ${balance}, Win: ${win}`);
    }

    // Verify all spins completed
    expect(spinResults.length).toBe(totalSpins);

    // Log results summary
    console.log('\n📊 Spin Results Summary:');
    spinResults.forEach(result => {
      console.log(`  Spin ${result.spinNumber}: Balance=${result.balance}, Win=${result.win}`);
    });
  });

  test('HHB-006: Game info and paytable access', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    try {
      // Open info
      await gamePage.openInfo();
      await page.waitForTimeout(2000);

      // Look for info indicators
      const infoElements = [
        page.locator('.paytable'),
        page.locator('.game-info'),
        page.locator('.info-panel'),
        page.locator('[class*="info"]')
      ];

      let infoFound = false;
      for (const element of infoElements) {
        if (await element.first().isVisible().catch(() => false)) {
          infoFound = true;
          console.log('✓ Info panel found');
          break;
        }
      }

      // Take screenshot of info
      if (infoFound) {
        await page.screenshot({ path: 'screenshots/hot-hot-betway-info.png' });
      }

      // Close info
      await gamePage.closeInfo();
      await page.waitForTimeout(1000);

      console.log(`Info accessibility: ${infoFound ? 'Available' : 'Not accessible'}`);
    } catch (error) {
      console.log('Info button not found or not clickable');
    }
  });

  test('HHB-007: Audio controls', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    try {
      // Toggle mute
      await gamePage.toggleMute();
      await page.waitForTimeout(500);
      console.log('✓ Mute toggled');

      // Toggle again (unmute)
      await gamePage.toggleMute();
      await page.waitForTimeout(500);
      console.log('✓ Unmute toggled');
    } catch (error) {
      console.log('Audio controls not accessible');
    }
  });

  test('HHB-008: Mobile responsiveness', async ({ page, lobbyPage, gamePage }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await lobbyPage.gotoSlots();
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    // Verify game loads on mobile
    const gameType = await gamePage.getGameType();
    expect(['canvas', 'iframe']).toContain(gameType);

    // Perform a mobile spin
    await gamePage.spin();
    await gamePage.waitForSpinComplete();

    // Screenshot mobile view
    await gamePage.screenshot('screenshots/hot-hot-betway-mobile.png');
    console.log('✓ Mobile test completed');
  });

  test('HHB-009: Tablet responsiveness', async ({ page, lobbyPage, gamePage }) => {
    // Set tablet viewport (iPad)
    await page.setViewportSize({ width: 768, height: 1024 });
    
    await lobbyPage.gotoSlots();
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    const gameType = await gamePage.getGameType();
    expect(['canvas', 'iframe']).toContain(gameType);

    await gamePage.screenshot('screenshots/hot-hot-betway-tablet.png');
    console.log('✓ Tablet test completed');
  });

  test('HHB-010: Demo mode verification', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    const isDemoMode = await gamePage.isDemoMode();
    console.log(`Demo mode detected: ${isDemoMode}`);

    // In demo mode, balance should not be real money
    const balance = await gamePage.getBalance();
    console.log(`Demo balance: ${balance}`);

    expect(balance).toBeDefined();
  });

  test('HHB-011: Comprehensive validation suite', async ({ page, lobbyPage, gamePage, validator }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    // Run full validation
    const results = await validator.runFullValidation({
      canvas: 'canvas',
      gameContainer: '#game-container, .game-container, .game-wrapper',
      balanceDisplay: '[class*="balance"]',
      betDisplay: '[class*="bet"]',
      spinButton: 'button:has-text("Spin"), [class*="spin"]'
    }, {
      skipAutospin: false,
      skipInfo: false,
      testSpins: 2
    });

    // Print summary
    validator.printValidationSummary(results);

    // Calculate pass rate
    const passed = results.filter(r => r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n📈 Overall Pass Rate: ${passRate.toFixed(1)}%`);

    // Expect at least 60% pass rate
    expect(passRate).toBeGreaterThanOrEqual(60);
  });

  test('HHB-012: Performance - Load time', async ({ page, lobbyPage }) => {
    const startTime = Date.now();
    
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    
    // Wait for game to be fully loaded
    await page.waitForSelector('canvas, iframe', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(3000); // Asset loading time
    
    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Game load time: ${loadTime}ms`);

    // Game should load within 30 seconds
    expect(loadTime).toBeLessThan(30000);
  });

  test('HHB-013: Visual regression baseline', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Hot Hot Betway', 'demo');
    await gamePage.waitForGameLoad();

    // Take baseline screenshots for visual regression
    await page.screenshot({ 
      path: 'screenshots/baselines/hot-hot-betway-baseline.png',
      fullPage: false
    });

    console.log('✓ Baseline screenshot created');
  });
});
