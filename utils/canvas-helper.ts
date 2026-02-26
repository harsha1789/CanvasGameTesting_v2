import { Page, Locator } from '@playwright/test';

/**
 * Canvas Helper Utility
 * Provides methods for interacting with HTML5 Canvas elements in casino games
 */

export interface CanvasElement {
  locator: Locator;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CanvasClickOptions {
  offsetX?: number;
  offsetY?: number;
  position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  clickCount?: number;
  delay?: number;
}

export interface CanvasDragOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  steps?: number;
}

export class CanvasHelper {
  constructor(private page: Page) {}

  /**
   * Find and return canvas element with its bounding box
   */
  async getCanvas(selector: string = 'canvas'): Promise<CanvasElement | null> {
    const locator = this.page.locator(selector).first();
    const count = await locator.count();

    if (count === 0) {
      console.warn(`Canvas element not found with selector: ${selector}`);
      return null;
    }

    const box = await locator.boundingBox();
    if (!box) {
      console.warn(`Could not get bounding box for canvas: ${selector}`);
      return null;
    }

    return {
      locator,
      boundingBox: box
    };
  }

  /**
   * Find the main (largest) visible canvas element on the page.
   * Filters out small auxiliary canvases (icons, trackers) by requiring
   * a minimum size of 200x200, then returns the largest by area.
   */
  async getMainCanvas(): Promise<CanvasElement | null> {
    const allCanvases = await this.page.locator('canvas').all();
    let best: CanvasElement | null = null;
    let bestArea = 0;

    for (const canvas of allCanvases) {
      // Keep this fast: default Playwright timeouts can make this stall per element.
      if (!await canvas.isVisible({ timeout: 250 }).catch(() => false)) continue;
      const box = await canvas.boundingBox().catch(() => null);
      if (!box || box.width < 200 || box.height < 200) continue;
      const area = box.width * box.height;
      if (area > bestArea) {
        bestArea = area;
        best = { locator: canvas, boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height } };
      }
    }

    if (!best) {
      // Fallback: return the first canvas with any size
      return await this.getCanvas();
    }

