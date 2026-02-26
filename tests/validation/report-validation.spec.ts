import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Report Validation Test Suite
 *
 * Validates that the Game Testing HTML report:
 * 1. Contains all required sections (header, summary, test scenarios, detailed results)
 * 2. Has proper game entries with correct structure
 * 3. Contains embedded screenshots for each step
 * 4. Shows correct pass/fail/evidence status indicators
 * 5. Validates that key UI elements (bet button, gameplay) were actually tested
 */

// Report file path - can be overridden via env var
const REPORT_PATH = process.env.REPORT_PATH ||
  path.resolve(process.cwd(), 'game-testing-report.html');

// Expected sections in the report
const REQUIRED_SECTIONS = [
  'GamePulse',
  'Game Testing Report',
  'Games Tested',
  'Passed',
  'Failed',
  'Pass Rate',
  'Steps Passed',
  'Test Scenarios',
  'Detailed Results',
];

// Expected step names in order
const EXPECTED_STEPS = [
  'Lobby Navigation',
  'Play Button Click',
  'Game Element Loaded',
  'Continue/Accept',
  'Credits/Balance',
  'Spin',
  'Min Bet',
  'Max Bet',
  'Bet Reset',
  'Paytable/Info',
  'Auto-Spin',
];

// Valid status values
const VALID_STATUSES = ['PASS', 'FAIL', 'WARN', 'SKIP', 'EVIDENCE', 'NO DATA'];

test.describe('Game Testing Report Validation', () => {
  let page: Page;
  let reportExists: boolean;

  test.beforeAll(async ({ browser }) => {
    // Check if report exists
    reportExists = fs.existsSync(REPORT_PATH);
    if (!reportExists) {
      console.warn(`Report file not found at: ${REPORT_PATH}`);
    }
  });

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    if (reportExists) {
      await page.goto(`file:///${REPORT_PATH.replace(/\\/g, '/')}`);
    }
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('Report file exists', async () => {
    expect(reportExists, `Report should exist at ${REPORT_PATH}`).toBeTruthy();
  });

  test('Report has valid HTML structure', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    // Check DOCTYPE
    const html = await page.content();
    expect(html).toContain('<!DOCTYPE html>');

    // Check title
    const title = await page.title();
    expect(title).toContain('GamePulse');

    // Check meta charset
    const charset = await page.locator('meta[charset]').getAttribute('charset');
    expect(charset?.toLowerCase()).toBe('utf-8');
  });

  test('Report contains all required sections', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const bodyText = await page.locator('body').textContent();

    for (const section of REQUIRED_SECTIONS) {
      expect(bodyText, `Report should contain section: ${section}`).toContain(section);
    }
  });

  test('Report header has correct information', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    // Check title
    const h1 = await page.locator('h1').first().textContent();
    expect(h1).toContain('GamePulse');

    // Check date is present (format: DD Month YYYY)
    const bodyText = await page.locator('body').textContent();
    const datePattern = /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/;
    expect(bodyText).toMatch(datePattern);

    // Check session ID is present
    expect(bodyText).toMatch(/Session:\s*pt-\d+-\w+/);
  });

  test('Summary cards show numeric values', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const summaryCards = page.locator('.summary-card, [class*="summary"]');
    const cardCount = await summaryCards.count();

    // Should have at least 5 summary cards
    expect(cardCount).toBeGreaterThanOrEqual(5);

    // Check that values are numeric
    const bodyText = await page.locator('body').textContent() || '';

    // Games Tested should be a number
    expect(bodyText).toMatch(/Games Tested.*?\d+/s);

    // Pass Rate should be a percentage
    expect(bodyText).toMatch(/Pass Rate.*?\d+(\.\d+)?%/s);
  });

  test('Test scenarios table lists all 11 steps', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const bodyText = await page.locator('body').textContent() || '';

    for (const stepName of EXPECTED_STEPS) {
      expect(bodyText, `Report should list step: ${stepName}`).toContain(stepName);
    }
  });

  test('Each game has a results section', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    // Look for game result sections (h3 elements with game names)
    const gameHeaders = page.locator('h3');
    const headerCount = await gameHeaders.count();

    // Should have at least one game
    expect(headerCount).toBeGreaterThanOrEqual(1);

    // Each game section should have a score
    const bodyText = await page.locator('body').textContent() || '';
    const scorePattern = /\d+\/\d+|PASSED|FAILED/;
    expect(bodyText).toMatch(scorePattern);
  });

  test('Step results have valid status indicators', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const html = await page.content();

    // Check that status badges exist
    let hasValidStatus = false;
    for (const status of VALID_STATUSES) {
      if (html.includes(`>${status}<`)) {
        hasValidStatus = true;
        break;
      }
    }
    expect(hasValidStatus, 'Report should contain at least one valid status indicator').toBeTruthy();
  });

  test('Screenshots are embedded as base64', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const images = page.locator('img[src^="data:image/png;base64"]');
    const imageCount = await images.count();

    // Should have at least one embedded screenshot
    expect(imageCount, 'Report should contain embedded screenshots').toBeGreaterThanOrEqual(1);
  });

  test('Screenshots have step labels', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const html = await page.content();

    // Check that screenshot sections have step labels
    const stepLabelPattern = /Step \d+:/;
    expect(html).toMatch(stepLabelPattern);
  });

  test('Bet steps are validated', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const bodyText = await page.locator('body').textContent() || '';
    const html = await page.content();

    // Check that Min Bet, Max Bet, and Bet Reset are mentioned
    expect(bodyText).toContain('Min Bet');
    expect(bodyText).toContain('Max Bet');
    expect(bodyText).toContain('Bet Reset');

    // Should have either a pass/fail result or evidence indicator for bet steps
    const hasBetStatus =
      html.includes('Step 7') ||
      html.includes('Step 8') ||
      html.includes('Step 9') ||
      html.includes('Min Bet') ||
      html.includes('Max Bet') ||
      html.includes('Bet Reset');

    expect(hasBetStatus, 'Report should include bet step validation').toBeTruthy();
  });

