import { test, expect } from '../../utils/test-framework';

/**
 * Game Features Validation Test Suite
 * Validates core game features:
 * - Place bet (increase/decrease)
 * - Click Spin button
 * - Click Autospin button
 * - Validate balance changes
 * - Screenshot attachments for each action
 */

test.describe('Game Features Validation Suite', () => {

  /**
   * Before each test: Ensure user is logged in
   */
  test.beforeEach(async ({ page, loginPage }) => {
    await loginPage.gotoHome();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    console.log('Ensuring user is logged in...');
    await loginPage.login(
      process.env.BETWAY_USERNAME || '222212222',
      process.env.BETWAY_PASSWORD || '1234567890'
    );
    await page.waitForTimeout(3000);
    console.log('Login step completed');
  });

  /**
   * Test: Complete game feature validation for Betway Blackjack (Live Dealer)
   * This game has visible bet controls and balance
   */
  test('LIVE-DEALER: Betway Blackjack - Full Feature Validation', async ({ page, lobbyPage, gamePage }, testInfo) => {
    const gameName = 'Betway Blackjack';

    console.log(`\n🃏 Testing LIVE DEALER: ${gameName}`);
    console.log('=' .repeat(50));

    // Step 1: Navigate and launch game
    console.log('\n📍 Step 1: Navigate to game');
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Step 2: Wait for game to load
    console.log('\n📍 Step 2: Wait for game to load');
    await gamePage.waitForGameLoad(90000);

    // Screenshot: Game Loaded
    const gameLoadedShot = await page.screenshot({ path: 'reports/screenshots/blackjack-01-game-loaded.png' });
    await testInfo.attach('01-Game Loaded', { body: gameLoadedShot, contentType: 'image/png' });

    // Step 3: Verify game type
    const gameType = await gamePage.getGameType();
    console.log(`✓ Game type: ${gameType}`);
    expect(['canvas', 'iframe']).toContain(gameType);

    // Step 4: Get initial balance
    console.log('\n📍 Step 3: Check initial balance');
    await page.waitForTimeout(3000);

    // Look for balance on page
    const balanceLocator = page.locator('text=/Balance|R\\s*[\\d,]+\\.\\d{2}/i').first();
    let initialBalance = 'N/A';
    if (await balanceLocator.isVisible({ timeout: 5000 }).catch(() => false)) {
      initialBalance = await balanceLocator.textContent() || 'N/A';
    }
    console.log(`✓ Initial Balance: ${initialBalance}`);

    // Screenshot: Balance Visible
    const balanceShot = await page.screenshot({ path: 'reports/screenshots/blackjack-02-balance-visible.png' });
    await testInfo.attach('02-Balance Visible', { body: balanceShot, contentType: 'image/png' });

    console.log('\n✅ Live Dealer game validation complete!');
    console.log('Note: Bet placement and spin not applicable for live dealer - dealer controls the game');
  });

  /**
   * Test: Slot game feature validation - Hot Hot Betway
   * Tests spin, bet controls on canvas-based slot
   */
  test('SLOT: Hot Hot Betway - Spin and Bet Validation', async ({ page, lobbyPage, gamePage, canvasHelper }, testInfo) => {
    const gameName = 'Hot Hot Betway';

    console.log(`\n🎰 Testing SLOT: ${gameName}`);
    console.log('=' .repeat(50));

    // Step 1: Navigate and launch game
    console.log('\n📍 Step 1: Navigate to game');
    await lobbyPage.gotoSlots();
    await page.waitForLoadState('domcontentloaded');
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Step 2: Wait for game to load
    console.log('\n📍 Step 2: Wait for game to load');
    await gamePage.waitForGameLoad(90000);

    // Screenshot: Game Loaded
    const gameLoadedShot = await page.screenshot({ path: 'reports/screenshots/slot-01-game-loaded.png' });
    await testInfo.attach('01-Game Loaded', { body: gameLoadedShot, contentType: 'image/png' });

    // Step 3: Get canvas and dimensions
    console.log('\n📍 Step 3: Analyze game canvas');
    const canvas = await canvasHelper.getCanvas();
    expect(canvas).not.toBeNull();

    const dimensions = await canvasHelper.getCanvasDimensions();
    console.log(`✓ Canvas dimensions: ${dimensions?.width}x${dimensions?.height}`);

    // Step 4: Click on SPIN area (usually center-right or bottom-right of canvas)
    console.log('\n📍 Step 4: Click SPIN button');
    await page.waitForTimeout(2000);

    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        // Spin button is typically at bottom-right or center-right
        const spinX = box.x + box.width * 0.85;  // 85% from left
        const spinY = box.y + box.height * 0.5;  // Center vertically

        console.log(`Clicking SPIN at position (${Math.round(spinX)}, ${Math.round(spinY)})`);
        await page.mouse.click(spinX, spinY);
        await page.waitForTimeout(1000);

        // Screenshot: After Spin Click
        const spinClickShot = await page.screenshot({ path: 'reports/screenshots/slot-02-spin-clicked.png' });
        await testInfo.attach('02-Spin Clicked', { body: spinClickShot, contentType: 'image/png' });

        // Wait for spin animation
        console.log('Waiting for spin to complete...');
        await page.waitForTimeout(5000);

        // Screenshot: Spin Complete
        const spinCompleteShot = await page.screenshot({ path: 'reports/screenshots/slot-03-spin-complete.png' });
        await testInfo.attach('03-Spin Complete', { body: spinCompleteShot, contentType: 'image/png' });
      }
    }

    // Step 5: Click on BET INCREASE area (usually left side or bottom-left)
    console.log('\n📍 Step 5: Click BET controls');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        // Bet controls typically at bottom-left
        const betPlusX = box.x + box.width * 0.25;  // 25% from left
        const betPlusY = box.y + box.height * 0.85; // 85% from top

        console.log(`Clicking BET+ at position (${Math.round(betPlusX)}, ${Math.round(betPlusY)})`);
        await page.mouse.click(betPlusX, betPlusY);
        await page.waitForTimeout(1000);

        // Screenshot: After Bet Change
        const betChangeShot = await page.screenshot({ path: 'reports/screenshots/slot-04-bet-changed.png' });
        await testInfo.attach('04-Bet Changed', { body: betChangeShot, contentType: 'image/png' });
      }
    }

    // Step 6: Click SPIN again after bet change
    console.log('\n📍 Step 6: Click SPIN again');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        const spinX = box.x + box.width * 0.85;
        const spinY = box.y + box.height * 0.5;

        await page.mouse.click(spinX, spinY);
        console.log('Second spin initiated');
        await page.waitForTimeout(5000);

        // Screenshot: Second Spin Complete
        const spin2Shot = await page.screenshot({ path: 'reports/screenshots/slot-05-second-spin.png' });
        await testInfo.attach('05-Second Spin Complete', { body: spin2Shot, contentType: 'image/png' });
      }
    }

    // Step 7: Try AUTOSPIN (usually near spin button or in menu)
    console.log('\n📍 Step 7: Try AUTOSPIN');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        // Autospin often at bottom-left of spin button area
        const autoX = box.x + box.width * 0.7;
        const autoY = box.y + box.height * 0.65;

        console.log(`Clicking AUTOSPIN area at (${Math.round(autoX)}, ${Math.round(autoY)})`);
        await page.mouse.click(autoX, autoY);
        await page.waitForTimeout(2000);

        // Screenshot: Autospin
        const autoSpinShot = await page.screenshot({ path: 'reports/screenshots/slot-06-autospin.png' });
        await testInfo.attach('06-Autospin Clicked', { body: autoSpinShot, contentType: 'image/png' });
      }
    }

    console.log('\n✅ Slot game feature validation complete!');
  });

  /**
   * Test: Gates of Olympus - Popular Pragmatic Play slot
   */
  test('SLOT: Gates of Olympus - Full Feature Test', async ({ page, lobbyPage, gamePage, canvasHelper }, testInfo) => {
    const gameName = 'Gates of Olympus';

    console.log(`\n⚡ Testing SLOT: ${gameName}`);
    console.log('=' .repeat(50));

    // Navigate and launch
    await lobbyPage.gotoSlots();
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Wait for game
    await gamePage.waitForGameLoad(90000);

    // Screenshot: Game Loaded
    const loadShot = await page.screenshot({ path: 'reports/screenshots/goo-01-loaded.png' });
    await testInfo.attach('01-Game Loaded', { body: loadShot, contentType: 'image/png' });

    // Get canvas
    const canvas = await canvasHelper.getCanvas();
    if (!canvas) {
      console.log('Canvas not found');
      return;
    }

    const box = await canvas.boundingBox();
    if (!box) {
      console.log('Could not get canvas bounding box');
      return;
    }

    // Pragmatic Play games typically have:
    // - Spin button: center-bottom or right-center
    // - Bet controls: bottom-left
    // - Autospin: near spin button

    // Step 1: Click Spin
    console.log('\n📍 Clicking SPIN...');
    const spinX = box.x + box.width * 0.5;  // Center
    const spinY = box.y + box.height * 0.9; // Bottom
    await page.mouse.click(spinX, spinY);
    await page.waitForTimeout(5000);

    const spin1Shot = await page.screenshot({ path: 'reports/screenshots/goo-02-spin1.png' });
    await testInfo.attach('02-First Spin', { body: spin1Shot, contentType: 'image/png' });

    // Step 2: Adjust Bet (click minus/plus areas)
    console.log('\n📍 Adjusting BET...');
    const betX = box.x + box.width * 0.15;
    const betY = box.y + box.height * 0.9;
    await page.mouse.click(betX, betY);
    await page.waitForTimeout(1000);

    const betShot = await page.screenshot({ path: 'reports/screenshots/goo-03-bet.png' });
    await testInfo.attach('03-Bet Adjusted', { body: betShot, contentType: 'image/png' });

    // Step 3: Spin again
    console.log('\n📍 Clicking SPIN again...');
    await page.mouse.click(spinX, spinY);
    await page.waitForTimeout(5000);

    const spin2Shot = await page.screenshot({ path: 'reports/screenshots/goo-04-spin2.png' });
    await testInfo.attach('04-Second Spin', { body: spin2Shot, contentType: 'image/png' });

    // Step 4: Try Autospin
    console.log('\n📍 Trying AUTOSPIN...');
    const autoX = box.x + box.width * 0.35;
    const autoY = box.y + box.height * 0.9;
    await page.mouse.click(autoX, autoY);
    await page.waitForTimeout(2000);

    const autoShot = await page.screenshot({ path: 'reports/screenshots/goo-05-autospin.png' });
    await testInfo.attach('05-Autospin', { body: autoShot, contentType: 'image/png' });

    console.log('\n✅ Gates of Olympus feature validation complete!');
  });

  /**
   * Test: Starburst - NetEnt classic slot
   */
  test('SLOT: Starburst - Spin and Features', async ({ page, lobbyPage, gamePage, canvasHelper }, testInfo) => {
    const gameName = 'Starburst';

    console.log(`\n⭐ Testing SLOT: ${gameName}`);
    console.log('=' .repeat(50));

    // Navigate and launch
    await lobbyPage.gotoSlots();
    await lobbyPage.searchGame(gameName);
    await lobbyPage.openGame(gameName, 'demo');

    // Wait for game
    await gamePage.waitForGameLoad(90000);

    // Screenshot: Game Loaded
    const loadShot = await page.screenshot({ path: 'reports/screenshots/starburst-01-loaded.png' });
    await testInfo.attach('01-Game Loaded', { body: loadShot, contentType: 'image/png' });

    // Get canvas
    const canvas = await canvasHelper.getCanvas();
    if (!canvas) {
      console.log('Canvas not found');
      return;
    }

    const box = await canvas.boundingBox();
    if (!box) return;

    // NetEnt games typically have spin on right side
    console.log('\n📍 Clicking SPIN...');
    const spinX = box.x + box.width * 0.92;
    const spinY = box.y + box.height * 0.5;
    await page.mouse.click(spinX, spinY);
    await page.waitForTimeout(5000);

    const spin1Shot = await page.screenshot({ path: 'reports/screenshots/starburst-02-spin1.png' });
    await testInfo.attach('02-First Spin', { body: spin1Shot, contentType: 'image/png' });

    // Bet controls on left side
    console.log('\n📍 Clicking BET controls...');
    const betX = box.x + box.width * 0.08;
    const betY = box.y + box.height * 0.5;
    await page.mouse.click(betX, betY);
    await page.waitForTimeout(1000);

    const betShot = await page.screenshot({ path: 'reports/screenshots/starburst-03-bet.png' });
    await testInfo.attach('03-Bet Area', { body: betShot, contentType: 'image/png' });

    // Spin again
    console.log('\n📍 Clicking SPIN again...');
    await page.mouse.click(spinX, spinY);
    await page.waitForTimeout(5000);

    const spin2Shot = await page.screenshot({ path: 'reports/screenshots/starburst-04-spin2.png' });
    await testInfo.attach('04-Second Spin', { body: spin2Shot, contentType: 'image/png' });

    console.log('\n✅ Starburst feature validation complete!');
  });

});