    return best;
  }

  /**
   * Find the main game element on the page — the largest iframe or canvas.
   * Casino games are often inside iframes whose src doesn't contain "game",
   * so we check ALL iframes and canvases by size.
   * Returns the element with its bounding box, regardless of type.
   */
  async getMainGameElement(): Promise<{ locator: Locator; boundingBox: { x: number; y: number; width: number; height: number }; type: 'canvas' | 'iframe' } | null> {
    let best: { locator: Locator; boundingBox: { x: number; y: number; width: number; height: number }; type: 'canvas' | 'iframe' } | null = null;
    let bestArea = 0;

    // Check all iframes
    const allIframes = await this.page.locator('iframe').all();
    for (const iframe of allIframes) {
      if (!await iframe.isVisible({ timeout: 250 }).catch(() => false)) continue;
      const box = await iframe.boundingBox().catch(() => null);
      if (!box || box.width < 300 || box.height < 200) continue;
      const area = box.width * box.height;
      if (area > bestArea) {
        bestArea = area;
        best = { locator: iframe, boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height }, type: 'iframe' };
      }
    }

    // Check all canvases
    const allCanvases = await this.page.locator('canvas').all();
    for (const canvas of allCanvases) {
      if (!await canvas.isVisible({ timeout: 250 }).catch(() => false)) continue;
      const box = await canvas.boundingBox().catch(() => null);
      if (!box || box.width < 300 || box.height < 200) continue;
      const area = box.width * box.height;
      if (area > bestArea) {
        bestArea = area;
        best = { locator: canvas, boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height }, type: 'canvas' };
      }
    }

    return best;
  }

  /**
   * Click on canvas at specific coordinates
   */
  async clickCanvas(
    canvas: CanvasElement,
    options: CanvasClickOptions = {}
  ): Promise<void> {
    const { boundingBox } = canvas;
    const {
      offsetX = 0,
      offsetY = 0,
      position = 'center',
      clickCount = 1,
      delay = 100
    } = options;

    let x: number, y: number;

    // Calculate click position
    switch (position) {
      case 'center':
        x = boundingBox.x + boundingBox.width / 2 + offsetX;
        y = boundingBox.y + boundingBox.height / 2 + offsetY;
        break;
      case 'top-left':
        x = boundingBox.x + offsetX;
        y = boundingBox.y + offsetY;
        break;
      case 'top-right':
        x = boundingBox.x + boundingBox.width + offsetX;
        y = boundingBox.y + offsetY;
        break;
      case 'bottom-left':
        x = boundingBox.x + offsetX;
        y = boundingBox.y + boundingBox.height + offsetY;
        break;
      case 'bottom-right':
        x = boundingBox.x + boundingBox.width + offsetX;
        y = boundingBox.y + boundingBox.height + offsetY;
        break;
      default:
        x = boundingBox.x + boundingBox.width / 2 + offsetX;
        y = boundingBox.y + boundingBox.height / 2 + offsetY;
    }

    await this.page.mouse.click(x, y, { clickCount, delay });
  }

  /**
   * Click at grid position (divide canvas into grid)
   */
  async clickGridCell(
    canvas: CanvasElement,
    row: number,
    col: number,
    gridRows: number = 10,
    gridCols: number = 10
  ): Promise<void> {
    const { boundingBox } = canvas;
    const cellWidth = boundingBox.width / gridCols;
    const cellHeight = boundingBox.height / gridRows;

    const x = boundingBox.x + (col * cellWidth) + (cellWidth / 2);
    const y = boundingBox.y + (row * cellHeight) + (cellHeight / 2);

    await this.page.mouse.click(x, y);
  }

  /**
   * Drag on canvas
   */
  async dragOnCanvas(
    canvas: CanvasElement,
    options: CanvasDragOptions
  ): Promise<void> {
    const { boundingBox } = canvas;
    const { startX, startY, endX, endY, steps = 10 } = options;

    const startAbsX = boundingBox.x + startX;
    const startAbsY = boundingBox.y + startY;
    const endAbsX = boundingBox.x + endX;
    const endAbsY = boundingBox.y + endY;

    await this.page.mouse.move(startAbsX, startAbsY);
    await this.page.mouse.down();

    // Move in steps for smooth drag
    for (let i = 1; i <= steps; i++) {
      const x = startAbsX + ((endAbsX - startAbsX) * i) / steps;
      const y = startAbsY + ((endAbsY - startAbsY) * i) / steps;
      await this.page.mouse.move(x, y);
    }

    await this.page.mouse.up();
  }

  /**
   * Hover over canvas at specific position
   */
  async hoverCanvas(
    canvas: CanvasElement,
    offsetX: number = 0,
    offsetY: number = 0
  ): Promise<void> {
    const { boundingBox } = canvas;
    const x = boundingBox.x + boundingBox.width / 2 + offsetX;
    const y = boundingBox.y + boundingBox.height / 2 + offsetY;

    await this.page.mouse.move(x, y);
  }

  /**
   * Get pixel color at specific position
   */
  async getPixelColor(
    canvas: CanvasElement,
    x: number,
    y: number
  ): Promise<{ r: number; g: number; b: number; a: number } | null> {
    try {
      const color = await this.page.evaluate(
        ({ selector, x, y }) => {
          const canvas = document.querySelector(selector) as HTMLCanvasElement;
          if (!canvas) return null;

          const ctx = canvas.getContext('2d');
          if (!ctx) return null;

          const pixel = ctx.getImageData(x, y, 1, 1).data;
          return {
            r: pixel[0],
            g: pixel[1],
            b: pixel[2],
            a: pixel[3]
          };
        },
        { selector: 'canvas', x, y }
      );

      return color;
    } catch (error) {
      console.error('Error getting pixel color:', error);
      return null;
    }
  }

  /**
   * Take canvas screenshot
   */
  async screenshotCanvas(
    canvas: CanvasElement,
    path?: string
  ): Promise<Buffer> {
    return await canvas.locator.screenshot({ path });
  }

  /**
   * Wait for canvas to be visible and loaded
   */
  async waitForCanvasReady(
    selector: string = 'canvas',
    timeout: number = 30000
  ): Promise<CanvasElement | null> {
    await this.page.waitForSelector(selector, { 
      state: 'visible', 
      timeout 
    });

    // Wait additional time for canvas to render
    await this.page.waitForTimeout(2000);

    return await this.getCanvas(selector);
  }

  /**
   * Detect if element is canvas or iframe
   */
  async detectGameType(
    containerSelector: string = '.game-container'
  ): Promise<'canvas' | 'iframe' | 'unknown'> {
    const canvasExists = await this.page.locator(`${containerSelector} canvas`).count() > 0;
    const iframeExists = await this.page.locator(`${containerSelector} iframe`).count() > 0;

    if (canvasExists) return 'canvas';
    if (iframeExists) return 'iframe';
    return 'unknown';
  }

  /**
   * Get canvas dimensions
   */
  async getCanvasDimensions(
    selector: string = 'canvas'
  ): Promise<{ width: number; height: number } | null> {
    try {
      return await this.page.evaluate((sel) => {
        const canvas = document.querySelector(sel) as HTMLCanvasElement;
        if (!canvas) return null;
        return {
          width: canvas.width,
          height: canvas.height
        };
      }, selector);
    } catch (error) {
      console.error('Error getting canvas dimensions:', error);
      return null;
    }
  }

  /**
   * Check if canvas is animating (multiple frames with differences)
   */
  async isCanvasAnimating(
    canvas: CanvasElement,
    samples: number = 3,
    interval: number = 100
  ): Promise<boolean> {
    const screenshots: Buffer[] = [];

    for (let i = 0; i < samples; i++) {
      const screenshot = await this.screenshotCanvas(canvas);
      screenshots.push(screenshot);
      if (i < samples - 1) {
        await this.page.waitForTimeout(interval);
      }
    }

    // Compare screenshots to detect animation
    for (let i = 1; i < screenshots.length; i++) {
      if (!screenshots[i].equals(screenshots[i - 1])) {
        return true; // Found difference = animation detected
      }
    }

    return false;
  }

  /**
   * Execute JavaScript in canvas context
   */
  async executeInCanvasContext<T>(
    script: string,
    selector: string = 'canvas'
  ): Promise<T | null> {
    try {
      return await this.page.evaluate(
        ({ sel, script }) => {
          const canvas = document.querySelector(sel) as HTMLCanvasElement;
          if (!canvas) return null;
          
          // Execute script with canvas as context
          const func = new Function('canvas', script);
          return func(canvas);
        },
        { sel: selector, script }
      );
    } catch (error) {
      console.error('Error executing in canvas context:', error);
      return null;
    }
  }

  /**
   * Find clickable regions using color detection
   */
  async findClickableRegions(
    canvas: CanvasElement,
    targetColor: { r: number; g: number; b: number },
    tolerance: number = 10
  ): Promise<Array<{ x: number; y: number }>> {
    const regions: Array<{ x: number; y: number }> = [];
    const { boundingBox } = canvas;
    const step = 20; // Sample every 20 pixels

    for (let y = 0; y < boundingBox.height; y += step) {
      for (let x = 0; x < boundingBox.width; x += step) {
        const color = await this.getPixelColor(canvas, x, y);
        if (color && this.colorsMatch(color, targetColor, tolerance)) {
          regions.push({ x, y });
        }
      }
    }

    return regions;
  }

  /**
   * Helper: Check if two colors match within tolerance
   */
  private colorsMatch(
    color1: { r: number; g: number; b: number },
    color2: { r: number; g: number; b: number },
    tolerance: number
  ): boolean {
    return (
      Math.abs(color1.r - color2.r) <= tolerance &&
      Math.abs(color1.g - color2.g) <= tolerance &&
      Math.abs(color1.b - color2.b) <= tolerance
    );
  }

  /**
   * Simulate touch/swipe on canvas (for mobile games)
   */
  async swipeOnCanvas(
    canvas: CanvasElement,
    direction: 'up' | 'down' | 'left' | 'right',
    distance: number = 100
  ): Promise<void> {
    const { boundingBox } = canvas;
    const centerX = boundingBox.width / 2;
    const centerY = boundingBox.height / 2;

    let startX = centerX, startY = centerY;
    let endX = centerX, endY = centerY;

    switch (direction) {
      case 'up':
        endY = centerY - distance;
        break;
      case 'down':
        endY = centerY + distance;
        break;
      case 'left':
        endX = centerX - distance;
        break;
      case 'right':
        endX = centerX + distance;
        break;
    }

    await this.dragOnCanvas(canvas, { startX, startY, endX, endY, steps: 20 });
  }
}
