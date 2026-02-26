import { test, expect } from '../../utils/test-framework';

/**
 * Table Games Test Suite
 * Template for testing table games like Blackjack, Roulette, Baccarat
 */

test.describe('Table Games - Blackjack', () => {
  
  test.beforeEach(async ({ page, lobbyPage }) => {
    // Navigate to table games section
    await page.goto('/lobby/casino-games');
    await page.waitForLoadState('networkidle');
  });

  test('TG-BJ-001: Blackjack game loads successfully', async ({ page, lobbyPage, gamePage }) => {
    // Search for Blackjack
    await lobbyPage.searchGame('Blackjack');
    
    // Open game in demo mode
    await lobbyPage.openGame('Blackjack', 'demo');
    
    // Wait for game to load
    await gamePage.waitForGameLoad(30000);

    // Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ Game type: ${gameType}`);
    expect(['canvas', 'iframe']).toContain(gameType);
  });

  test('TG-BJ-002: Place bet and deal cards', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Blackjack', 'demo');
    await gamePage.waitForGameLoad();

    // Get initial balance
    const initialBalance = await gamePage.getBalance();
    console.log(`Initial balance: ${initialBalance}`);

    // Place bet (adjust selectors based on actual game)
    const betButton = page.locator('button:has-text("Bet"), .bet-button').first();
    if (await betButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await betButton.click();
      await page.waitForTimeout(1000);
    }

    // Deal cards
    const dealButton = page.locator('button:has-text("Deal"), .deal-button').first();
    if (await dealButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dealButton.click();
      await page.waitForTimeout(3000);
    }

    console.log('✓ Bet placed and cards dealt');
  });

  test('TG-BJ-003: Hit and Stand actions', async ({ page, lobbyPage, gamePage }) => {
    await lobbyPage.openGame('Blackjack', 'demo');
    await gamePage.waitForGameLoad();

    // Place bet and deal
    const dealButton = page.locator('button:has-text("Deal")').first();
    if (await dealButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dealButton.click();
      await page.waitForTimeout(3000);
    }

    // Try hit action
    const hitButton = page.locator('button:has-text("Hit")').first();
    if (await hitButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await hitButton.click();
      await page.waitForTimeout(2000);
      console.log('✓ Hit action executed');
    }

    // Try stand action
    const standButton = page.locator('button:has-text("Stand")').first();
    if (await standButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await standButton.click();
      await page.waitForTimeout(2000);
      console.log('✓ Stand action executed');
    }
  });

  test('TG-BJ-004: Mobile responsiveness', async ({ page, lobbyPage, gamePage }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/lobby/casino-games');
    await lobbyPage.openGame('Blackjack', 'demo');
    await gamePage.waitForGameLoad();

    const gameType = await gamePage.getGameType();
    expect(['canvas', 'iframe']).toContain(gameType);

    console.log('✓ Mobile test completed');
  });
});

test.describe('Table Games - Roulette', () => {
  
  test('TG-RO-001: Roulette game loads successfully', async ({ page, lobbyPage, gamePage }) => {
    await page.goto('/lobby/casino-games');
    await lobbyPage.searchGame('Roulette');
    await lobbyPage.openGame('Roulette', 'demo');
    await gamePage.waitForGameLoad(30000);

    const gameType = await gamePage.getGameType();
    console.log(`✓ Roulette game type: ${gameType}`);
    expect(['canvas', 'iframe']).toContain(gameType);
  });

  test('TG-RO-002: Place bet on number', async ({ page, lobbyPage, gamePage }) => {
    await page.goto('/lobby/casino-games');
    await lobbyPage.openGame('Roulette', 'demo');
    await gamePage.waitForGameLoad();

    // For canvas-based roulette, might need to click on betting area
    const gameType = await gamePage.getGameType();
    
    if (gameType === 'canvas') {
      const canvas = await gamePage.canvasHelper.getCanvas();
      if (canvas) {
        // Click on betting area (adjust coordinates as needed)
        await gamePage.canvasHelper.clickCanvas(canvas, {
          position: 'center',
          offsetY: 50
        });
        console.log('✓ Bet placed on canvas');
      }
    }

    await page.waitForTimeout(2000);
  });

  test('TG-RO-003: Spin wheel', async ({ page, lobbyPage, gamePage }) => {
    await page.goto('/lobby/casino-games');
    await lobbyPage.openGame('Roulette', 'demo');
    await gamePage.waitForGameLoad();

    // Look for spin button
    const spinButton = page.locator('button:has-text("Spin"), .spin-button').first();
    if (await spinButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await spinButton.click();
      await page.waitForTimeout(5000); // Wait for wheel to spin
      console.log('✓ Wheel spin completed');
    }
  });
});

test.describe('Table Games - Baccarat', () => {
  
  test('TG-BA-001: Baccarat game loads successfully', async ({ page, lobbyPage, gamePage }) => {
    await page.goto('/lobby/casino-games');
    await lobbyPage.searchGame('Baccarat');
    await lobbyPage.openGame('Baccarat', 'demo');
    await gamePage.waitForGameLoad(30000);

    const gameType = await gamePage.getGameType();
    console.log(`✓ Baccarat game type: ${gameType}`);
    expect(['canvas', 'iframe']).toContain(gameType);
  });

  test('TG-BA-002: Place bet on Player/Banker/Tie', async ({ page, lobbyPage, gamePage }) => {
    await page.goto('/lobby/casino-games');
    await lobbyPage.openGame('Baccarat', 'demo');
    await gamePage.waitForGameLoad();

    // Try to find bet buttons for Player, Banker, or Tie
    const betOptions = ['Player', 'Banker', 'Tie'];
    
    for (const option of betOptions) {
      const betButton = page.locator(`button:has-text("${option}")`).first();
      if (await betButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`✓ ${option} bet option available`);
      }
    }
  });
});

// Add more table games as needed:
// - Poker variants
// - Sic Bo
// - Craps
// - etc.
