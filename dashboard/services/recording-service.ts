/**
 * Recording Service
 *
 * Wraps Playwright HAR recording with feature flag support.
 * Replicates the flow from HarRecorder but conditionally skips steps
 * based on FeatureFlags. Uses the same page objects without modification.
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { CasinoLobbyPage } from '../../pages/CasinoLobbyPage';
import { GamePage } from '../../pages/GamePage';
import { HarRecordingConfig } from '../../utils/har-recorder';
import { performGameplay, resolveGameCategory } from '../../utils/gameplay-actions';
import { FeatureFlags, GameInput, DEFAULT_FEATURES, DashboardHarRecordResult } from '../types/dashboard-types';
import { ScreenshotService } from './screenshot-service';
import { progressEmitter } from '../routes/sse-routes';
import * as path from 'path';
import * as fs from 'fs';

export class RecordingService {
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
      proxy: 'bypass',
      ignoreHTTPSErrors: true,
      ...config,
    };
    this.harOutputDir = path.resolve(process.cwd(), this.config.outputDir);
    this.baseURL = process.env.BASE_URL || 'https://www.betway.co.za';

    if (!fs.existsSync(this.harOutputDir)) {
      fs.mkdirSync(this.harOutputDir, { recursive: true });
    }
  }

  private emit(type: string, payload: any) {
    progressEmitter.emit('progress', { type, payload });
  }

  async recordGame(
    game: GameInput,
    features: FeatureFlags = DEFAULT_FEATURES,
    sessionId: string,
    gameIndex: number,
    totalGames: number
  ): Promise<DashboardHarRecordResult> {
    const startTime = Date.now();
    const sanitizedName = game.id.replace(/[^a-z0-9-]/g, '-');
    const harFilePath = path.join(this.harOutputDir, `${sanitizedName}.har`);
    const screenshotService = new ScreenshotService();

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let screenshotLanding: string | undefined;
    let screenshotBet: string | undefined;
    let screenshotSpin: string | undefined;

    // Merge per-game features if present
    const effectiveFeatures = game.features || features;

    // Resolve game category for type-aware gameplay
    const category = resolveGameCategory(game);

    // Build step list
    const steps: string[] = [];
    if (effectiveFeatures.login) steps.push('login');
    if (effectiveFeatures.lobbyNavigation) steps.push('lobby');
    if (effectiveFeatures.gameLaunch) steps.push('game-launch');
    if (effectiveFeatures.gameplay !== false) {
      steps.push(`gameplay-${category}`);
    } else {
      if (effectiveFeatures.betAdjustment) steps.push('bet');
      if (effectiveFeatures.spin) steps.push('spin');
    }

    this.emit('recording:game-start', {
      gameId: game.id, gameName: game.name, gameIndex, totalGames, steps,
    });

    try {
      // Launch browser with same options as HarRecorder
      const launchOptions: any = { headless: this.config.headless };
      if (this.config.proxy === 'bypass' || this.config.proxy === 'direct') {
        launchOptions.args = ['--no-proxy-server'];
      } else if (this.config.proxy) {
        launchOptions.proxy = { server: this.config.proxy };
      }
      browser = await chromium.launch(launchOptions);

      context = await browser.newContext({
        recordHar: { path: harFilePath, urlFilter: '**/*' },
        baseURL: this.baseURL,
        viewport: { width: 1366, height: 768 },
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
        ignoreHTTPSErrors: this.config.ignoreHTTPSErrors ?? false,
      });

      const page: Page = await context.newPage();
      let stepIndex = 0;

      // Step: Login
      if (effectiveFeatures.login) {
        stepIndex++;
        this.emit('recording:step', { gameId: game.id, step: 'login', stepIndex, totalSteps: steps.length });
        this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: Logging in...`, level: 'info', timestamp: Date.now() });
        const loginPage = new LoginPage(page);
        await loginPage.gotoHome();
        await loginPage.login(
          process.env.BETWAY_USERNAME || '222212222',
          process.env.BETWAY_PASSWORD || '1234567890'
        );
      }

      // Step: Lobby Navigation
      if (effectiveFeatures.lobbyNavigation) {
        stepIndex++;
        this.emit('recording:step', { gameId: game.id, step: 'lobby', stepIndex, totalSteps: steps.length });
        this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: Navigating lobby...`, level: 'info', timestamp: Date.now() });
        const lobbyPage = new CasinoLobbyPage(page);
        if (category === 'slots') await lobbyPage.gotoSlots();
        else if (category === 'live-casino') await lobbyPage.gotoLiveGames();
        else if (category === 'table-game') await lobbyPage.gotoTableGames();
        else await lobbyPage.goto();

        if (effectiveFeatures.gameLaunch) {
          await lobbyPage.openGame(game.name, 'play');
        }
      } else if (effectiveFeatures.gameLaunch) {
        // Skip lobby, navigate directly to game URL
        stepIndex++;
        this.emit('recording:step', { gameId: game.id, step: 'game-launch', stepIndex, totalSteps: steps.length });
        this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: Direct game launch...`, level: 'info', timestamp: Date.now() });
        await page.goto(game.url);
      }

      // Step: Game Launch / Wait for load
      if (effectiveFeatures.gameLaunch) {
        if (effectiveFeatures.lobbyNavigation) {
          stepIndex++;
          this.emit('recording:step', { gameId: game.id, step: 'game-launch', stepIndex, totalSteps: steps.length });
          this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: Waiting for game load...`, level: 'info', timestamp: Date.now() });
        }
        const gamePage = new GamePage(page);
        await gamePage.waitForGameLoad(this.config.gameLoadTimeout);

        // Screenshot: Landing page (after game load)
        screenshotLanding = await screenshotService.capture(page, game.id, 'landing');
        if (screenshotLanding) this.emit('log', { message: `[${game.name}] Screenshot captured: landing`, level: 'info', timestamp: Date.now() });
      }

      // Step: Type-aware Gameplay
      if (effectiveFeatures.gameplay !== false) {
        stepIndex++;
        const stepName = `gameplay-${category}`;
        this.emit('recording:step', { gameId: game.id, step: stepName, stepIndex, totalSteps: steps.length });
        this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: ${category} gameplay...`, level: 'info', timestamp: Date.now() });
        const gamePage = new GamePage(page);

        const gameplayResult = await performGameplay(page, gamePage, category, {
          postActionWaitMs: this.config.postSpinWaitMs,
          betIncreaseTimes: this.config.betIncreaseTimes,
          subType: game.subType,
          gameLoadTimeout: this.config.gameLoadTimeout,
        });
        this.emit('log', { message: `[${game.name}] Gameplay actions: ${gameplayResult.actionsPerformed.join(', ')}`, level: 'info', timestamp: Date.now() });

        // Screenshot: After gameplay (result state)
        screenshotSpin = await screenshotService.capture(page, game.id, 'spin');
        if (screenshotSpin) this.emit('log', { message: `[${game.name}] Screenshot captured: post-gameplay`, level: 'info', timestamp: Date.now() });
      } else {
        // Legacy: separate bet + spin steps
        if (effectiveFeatures.betAdjustment) {
          stepIndex++;
          this.emit('recording:step', { gameId: game.id, step: 'bet', stepIndex, totalSteps: steps.length });
          this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: Adjusting bet...`, level: 'info', timestamp: Date.now() });
          const gamePage = new GamePage(page);
          try { await gamePage.increaseBet(this.config.betIncreaseTimes); }
          catch { this.emit('log', { message: `[${game.name}] Bet adjust skipped (canvas controls)`, level: 'warn', timestamp: Date.now() }); }

          screenshotBet = await screenshotService.capture(page, game.id, 'bet');
          if (screenshotBet) this.emit('log', { message: `[${game.name}] Screenshot captured: bet`, level: 'info', timestamp: Date.now() });
        }

        if (effectiveFeatures.spin) {
          stepIndex++;
          this.emit('recording:step', { gameId: game.id, step: 'spin', stepIndex, totalSteps: steps.length });
          this.emit('log', { message: `[${game.name}] Step ${stepIndex}/${steps.length}: Spinning...`, level: 'info', timestamp: Date.now() });
          const gamePage = new GamePage(page);
          try {
            await gamePage.spin();
            await gamePage.waitForSpinComplete(15000);
          } catch { this.emit('log', { message: `[${game.name}] Spin skipped (canvas controls)`, level: 'warn', timestamp: Date.now() }); }

          screenshotSpin = await screenshotService.capture(page, game.id, 'spin');
          if (screenshotSpin) this.emit('log', { message: `[${game.name}] Screenshot captured: spin`, level: 'info', timestamp: Date.now() });
        }
      }

      // Wait for trailing requests, close context to flush HAR
      await page.waitForTimeout(this.config.postSpinWaitMs);
      await context.close();
      context = null;

      const durationMs = Date.now() - startTime;
      const totalEntries = this.countHarEntries(harFilePath);

      this.emit('recording:game-complete', {
        gameId: game.id, success: true, totalEntries, durationMs,
      });
      this.emit('log', { message: `[${game.name}] Recording complete: ${totalEntries} entries (${durationMs}ms)`, level: 'info', timestamp: Date.now() });

      return { gameName: game.name, gameId: game.id, harFilePath, success: true, durationMs, totalEntries, screenshotLanding, screenshotBet, screenshotSpin };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      if (context) { try { await context.close(); } catch { /* ignore */ } }
      const totalEntries = this.countHarEntries(harFilePath);

      this.emit('recording:game-complete', {
        gameId: game.id, success: false, error: error.message, totalEntries, durationMs,
      });
      this.emit('log', { message: `[${game.name}] FAILED: ${error.message}`, level: 'error', timestamp: Date.now() });

      return { gameName: game.name, gameId: game.id, harFilePath, success: false, error: error.message, durationMs, totalEntries, screenshotLanding, screenshotBet, screenshotSpin };
    } finally {
      if (browser) await browser.close();
    }
  }

  async recordAllGames(
    games: GameInput[],
    features: FeatureFlags,
    sessionId: string
  ): Promise<DashboardHarRecordResult[]> {
    const results: DashboardHarRecordResult[] = [];

    this.emit('recording:start', { sessionId, totalGames: games.length, games: games.map(g => ({ id: g.id, name: g.name })) });

    for (let i = 0; i < games.length; i++) {
      const result = await this.recordGame(games[i], features, sessionId, i + 1, games.length);
      results.push(result);
      if (i < games.length - 1) await new Promise(resolve => setTimeout(resolve, 2000));
    }

    this.emit('recording:complete', { sessionId, results });
    return results;
  }

  private countHarEntries(harFilePath: string): number {
    try {
      if (!fs.existsSync(harFilePath)) return 0;
      const content = fs.readFileSync(harFilePath, 'utf-8');
      return JSON.parse(content).log?.entries?.length || 0;
    } catch { return 0; }
  }
}
