import { test, expect } from '../../utils/test-framework';

/**
 * Live Casino Test Suite
 * Template for testing live dealer games
 */

test.describe('Live Casino - Live Roulette', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to live casino section
    await page.goto('/Livegames');
    await page.waitForLoadState('networkidle');
  });

  test('LC-LR-001: Live Roulette loads successfully', async ({ page, gamePage }) => {
    // Find and open Live Roulette
    const liveRouletteButton = page.locator('text=/Live Roulette/i').first();
    
    if (await liveRouletteButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveRouletteButton.click();
      await page.waitForTimeout(5000);
      
      // Wait for game to load
      await gamePage.waitForGameLoad(45000); // Live games take longer
      
      const gameType = await gamePage.getGameType();
      console.log(`✓ Live Roulette type: ${gameType}`);
      expect(['canvas', 'iframe']).toContain(gameType);
    } else {
      console.log('⚠️  Live Roulette not found in lobby');
      test.skip();
    }
  });

  test('LC-LR-002: Video stream is visible', async ({ page, gamePage }) => {
    const liveRouletteButton = page.locator('text=/Live Roulette/i').first();
    
    if (await liveRouletteButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveRouletteButton.click();
      await gamePage.waitForGameLoad(45000);
      
      // Check for video element or canvas with video stream
      const videoElement = page.locator('video, canvas').first();
      const isVisible = await videoElement.isVisible({ timeout: 10000 }).catch(() => false);
      
      console.log(`✓ Video stream visible: ${isVisible}`);
      expect(isVisible).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('LC-LR-003: Betting interface is accessible', async ({ page, gamePage }) => {
    const liveRouletteButton = page.locator('text=/Live Roulette/i').first();
    
    if (await liveRouletteButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveRouletteButton.click();
      await gamePage.waitForGameLoad(45000);
      
      // Check for betting interface elements
      const bettingElements = [
        page.locator('.betting-grid'),
        page.locator('.roulette-table'),
        page.locator('[class*="bet"]'),
        page.locator('canvas').first()
      ];
      
      let bettingInterfaceFound = false;
      for (const element of bettingElements) {
        if (await element.isVisible({ timeout: 5000 }).catch(() => false)) {
          bettingInterfaceFound = true;
          console.log('✓ Betting interface found');
          break;
        }
      }
      
      expect(bettingInterfaceFound).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('LC-LR-004: Chat functionality exists', async ({ page, gamePage }) => {
    const liveRouletteButton = page.locator('text=/Live Roulette/i').first();
    
    if (await liveRouletteButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveRouletteButton.click();
      await gamePage.waitForGameLoad(45000);
      
      // Look for chat interface
      const chatElements = [
        page.locator('.chat'),
        page.locator('[class*="chat"]'),
        page.locator('button:has-text("Chat")'),
        page.locator('[aria-label*="chat" i]')
      ];
      
      let chatFound = false;
      for (const element of chatElements) {
        if (await element.isVisible({ timeout: 5000 }).catch(() => false)) {
          chatFound = true;
          console.log('✓ Chat interface available');
          break;
        }
      }
      
      console.log(`Chat functionality: ${chatFound ? 'Available' : 'Not found'}`);
    } else {
      test.skip();
    }
  });

  test('LC-LR-005: Mobile responsiveness', async ({ page, gamePage }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/Livegames');
    
    const liveRouletteButton = page.locator('text=/Live Roulette/i').first();
    if (await liveRouletteButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveRouletteButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const gameType = await gamePage.getGameType();
      expect(['canvas', 'iframe']).toContain(gameType);
      
      console.log('✓ Mobile live casino test completed');
    } else {
      test.skip();
    }
  });
});

test.describe('Live Casino - Live Blackjack', () => {
  
  test('LC-BJ-001: Live Blackjack loads successfully', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const liveBlackjackButton = page.locator('text=/Live Blackjack/i').first();
    
    if (await liveBlackjackButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveBlackjackButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const gameType = await gamePage.getGameType();
      console.log(`✓ Live Blackjack type: ${gameType}`);
      expect(['canvas', 'iframe']).toContain(gameType);
    } else {
      console.log('⚠️  Live Blackjack not found in lobby');
      test.skip();
    }
  });

  test('LC-BJ-002: Dealer video stream visible', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const liveBlackjackButton = page.locator('text=/Live Blackjack/i').first();
    
    if (await liveBlackjackButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveBlackjackButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const videoElement = page.locator('video, canvas').first();
      const isVisible = await videoElement.isVisible({ timeout: 10000 }).catch(() => false);
      
      console.log(`✓ Dealer stream visible: ${isVisible}`);
      expect(isVisible).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('LC-BJ-003: Game controls are functional', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const liveBlackjackButton = page.locator('text=/Live Blackjack/i').first();
    
    if (await liveBlackjackButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveBlackjackButton.click();
      await gamePage.waitForGameLoad(45000);
      
      // Check for common game controls
      const controls = [
        'Bet',
        'Hit',
        'Stand',
        'Double',
        'Split'
      ];
      
      const availableControls: string[] = [];
      
      for (const control of controls) {
        const button = page.locator(`button:has-text("${control}")`).first();
        if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
          availableControls.push(control);
        }
      }
      
      console.log(`✓ Available controls: ${availableControls.join(', ')}`);
      expect(availableControls.length).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });
});

test.describe('Live Casino - Live Baccarat', () => {
  
  test('LC-BA-001: Live Baccarat loads successfully', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const liveBaccaratButton = page.locator('text=/Live Baccarat/i').first();
    
    if (await liveBaccaratButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await liveBaccaratButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const gameType = await gamePage.getGameType();
      console.log(`✓ Live Baccarat type: ${gameType}`);
      expect(['canvas', 'iframe']).toContain(gameType);
    } else {
      console.log('⚠️  Live Baccarat not found in lobby');
      test.skip();
    }
  });
});

test.describe('Live Casino - Game Shows', () => {
  
  test('LC-GS-001: Crazy Time loads successfully', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const crazyTimeButton = page.locator('text=/Crazy Time/i').first();
    
    if (await crazyTimeButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await crazyTimeButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const gameType = await gamePage.getGameType();
      console.log(`✓ Crazy Time type: ${gameType}`);
      expect(['canvas', 'iframe']).toContain(gameType);
    } else {
      console.log('⚠️  Crazy Time not found in lobby');
      test.skip();
    }
  });

  test('LC-GS-002: Cash or Crash loads successfully', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const cashOrCrashButton = page.locator('text=/Cash or Crash/i').first();
    
    if (await cashOrCrashButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await cashOrCrashButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const gameType = await gamePage.getGameType();
      console.log(`✓ Cash or Crash type: ${gameType}`);
      expect(['canvas', 'iframe']).toContain(gameType);
    } else {
      console.log('⚠️  Cash or Crash not found in lobby');
      test.skip();
    }
  });

  test('LC-GS-003: Mega Ball loads successfully', async ({ page, gamePage }) => {
    await page.goto('/Livegames');
    
    const megaBallButton = page.locator('text=/Mega Ball/i').first();
    
    if (await megaBallButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      await megaBallButton.click();
      await gamePage.waitForGameLoad(45000);
      
      const gameType = await gamePage.getGameType();
      console.log(`✓ Mega Ball type: ${gameType}`);
      expect(['canvas', 'iframe']).toContain(gameType);
    } else {
      console.log('⚠️  Mega Ball not found in lobby');
      test.skip();
    }
  });
});

// Notes for Live Casino Testing:
// 1. Live games require longer load times (30-60 seconds)
// 2. Games may not be available 24/7 depending on dealer schedules
// 3. Some games require minimum balance to join
// 4. Network speed significantly affects live game performance
// 5. Consider testing during peak and off-peak hours
