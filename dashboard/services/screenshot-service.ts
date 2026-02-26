/**
 * Screenshot Service
 *
 * Captures and stores screenshots during recording at key moments.
 * Screenshots are saved to: load-test-reports/screenshots/{game-id}/{step}.png
 */

import { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

export class ScreenshotService {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), 'load-test-reports', 'screenshots');
  }

  /**
   * Ensure the screenshot directory exists for a given game.
   */
  private ensureDir(gameId: string): string {
    const dir = path.join(this.baseDir, gameId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Capture a screenshot and save it to disk.
   * Returns the absolute file path of the saved screenshot, or undefined on failure.
   */
  async capture(page: Page, gameId: string, step: 'landing' | 'bet' | 'spin' | 'gameplay'): Promise<string | undefined> {
    try {
      const dir = this.ensureDir(gameId);
      const filePath = path.join(dir, `${step}.png`);
      await page.screenshot({ path: filePath, fullPage: false });
      return filePath;
    } catch {
      return undefined;
    }
  }

  /**
   * Read a screenshot file as a base64-encoded data URI for embedding in HTML.
   */
  static toBase64DataUri(filePath: string): string | undefined {
    try {
      if (!fs.existsSync(filePath)) return undefined;
      const buffer = fs.readFileSync(filePath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return undefined;
    }
  }
}
