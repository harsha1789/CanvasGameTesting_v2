/**
 * HAR Load Test Runner
 *
 * Main entry-point script that orchestrates the full flow:
 *   1. Load game catalog and configuration
 *   2. Launch each game one-by-one, recording a .HAR file (login → bet → spin)
 *   3. Run a load test on each game using its captured .HAR file
 *   4. Generate a consolidated HTML report
 *
 * Usage:
 *   npx ts-node scripts/har-load-test-runner.ts
 *   npx ts-node scripts/har-load-test-runner.ts --games "Hot Hot Betway,Starburst"
 *   npx ts-node scripts/har-load-test-runner.ts --skip-recording   (reuse existing HAR files)
 *   npx ts-node scripts/har-load-test-runner.ts --skip-load-test   (only record HARs)
 *   npx ts-node scripts/har-load-test-runner.ts --virtual-users 10 --iterations 3
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { HarRecorder, GameConfig, HarRecordResult } from '../utils/har-recorder';
import { HarLoadTester, LoadTestResult, LoadTestConfig } from '../utils/har-load-tester';
import { LoadTestReportGenerator } from '../utils/load-test-report-generator';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Full configuration loaded from har-load-test-config.json
 */
interface RunnerConfig {
  harRecording: {
    outputDir: string;
    headless: boolean;
    gameLoadTimeout: number;
    postSpinWaitMs: number;
    betIncreaseTimes: number;
    proxy?: string;
    ignoreHTTPSErrors?: boolean;
  };
  loadTest: {
    virtualUsers: number;
    iterations: number;
    rampUpSeconds: number;
    thinkTimeMs: number;
    timeoutMs: number;
    includeStaticAssets: boolean;
  };
  report: {
    outputDir: string;
    title: string;
  };
  gameFilter: {
    categories: string[];
    providers: string[];
    gameIds: string[];
    excludeGameIds: string[];
  };
}

/**
 * Parse command-line arguments.
 */
function parseArgs(): {
  games?: string[];
  skipRecording: boolean;
  skipLoadTest: boolean;
  virtualUsers?: number;
  iterations?: number;
  headless?: boolean;
} {
  const args = process.argv.slice(2);
  const result: ReturnType<typeof parseArgs> = {
    skipRecording: false,
    skipLoadTest: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--games':
        result.games = args[++i]?.split(',').map(g => g.trim());
        break;
      case '--skip-recording':
        result.skipRecording = true;
        break;
      case '--skip-load-test':
        result.skipLoadTest = true;
        break;
      case '--virtual-users':
        result.virtualUsers = parseInt(args[++i], 10);
        break;
      case '--iterations':
        result.iterations = parseInt(args[++i], 10);
        break;
      case '--headless':
        result.headless = true;
        break;
      case '--help':
        printUsage();
        process.exit(0);
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
HAR Load Test Runner - Betway Automation Framework
===================================================

Usage:
  npx ts-node scripts/har-load-test-runner.ts [options]

Options:
  --games "Game1,Game2"    Run only specific games (comma-separated names)
  --skip-recording         Skip HAR recording; reuse existing HAR files
  --skip-load-test         Skip load test; only record HAR files
  --virtual-users N        Override number of virtual users (default: from config)
  --iterations N           Override iterations per user (default: from config)
  --headless               Run browser in headless mode
  --help                   Show this help message

Configuration:
  Edit config/har-load-test-config.json to customize default settings.

Examples:
  npx ts-node scripts/har-load-test-runner.ts
  npx ts-node scripts/har-load-test-runner.ts --games "Starburst,Aviator"
  npx ts-node scripts/har-load-test-runner.ts --skip-recording --virtual-users 10
  npx ts-node scripts/har-load-test-runner.ts --skip-load-test
`);
}

/**
 * Load runner configuration from JSON file.
 */
function loadConfig(): RunnerConfig {
  const configPath = path.resolve(__dirname, '..', 'config', 'har-load-test-config.json');

  if (!fs.existsSync(configPath)) {
    console.warn(`Config file not found at ${configPath}. Using defaults.`);
    return {
      harRecording: {
        outputDir: 'har-files',
        headless: false,
        gameLoadTimeout: 60000,
        postSpinWaitMs: 5000,
        betIncreaseTimes: 1,
      },
      loadTest: {
        virtualUsers: 5,
        iterations: 2,
        rampUpSeconds: 5,
        thinkTimeMs: 500,
        timeoutMs: 30000,
        includeStaticAssets: false,
      },
      report: {
        outputDir: 'load-test-reports',
        title: 'Betway Game Load Test Report',
      },
      gameFilter: {
        categories: [],
        providers: [],
        gameIds: [],
        excludeGameIds: [],
      },
    };
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as RunnerConfig;
}

/**
 * Load game catalog and apply filters.
 */
function loadGames(config: RunnerConfig, cliGames?: string[]): GameConfig[] {
  const catalogPath = path.resolve(__dirname, '..', 'config', 'games-catalog.json');

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Game catalog not found at ${catalogPath}`);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  let games: GameConfig[] = catalog.games || [];

  // Apply CLI game name filter
  if (cliGames && cliGames.length > 0) {
    const lowerNames = cliGames.map(g => g.toLowerCase());
    games = games.filter(g => lowerNames.some(n => g.name.toLowerCase().includes(n)));
  }

  // Apply config filters
  const filter = config.gameFilter;

  if (filter.gameIds.length > 0) {
    games = games.filter(g => filter.gameIds.includes(g.id));
  }
  if (filter.categories.length > 0) {
    games = games.filter(g => filter.categories.includes(g.category));
  }
  if (filter.providers.length > 0) {
    games = games.filter(g => filter.providers.includes(g.provider));
  }
  if (filter.excludeGameIds.length > 0) {
    games = games.filter(g => !filter.excludeGameIds.includes(g.id));
  }

  return games;
}