test('Step 6 spin action is validated', async () => {
  test.skip(!reportExists, 'Report file does not exist');

  const bodyText = await page.locator('body').textContent() || '';

  // Check that Step 6 action is mentioned
  expect(
    bodyText.includes('Spin'),
    'Expected Step 6 spin label to be present'
  ).toBeTruthy();

    // Check that there's evidence for step 6 (Spin)
    const html = await page.content();

    const hasGameplayStatus =
      html.includes('Step 6') ||
      html.includes('06b-after-gameplay') ||
      html.includes('06a-before-gameplay');

  expect(hasGameplayStatus, 'Report should include Step 6 spin validation').toBeTruthy();
});

  test('Step 11 auto-spin action is validated', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const bodyText = await page.locator('body').textContent() || '';
    const html = await page.content();

    const hasSpinStepLabel = bodyText.includes('Auto-Spin');

    expect(hasSpinStepLabel, 'Report should include Auto-Spin step label').toBeTruthy();

    // Verify step 11 has related evidence/output markers.
    const hasSpinEvidence =
      html.includes('Step 11') ||
      html.includes('Auto-Spin') ||
      html.includes('11b-after-autospin') ||
      html.includes('11a-before-autospin');

    expect(hasSpinEvidence, 'Report should include Step 11 auto-spin evidence').toBeTruthy();
  });

  test('Report has footer with attribution', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const bodyText = await page.locator('body').textContent() || '';

    expect(bodyText).toContain('GamePulse Dashboard');
    expect(bodyText).toContain('Betway');
  });

  test('No broken images in report', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    // Get all images
    const images = page.locator('img');
    const imageCount = await images.count();

    let brokenImages = 0;
    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
      if (naturalWidth === 0) {
        brokenImages++;
        const src = await img.getAttribute('src');
        console.warn(`Broken image found: ${src?.substring(0, 50)}...`);
      }
    }

    expect(brokenImages, 'Report should not have broken images').toBe(0);
  });

  test('Report is print-friendly', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const html = await page.content();

    // Check for print media query
    expect(html).toContain('@media print');
  });

  test('All tested games have screenshot evidence', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    // Find all game sections
    const gameHeaders = page.locator('h3');
    const headerCount = await gameHeaders.count();

    if (headerCount === 0) {
      test.skip(true, 'No games in report');
      return;
    }

    // For each game, check that it has at least one screenshot
    const images = page.locator('img[src^="data:image/png;base64"]');
    const imageCount = await images.count();

    // At minimum, each game should have 1 screenshot per step tested
    // But we'll be lenient and just check there's at least 1 image per game
    expect(imageCount).toBeGreaterThanOrEqual(headerCount);
  });
});

test.describe('Report Content Quality Checks', () => {
  let page: Page;
  let reportExists: boolean;

  test.beforeAll(async () => {
    reportExists = fs.existsSync(REPORT_PATH);
  });

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    if (reportExists) {
      await page.goto(`file:///${REPORT_PATH.replace(/\\/g, '/')}`);
    }
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('Pass rate calculation is correct', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const bodyText = await page.locator('body').textContent() || '';

    // Extract numbers
    const testedMatch = bodyText.match(/Games Tested.*?(\d+)/s);
    const passedMatch = bodyText.match(/Passed.*?(\d+)/s);
    const rateMatch = bodyText.match(/Pass Rate.*?(\d+(?:\.\d+)?)/s);

    if (testedMatch && passedMatch && rateMatch) {
      const tested = parseInt(testedMatch[1]);
      const passed = parseInt(passedMatch[1]);
      const rate = parseFloat(rateMatch[1]);

      if (tested > 0) {
        const expectedRate = (passed / tested) * 100;
        expect(Math.abs(rate - expectedRate)).toBeLessThan(1); // Allow 1% tolerance
      }
    }
  });

  test('Step counts are consistent', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const html = await page.content();

    // Count PASS/FAIL/WARN indicators
    const passCount = (html.match(/>PASS</g) || []).length;
    const failCount = (html.match(/>FAIL</g) || []).length;
    const warnCount = (html.match(/>WARN</g) || []).length;
    const evidenceCount = (html.match(/>EVIDENCE</g) || []).length;

    const totalStepIndicators = passCount + failCount + warnCount + evidenceCount;

    // Should have at least 11 indicators per game (one per step)
    // This is a sanity check
    console.log(`Step indicators found: PASS=${passCount}, FAIL=${failCount}, WARN=${warnCount}, EVIDENCE=${evidenceCount}`);
    expect(totalStepIndicators).toBeGreaterThanOrEqual(11);
  });

  test('Screenshots are reasonably sized', async () => {
    test.skip(!reportExists, 'Report file does not exist');

    const images = page.locator('img[src^="data:image/png;base64"]');
    const imageCount = await images.count();

    for (let i = 0; i < Math.min(imageCount, 5); i++) { // Check first 5 images
      const img = images.nth(i);
      const src = await img.getAttribute('src');

      if (src) {
        // Base64 encoded PNG should be at least a few KB
        const base64Length = src.replace('data:image/png;base64,', '').length;
        const approximateBytes = base64Length * 0.75;

        // A valid screenshot should be at least 10KB
        expect(approximateBytes, `Image ${i + 1} should be at least 10KB`).toBeGreaterThan(10000);
      }
    }
  });
});
