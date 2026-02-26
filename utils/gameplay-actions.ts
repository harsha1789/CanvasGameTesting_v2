import { Page } from '@playwright/test';
import { GamePage } from '../pages/GamePage';

/**
 * Unified Game-Type-Aware Gameplay Actions
 *
 * Central dispatcher that performs type-appropriate gameplay during HAR recording.
 * Replaces the hardcoded slots-only bet+spin flow in HarRecorder and RecordingService.
 *
 * Gameplay logic extracted from existing per-type test scripts:
 * - Slots:      tests/slots/generic-slot-tests.spec.ts
 * - Crash:      tests/validation/aviator-test.spec.ts
 * - Table:      tests/table-games/table-games.spec.ts
 * - Live:       tests/live-casino/live-casino.spec.ts
 */

// ── Types ──

export type GameCategory = 'slots' | 'crash-games' | 'table-game' | 'live-casino';

export interface GameplayConfig {
  postActionWaitMs: number;
  betIncreaseTimes: number;
  subType?: string;
  gameLoadTimeout: number;
}

export interface GameplayResult {
  actionsPerformed: string[];
  success: boolean;
  error?: string;
}

// ── Category Resolution ──

const CATEGORY_MAP: Record<string, GameCategory> = {
  'slots': 'slots',
  'slot': 'slots',
  'crash-games': 'crash-games',
  'crash': 'crash-games',
  'table-game': 'table-game',
  'table-games': 'table-game',
  'table': 'table-game',
  'live-casino': 'live-casino',
  'live': 'live-casino',
  'livegames': 'live-casino',
};

/**
 * Resolve canonical game category from a game object.
 * Falls back to 'slots' for unrecognized categories.
 */
export function resolveGameCategory(game: { category?: string }): GameCategory {
  const cat = (game.category || '').toLowerCase().trim();
  return CATEGORY_MAP[cat] || 'slots';
}

// ── Main Dispatcher ──

/**
 * Perform type-appropriate gameplay actions during HAR recording.
 */
export async function performGameplay(
  page: Page,
  gamePage: GamePage,
  category: GameCategory,
  config: GameplayConfig
): Promise<GameplayResult> {
  console.log(`  [Gameplay] Category: ${category}, subType: ${config.subType || 'none'}`);

  switch (category) {
    case 'slots':
      return performSlotGameplay(page, gamePage, config);
    case 'crash-games':
      return performCrashGameplay(page, gamePage, config);
    case 'table-game':
      return performTableGameplay(page, gamePage, config);
    case 'live-casino':
      return performLiveCasinoGameplay(page, gamePage, config);
    default:
      return performSlotGameplay(page, gamePage, config);
  }
}

// ── Slot Gameplay ──

async function performSlotGameplay(
  page: Page,
  gamePage: GamePage,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  try {
    await gamePage.increaseBet(config.betIncreaseTimes);
    actions.push(`increaseBet(${config.betIncreaseTimes})`);
  } catch {
    actions.push('increaseBet:skipped');
  }

  try {
    await gamePage.spin();
    actions.push('spin');
    await gamePage.waitForSpinComplete(15000);
    actions.push('spinComplete');
  } catch {
    actions.push('spin:skipped');
  }

  await page.waitForTimeout(config.postActionWaitMs);
  actions.push(`postWait(${config.postActionWaitMs}ms)`);

  return { actionsPerformed: actions, success: true };
}

// ── Crash Game Gameplay ──