/**
 * Main runner function.
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  const cliArgs = parseArgs();
  const config = loadConfig();

  // Apply CLI overrides
  if (cliArgs.virtualUsers) config.loadTest.virtualUsers = cliArgs.virtualUsers;
  if (cliArgs.iterations) config.loadTest.iterations = cliArgs.iterations;
  if (cliArgs.headless !== undefined) config.harRecording.headless = cliArgs.headless;

  console.log('========================================');
  console.log(' Betway HAR Load Test Runner');
  console.log('========================================');
  console.log(`Skip Recording: ${cliArgs.skipRecording}`);
  console.log(`Skip Load Test: ${cliArgs.skipLoadTest}`);
  console.log(`Virtual Users:  ${config.loadTest.virtualUsers}`);
  console.log(`Iterations:     ${config.loadTest.iterations}`);
  console.log(`Headless:       ${config.harRecording.headless}`);
  console.log(`Proxy:          ${config.harRecording.proxy || 'none'}`);

  // Load games
  const games = loadGames(config, cliArgs.games);

  if (games.length === 0) {
    console.error('\nNo games found matching the filters. Exiting.');
    process.exit(1);
  }

  console.log(`\nGames to process (${games.length}):`);
  games.forEach((g, i) => console.log(`  ${i + 1}. ${g.name} (${g.provider}) [${g.category}]`));

  // ── Phase 1: Record HARs ──
  let harResults: HarRecordResult[] = [];

  if (!cliArgs.skipRecording) {
    console.log('\n\n╔══════════════════════════════════════╗');
    console.log('║     PHASE 1: HAR RECORDING           ║');
    console.log('╚══════════════════════════════════════╝');

    const recorder = new HarRecorder({
      outputDir: config.harRecording.outputDir,
      headless: config.harRecording.headless,
      gameLoadTimeout: config.harRecording.gameLoadTimeout,
      postSpinWaitMs: config.harRecording.postSpinWaitMs,
      proxy: config.harRecording.proxy,
      ignoreHTTPSErrors: config.harRecording.ignoreHTTPSErrors,
      betIncreaseTimes: config.harRecording.betIncreaseTimes,
    });

    harResults = await recorder.recordAllGames(games);
  } else {
    console.log('\n\nSkipping HAR recording (--skip-recording). Using existing HAR files.');

    // Build results from existing HAR files
    const harDir = path.resolve(process.cwd(), config.harRecording.outputDir);
    harResults = games.map(g => {
      const harPath = path.join(harDir, `${g.id}.har`);
      const exists = fs.existsSync(harPath);
      let totalEntries = 0;
      if (exists) {
        try {
          const content = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
          totalEntries = content.log?.entries?.length || 0;
        } catch { /* ignore */ }
      }
      return {
        gameName: g.name,
        gameId: g.id,
        harFilePath: harPath,
        success: exists,
        error: exists ? undefined : 'HAR file not found',
        durationMs: 0,
        totalEntries,
      };
    });
  }

  // ── Phase 2: Load Tests ──
  let loadTestResults: LoadTestResult[] = [];

  if (!cliArgs.skipLoadTest) {
    console.log('\n\n╔══════════════════════════════════════╗');
    console.log('║     PHASE 2: LOAD TESTING            ║');
    console.log('╚══════════════════════════════════════╝');

    const loadTester = new HarLoadTester();

    const successfulHars = harResults.filter(r => r.success && r.totalEntries > 0);

    if (successfulHars.length === 0) {
      console.warn('\nNo successful HAR recordings with entries. Skipping load tests.');
    } else {
      console.log(`\nRunning load tests for ${successfulHars.length} game(s)...`);

      const loadTestConfig: Partial<LoadTestConfig> = {
        virtualUsers: config.loadTest.virtualUsers,
        iterations: config.loadTest.iterations,
        rampUpSeconds: config.loadTest.rampUpSeconds,
        thinkTimeMs: config.loadTest.thinkTimeMs,
        timeoutMs: config.loadTest.timeoutMs,
        includeStaticAssets: config.loadTest.includeStaticAssets,
      };

      for (const harResult of successfulHars) {
        try {
          const result = await loadTester.runLoadTest(
            harResult.gameName,
            harResult.gameId,
            harResult.harFilePath,
            loadTestConfig
          );
          loadTestResults.push(result);
        } catch (error: any) {
          console.error(`Load test failed for ${harResult.gameName}: ${error.message}`);
        }

        // Brief pause between load tests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } else {
    console.log('\n\nSkipping load tests (--skip-load-test).');
  }

  // ── Phase 3: Generate Report ──
  console.log('\n\n╔══════════════════════════════════════╗');
  console.log('║     PHASE 3: REPORT GENERATION       ║');
  console.log('╚══════════════════════════════════════╝');

  const reportGenerator = new LoadTestReportGenerator({
    outputDir: config.report.outputDir,
    title: config.report.title,
  });

  const reportPath = reportGenerator.generateReport(loadTestResults, harResults);

  // ── Final Summary ──
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n========================================');
  console.log(' RUN COMPLETE');
  console.log('========================================');
  console.log(`Total Duration:     ${totalDuration}s`);
  console.log(`Games Processed:    ${games.length}`);
  console.log(`HARs Recorded:      ${harResults.filter(r => r.success).length}/${harResults.length}`);
  console.log(`Load Tests Run:     ${loadTestResults.length}`);
  console.log(`Report:             ${reportPath}`);
  console.log('========================================\n');
}

// Run
main().catch(error => {
  console.error('\nFATAL ERROR:', error);
  process.exit(1);
});
