import { test as base } from '@playwright/test';
import { CasinoLobbyPage } from '../pages/CasinoLobbyPage';
import { GamePage } from '../pages/GamePage';
import { LoginPage } from '../pages/LoginPage';
import { GameValidator } from '../utils/game-validator';
import { CanvasHelper } from '../utils/canvas-helper';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Data-Driven Test Framework
 * Extends Playwright test with custom fixtures and data loading
 */

// Define custom fixtures
type CustomFixtures = {
  lobbyPage: CasinoLobbyPage;
  gamePage: GamePage;
  loginPage: LoginPage;
  validator: GameValidator;
  canvasHelper: CanvasHelper;
  gameData: any;
};

// Extend base test with custom fixtures
export const test = base.extend<CustomFixtures>({
  // Patch page.screenshot() for heavy canvas games to avoid long "waiting for fonts"
  // and full-page capture overhead. Falls back to the original page screenshot.
  page: async ({ page }, use) => {
    const original = page.screenshot.bind(page);

    (page as any).screenshot = async (options: any = {}) => {
      // If caller explicitly requests special page screenshot features, keep default behavior.
      if (options?.fullPage || options?.clip || options?.mask || options?.style) {
        return await original(options);
      }

      try {
        const canvas = page.locator('canvas').first();
        if (await canvas.isVisible({ timeout: 750 }).catch(() => false)) {
          return await canvas.screenshot({
            // Preserve any explicit timeout, otherwise allow canvas capture to take longer.
            timeout: options?.timeout ?? 60_000,
          });
        }
      } catch {
        // Ignore and fall back to full page screenshot.
      }

      return await original({ timeout: options?.timeout ?? 60_000, ...options });
    };

    await use(page);
  },

  lobbyPage: async ({ page }, use) => {
    const lobbyPage = new CasinoLobbyPage(page);
    await use(lobbyPage);
  },

  gamePage: async ({ page }, use) => {
    const gamePage = new GamePage(page);
    await use(gamePage);
  },

  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  validator: async ({ page }, use) => {
    const validator = new GameValidator(page);
    await use(validator);
  },

  canvasHelper: async ({ page }, use) => {
    const canvasHelper = new CanvasHelper(page);
    await use(canvasHelper);
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  gameData: async ({}, use: (data: Record<string, unknown>) => Promise<void>) => {
    // Load game catalog
    const catalogPath = path.join(__dirname, '../config/games-catalog.json');
    let gameData: Record<string, unknown> = {};

    if (fs.existsSync(catalogPath)) {
      const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
      gameData = JSON.parse(catalogContent);
    }

    await use(gameData);
  }
});

export { expect } from '@playwright/test';

/**
 * Data-driven test helper
 */
export class DataDrivenTestHelper {
  /**
   * Load test data from JSON file
   */
  static loadTestData<T>(filename: string): T[] {
    const filePath = path.join(__dirname, '../config', filename);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`Test data file not found: ${filename}`);
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Error loading test data from ${filename}:`, error);
      return [];
    }
  }

  /**
   * Filter games by criteria
   */
  static filterGames(
    games: any[],
    criteria: {
      category?: string;
      provider?: string;
      gameType?: string;
      hasDemo?: boolean;
    }
  ): any[] {
    return games.filter(game => {
      if (criteria.category && game.category !== criteria.category) return false;
      if (criteria.provider && game.provider !== criteria.provider) return false;
      if (criteria.gameType && game.gameType !== criteria.gameType) return false;
      if (criteria.hasDemo !== undefined && game.hasDemo !== criteria.hasDemo) return false;
      return true;
    });
  }

  /**
   * Generate test matrix (for cross-browser/device testing)
   */
  static generateTestMatrix(
    games: string[],
    browsers: string[],
    viewports: Array<{ width: number; height: number; name: string }>
  ): Array<{
    game: string;
    browser: string;
    viewport: { width: number; height: number; name: string };
  }> {
    const matrix: any[] = [];

    for (const game of games) {
      for (const browser of browsers) {
        for (const viewport of viewports) {
          matrix.push({ game, browser, viewport });
        }
      }
    }

    return matrix;
  }

  /**
   * Load region-specific configuration
   */
  static loadRegionConfig(region: string): {
    baseURL: string;
    locale: string;
    currency: string;
    timezone: string;
  } {
    const regionConfigs: Record<string, any> = {
      'za': {
        baseURL: 'https://www.betway.co.za',
        locale: 'en-ZA',
        currency: 'ZAR',
        timezone: 'Africa/Johannesburg'
      },
      'ng': {
        baseURL: 'https://www.betway.com.ng',
        locale: 'en-NG',
        currency: 'NGN',
        timezone: 'Africa/Lagos'
      },
      'ke': {
        baseURL: 'https://www.betway.co.ke',
        locale: 'en-KE',
        currency: 'KES',
        timezone: 'Africa/Nairobi'
      },
      'gh': {
        baseURL: 'https://www.betway.com.gh',
        locale: 'en-GH',
        currency: 'GHS',
        timezone: 'Africa/Accra'
      }
    };

    return regionConfigs[region] || regionConfigs['za'];
  }

  /**
   * Create test report
   */
  static generateTestReport(results: any[], outputPath: string): void {
    const report = {
      timestamp: new Date().toISOString(),
      totalTests: results.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      results: results
    };

    const reportDir = path.dirname(outputPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\nTest report saved to: ${outputPath}`);
  }

  /**
   * Save test results to CSV
   */
  static saveResultsToCSV(results: any[], outputPath: string): void {
    const headers = ['Game', 'Test', 'Status', 'Duration', 'Timestamp'];
    const rows = results.map(r => [
      r.game || 'N/A',
      r.test || 'N/A',
      r.status || 'N/A',
      `${r.duration || 0}ms`,
      r.timestamp || new Date().toISOString()
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    fs.writeFileSync(outputPath, csv);
    console.log(`\nCSV report saved to: ${outputPath}`);
  }
}

/**
 * Test execution helpers
 */
export class TestExecutionHelper {
  /**
   * Retry wrapper with exponential backoff
   */
  static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Measure test execution time
   */
  static async measureExecutionTime<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    const result = await fn();
    const duration = Date.now() - startTime;
    
    console.log(`${name} completed in ${duration}ms`);
    return { result, duration };
  }

  /**
   * Take screenshot on failure
   */
  static async screenshotOnFailure(
    page: any,
    testInfo: any
  ): Promise<void> {
    if (testInfo.status !== 'passed') {
      const screenshot = await page.screenshot();
      await testInfo.attach('failure-screenshot', {
        body: screenshot,
        contentType: 'image/png'
      });
    }
  }
}
