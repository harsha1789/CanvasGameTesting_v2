import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { CanvasHelper } from '../utils/canvas-helper';
import { findTemplateMatchMultiScale, findTemplateMatchRobust } from '../utils/image-template';

/**
 * Page Object Model for Individual Game Page
 */
export class GamePage {
  readonly page: Page;
  readonly canvasHelper: CanvasHelper;
  
  // Game container
  readonly gameContainer: Locator;
  readonly gameIframe: Locator;
  readonly gameCanvas: Locator;
  
  // Control buttons
  readonly spinButton: Locator;
  readonly autospinButton: Locator;
  readonly maxBetButton: Locator;
  readonly betIncreaseButton: Locator;
  readonly betDecreaseButton: Locator;
  
  // Info buttons
  readonly infoButton: Locator;
  readonly settingsButton: Locator;
  readonly menuButton: Locator;
  readonly closeButton: Locator;
  
  // Display elements
  readonly balanceDisplay: Locator;
  readonly betDisplay: Locator;
  readonly winDisplay: Locator;
  
  // Audio controls
  readonly muteButton: Locator;
  readonly volumeSlider: Locator;
  
  // Fullscreen
  readonly fullscreenButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.canvasHelper = new CanvasHelper(page);
    
    // Game container
    this.gameContainer = page.locator('#game-container, .game-container, .game-wrapper, #gameWrapper');
    this.gameIframe = page.locator('iframe[src*="game"], iframe.game-frame');
    this.gameCanvas = page.locator('canvas').first();
    
    // Control buttons - multiple possible selectors
    this.spinButton = page.locator(
      'button:has-text("Spin"), ' +
      '[class*="spin-button"], ' +
      '[id*="spin"], ' +
      'button[aria-label*="spin"]'
    ).first();
    
    this.autospinButton = page.locator(
      'button:has-text("Auto"), ' +
      '[class*="auto-spin"], ' +
      '[id*="autoplay"]'
    ).first();
    
    this.maxBetButton = page.locator(
      'button:has-text("Max"), ' +
      '[class*="max-bet"], ' +
      '[id*="maxbet"]'
    ).first();
    
    this.betIncreaseButton = page.locator(
      'button:has-text("+"), ' +
      '[class*="bet-up"], ' +
      '[class*="bet-increase"], ' +
      'button[aria-label*="increase"]'
    ).first();
    
    this.betDecreaseButton = page.locator(
      'button:has-text("-"), ' +
      '[class*="bet-down"], ' +
      '[class*="bet-decrease"], ' +
      'button[aria-label*="decrease"]'
    ).first();
    
    // Info buttons
    this.infoButton = page.locator(
      'button:has-text("Info"), ' +
      '[class*="info-button"], ' +
      '[id*="info"], ' +
      'button[aria-label*="info"]'
    ).first();
    
    this.settingsButton = page.locator(
      'button:has-text("Settings"), ' +
      '[class*="settings"], ' +
      'button[aria-label*="settings"]'
    ).first();
    
    this.menuButton = page.locator(
      'button:has-text("Menu"), ' +
      '[class*="menu-button"], ' +
      'button[aria-label*="menu"]'
    ).first();
    
    this.closeButton = page.locator(
      'button:has-text("Close"), ' +
      '[class*="close"], ' +
      'button[aria-label*="close"]'
    ).first();
    
    // Display elements
    this.balanceDisplay = page.locator(
      '[class*="balance"], ' +
      '[id*="balance"], ' +
      '.balance-value, ' +
      '[data-testid*="balance"]'
    ).first();
    
    this.betDisplay = page.locator(
      '[class*="bet-amount"], ' +
      '[id*="bet"], ' +
      '.bet-value, ' +
      '[data-testid*="bet"]'
    ).first();
    
    this.winDisplay = page.locator(
      '[class*="win"], ' +
      '[id*="win"], ' +
      '.win-value, ' +
      '[data-testid*="win"]'
    ).first();
    
    // Audio controls
    this.muteButton = page.locator(
      'button:has-text("Mute"), ' +
      '[class*="mute"], ' +
      '[class*="sound"], ' +
      'button[aria-label*="mute"]'
    ).first();
    
    this.volumeSlider = page.locator('input[type="range"], .volume-slider').first();
    