async function performCrashGameplay(
  page: Page,
  _gamePage: GamePage,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  // Verify credits (crash games need balance visible before play)
  try {
    const { verifyCreditsWithRetry } = await import('./game-launch-helpers');
    const creditsResult = await verifyCreditsWithRetry(page, 3);
    actions.push(`verifyCredits:${creditsResult.visible}`);
  } catch {
    actions.push('verifyCredits:error');
  }

  // Try to place a bet (crash games have a Bet button, not spin)
  const betSelectors = [
    'button:has-text("Bet")', 'button:has-text("BET")',
    '[class*="bet-btn"]', '[class*="bet-button"]', '[data-testid*="bet"]',
  ];

  for (const selector of betSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        actions.push(`placeBet(${selector})`);
        await page.waitForTimeout(3000);
        break;
      }
    } catch { /* continue */ }
  }

  // Also check inside iframes for bet button
  if (!actions.some(a => a.startsWith('placeBet'))) {
    try {
      const iframe = page.frameLocator('iframe').first();
      for (const selector of betSelectors) {
        const btn = iframe.locator(selector).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          actions.push(`placeBet(iframe:${selector})`);
          await page.waitForTimeout(3000);
          break;
        }
      }
    } catch { /* iframe not accessible */ }
  }

  if (!actions.some(a => a.startsWith('placeBet'))) {
    actions.push('placeBet:skipped');
  }

  // Wait for round activity (crash games have continuous rounds)
  const waitMs = Math.max(config.postActionWaitMs, 10000);
  await page.waitForTimeout(waitMs);
  actions.push(`waitForRound(${waitMs}ms)`);

  return { actionsPerformed: actions, success: true };
}

// ── Table Game Gameplay ──

async function performTableGameplay(
  page: Page,
  gamePage: GamePage,
  config: GameplayConfig
): Promise<GameplayResult> {
  const subType = (config.subType || '').toLowerCase();

  if (subType === 'blackjack') {
    return performBlackjackGameplay(page, config);
  } else if (subType === 'roulette') {
    return performRouletteGameplay(page, config);
  } else if (subType === 'baccarat') {
    return performBaccaratGameplay(page, config);
  }

  // Generic table game: try bet then deal
  return performGenericTableGameplay(page, config);
}

async function performBlackjackGameplay(
  page: Page,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  // Bet
  await clickFirstVisible(page, actions, 'bet', [
    'button:has-text("Bet")', 'button:has-text("BET")', '.bet-button', '[class*="bet"]',
  ], 3000);

  // Deal
  await clickFirstVisible(page, actions, 'deal', [
    'button:has-text("Deal")', 'button:has-text("DEAL")', '.deal-button', '[class*="deal"]',
  ], 3000);

  // Hit
  await clickFirstVisible(page, actions, 'hit', [
    'button:has-text("Hit")', 'button:has-text("HIT")', '.hit-button', '[class*="hit"]',
  ], 2000);

  // Stand
  await clickFirstVisible(page, actions, 'stand', [
    'button:has-text("Stand")', 'button:has-text("STAND")', '.stand-button', '[class*="stand"]',
  ], 2000);

  await page.waitForTimeout(config.postActionWaitMs);
  actions.push('postWait');

  return { actionsPerformed: actions, success: true };
}

async function performRouletteGameplay(
  page: Page,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  // Try to click a betting area on the canvas/iframe
  const gameElement = page.locator('canvas, iframe').first();
  if (await gameElement.isVisible({ timeout: 5000 }).catch(() => false)) {
    const box = await gameElement.boundingBox().catch(() => null);
    if (box && box.width > 400) {
      // Click center of game area (betting table area)
      const betX = box.x + box.width / 2;
      const betY = box.y + box.height * 0.5;
      await page.mouse.click(betX, betY);
      actions.push('betOnTable(canvas-click)');
      await page.waitForTimeout(2000);
    }
  }

  // Click spin button
  await clickFirstVisible(page, actions, 'spin', [
    'button:has-text("Spin")', 'button:has-text("SPIN")', '.spin-button', '[class*="spin"]',
  ], 5000);

  await page.waitForTimeout(config.postActionWaitMs);
  actions.push('postWait');

  return { actionsPerformed: actions, success: true };
}

