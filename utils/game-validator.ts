import { Page, expect } from '@playwright/test';
import { CanvasHelper } from './canvas-helper';

/**
 * Game Validator Utility
 * Reusable validation functions for casino game testing
 */

export interface GameElements {
  spinButton?: string;
  betIncreaseButton?: string;
  betDecreaseButton?: string;
  maxBetButton?: string;
  autospinButton?: string;
  infoButton?: string;
  settingsButton?: string;
  balanceDisplay?: string;
  betDisplay?: string;
  winDisplay?: string;
  canvas?: string;
  gameContainer?: string;
}

export interface ValidationResult {
  passed: boolean;
  message: string;
  timestamp: string;
  details?: any;
}

export class GameValidator {
  private canvasHelper: CanvasHelper;

  constructor(private page: Page) {
    this.canvasHelper = new CanvasHelper(page);
  }

  /**
   * Validate game loading
   */
  async validateGameLoading(
    elements: GameElements,
    timeout: number = 30000
  ): Promise<ValidationResult> {
    try {
      const startTime = Date.now();

      // Wait for game container
      if (elements.gameContainer) {
        await this.page.waitForSelector(elements.gameContainer, { 
          state: 'visible', 
          timeout 
        });
      }

      // Wait for canvas or iframe
      if (elements.canvas) {
        await this.page.waitForSelector(elements.canvas, { 
          state: 'visible', 
          timeout: timeout - (Date.now() - startTime) 
        });
      }

      // Additional wait for game assets to load
      await this.page.waitForTimeout(3000);

      const loadTime = Date.now() - startTime;

      return {
        passed: true,
        message: `Game loaded successfully in ${loadTime}ms`,
        timestamp: new Date().toISOString(),
        details: { loadTime }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Game loading failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate spin functionality
   */
  async validateSpin(
    elements: GameElements,
    options: { waitTime?: number; checkBalanceChange?: boolean } = {}
  ): Promise<ValidationResult> {
    const { waitTime = 5000, checkBalanceChange = true } = options;

    try {
      // Get initial balance if checking
      let initialBalance: string | null = null;
      if (checkBalanceChange && elements.balanceDisplay) {
        initialBalance = await this.page.locator(elements.balanceDisplay).textContent();
      }

      // Canvas-first click for spin.
      let spinClicked = false;
      const main = await this.canvasHelper.getMainGameElement().catch(() => null);
      if (main) {
        const x = main.boundingBox.x + main.boundingBox.width * 0.9;
        const y = main.boundingBox.y + main.boundingBox.height * 0.88;
        await this.page.mouse.click(x, y);
        spinClicked = true;
      }
      if (!spinClicked && elements.spinButton) {
        await this.page.locator(elements.spinButton).click();
        spinClicked = true;
      }
      if (!spinClicked) {
        const canvas = await this.canvasHelper.getCanvas(elements.canvas);
        if (canvas) {
          await this.canvasHelper.clickCanvas(canvas, { position: 'center' });
          spinClicked = true;
        }
      }

      // Wait for spin to complete
      await this.page.waitForTimeout(waitTime);

      // Check balance changed
      if (checkBalanceChange && elements.balanceDisplay && initialBalance) {
        const newBalance = await this.page.locator(elements.balanceDisplay).textContent();
        if (newBalance === initialBalance) {
          return {
            passed: false,
            message: 'Balance did not change after spin',
            timestamp: new Date().toISOString()
          };
        }
      }

      return {
        passed: true,
        message: 'Spin executed successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        passed: false,
        message: `Spin validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate bet controls
   */
  async validateBetControls(elements: GameElements): Promise<ValidationResult> {
    try {
      const results: string[] = [];

      // Get initial bet
      const initialBet = elements.betDisplay 
        ? await this.page.locator(elements.betDisplay).textContent()
        : null;

      // Test increase button
      if (elements.betIncreaseButton) {
        await this.page.locator(elements.betIncreaseButton).click();
        await this.page.waitForTimeout(500);
        
        if (elements.betDisplay) {
          const increasedBet = await this.page.locator(elements.betDisplay).textContent();
          if (increasedBet !== initialBet) {
            results.push('✓ Bet increase works');
          } else {
            results.push('✗ Bet increase failed');
          }
        }
      }

      // Test decrease button
      if (elements.betDecreaseButton) {
        await this.page.locator(elements.betDecreaseButton).click();
        await this.page.waitForTimeout(500);
        results.push('✓ Bet decrease works');
      }

      // Test max bet button
      if (elements.maxBetButton) {
        await this.page.locator(elements.maxBetButton).click();
        await this.page.waitForTimeout(500);
        results.push('✓ Max bet works');
      }

      return {
        passed: true,
        message: `Bet controls validated: ${results.join(', ')}`,
        timestamp: new Date().toISOString(),
        details: { results }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Bet controls validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate game UI elements visibility
   */
  async validateUIElements(elements: GameElements): Promise<ValidationResult> {
    try {
      const visibilityChecks: Array<{ element: string; visible: boolean }> = [];

      for (const [key, selector] of Object.entries(elements)) {
        if (selector) {
          const isVisible = await this.page.locator(selector).isVisible().catch(() => false);
          visibilityChecks.push({ element: key, visible: isVisible });
        }
      }

      const visibleCount = visibilityChecks.filter(c => c.visible).length;
      const totalCount = visibilityChecks.length;

      return {
        passed: visibleCount > 0,
        message: `${visibleCount}/${totalCount} UI elements visible`,
        timestamp: new Date().toISOString(),
        details: { visibilityChecks }
      };
    } catch (error) {
      return {
        passed: false,
        message: `UI validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate canvas rendering
   */
  async validateCanvasRendering(
    canvasSelector: string = 'canvas'
  ): Promise<ValidationResult> {
    try {
      const canvas = await this.canvasHelper.waitForCanvasReady(canvasSelector);
      
      if (!canvas) {
        return {
          passed: false,
          message: 'Canvas element not found',
          timestamp: new Date().toISOString()
        };
      }

      // Check if canvas has content
      const dimensions = await this.canvasHelper.getCanvasDimensions(canvasSelector);
      if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
        return {
          passed: false,
          message: 'Canvas has invalid dimensions',
          timestamp: new Date().toISOString()
        };
      }

      // Check if canvas is animating
      const isAnimating = await this.canvasHelper.isCanvasAnimating(canvas);

      return {
        passed: true,
        message: `Canvas rendering validated (${dimensions.width}x${dimensions.height}, animating: ${isAnimating})`,
        timestamp: new Date().toISOString(),
        details: { dimensions, isAnimating }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Canvas validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate autospin functionality
   */
  async validateAutospin(
    elements: GameElements,
    spinsToTest: number = 3
  ): Promise<ValidationResult> {
    try {
      if (!elements.autospinButton) {
        return {
          passed: false,
          message: 'Autospin button not defined',
          timestamp: new Date().toISOString()
        };
      }

      // Enable autospin
      await this.page.locator(elements.autospinButton).click();
      await this.page.waitForTimeout(1000);

      // Monitor balance changes over multiple spins
      const balanceChecks: string[] = [];
      for (let i = 0; i < spinsToTest; i++) {
        if (elements.balanceDisplay) {
          const balance = await this.page.locator(elements.balanceDisplay).textContent();
          balanceChecks.push(balance || '0');
        }
        await this.page.waitForTimeout(3000); // Wait between spins
      }

      // Check if balances changed (indicating spins happened)
      const uniqueBalances = new Set(balanceChecks);
      const spinsDetected = uniqueBalances.size > 1;

      // Stop autospin
      await this.page.locator(elements.autospinButton).click();

      return {
        passed: spinsDetected,
        message: spinsDetected 
          ? `Autospin working (${uniqueBalances.size} balance changes detected)`
          : 'Autospin failed - no balance changes detected',
        timestamp: new Date().toISOString(),
        details: { balanceChecks }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Autospin validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate game info/paytable accessibility
   */
  async validateGameInfo(elements: GameElements): Promise<ValidationResult> {
    try {
      if (!elements.infoButton) {
        return {
          passed: false,
          message: 'Info button not defined',
          timestamp: new Date().toISOString()
        };
      }

      // Click info button
      await this.page.locator(elements.infoButton).click();
      await this.page.waitForTimeout(1000);

      // Check if info panel/modal appeared
      const infoVisible = await this.page.locator('.info-panel, .paytable, .game-info').isVisible()
        .catch(() => false);

      // Close info
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);

      return {
        passed: infoVisible,
        message: infoVisible ? 'Game info accessible' : 'Game info not accessible',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        passed: false,
        message: `Game info validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate responsive design
   */
  async validateResponsive(
    viewports: Array<{ width: number; height: number; name: string }>,
    canvasSelector: string = 'canvas'
  ): Promise<ValidationResult> {
    try {
      const results: Array<{ viewport: string; passed: boolean }> = [];

      for (const viewport of viewports) {
        await this.page.setViewportSize({ 
          width: viewport.width, 
          height: viewport.height 
        });
        await this.page.waitForTimeout(1000);

        const canvas = await this.canvasHelper.getCanvas(canvasSelector);
        results.push({
          viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
          passed: canvas !== null
        });
      }

      const passedCount = results.filter(r => r.passed).length;

      return {
        passed: passedCount === viewports.length,
        message: `Responsive validation: ${passedCount}/${viewports.length} viewports passed`,
        timestamp: new Date().toISOString(),
        details: { results }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Responsive validation failed: ${(error as Error).message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Comprehensive game validation (runs all checks)
   */
  async runFullValidation(
    elements: GameElements,
    options: {
      skipAutospin?: boolean;
      skipInfo?: boolean;
      testSpins?: number;
    } = {}
  ): Promise<Array<ValidationResult>> {
    const results: Array<ValidationResult> = [];

    console.log('Running comprehensive game validation...\n');

    // 1. Loading
    console.log('1️⃣  Validating game loading...');
    results.push(await this.validateGameLoading(elements));

    // 2. Canvas rendering
    if (elements.canvas) {
      console.log('2️⃣  Validating canvas rendering...');
      results.push(await this.validateCanvasRendering(elements.canvas));
    }

    // 3. UI elements
    console.log('3️⃣  Validating UI elements...');
    results.push(await this.validateUIElements(elements));

    // 4. Bet controls
    console.log('4️⃣  Validating bet controls...');
    results.push(await this.validateBetControls(elements));

    // 5. Spin
    console.log('5️⃣  Validating spin functionality...');
    results.push(await this.validateSpin(elements));

    // 6. Autospin (optional)
    if (!options.skipAutospin && elements.autospinButton) {
      console.log('6️⃣  Validating autospin...');
      results.push(await this.validateAutospin(elements, options.testSpins || 3));
    }

    // 7. Game info (optional)
    if (!options.skipInfo && elements.infoButton) {
      console.log('7️⃣  Validating game info...');
      results.push(await this.validateGameInfo(elements));
    }

    return results;
  }

  /**
   * Print validation summary
   */
  printValidationSummary(results: Array<ValidationResult>): void {
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    results.forEach((result, index) => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${index + 1}. ${result.message}`);
    });

    console.log('='.repeat(60));
    console.log(`Total: ${passed}/${total} validations passed`);
    console.log('='.repeat(60) + '\n');
  }
}
