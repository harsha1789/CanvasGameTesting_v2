/**
 * Generate Test Configuration from CSV
 *
 * This script reads a CSV file with game details and generates
 * the configuration file for the game launch checklist tests.
 *
 * Usage:
 *   npx ts-node scripts/generate-test-config-from-csv.ts <csv-file-path>
 *
 * CSV Format for Games:
 *   Game ID, Game Name, Provider, Category, URL
 *
 * Example:
 *   G001,Aviator,Spribe,crash,/lobby/casino-games/game/aviator
 *   G002,Hot Hot Betway,Habanero,slots,/lobby/casino-games/game/hot-hot-betway
 */

import * as fs from 'fs';
import * as path from 'path';

interface GameConfig {
  id: string;
  name: string;
  provider: string;
  category: string;
  url: string;
}

/**
 * Parse CSV content into game configurations
 */
function parseGamesCSV(csvContent: string): GameConfig[] {
  const lines = csvContent.split('\n').filter(line => line.trim());
  const games: GameConfig[] = [];

  // Skip header if present
  const startIndex = lines[0].toLowerCase().includes('game') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV with quotes
    const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');

    if (parts.length >= 3) {
      const cleanPart = (s: string) => s?.replace(/^"|"$/g, '').trim() || '';

      const game: GameConfig = {
        id: cleanPart(parts[0]) || `G${String(games.length + 1).padStart(3, '0')}`,
        name: cleanPart(parts[1]),
        provider: cleanPart(parts[2]),
        category: cleanPart(parts[3]) || 'slots',
        url: cleanPart(parts[4]) || generateGameUrl(cleanPart(parts[1]))
      };

      if (game.name) {
        games.push(game);
      }
    }
  }

  return games;
}

/**
 * Generate game URL from game name
 */
function generateGameUrl(gameName: string): string {
  const slug = gameName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-');
  return `/lobby/casino-games/game/${slug}`;
}

/**
 * Generate the test configuration file
 */
