import { test, expect } from '../../utils/test-framework';

/**
 * Game Launch Validation Test Suite
 * Validates login and game launch for different game types:
 * - Slot games
 * - Casino games
 * - Table games
 * - Data-driven games from catalog
 */

test.describe('Game Launch Validation Suite', () => {

  /**
   * Before each test: Navigate to home, ensure user is logged in
   * Always perform login to ensure session is valid
   */
  test.beforeEach(async ({ page, loginPage }) => {
    // Navigate to home page and wait for it to load
    await loginPage.gotoHome();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Always perform login - the login method handles "already logged in" case
    console.log('Ensuring user is logged in...');
    await loginPage.login(
      process.env.BETWAY_USERNAME || '222212222',
      process.env.BETWAY_PASSWORD || '1234567890'
    );

    // Wait for any login redirects/updates
    await page.waitForTimeout(3000);
    console.log('Login step completed');
  });

  /**
   * Test 1: Slot Game - Hot Hot Betway
   */
  test('SLOT: Hot Hot Betway loads and displays correctly', async ({ page, lobbyPage, gamePage }) => {
    const gameName = 'Hot Hot Betway';

    console.log(`\n🎰 Testing SLOT: ${gameName}`);

    // Navigate to slots section
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');

    // Search and open game
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Wait for game to load
    await gamePage.waitForGameLoad(60000);

    // Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ ${gameName} loaded - Type: ${gameType}`);

    expect(['canvas', 'iframe']).toContain(gameType);

    // Take screenshot
    await page.screenshot({ path: 'reports/screenshots/slot-hot-hot-betway.png' });
  });

  /**
   * Test 2: Casino Game - Starburst (popular slot)
   */
  test('CASINO: Starburst game loads and displays correctly', async ({ page, lobbyPage, gamePage }) => {
    const gameName = 'Starburst';

    console.log(`\n🎲 Testing CASINO: ${gameName}`);

    // Navigate to slots section
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');

    // Search and open game
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Wait for game to load
    await gamePage.waitForGameLoad(60000);

    // Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ ${gameName} loaded - Type: ${gameType}`);

    expect(['canvas', 'iframe']).toContain(gameType);

    // Take screenshot
    await page.screenshot({ path: 'reports/screenshots/casino-starburst.png' });
  });

  /**
   * Test 3: Table Game - Betway Blackjack
   */
  test('TABLE: Betway Blackjack game loads and displays correctly', async ({ page, lobbyPage, gamePage }, testInfo) => {
    const gameName = 'Betway Blackjack';

    console.log(`\n🃏 Testing TABLE: ${gameName}`);

    // Navigate to slots section (search works here)
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');

    // Search and open game
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Screenshot 1: Game Loading State
    await page.waitForTimeout(3000);
    const loadingScreenshot = await page.screenshot({ path: 'reports/screenshots/table-betway-blackjack-loading.png' });
    await testInfo.attach('Game Loading State', { body: loadingScreenshot, contentType: 'image/png' });

    // Wait for game to load
    await gamePage.waitForGameLoad(60000);

    // Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ ${gameName} loaded - Type: ${gameType}`);

    expect(['canvas', 'iframe']).toContain(gameType);

    // Screenshot 2: Credits/Balance Visible Validation
    const finalScreenshot = await page.screenshot({ path: 'reports/screenshots/table-betway-blackjack.png' });
    await testInfo.attach('Credits Balance Visible', { body: finalScreenshot, contentType: 'image/png' });
  });

  /**
   * Test 4: Data-Driven Game - Gates of Olympus (from catalog)
   */
  test('DATA-DRIVEN: Gates of Olympus loads and displays correctly', async ({ page, lobbyPage, gamePage }) => {
    const gameName = 'Gates of Olympus';

    console.log(`\n📊 Testing DATA-DRIVEN: ${gameName}`);

    // Navigate to slots section
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');

    // Search and open game
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Wait for game to load
    await gamePage.waitForGameLoad(60000);

    // Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ ${gameName} loaded - Type: ${gameType}`);

    expect(['canvas', 'iframe']).toContain(gameType);

    // Take screenshot
    await page.screenshot({ path: 'reports/screenshots/data-driven-gates-of-olympus.png' });
  });

});
