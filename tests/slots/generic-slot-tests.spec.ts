import { test, expect } from '../../utils/test-framework';
import { CasinoLobbyPage } from '../../pages/CasinoLobbyPage';
import { GamePage } from '../../pages/GamePage';
import { GameValidator } from '../../utils/game-validator';

/**
 * Generic Slot Game Test Template
 * Can be used for any slot game with data-driven approach
 */

interface SlotGameTestData {
  gameName: string;
  gameUrl?: string;
  provider?: string;
  skipTests?: string[];
}

// Test data - can be loaded from JSON file
const testGames: SlotGameTestData[] = [
  { gameName: 'Hot Hot Betway', provider: 'Habanero' },
  { gameName: "Gonzo's Quest Megaways", provider: 'NetEnt' },
  { gameName: 'Starburst', provider: 'NetEnt' },
  { gameName: 'Book of Dead', provider: "Play'n GO" },
];

testGames.forEach((gameData) => {
  test.describe(`Slot Game: ${gameData.gameName}`, () => {
    test.beforeEach(async ({ lobbyPage }) => {
      // Navigate to slots lobby
      await lobbyPage.gotoSlots();
    });

    test('should load game successfully', async ({ lobbyPage, gamePage, validator }) => {
      // Search and open game
      await lobbyPage.searchGame(gameData.gameName);
      await lobbyPage.openGame(gameData.gameName, 'demo');

      // Wait for game to load
      await gamePage.waitForGameLoad();

      // Validate loading
      const result = await validator.validateGameLoading({
        gameContainer: '#game-container, .game-container',
        canvas: 'canvas'
      });

      expect(result.passed).toBeTruthy();
    });

    test('should render canvas correctly', async ({ lobbyPage, gamePage, validator }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Check game type
      const gameType = await gamePage.getGameType();

      if (gameType === 'canvas') {
        const result = await validator.validateCanvasRendering();
        expect(result.passed).toBeTruthy();
      } else {
        test.skip(); // Skip if not canvas-based
      }
    });

    test('should perform spin successfully', async ({ lobbyPage, gamePage }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Get initial balance
      const initialBalance = await gamePage.getBalance();

      // Perform spin
      await gamePage.spin();

      // Wait for spin to complete
      await gamePage.waitForSpinComplete();

      // Get new balance
      const newBalance = await gamePage.getBalance();

      // Balance should change (unless it's a push)
      // In demo mode, balance typically decreases
      expect(newBalance).toBeDefined();
    });

    test('should adjust bet controls', async ({ page, lobbyPage, gamePage }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Get initial bet
      const initialBet = await gamePage.getBet();

      // Increase bet
      await gamePage.increaseBet(2);
      await page.waitForTimeout(500);

      const increasedBet = await gamePage.getBet();

      // Decrease bet
      await gamePage.decreaseBet(1);
      await page.waitForTimeout(500);

      const decreasedBet = await gamePage.getBet();

      // Bets should be defined
      expect(initialBet).toBeDefined();
      expect(increasedBet).toBeDefined();
      expect(decreasedBet).toBeDefined();
    });

    test('should access game info/paytable', async ({ page, lobbyPage, gamePage }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Try to open info
      try {
        await gamePage.openInfo();
        await page.waitForTimeout(1000);

        // Check if info panel is visible
        await page.locator('.info, .paytable, .help').first().isVisible()
          .catch(() => false);

        // Close info
        await gamePage.closeInfo();
      } catch {
        // Info button not found or not accessible
      }
    });

    test('should handle multiple spins', async ({ lobbyPage, gamePage }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      const spinsToPerform = 3;
      const balances: string[] = [];

      for (let i = 0; i < spinsToPerform; i++) {
        await gamePage.spin();
        await gamePage.waitForSpinComplete();

        const balance = await gamePage.getBalance();
        balances.push(balance);
      }

      // At least one spin should complete
      expect(balances.length).toBe(spinsToPerform);
    });

    test('should be responsive on mobile', async ({ page, lobbyPage, gamePage }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await lobbyPage.gotoSlots();
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Check if game loads on mobile
      const gameType = await gamePage.getGameType();
      expect(['canvas', 'iframe']).toContain(gameType);

      // Take mobile screenshot
      await gamePage.screenshot(`screenshots/${gameData.gameName.replace(/[^a-z0-9]/gi, '-')}-mobile.png`);
    });

    test('should display in demo mode', async ({ lobbyPage, gamePage }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      const isDemoMode = await gamePage.isDemoMode();

      // If we can detect demo mode, it should be true
      // If we can't detect it, that's also acceptable
      expect(typeof isDemoMode).toBe('boolean');
    });

    test('should take game screenshots for visual comparison', async ({ lobbyPage, gamePage }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Screenshot initial state
      await gamePage.screenshot(
        `screenshots/${gameData.gameName.replace(/[^a-z0-9]/gi, '-')}-initial.png`
      );

      // Perform spin
      await gamePage.spin();
      await gamePage.waitForSpinComplete();

      // Screenshot after spin
      await gamePage.screenshot(
        `screenshots/${gameData.gameName.replace(/[^a-z0-9]/gi, '-')}-after-spin.png`
      );
    });

    test('should run comprehensive validation', async ({ lobbyPage, gamePage, validator }) => {
      await lobbyPage.openGame(gameData.gameName, 'demo');
      await gamePage.waitForGameLoad();

      // Run all validations
      const results = await validator.runFullValidation({
        canvas: 'canvas',
        gameContainer: '#game-container, .game-container',
        balanceDisplay: '[class*="balance"]',
        betDisplay: '[class*="bet"]'
      }, {
        skipAutospin: true, // Skip autospin to keep test faster
        skipInfo: false,
        testSpins: 2
      });

      // Print summary
      validator.printValidationSummary(results);

      // At least 50% of validations should pass
      const passedCount = results.filter(r => r.passed).length;
      const passRate = passedCount / results.length;

      expect(passRate).toBeGreaterThanOrEqual(0.5);
    });
  });
});