function generateTestConfig(games: GameConfig[]): object {
  return {
    testConfig: {
      baseUrl: 'https://www.betway.co.za',
      maxLoadTimeSeconds: 10,
      screenshotOnPass: true,
      screenshotOnFail: true,
      retryOnFail: 1
    },
    credentials: {
      username: process.env.BETWAY_USERNAME || '222212222',
      password: process.env.BETWAY_PASSWORD || '1234567890'
    },
    browsers: [
      { name: 'Chrome', project: 'chromium' },
      { name: 'Firefox', project: 'firefox' },
      { name: 'Edge', project: 'chromium' },
      { name: 'Safari', project: 'webkit' }
    ],
    mobileDevices: [
      { name: 'Android - Pixel 5', device: 'Pixel 5', platform: 'Android' },
      { name: 'Android - Samsung Galaxy S21', device: 'Galaxy S21', platform: 'Android' },
      { name: 'iOS - iPhone 12', device: 'iPhone 12', platform: 'iOS' },
      { name: 'iOS - iPhone SE', device: 'iPhone SE', platform: 'iOS' },
      { name: 'iOS - iPad Pro', device: 'iPad Pro 11', platform: 'iOS' }
    ],
    games: games,
    testCases: [
      {
        testId: 'TC001',
        summary: 'Verify Game Launch on Web Browser',
        category: 'Web',
        steps: ['Open browser', 'Navigate to game URL', 'Click Play button'],
        expectedResult: 'Game loads successfully and displays game interface without errors'
      },
      {
        testId: 'TC002',
        summary: 'Test Game Loading Time',
        category: 'Web',
        steps: ['Open browser', 'Navigate to game URL', 'Measure load time'],
        expectedResult: 'Game loads within 10 seconds'
      },
      {
        testId: 'TC003',
        summary: 'Cross-Browser Compatibility',
        category: 'Web',
        steps: ['Test on Chrome', 'Test on Firefox', 'Test on Safari', 'Test on Edge'],
        expectedResult: 'Game launches successfully on all browsers'
      },
      {
        testId: 'TC004',
        summary: 'No Errors During Launch',
        category: 'Web',
        steps: ['Open game', 'Monitor console errors', 'Check for error popups'],
        expectedResult: 'No error messages or warnings appear'
      },
      {
        testId: 'TC005',
        summary: 'Game Launch on Android Device',
        category: 'Android',
        steps: ['Open mobile browser', 'Navigate to game', 'Launch game'],
        expectedResult: 'Game loads and displays correctly on Android'
      },
      {
        testId: 'TC006',
        summary: 'Android Device Compatibility',
        category: 'Android',
        steps: ['Test on multiple Android devices', 'Test different screen sizes'],
        expectedResult: 'Game launches on all Android devices without issues'
      },
      {
        testId: 'TC007',
        summary: 'Game Launch on iOS Device',
        category: 'iOS',
        steps: ['Open mobile browser', 'Navigate to game', 'Launch game'],
        expectedResult: 'Game loads and displays correctly on iOS'
      },
      {
        testId: 'TC008',
        summary: 'iOS Device Compatibility',
        category: 'iOS',
        steps: ['Test on multiple iOS devices', 'Test different screen sizes'],
        expectedResult: 'Game launches on all iOS devices without issues'
      }
    ]
  };
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  console.log('\n========================================');
  console.log('  GENERATE TEST CONFIG FROM CSV');
  console.log('========================================\n');

  // Check for CSV file argument
  let csvPath = args[0];

  if (!csvPath) {
    // Look for default CSV files
    const defaultPaths = [
      'config/games.csv',
      'games.csv',
      '../New Checklist  Test cases for verticals(Game Launch).csv'
    ];

    for (const p of defaultPaths) {
      if (fs.existsSync(p)) {
        csvPath = p;
        break;
      }
    }
  }

  if (!csvPath || !fs.existsSync(csvPath)) {
    console.log('No CSV file provided or found.');
    console.log('\nUsage: npx ts-node scripts/generate-test-config-from-csv.ts <csv-file>');
    console.log('\nYou can also create a games.csv file in the config folder with format:');
    console.log('Game ID, Game Name, Provider, Category, URL');
    console.log('G001,Aviator,Spribe,crash,/lobby/casino-games/game/aviator');
    console.log('\nGenerating default config with sample games...\n');

    // Generate default config
    const defaultGames: GameConfig[] = [
      { id: 'G001', name: 'Aviator', provider: 'Spribe', category: 'crash', url: '/lobby/casino-games/game/aviator' },
      { id: 'G002', name: 'Hot Hot Betway', provider: 'Habanero', category: 'slots', url: '/lobby/casino-games/game/hot-hot-betway' },
      { id: 'G003', name: 'Gates of Olympus', provider: 'Pragmatic Play', category: 'slots', url: '/lobby/casino-games/game/gates-of-olympus' },
      { id: 'G004', name: 'Starburst', provider: 'NetEnt', category: 'slots', url: '/lobby/casino-games/game/starburst' },
      { id: 'G005', name: 'Book of Dead', provider: "Play'n GO", category: 'slots', url: '/lobby/casino-games/game/book-of-dead' },
    ];

    const config = generateTestConfig(defaultGames);
    const outputPath = 'config/game-launch-test-config.json';
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

    console.log(`Default config generated: ${outputPath}`);
    console.log(`Games included: ${defaultGames.length}`);
    return;
  }

  // Read and parse CSV
  console.log(`Reading CSV: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const games = parseGamesCSV(csvContent);

  if (games.length === 0) {
    console.log('No games found in CSV file.');
    console.log('Expected format: Game ID, Game Name, Provider, Category, URL');
    return;
  }

  console.log(`Found ${games.length} games in CSV`);

  // Generate config
  const config = generateTestConfig(games);
  const outputPath = 'config/game-launch-test-config.json';
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

  console.log(`\nConfig generated: ${outputPath}`);
  console.log('\nGames included:');
  games.forEach((g, i) => {
    console.log(`  ${i + 1}. ${g.name} (${g.provider}) - ${g.category}`);
  });

  console.log('\nRun tests with:');
  console.log('  npx playwright test tests/validation/game-launch-checklist.spec.ts');
}

main().catch(console.error);