async function performBaccaratGameplay(
  page: Page,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  // Try to click Player/Banker/Tie bet areas
  await clickFirstVisible(page, actions, 'betPlayer', [
    'button:has-text("Player")', 'button:has-text("PLAYER")', '[class*="player"]',
  ], 3000);

  // If player bet didn't work, try banker
  if (!actions.some(a => a.startsWith('betPlayer'))) {
    await clickFirstVisible(page, actions, 'betBanker', [
      'button:has-text("Banker")', 'button:has-text("BANKER")', '[class*="banker"]',
    ], 3000);
  }

  // Deal
  await clickFirstVisible(page, actions, 'deal', [
    'button:has-text("Deal")', 'button:has-text("DEAL")', '.deal-button',
  ], 3000);

  await page.waitForTimeout(config.postActionWaitMs);
  actions.push('postWait');

  return { actionsPerformed: actions, success: true };
}

async function performGenericTableGameplay(
  page: Page,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  await clickFirstVisible(page, actions, 'bet', [
    'button:has-text("Bet")', 'button:has-text("BET")', '.bet-button', '[class*="bet"]',
  ], 5000);

  await clickFirstVisible(page, actions, 'deal', [
    'button:has-text("Deal")', 'button:has-text("DEAL")', '.deal-button',
    'button:has-text("Spin")', 'button:has-text("SPIN")',
  ], 5000);

  await page.waitForTimeout(config.postActionWaitMs);
  actions.push('postWait');

  return { actionsPerformed: actions, success: true };
}

// ── Live Casino Gameplay ──

async function performLiveCasinoGameplay(
  page: Page,
  _gamePage: GamePage,
  config: GameplayConfig
): Promise<GameplayResult> {
  const actions: string[] = [];

  // Live games need extra load time for video stream
  await page.waitForTimeout(5000);
  actions.push('extendedLoadWait');

  // Check for video/stream element
  const videoEl = page.locator('video, canvas').first();
  const streamVisible = await videoEl.isVisible({ timeout: 10000 }).catch(() => false);
  actions.push(`videoStream:${streamVisible}`);

  // Check for betting interface
  const bettingSelectors = ['.betting-grid', '.roulette-table', '[class*="bet"]', '[class*="chip"]'];
  for (const sel of bettingSelectors) {
    if (await page.locator(sel).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      actions.push(`bettingInterface(${sel})`);
      break;
    }
  }

  // Try to select a chip/token
  await clickFirstVisible(page, actions, 'selectChip', [
    '[class*="chip"]', '[class*="token"]', '[class*="denomination"]',
  ], 3000);

  // Try to place a bet on a visible area
  await clickFirstVisible(page, actions, 'placeBet', [
    '[class*="bet-spot"]', '[class*="betting-area"]',
    'button:has-text("Bet")', 'button:has-text("BET")',
  ], 3000);

  // Wait for live game activity to generate network traffic
  const waitMs = Math.max(config.postActionWaitMs, 15000);
  await page.waitForTimeout(waitMs);
  actions.push(`waitForLiveActivity(${waitMs}ms)`);

  return { actionsPerformed: actions, success: true };
}

// ── Utility ──

/**
 * Try to click the first visible element from a list of selectors.
 * Checks main page and then iframes.
 */
async function clickFirstVisible(
  page: Page,
  actions: string[],
  actionName: string,
  selectors: string[],
  waitAfterMs: number
): Promise<boolean> {
  // Check main page
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click({ force: true }).catch(() => {});
        actions.push(`${actionName}(${selector})`);
        await page.waitForTimeout(waitAfterMs);
        return true;
      }
    } catch { /* continue */ }
  }

  // Check inside iframes
  try {
    const iframe = page.frameLocator('iframe').first();
    for (const selector of selectors) {
      try {
        const el = iframe.locator(selector).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.click({ force: true }).catch(() => {});
          actions.push(`${actionName}(iframe:${selector})`);
          await page.waitForTimeout(waitAfterMs);
          return true;
        }
      } catch { /* continue */ }
    }
  } catch { /* iframe not accessible */ }

  actions.push(`${actionName}:skipped`);
  return false;
}
