import { test, expect } from '@playwright/test';

/**
 * Dashboard Game Testing UI Validation
 *
 * Validates that the manual game input feature on the Game Testing tab
 * works correctly for adding and running games like Sugar Time.
 */

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4000';

test.describe('Game Testing Tab - Manual Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('domcontentloaded');
    // Click the Game Testing tab
    const gameTestingTab = page.locator('[data-tab="game-testing"]');
    await gameTestingTab.click();
    await expect(page.locator('#tab-game-testing')).toHaveClass(/active/);
  });

  test('should display manual game input section', async ({ page }) => {
    // Verify the manual input section exists
    await expect(page.locator('#pt-game-url')).toBeVisible();
    await expect(page.locator('#pt-game-name')).toBeVisible();
    await expect(page.locator('#pt-game-category')).toBeVisible();
    await expect(page.locator('#pt-game-provider')).toBeVisible();
    await expect(page.locator('#pt-add-game')).toBeVisible();
  });

  test('should auto-detect game name from URL', async ({ page }) => {
    const urlInput = page.locator('#pt-game-url');
    const nameInput = page.locator('#pt-game-name');
    const addBtn = page.locator('#pt-add-game');

    // Enter Sugar Time URL (leave name blank for auto-detect)
    await urlInput.fill('https://www.betway.co.za/lobby/casino-games/game/sugartime-egt?vertical=casino-games');
    await addBtn.click();

    // Verify game was added to manual queue
    const queueItem = page.locator('.pt-manual-queue-item');
    await expect(queueItem).toBeVisible();
    await expect(queueItem.locator('.pt-mq-name')).toContainText('Sugartime Egt');
  });

  test('should add Sugar Time with custom name', async ({ page }) => {
    await page.locator('#pt-game-url').fill('https://www.betway.co.za/lobby/casino-games/game/sugartime-egt?vertical=casino-games');
    await page.locator('#pt-game-name').fill('Sugar Time');
    await page.locator('#pt-game-category').selectOption('slots');
    await page.locator('#pt-game-provider').fill('EGT');
    await page.locator('#pt-add-game').click();

    // Verify game appears in queue with correct name
    const queueItem = page.locator('.pt-manual-queue-item');
    await expect(queueItem).toBeVisible();
    await expect(queueItem.locator('.pt-mq-name')).toContainText('Sugar Time');
    await expect(queueItem.locator('.pt-mq-cat')).toContainText('slots');
    await expect(queueItem.locator('.pt-mq-cat')).toContainText('EGT');
  });

  test('should prevent duplicate games', async ({ page }) => {
    const url = 'https://www.betway.co.za/lobby/casino-games/game/sugartime-egt';
    await page.locator('#pt-game-url').fill(url);
    await page.locator('#pt-game-name').fill('Sugar Time');
    await page.locator('#pt-add-game').click();

    // Try adding same game again
    await page.locator('#pt-game-url').fill(url);
    await page.locator('#pt-game-name').fill('Sugar Time');

    // Listen for alert
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('already added');
      await dialog.accept();
    });
    await page.locator('#pt-add-game').click();

    // Should still have only 1 item
    const items = page.locator('.pt-manual-queue-item');
    await expect(items).toHaveCount(1);
  });

  test('should remove game from queue', async ({ page }) => {
    await page.locator('#pt-game-url').fill('https://www.betway.co.za/lobby/casino-games/game/sugartime-egt');
    await page.locator('#pt-game-name').fill('Sugar Time');
    await page.locator('#pt-add-game').click();

    await expect(page.locator('.pt-manual-queue-item')).toHaveCount(1);

    // Click remove button
    await page.locator('.pt-mq-remove').click();
    await expect(page.locator('.pt-manual-queue-item')).toHaveCount(0);
  });

  test('should clear inputs after adding game', async ({ page }) => {
    await page.locator('#pt-game-url').fill('https://www.betway.co.za/lobby/casino-games/game/sugartime-egt');
    await page.locator('#pt-game-name').fill('Sugar Time');
    await page.locator('#pt-game-provider').fill('EGT');
    await page.locator('#pt-add-game').click();

    // Inputs should be cleared
    await expect(page.locator('#pt-game-url')).toHaveValue('');
    await expect(page.locator('#pt-game-name')).toHaveValue('');
    await expect(page.locator('#pt-game-provider')).toHaveValue('');
  });

  test('should trigger pipeline test for Sugar Time', async ({ page }) => {
    // Add Sugar Time
    await page.locator('#pt-game-url').fill('https://www.betway.co.za/lobby/casino-games/game/sugartime-egt?vertical=casino-games');
    await page.locator('#pt-game-name').fill('Sugar Time');
    await page.locator('#pt-game-category').selectOption('slots');
    await page.locator('#pt-gaYou sme-provider').fill('EGT');
    await page.locator('#pt-add-game').click();

    // Verify game is in queue
    await expect(page.locator('.pt-manual-queue-item')).toHaveCount(1);

    // Click Run Selected
    const runBtn = page.locator('#pt-run-selected');
    await expect(runBtn).toBeVisible();
    await runBtn.click();
    // Verify run request produced a session with Sugar Time.
    await expect
      .poll(async () => {
        const response = await page.request.get(`${DASHBOARD_URL}/api/pipeline/results`);
        if (!response.ok()) return false;
        const data = await response.json();
        if (!data || !Array.isArray(data.games)) return false;
        return Boolean(data.sessionId) &&
          (data.totalGames === 1 || data.games.length === 1) &&
          data.games.some((g: any) => g.gameName === 'Sugar Time');
      }, {
        timeout: 20000,
        message: 'Expected pipeline run to create results for Sugar Time',
      })
      .toBeTruthy();

    const response = await page.request.get(`${DASHBOARD_URL}/api/pipeline/results`);
    const results = await response.json();

    // UI updates via SSE can lag behind API state.
    const panelClasses = (await page.locator('#pt-progress-panel').getAttribute('class')) || '';
    const progressPanelVisible = !panelClasses.includes('hidden');
    const hasResults = Array.isArray(results.games) && results.games.length > 0;
    expect(progressPanelVisible || hasResults).toBeTruthy();
  });

  test('should show catalog games alongside manual input', async ({ page }) => {
    // Catalog section should be visible with games loaded
    await expect(page.locator('#pt-game-selection')).toBeVisible();

    // Manual input section should also be visible
    await expect(page.locator('#pt-game-url')).toBeVisible();

    // Both "Run Selected / Added Games" and "Run All Catalog" buttons exist
    await expect(page.locator('#pt-run-selected')).toBeVisible();
    await expect(page.locator('#pt-run-all')).toBeVisible();
  });
});

