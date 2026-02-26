import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { CasinoLobbyPage } from '../pages/CasinoLobbyPage';
import { GamePage } from '../pages/GamePage';
import { performGameplay, resolveGameCategory } from './gameplay-actions';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Game configuration from the catalog
 */
export interface GameConfig {
  id: string;
  name: string;
  url: string;
  category: string;
  provider: string;
  gameType: string;
  hasDemo: boolean;
}

/**
 * Result of recording a single game's HAR
 */
export interface HarRecordResult {
  gameName: string;
  gameId: string;
  harFilePath: string;
  success: boolean;
  error?: string;
  durationMs: number;
  totalEntries: number;
}

/**
 * Configuration for HAR recording
 */
export interface HarRecordingConfig {
  outputDir: string;
  headless: boolean;
  gameLoadTimeout: number;
  postSpinWaitMs: number;
  betIncreaseTimes: number;
  proxy?: string;
  ignoreHTTPSErrors?: boolean;
}

/**
 * HarRecorder - Records HAR files by launching games and performing bet/spin actions.
 *
 * Uses existing page objects (LoginPage, CasinoLobbyPage, GamePage) without modifying them.
 * Each game gets its own browser instance with Playwright's built-in HAR recording.
 */
export class HarRecorder {
  private harOutputDir: string;
  private baseURL: string;
  private config: HarRecordingConfig;

  constructor(config?: Partial<HarRecordingConfig>) {
    this.config = {
      outputDir: 'har-files',
      headless: false,
      gameLoadTimeout: 60000,
      postSpinWaitMs: 5000,
      betIncreaseTimes: 1,
      ...config,
    };

    this.harOutputDir = path.resolve(process.cwd(), this.config.outputDir);
    this.baseURL = process.env.BASE_URL || 'https://www.betway.co.za';

    if (!fs.existsSync(this.harOutputDir)) {
      fs.mkdirSync(this.harOutputDir, { recursive: true });
    }
  }

  /**
   * Record HAR file for a single game.
   * Flow: Launch browser with HAR → Login → Navigate → Open game → Bet → Spin → Close (saves HAR)
   */
  async recordGameHar(game: GameConfig): Promise<HarRecordResult> {
    const startTime = Date.now();
    const sanitizedName = game.id.replace(/[^a-z0-9-]/g, '-');
    const harFilePath = path.join(this.harOutputDir, `${sanitizedName}.har`);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      console.log(`\n========================================`);
      console.log(`Recording HAR for: ${game.name} (${game.provider})`);
      console.log(`========================================`);

      // Launch browser — bypass system proxy or use explicit proxy
      const launchOptions: any = { headless: this.config.headless };
      if (this.config.proxy === 'bypass' || this.config.proxy === 'direct') {
        // Tell Chromium to ignore system proxy entirely
        launchOptions.args = ['--no-proxy-server'];
      } else if (this.config.proxy) {
        launchOptions.proxy = { server: this.config.proxy };
      }
      browser = await chromium.launch(launchOptions);

      // Create context with HAR recording enabled
      context = await browser.newContext({
        recordHar: {
          path: harFilePath,
          urlFilter: '**/*',
        },
        baseURL: this.baseURL,
        viewport: { width: 1366, height: 768 },
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
        ignoreHTTPSErrors: this.config.ignoreHTTPSErrors ?? false,
      });

      const page: Page = await context.newPage();

      // Step 1: Login
      console.log('[1/4] Logging in...');
      const loginPage = new LoginPage(page);
      await loginPage.gotoHome();
      const loggedIn = await loginPage.login(
        process.env.BETWAY_USERNAME || '222212222',
        process.env.BETWAY_PASSWORD || '1234567890'
      );

      if (!loggedIn) {
        console.warn('  Login may have failed, continuing anyway...');
      } else {
        console.log('  Login successful');
      }

      // Step 2: Navigate to lobby and search for game
      const category = resolveGameCategory(game);
      console.log(`[2/4] Navigating to lobby and opening ${game.name} (${category})...`);
      const lobbyPage = new CasinoLobbyPage(page);

      if (category === 'slots') {
        await lobbyPage.gotoSlots();
      } else if (category === 'live-casino') {
        await lobbyPage.gotoLiveGames();
      } else if (category === 'table-game') {
        await lobbyPage.gotoTableGames();
      } else {
        await lobbyPage.goto();
      }

      await lobbyPage.openGame(game.name, 'play');

      // Step 3: Wait for game to load
      console.log('[3/4] Waiting for game to load...');
      const gamePage = new GamePage(page);
      await gamePage.waitForGameLoad(this.config.gameLoadTimeout);
      console.log('  Game loaded');

      // Step 4: Type-aware gameplay
      console.log(`[4/4] Performing ${category} gameplay...`);
      const gameplayResult = await performGameplay(page, gamePage, category, {
        postActionWaitMs: this.config.postSpinWaitMs,
        betIncreaseTimes: this.config.betIncreaseTimes,
        subType: (game as any).subType,
        gameLoadTimeout: this.config.gameLoadTimeout,
      });
      console.log(`  Actions: ${gameplayResult.actionsPerformed.join(', ')}`);

      // Close context to flush HAR to disk
      await context.close();
      context = null;

      const durationMs = Date.now() - startTime;

      // Count entries in the saved HAR
      const totalEntries = this.countHarEntries(harFilePath);

      console.log(`HAR saved: ${harFilePath}`);
      console.log(`  Entries: ${totalEntries}, Duration: ${durationMs}ms`);

      return {
        gameName: game.name,
        gameId: game.id,
        harFilePath,
        success: true,
        durationMs,
        totalEntries,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      console.error(`FAILED to record HAR for ${game.name}: ${error.message}`);

      // Attempt to close context so partial HAR is saved
      if (context) {
        try { await context.close(); } catch { /* ignore */ }
      }

      const totalEntries = this.countHarEntries(harFilePath);

      return {
        gameName: game.name,
        gameId: game.id,
        harFilePath,
        success: false,
        error: error.message,
        durationMs,
        totalEntries,
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Record HAR files for all provided games, one by one.
   */
  async recordAllGames(games: GameConfig[]): Promise<HarRecordResult[]> {
    const results: HarRecordResult[] = [];

    console.log(`\nStarting HAR recording for ${games.length} game(s)...`);
    console.log(`Output directory: ${this.harOutputDir}\n`);

    for (let i = 0; i < games.length; i++) {
      console.log(`\n[Game ${i + 1}/${games.length}]`);
      const result = await this.recordGameHar(games[i]);
      results.push(result);

      // Brief pause between games to let system resources settle
      if (i < games.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Print summary
    const successful = results.filter(r => r.success).length;
    console.log(`\n========================================`);
    console.log(`HAR Recording Summary`);
    console.log(`========================================`);
    console.log(`Total: ${results.length}, Success: ${successful}, Failed: ${results.length - successful}`);
    results.forEach(r => {
      const status = r.success ? 'OK' : 'FAIL';
      console.log(`  [${status}] ${r.gameName} - ${r.totalEntries} entries (${r.durationMs}ms)`);
    });

    return results;
  }

  /**
   * Count entries in a saved HAR file.
   */
  private countHarEntries(harFilePath: string): number {
    try {
      if (!fs.existsSync(harFilePath)) return 0;
      const content = fs.readFileSync(harFilePath, 'utf-8');
      const har = JSON.parse(content);
      return har.log?.entries?.length || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get the HAR output directory path.
   */
  getOutputDir(): string {
    return this.harOutputDir;
  }
}