    // Fullscreen
    this.fullscreenButton = page.locator(
      'button:has-text("Fullscreen"), ' +
      '[class*="fullscreen"], ' +
      'button[aria-label*="fullscreen"]'
    ).first();
  }

  /**
   * Heuristic detection for GGL-hosted games that use canvas controls
   * (e.g. installprogram.eu hosts with 3-dot top-left menu flow).
   */
  private isLikelyGglGame(): boolean {
    const url = this.page.url().toLowerCase();
    return url.includes('installprogram.eu') || url.includes('-gtp') || url.includes('ggl');
  }

  /**
   * More robust (async) GGL detection: some canvas games navigate/replace the top-level URL,
   * but the frame URLs still reveal the provider host.
   */
  private async isLikelyGglGameNow(): Promise<boolean> {
    try {
      const urls = [this.page.url(), ...this.page.frames().map(f => f.url())]
        .filter(Boolean)
        .map(u => u.toLowerCase());
      return urls.some(u => u.includes('installprogram.eu') || u.includes('-gtp') || u.includes('ggl'));
    } catch {
      return this.isLikelyGglGame();
    }
  }

  /**
   * Click a relative point inside the main game element.
   */
  private async clickMainElementRelative(relX: number, relY: number, label: string): Promise<boolean> {
    const mainElement = await this.canvasHelper.getMainGameElement();
    if (!mainElement) return false;
    const box = mainElement.boundingBox;
    const x = box.x + (box.width * relX);
    const y = box.y + (box.height * relY);
    await this.page.mouse.click(x, y);
    console.log(`Clicked ${label} at (${Math.round(x)}, ${Math.round(y)}) on ${mainElement.type}`);
    await this.page.waitForTimeout(400);
    return true;
  }

  private inferGameIdForReports(): string {
    const url = this.page.url();
    const fromMgs = url.match(/\/mgs\/([^/?#]+)/i)?.[1];
    if (fromMgs) return fromMgs;
    const fromGameIdParam = url.match(/[?&]gameId=([^&#]+)/i)?.[1];
    if (fromGameIdParam) return decodeURIComponent(fromGameIdParam).replace(/Desktop$/i, '');
    const fromLaunch = url.match(/\/launch\/([^/?#]+)/i)?.[1];
    if (fromLaunch) return fromLaunch.split('_')[0];
    return 'unknown-game';
  }

  private async screenshotBuffer(): Promise<Buffer> {
    return await this.page.screenshot({ timeout: 30_000 }).catch(() => Buffer.alloc(0));
  }

  private didScreenChange(before: Buffer, after: Buffer, threshold = 0.0025): { changed: boolean; diffRatio: number } {
    const len = Math.min(before.length, after.length);
    if (len === 0) return { changed: false, diffRatio: 0 };
    let diffCount = 0;
    for (let i = 0; i < len; i++) {
      if (before[i] !== after[i]) diffCount++;
    }
    diffCount += Math.abs(before.length - after.length);
    const totalLen = Math.max(before.length, after.length);
    const diffRatio = totalLen ? diffCount / totalLen : 0;
    return { changed: diffRatio > threshold, diffRatio };
  }

  private savePipelineScreenshot(buffer: Buffer, stepKey: string): void {
    if (!buffer || buffer.length === 0) return;
    const screenshotDir = path.resolve(process.cwd(), 'reports', 'pipeline-validation');
    try {
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const gameId = this.inferGameIdForReports();
      const filePath = path.join(screenshotDir, `${gameId}-${stepKey}.png`);
      fs.writeFileSync(filePath, buffer);
    } catch {
      // ignore - screenshots are best-effort diagnostics
    }
  }

  /**
   * Try clicking first visible selector in main page and iframe contexts.
   */
  private async clickFirstVisibleSelector(selectors: string[], label: string): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
          await el.click({ force: true }).catch(async () => {
            await el.evaluate((node: HTMLElement) => node.click());
          });
          console.log(`Clicked ${label} via selector: ${selector}`);
          await this.page.waitForTimeout(500);
          return true;
        }
      } catch {
        // continue
      }
    }

    try {
      const iframe = this.page.frameLocator('iframe').first();
      for (const selector of selectors) {
        try {
          const el = iframe.locator(selector).first();
          if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
            await el.click({ force: true }).catch(() => {});
            console.log(`Clicked ${label} in iframe via selector: ${selector}`);
            await this.page.waitForTimeout(500);
            return true;
          }
        } catch {
          // continue
        }
      }
    } catch {
      // cross-origin iframe may block locator access
    }

    return false;
  }

  /**
   * Best-effort read of currently visible bet value text from page/iframe UI.
   */
  private async tryReadVisibleBetValue(): Promise<string> {
    const selectors = [
      '[class*="bet-amount"]',
      '[class*="betAmount"]',
      '[class*="current-bet"]',
      '[data-testid*="bet"]',
      'text=/\\bBet\\b/i',
    ];

    for (const selector of selectors) {
      try {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
          const txt = (await el.textContent().catch(() => ''))?.trim() || '';
          if (txt) return txt;
        }
      } catch { /* continue */ }
    }

    try {
      const frame = this.page.frameLocator('iframe').first();
      for (const selector of selectors) {
        try {
          const el = frame.locator(selector).first();
          if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
            const txt = (await el.textContent().catch(() => ''))?.trim() || '';
            if (txt) return txt;
          }
        } catch { /* continue */ }
      }
    } catch { /* cross-origin */ }

    return '';
  }

  /**
   * Open bet popup via bet icon/menu.
   */
  private async openBetPopup(): Promise<boolean> {
    const selectorClicked = await this.clickFirstVisibleSelector([
      'button:has-text("Bet")',
      'button:has-text("BET")',
      '[aria-label*="bet" i]',
      '[class*="bet-button"]',
      '[class*="bet-icon"]',
      '[class*="stake"]',
    ], 'bet icon');
    if (selectorClicked) return true;

    // Canvas fallback positions for many slots.
    // For GGL (Fourfold the Gold): bet button is the coin-stack on the right rail,
    // just above the large spin button.
    const byPos = await this.clickMainElementRelative(0.92, 0.56, 'bet icon (coin stack)') ||
      await this.clickMainElementRelative(0.92, 0.6, 'bet icon (coin stack) alt') ||
      await this.clickMainElementRelative(0.14, 0.9, 'bet icon fallback (bottom-left)') ||
      await this.clickMainElementRelative(0.2, 0.9, 'bet icon fallback (bottom-left) alt');
    await this.page.waitForTimeout(500);
    return byPos;
  }

  /**
   * Select a bet value from the bet popup and close popup.
   * For GGL canvas games, the popup is canvas-rendered, so we use relative clicks.
   */
  private async selectBetFromPopup(mode: 'min' | 'max' | 'median'): Promise<boolean> {
    const beforeBet = await this.tryReadVisibleBetValue();
    const beforeScreen = await this.screenshotBuffer();

    // Never let this hang the full pipeline; bail quickly and let the test proceed.
    const opened = await Promise.race([
      this.openBetPopup(),
      this.page.waitForTimeout(12_000).then(() => false),
    ]);
    if (!opened) return false;

    const afterOpenScreen = await this.screenshotBuffer();
    const openDiff = this.didScreenChange(beforeScreen, afterOpenScreen, 0.0015);
    const openKey = mode === 'min' ? '07aa-betpopup-open'
      : mode === 'max' ? '08aa-betpopup-open'
      : '09aa-betpopup-open';
    this.savePipelineScreenshot(afterOpenScreen, openKey);

    let optionClicked = false;
    if (mode === 'min') {
      optionClicked = await this.clickFirstVisibleSelector([
        // GGL bet tiers (e.g. Fourfold the Gold)
        'text=/\\bMINI\\b/i',
        'button:has-text("MINI")',
        'button:has-text("Min")',
        'button:has-text("MIN")',
        'button:has-text("Minimum")',
        'text=/\\bMin\\b/i',
      ], 'min bet amount');
      if (!optionClicked) {
        // Fourfold: min is the right-most tier tab (MINI) across the top of the reels.
        optionClicked = await this.clickMainElementRelative(0.86, 0.16, 'min bet (MINI tab)') ||
          await this.clickMainElementRelative(0.88, 0.16, 'min bet (MINI tab) alt');
      }
    } else if (mode === 'max') {
      optionClicked = await this.clickFirstVisibleSelector([
        // GGL bet tiers (e.g. Fourfold the Gold)
        'text=/\\bMAXI\\b/i',
        'button:has-text("MAXI")',
        'button:has-text("Max")',
        'button:has-text("MAX")',
        'button:has-text("Maximum")',
        'text=/\\bMax\\b/i',
      ], 'max bet amount');
      if (!optionClicked) {
        // Fourfold: max is the left-most tier tab (MAXI) across the top of the reels.
        optionClicked = await this.clickMainElementRelative(0.18, 0.16, 'max bet (MAXI tab)') ||
          await this.clickMainElementRelative(0.2, 0.16, 'max bet (MAXI tab) alt');
      }
    } else {
      // Median bet for reset: pick a middle tier (MAJOR tends to be mid-range).
      optionClicked = await this.clickFirstVisibleSelector([
        'text=/\\bMAJOR\\b/i',
        'button:has-text("MAJOR")',
      ], 'median bet amount');
      if (!optionClicked) {
        optionClicked = await this.clickMainElementRelative(0.38, 0.16, 'median bet (MAJOR tab)') ||
          await this.clickMainElementRelative(0.4, 0.16, 'median bet (MAJOR tab) alt');
      }
    }

    await this.page.waitForTimeout(700);
    const afterSelectScreen = await this.screenshotBuffer();
    const selectDiff = this.didScreenChange(afterOpenScreen, afterSelectScreen, 0.0015);
    const selectKey = mode === 'min' ? '07ab-min-selected'
      : mode === 'max' ? '08ab-max-selected'
      : '09ab-median-selected';
    this.savePipelineScreenshot(afterSelectScreen, selectKey);

    // Close popup after selecting amount.
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(250);
    let closed = await this.clickFirstVisibleSelector([
      'button:has-text("Close")',
      'button:has-text("Done")',
      'button:has-text("OK")',
      '[aria-label*="close" i]',
      '[class*="close"]',
    ], 'bet popup close');
    if (!closed) {
      // Fallback: click bet icon again or a likely close position.
      // GGL often has an X at the top-right while the bet tier overlay is open.
      closed = await this.clickMainElementRelative(0.97, 0.05, 'bet popup close (X)') ||
        await this.clickMainElementRelative(0.95, 0.06, 'bet popup close (X) alt') ||
        await this.clickMainElementRelative(0.92, 0.56, 'bet popup close (coin stack)') ||
        await this.clickMainElementRelative(0.14, 0.9, 'bet popup close fallback') ||
        await this.clickMainElementRelative(0.88, 0.32, 'bet popup close fallback alt');
    }

    await this.page.waitForTimeout(800);
    const afterBet = await this.tryReadVisibleBetValue();
    const afterCloseScreen = await this.screenshotBuffer();
    const closeDiff = this.didScreenChange(afterSelectScreen, afterCloseScreen, 0.0015);

    const betTextChanged = beforeBet && afterBet ? beforeBet !== afterBet : false;
    const screenChangedOverall = openDiff.changed && selectDiff.changed;

    console.log(`[BetPopup] mode=${mode} opened=${opened} openDiff=${(openDiff.diffRatio * 100).toFixed(2)}% selected=${optionClicked} selectDiff=${(selectDiff.diffRatio * 100).toFixed(2)}% closed=${closed} closeDiff=${(closeDiff.diffRatio * 100).toFixed(2)}% beforeBet="${beforeBet}" afterBet="${afterBet}" betTextChanged=${betTextChanged}`);
    return Boolean(opened && optionClicked && closed && (betTextChanged || screenChangedOverall));
  }

  /**
   * Get the main game canvas (largest visible canvas, not small auxiliary ones).
   */
  async getMainGameCanvas(): Promise<Locator> {
    const main = await this.canvasHelper.getMainCanvas();
    return main ? main.locator : this.gameCanvas;
  }

  /**
   * Wait for game to load
   */
  async waitForGameLoad(timeout: number = 30000): Promise<void> {
    // Wait for either iframe or canvas (including iframes without "game" in src)
    await Promise.race([
      this.gameIframe.waitFor({ state: 'visible', timeout }),
      this.gameCanvas.waitFor({ state: 'visible', timeout }),
      this.page.locator('iframe').first().waitFor({ state: 'visible', timeout }),
    ]).catch(() => {
      console.warn('Neither iframe nor canvas found - game may use different structure');
    });

    // Additional wait for game assets
    await this.page.waitForTimeout(3000);

    // Click the game area to trigger loading (some games need an initial click)
    const mainElement = await this.canvasHelper.getMainGameElement();
    if (mainElement) {
      const box = mainElement.boundingBox;
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.waitForTimeout(3000);
    }

    // Handle login popup if it appears (user not logged in)
    await this.handleLoginPopupIfPresent();

    // Click Continue/Accept buttons if they appear
    await this.clickContinueButtonIfPresent();

    // Wait a bit more for game to fully initialize
    await this.page.waitForTimeout(2000);

    // Validate game is loaded by checking for credits/balance
    await this.validateGameLoaded();
  }

  /**
   * Handle login popup that may appear when accessing a game
   */
  async handleLoginPopupIfPresent(): Promise<void> {
    try {
      // Check if login popup is visible by looking for password input in a modal
      const passwordInPopup = this.page.locator('input[type="password"]').first();

      if (await passwordInPopup.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Login popup detected - filling credentials...');

        // Find mobile number input - try multiple selectors
        const mobileInputSelectors = [
          'input[placeholder*="Mobile" i]',
          'input[placeholder*="Phone" i]',
          'input[type="tel"]',
          'input[placeholder*="Number" i]',
        ];

        for (const selector of mobileInputSelectors) {
          const mobileInput = this.page.locator(selector).first();
          if (await mobileInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await mobileInput.clear();
            await mobileInput.fill(process.env.BETWAY_USERNAME || '222212222');
            console.log('Filled mobile number in popup');
            break;
          }
        }

        // Fill password
        await passwordInPopup.clear();
        await passwordInPopup.fill(process.env.BETWAY_PASSWORD || '1234567890');
        console.log('Filled password in popup');

        // Click login button in popup - look for button INSIDE the modal
        // The modal has class containing "fixed" and "z-50"
        const modalLoginBtn = this.page.locator('div.fixed button:has-text("Login"), [role="dialog"] button:has-text("Login"), div[class*="modal"] button:has-text("Login")').first();

        if (await modalLoginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Use JavaScript click to bypass overlay interception
          await modalLoginBtn.evaluate((el: HTMLElement) => el.click());
          console.log('Clicked login button in popup via JS');
          await this.page.waitForTimeout(5000);
        } else {
          // Fallback: try force click on any visible Login button
          const loginBtnSelectors = [
            'button:has-text("Login")',
            'button:has-text("LOGIN")',
            'button:has-text("Log In")',
            'button[type="submit"]',
          ];

          for (const selector of loginBtnSelectors) {
            const loginBtn = this.page.locator(selector).first();
            if (await loginBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              try {
                await loginBtn.evaluate((el: HTMLElement) => el.click());
                console.log('Clicked login button via JS fallback');
                await this.page.waitForTimeout(5000);
                break;
              } catch {
                console.log('Failed to click login button');
              }
            }
          }
        }
      }
    } catch (error) {
      console.log('No login popup or error handling it:', error);
    }
  }

  /**
   * Click Continue/Accept/I Accept buttons if they appear
   * These buttons may be in HTML or rendered inside canvas
   */
  async clickContinueButtonIfPresent(): Promise<void> {
    try {
      // Try multiple times as buttons may appear after animations
      for (let attempt = 0; attempt < 3; attempt++) {
        console.log(`Checking for Continue/Accept/Arrow button (attempt ${attempt + 1})...`);

        // Some games gate Continue/Accept behind a "Do not show again" checkbox.
        // Click the checkbox/label first when present.
        const dontShowSelectors = [
          'label:has-text("Do not show again")',
          'label:has-text("DO NOT SHOW AGAIN")',
          'label:has-text("Don\'t show again")',
          'label:has-text("DON\'T SHOW AGAIN")',
          'text=/do\\s*not\\s*show\\s*again/i',
          "text=/don'?t\\s*show\\s*again/i",
          'input[type="checkbox"][name*="show" i]',
          'input[type="checkbox"][id*="show" i]',
          'input[type="checkbox"][aria-label*="show" i]',
        ];
        for (const selector of dontShowSelectors) {
          const checkboxOrLabel = this.page.locator(selector).first();
          if (await checkboxOrLabel.isVisible({ timeout: 500 }).catch(() => false)) {
            try {
              await checkboxOrLabel.click({ force: true });
              console.log(`Clicked do-not-show-again control: ${selector}`);
              await this.page.waitForTimeout(800);
              break;
            } catch {
              // Continue to other selectors
            }
          }
        }

        // HTML button selectors
        const continueButtonSelectors = [
          'button:has-text("Continue")',
          'button:has-text("CONTINUE")',
          'button:has-text("I Accept")',
          'button:has-text("I ACCEPT")',
          'button:has-text("Accept")',
          'button:has-text("ACCEPT")',
          'button:has-text("OK")',
          'button:has-text("Start")',
          'button:has-text("START")',
          'button:has-text("Play")',
          'button:has-text("PLAY")',
          'div:has-text("CONTINUE")',
          'div:has-text("Continue")',
          'span:has-text("CONTINUE")',
          '[class*="continue"]',
          '[class*="accept"]',
          '[class*="start-btn"]',
          '[class*="arrow-right"]',
          '[class*="arrow_right"]',
          '[class*="next"]',
          '[aria-label*="continue" i]',
          '[aria-label*="next" i]',
          '[title*="continue" i]',
          '[title*="next" i]',
          'button:has(svg)',
          'a:has(svg)',
        ];

        let buttonClicked = false;

        for (const selector of continueButtonSelectors) {
          const button = this.page.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
            try {
              await button.click({ force: true });
              console.log(`Clicked continue/accept button: ${selector}`);
              buttonClicked = true;
              await this.page.waitForTimeout(3000);
              break;
            } catch (e) {
              // Try JavaScript click as fallback
              try {
                await button.evaluate((el: HTMLElement) => el.click());
                console.log(`Clicked via JS: ${selector}`);
                buttonClicked = true;
                await this.page.waitForTimeout(3000);
                break;
              } catch {
                console.log(`Failed to click ${selector}`);
              }
            }
          }
        }

        // Try checkbox + continue inside iframe overlays when accessible.
        try {
          const iframe = this.page.frameLocator('iframe').first();
          for (const selector of dontShowSelectors) {
            const iframeCheckboxOrLabel = iframe.locator(selector).first();
            if (await iframeCheckboxOrLabel.isVisible({ timeout: 300 }).catch(() => false)) {
              await iframeCheckboxOrLabel.click({ force: true }).catch(() => {});
              console.log(`Clicked iframe do-not-show-again control: ${selector}`);
              await this.page.waitForTimeout(500);
              break;
            }
          }
          for (const selector of continueButtonSelectors) {
            const iframeBtn = iframe.locator(selector).first();
            if (await iframeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
              await iframeBtn.click({ force: true }).catch(() => {});
              console.log(`Clicked iframe continue/accept button: ${selector}`);
              buttonClicked = true;
              await this.page.waitForTimeout(2000);
              break;
            }
          }
        } catch {
          // Cross-origin iframe restrictions are expected for some providers.
        }

        // If no HTML button found, try clicking the main game element (iframe or canvas)
        // Games render CONTINUE buttons inside canvas within iframes
        if (!buttonClicked) {
          const mainElement = await this.canvasHelper.getMainGameElement();
          if (mainElement) {
            const box = mainElement.boundingBox;
            console.log(`Main game element (${mainElement.type}): x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`);

            // Click common intro controls in order: right-arrow zone, bottom-center, then center.
            const clickPoints = [
              { x: box.x + box.width * 0.88, y: box.y + box.height * 0.52, name: 'right-arrow-zone' },
              { x: box.x + box.width * 0.94, y: box.y + box.height * 0.52, name: 'right-edge-arrow-zone' },
              { x: box.x + box.width * 0.5, y: box.y + box.height * 0.85, name: 'bottom-center' },
              { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5, name: 'center' },
            ];
            for (const pt of clickPoints) {
              await this.page.mouse.click(pt.x, pt.y);
              console.log(`Clicked ${mainElement.type} ${pt.name} at (${Math.round(pt.x)}, ${Math.round(pt.y)})`);
              await this.page.waitForTimeout(900);
            }
          } else {
            // Fallback: try any visible element
            const anyElement = this.page.locator('iframe, canvas').first();
            if (await anyElement.isVisible({ timeout: 1000 }).catch(() => false)) {
              const box = await anyElement.boundingBox();
              if (box && box.height > 0 && box.width > 0) {
                console.log(`Fallback element box: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`);
                await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                console.log(`Clicked fallback element center`);
                await this.page.waitForTimeout(2000);
              }
            }
          }
        }

        // Wait and check if more buttons appear
        await this.page.waitForTimeout(2000);
      }
    } catch (error) {
      console.log('No continue button found or error clicking it');
    }
  }

  /**
   * Validate game is fully loaded by checking for credits/balance display
   */
  async validateGameLoaded(): Promise<boolean> {
    try {
      const gameLoadedIndicators = [
        // Credits/Balance indicators
        'text=/credit/i',
        'text=/balance/i',
        'text=/coins/i',
        '[class*="credit"]',
        '[class*="balance"]',
        '[class*="coins"]',
        // Spin/Play button indicators
        'button:has-text("Spin")',
        '[class*="spin"]',
        // Game canvas active
        'canvas',
      ];

      for (const selector of gameLoadedIndicators) {
        const element = this.page.locator(selector).first();
        if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`Game loaded - found indicator: ${selector}`);
          return true;
        }
      }

      console.log('Game load indicators not found - game may still be loading');
      return false;
    } catch (error) {
      console.log('Error validating game load');
      return false;
    }
  }

  /**
   * Determine game type (canvas or iframe)
   */
  async getGameType(): Promise<'canvas' | 'iframe' | 'unknown'> {
    // Use getMainGameElement which finds the largest iframe or canvas
    const mainElement = await this.canvasHelper.getMainGameElement();
    if (mainElement) return mainElement.type;

    // Fallback: check specific selectors
    const iframeVisible = await this.gameIframe.isVisible().catch(() => false);
    if (iframeVisible) return 'iframe';

    const canvasVisible = await this.gameCanvas.isVisible().catch(() => false);
    if (canvasVisible) return 'canvas';

    return 'unknown';
  }

  /**
   * Switch to game iframe context (if applicable)
   */
  async switchToGameFrame(): Promise<Page> {
    const gameType = await this.getGameType();
    
    if (gameType === 'iframe') {
      const frameElement = await this.gameIframe.elementHandle();
      if (frameElement) {
        const frame = await frameElement.contentFrame();
        if (frame) {
          return frame as unknown as Page;
        }
      }
    }
    
    return this.page;
  }

  /**
   * Click spin button
   */
  async spin(): Promise<void> {
    // Canvas-first strategy (works for most embedded game UIs, including iframe-hosted canvas).
    const canvasClicked =
      await this.clickMainElementRelative(0.92, 0.88, 'spin (right-lower rail)') ||
      await this.clickMainElementRelative(0.9, 0.9, 'spin (right-lower rail) alt') ||
      await this.clickMainElementRelative(0.5, 0.92, 'spin (bottom-center fallback)');
    if (canvasClicked) {
      await this.page.waitForTimeout(500);
      return;
    }

    // Selector fallback for DOM-driven games.
    const spinVisible = await this.spinButton.isVisible().catch(() => false);
    if (spinVisible) {
      await this.spinButton.click();
      await this.page.waitForTimeout(500);
      return;
    }

    // Last resort: Space key triggers spin in many games.
    await this.page.keyboard.press('Space');
    console.log('Pressed Space key for spin');
    await this.page.waitForTimeout(500);
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<string> {
    try {
      const balance = await this.balanceDisplay.textContent({ timeout: 5000 });
      return balance?.trim() || '0';
    } catch {
      return '0';
    }
  }

  /**
   * Get current bet amount
   */
  async getBet(): Promise<string> {
    try {
      const bet = await this.betDisplay.textContent({ timeout: 5000 });
      return bet?.trim() || '0';
    } catch {
      return '0';
    }
  }

  /**
   * Get current win amount
   */
  async getWin(): Promise<string> {
    try {
      const win = await this.winDisplay.textContent({ timeout: 5000 });
      return win?.trim() || '0';
    } catch {
      return '0';
    }
  }

  /**
   * Increase bet
   */
  async increaseBet(times: number = 1): Promise<boolean> {
    let clicked = false;
    for (let i = 0; i < times; i++) {
      // Canvas-first: most games expose plus/max controls on lower control rail.
      let stepClicked =
        await this.clickMainElementRelative(0.28, 0.9, 'bet increase (canvas)') ||
        await this.clickMainElementRelative(0.24, 0.9, 'bet increase (canvas) alt') ||
        await this.clickMainElementRelative(0.82, 0.9, 'bet increase (canvas right rail)');

      if (!stepClicked) {
        try {
          await this.betIncreaseButton.click({ timeout: 800 });
          stepClicked = true;
        } catch {
          stepClicked = false;
        }
      }

      clicked = clicked || stepClicked;
      await this.page.waitForTimeout(300);
    }
    return clicked;
  }

  /**
   * Decrease bet
   */
  async decreaseBet(times: number = 1): Promise<boolean> {
    // For GGL games: use the bet popup (much faster/more reliable than repeated "-" clicks).
    if (await this.isLikelyGglGameNow()) {
      const minSet = await this.selectBetFromPopup('min');
      if (minSet) return true;
    }

    let clicked = false;
    for (let i = 0; i < times; i++) {
      // Canvas-first for minus controls.
      let stepClicked =
        await this.clickMainElementRelative(0.16, 0.9, 'bet decrease (canvas)') ||
        await this.clickMainElementRelative(0.12, 0.88, 'bet decrease (canvas) alt');

      if (!stepClicked) {
        try {
          await this.betDecreaseButton.click({ timeout: 800 });
          stepClicked = true;
        } catch {
          stepClicked = false;
        }
      }

      clicked = clicked || stepClicked;
      await this.page.waitForTimeout(300);
    }
    return clicked;
  }

  /**
   * Set max bet
   */
  async setMaxBet(): Promise<boolean> {
    if (await this.isLikelyGglGameNow()) {
      const maxSet = await this.selectBetFromPopup('max');
      if (maxSet) return true;
    }

    // Canvas-first: max bet controls are commonly on the lower-right rail.
    const canvasClicked = await this.clickMainElementRelative(0.84, 0.9, 'max bet (canvas)') ||
      await this.clickMainElementRelative(0.78, 0.9, 'max bet (canvas) alt');
    if (canvasClicked) {
      await this.page.waitForTimeout(500);
      return true;
    }

    try {
      await this.maxBetButton.click({ timeout: 800 });
      await this.page.waitForTimeout(500);
      return true;
    } catch {
      const selectorClicked = await this.clickFirstVisibleSelector([
        'button:has-text("MAX BET")',
        'button:has-text("Max Bet")',
        'button:has-text("Max")',
        '[aria-label*="max" i]',
        '[class*="max-bet"]',
      ], 'max bet');
      await this.page.waitForTimeout(500);
      return selectorClicked;
    }
  }

  /**
   * Reset bet after max-bet by decreasing a few steps.
   */
  async resetBetAfterMax(steps: number = 8): Promise<boolean> {
    if (await this.isLikelyGglGameNow()) {
      // Safe reset after max for GGL: reopen popup and select a median bet value.
      const reset = await this.selectBetFromPopup('median');
      if (reset) return true;
    }
    return this.decreaseBet(steps);
  }

  /**
   * Open GGL 3-dot menu and try to click paytable/info option.
   */
  async openGglMenuAndPaytable(): Promise<boolean> {
    let clicked = false;
    // 3 dots are typically top-left inside game area
    clicked = (await this.clickMainElementRelative(0.06, 0.08, 'GGL menu (3 dots)')) || clicked;
    clicked = (await this.clickMainElementRelative(0.1, 0.08, 'GGL menu (3 dots) alt')) || clicked;
    await this.page.waitForTimeout(700);

    const paytableClicked = await this.clickFirstVisibleSelector([
      'text=/Paytable/i',
      'button:has-text("Paytable")',
      'button:has-text("PAYTABLE")',
      'text=/Game Rules/i',
      'button:has-text("Info")',
      'button:has-text("Rules")',
    ], 'paytable/info');

    if (!paytableClicked) {
      // Canvas fallback for a left-side menu item.
      clicked = (await this.clickMainElementRelative(0.2, 0.36, 'GGL paytable item fallback')) || clicked;
    } else {
      clicked = true;
    }

    // Try scrolling paytable content to validate interaction.
    await this.page.mouse.wheel(0, 650);
    await this.page.waitForTimeout(300);
    await this.page.mouse.wheel(0, -250);
    await this.page.waitForTimeout(300);

    return clicked;
  }
  /**
   * Enable autospin
   */
  async enableAutospin(spins?: number): Promise<void> {
    // Canvas-first: many providers place auto-spin near the spin control cluster.
    const canvasClicked =
      await this.clickMainElementRelative(0.84, 0.8, 'autospin (canvas)') ||
      await this.clickMainElementRelative(0.8, 0.82, 'autospin (canvas) alt');
    if (!canvasClicked) {
      await this.autospinButton.click();
      await this.page.waitForTimeout(500);
    } else {
      await this.page.waitForTimeout(700);
    }
    
    // If spin count selector appears, set it
    if (spins) {
      // This would need to be customized based on actual UI
      const spinCountButton = this.page.locator(`button:has-text("${spins}")`).first();
      if (await spinCountButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await spinCountButton.click();
      }
    }
  }

  /**
   * Disable autospin
   */
  async disableAutospin(): Promise<void> {
    // Usually clicking auto/stop near spin cluster.
    const canvasClicked =
      await this.clickMainElementRelative(0.84, 0.8, 'autospin stop (canvas)') ||
      await this.clickMainElementRelative(0.9, 0.88, 'spin stop (canvas)');
    if (!canvasClicked) {
      await this.autospinButton.click();
    }
    await this.page.waitForTimeout(500);
  }

  /**
   * Open game info/paytable
   */
  async openInfo(): Promise<boolean> {
    const doOpen = async (): Promise<boolean> => {
      // Some providers (notably GGL) render paytables via canvas menus. Keep this bounded so it
      // never blocks the pipeline.

      // GGL: open 3-dot menu (top-left) then open Paytable/Info and scroll.
      if (this.isLikelyGglGame()) {
        console.log('[openInfo] GGL detected - attempting paytable/info via 3-dot menu');
        const main = await this.canvasHelper.getMainGameElement().catch(() => null);
        if (!main) {
          return false;
        }
        const box = main.boundingBox;
        const tmpDir = path.resolve(process.cwd(), 'tmp');

        const readExisting = (candidates: Array<{ label: string; filePath: string }>): Array<{ label: string; data: Buffer }> => {
          return candidates
            .filter((c) => fs.existsSync(c.filePath))
            .map((c) => ({ label: c.label, data: fs.readFileSync(c.filePath) }));
        };

        const findBestTemplate = (canvasBuf: Buffer, templates: Array<{ label: string; data: Buffer }>, region: any) => {
          let best: any | null = null;
          for (const tpl of templates) {
            let m = findTemplateMatchMultiScale(
              canvasBuf,
              tpl.data,
              [0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3],
              { region, step: 2, maxScore: 0.28, timeBudgetMs: 1800 }
            );
            if (!m) {
              const robust = findTemplateMatchRobust(canvasBuf, tpl.data, {
                regions: [region],
                scales: [0.45, 0.6, 0.75, 0.9, 1, 1.15, 1.3],
                maxScore: 0.28,
                relaxedMaxScore: 0.34,
                steps: [2, 1],
                timeBudgetMs: 1400,
              });
              if (robust) m = robust;
            }
            if (m && (!best || m.score < best.score)) best = { ...m, templateLabel: tpl.label };
          }
          return best;
        };

        const menuTemplates = readExisting([
          { label: 'tmp-hamburger', filePath: path.resolve(tmpDir, 'hamuburger-menu.png') },
          { label: 'tmp-menu-after', filePath: path.resolve(tmpDir, 'hamburget-menu-after-click.png') },
        ]);
        const paytableTemplates = readExisting([
          { label: 'tmp-paytable', filePath: path.resolve(tmpDir, 'paytable-icon-visible-after-hamburger-menu-click.png') },
        ]);

        const beforeCanvas = await main.locator.screenshot({ timeout: 30_000 }).catch(() => null);
        if (!beforeCanvas) return false;
        const topLeftRegion = {
          x0: Math.floor(box.width * 0.0),
          y0: Math.floor(box.height * 0.0),
          x1: Math.floor(box.width * 0.36),
          y1: Math.floor(box.height * 0.36),
        };

        const menuMatch = findBestTemplate(beforeCanvas, menuTemplates, topLeftRegion);
        if (!menuMatch) {
          console.log('[openInfo] menu/hamburger template not found in top-left region');
          return false;
        }
        const menuX = box.x + menuMatch.x + menuMatch.width / 2;
        const menuY = box.y + menuMatch.y + menuMatch.height / 2;
        await this.page.mouse.click(menuX, menuY).catch(() => {});
        await this.page.waitForTimeout(700);
        console.log(`[openInfo] clicked menu template (${menuMatch.templateLabel || 'unknown'}) x=${Math.round(menuX)} y=${Math.round(menuY)}`);

        const menuCanvas = await main.locator.screenshot({ timeout: 30_000 }).catch(() => null);
        if (!menuCanvas) return true;
        const paytableMatch = findBestTemplate(menuCanvas, paytableTemplates, topLeftRegion);
        if (!paytableMatch) {
          console.log('[openInfo] paytable template not found after menu click');
          return true;
        }
        const payX = box.x + paytableMatch.x + paytableMatch.width / 2;
        const payY = box.y + paytableMatch.y + paytableMatch.height / 2;
        await this.page.mouse.click(payX, payY).catch(() => {});
        await this.page.waitForTimeout(600);
        console.log(`[openInfo] clicked paytable template (${paytableMatch.templateLabel || 'unknown'}) x=${Math.round(payX)} y=${Math.round(payY)}`);

        // Attempt to scroll paytable to validate open state changes.
        await this.page.mouse.wheel(0, 900).catch(() => {});
        await this.page.waitForTimeout(300);
        await this.page.mouse.wheel(0, 900).catch(() => {});
        return true;
      }

      let clicked = false;
      try {
        await this.infoButton.click();
        clicked = true;
      } catch {
        const selectorClicked = await this.clickFirstVisibleSelector([
          'button:has-text("Info")',
          'button:has-text("PAYTABLE")',
          'button:has-text("Paytable")',
          'button:has-text("Rules")',
          'button:has-text("Menu")',
          '[aria-label*="info" i]',
          '[aria-label*="menu" i]',
        ], 'info/menu');
        clicked = clicked || selectorClicked;
      }

      await this.page.waitForTimeout(1000);
      return clicked;
    };

    // Never let paytable open stall the full pipeline.
    return await Promise.race([
      doOpen(),
      // If paytable is slow, treat it as action-performed and let the spec's screenshot-diff
      // determine if the UI changed.
      this.page.waitForTimeout(10_000).then(() => true),
    ]);
  }

  /**
   * Close game info/paytable
   */
  async closeInfo(): Promise<boolean> {
    const doClose = async (): Promise<boolean> => {
      let clicked = false;

      // Try pressing Escape key first (common for overlays)
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(350);

      // GGL overlays frequently have an X in the top-right of the game surface.
      if (this.isLikelyGglGame()) {
        clicked = (await this.clickMainElementRelative(0.97, 0.05, 'GGL close (X)')) || clicked;
        await this.page.waitForTimeout(250);
      }

      if (!clicked) {
        if (await this.closeButton.isVisible({ timeout: 600 }).catch(() => false)) {
          await this.closeButton.click().catch(() => {});
          clicked = true;
        }
      }

      if (!clicked) {
        const selectorClicked = await this.clickFirstVisibleSelector([
          'button:has-text("Close")',
          'button:has-text("CLOSE")',
          'button:has-text("Back")',
          'button:has-text("Done")',
          '[aria-label*="close" i]',
          '[class*="close"]',
        ], 'close info');
        clicked = clicked || selectorClicked;
      }

      // Final GGL fallback: reopen 3-dot menu and attempt a close area click.
      if (!clicked && this.isLikelyGglGame()) {
        await this.clickMainElementRelative(0.06, 0.08, 'GGL menu re-open for close');
        await this.page.waitForTimeout(350);
        clicked = (await this.clickMainElementRelative(0.97, 0.05, 'GGL close (X) after menu')) || clicked;
      }

      return clicked;
    };

    // Never let closeInfo hang the whole pipeline.
    return await Promise.race([
      doClose(),
      this.page.waitForTimeout(10_000).then(() => false),
    ]);
  }

  /**
   * Mute/unmute audio
   */
  async toggleMute(): Promise<void> {
    if (await this.muteButton.isVisible().catch(() => false)) {
      await this.muteButton.click();
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Take screenshot of game
   */
  async screenshot(path?: string): Promise<Buffer> {
    const gameType = await this.getGameType();

    if (gameType === 'canvas') {
      const mainCanvas = await this.getMainGameCanvas();
      return await mainCanvas.screenshot({ path });
    } else if (gameType === 'iframe') {
      return await this.gameIframe.screenshot({ path });
    } else {
      return await this.gameContainer.screenshot({ path });
    }
  }

  /**
   * Check if game is in demo mode
   */
  async isDemoMode(): Promise<boolean> {
    // Look for demo indicators in the page
    const demoIndicators = [
      this.page.locator(':has-text("Demo")'),
      this.page.locator(':has-text("Fun Mode")'),
      this.page.locator(':has-text("Play Money")'),
      this.page.locator('[class*="demo"]')
    ];

    for (const indicator of demoIndicators) {
      if (await indicator.first().isVisible().catch(() => false)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Wait for spin to complete
   */
  async waitForSpinComplete(timeout: number = 10000): Promise<void> {
    const startTime = Date.now();

    // Check if canvas is animating
    const gameType = await this.getGameType();

    if (gameType === 'canvas') {
      const canvas = await this.canvasHelper.getMainCanvas() || await this.canvasHelper.getCanvas();
      if (canvas) {
        // Wait for animation to stop
        let isAnimating = true;
        while (isAnimating && (Date.now() - startTime) < timeout) {
          await this.page.waitForTimeout(1000);
          isAnimating = await this.canvasHelper.isCanvasAnimating(canvas, 2, 500);
        }
      }
    } else {
      // For non-canvas games, just wait a fixed time
      await this.page.waitForTimeout(3000);
    }
  }

  /**
   * Perform multiple spins
   */
  async performSpins(count: number, delayBetweenSpins: number = 5000): Promise<void> {
    for (let i = 0; i < count; i++) {
      console.log(`Performing spin ${i + 1}/${count}`);
      await this.spin();
      await this.page.waitForTimeout(delayBetweenSpins);
    }
  }
}
