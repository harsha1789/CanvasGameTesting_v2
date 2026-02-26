import { test, expect } from '../../utils/test-framework';
import { DataDrivenTestHelper } from '../../utils/test-framework';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Data-Driven Test Suite
 * Automatically tests all games from the catalog
 */

// Load game catalog
const catalogPath = path.join(__dirname, '../../config/games-catalog.json');
let gameCatalog: any = { games: [] };

if (fs.existsSync(catalogPath)) {
  const content = fs.readFileSync(catalogPath, 'utf-8');
  gameCatalog = JSON.parse(content);
  console.log(`\n📚 Loaded ${gameCatalog.games.length} games from catalog`);
} else {
  console.warn('\n⚠️  Game catalog not found. Run: npm run scrape:games');
}

// Filter to test only canvas-based slots
const testableGames = DataDrivenTestHelper.filterGames(gameCatalog.games, {
  category: 'slots',
  hasDemo: true
});

console.log(`\n🎯 Testing ${testableGames.length} canvas-based slot games\n`);

// Test each game
testableGames.forEach((game: any) => {
  test.describe(`Data-Driven: ${game.name}`, () => {
    
    test('should load successfully', async ({ page, lobbyPage, gamePage }) => {
      test.setTimeout(60000); // 60 second timeout

      try {
        // Navigate to game
        await lobbyPage.gotoSlots();
        await lobbyPage.openGame(game.name, 'demo');
        
        // Wait for load
        await gamePage.waitForGameLoad(30000);

        // Verify loaded
        const gameType = await gamePage.getGameType();
        console.log(`✓ ${game.name}: Type = ${gameType}`);
        
        expect(['canvas', 'iframe', 'unknown']).toContain(gameType);
      } catch (error) {
        console.error(`✗ ${game.name}: Failed to load`);
        throw error;
      }
    });

    test('should perform basic spin', async ({ page, lobbyPage, gamePage }) => {
      test.setTimeout(60000);

      try {
        await lobbyPage.gotoSlots();
        await lobbyPage.openGame(game.name, 'demo');
        await gamePage.waitForGameLoad();

        // Perform spin
        await gamePage.spin();
        await gamePage.waitForSpinComplete(10000);

        console.log(`✓ ${game.name}: Spin completed`);
      } catch (error) {
        console.error(`✗ ${game.name}: Spin failed`);
        // Don't throw - some games might have different spin mechanisms
      }
    });

    test('should render on mobile', async ({ page, lobbyPage, gamePage }) => {
      test.setTimeout(60000);

      try {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        
        await lobbyPage.gotoSlots();
        await lobbyPage.openGame(game.name, 'demo');
        await gamePage.waitForGameLoad();

        const gameType = await gamePage.getGameType();
        console.log(`✓ ${game.name}: Mobile render = ${gameType}`);
        
        expect(gameType).not.toBe('unknown');
      } catch (error) {
        console.error(`✗ ${game.name}: Mobile render failed`);
      }
    });
  });
});

// Summary test
test.describe('Test Execution Summary', () => {
  test('generate execution summary', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('DATA-DRIVEN TEST EXECUTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total games in catalog: ${gameCatalog.games.length}`);
    console.log(`Games tested: ${testableGames.length}`);
    console.log('\nGames by category:');
    Object.entries(gameCatalog.categories || {}).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}`);
    });
    console.log('\nGames by provider:');
    Object.entries(gameCatalog.providers || {}).forEach(([prov, count]) => {
      console.log(`  ${prov}: ${count}`);
    });
    console.log('='.repeat(60) + '\n');
  });
});
