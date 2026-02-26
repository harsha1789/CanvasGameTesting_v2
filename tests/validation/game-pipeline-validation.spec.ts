import { test, expect } from '../../utils/test-framework';
import {
  verifyCreditsWithRetry,
  isGamePlayable,
  detectCreditsInGame,
} from '../../utils/game-launch-helpers';
import { performGameplay, resolveGameCategory, GameCategory } from '../../utils/gameplay-actions';
import * as fs from 'fs';
import * as path from 'path';
import { findTemplateMatchMultiScale, findTemplateMatchRobust } from '../../utils/image-template';

/**
 * Game Pipeline Validation Test Suite
 *
 * Standalone tests that validate every step of the game pipeline:
 * 1. Lobby Navigation
 * 2. Play Button Click / Game Launch
 * 3. Game Element Loaded (canvas or iframe visible)
 * 4. Continue/Accept button handling
 * 5. Credits/Balance visibility
 * 6. Gameplay Action (spin/play action)
 * 7. Min Bet (decrease bet to minimum)
 * 8. Max Bet (click max bet)
 * 9. Bet Reset (decrease bet from max for safe gameplay)
 * 10. Paytable/Info panel (open, screenshot, close)
 * 11. Auto-Spin (template-based click and visual-state validation)
 *
 * DO NOT MODIFY THESE TESTS WHEN DEVELOPING THE DASHBOARD.
 * These are independent validation tests used to verify pipeline correctness.
 */

// â”€â”€ Screenshot output directory â”€â”€

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'reports', 'pipeline-validation');
const TMP_DIR = path.resolve(process.cwd(), 'tmp');
const GAME_TEMPLATE_ROOT = path.resolve(TMP_DIR, 'game-templates');
const FAST_MODE = ['1', 'true', 'yes', 'on'].includes((process.env.PIPELINE_FAST_MODE || '').toLowerCase());
const FAST = (normalMs: number, fastMs: number): number => (FAST_MODE ? fastMs : normalMs);
const SPIN_SCALES = FAST_MODE ? [0.85, 1.0, 1.15] : [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3];
const ROBUST_SCALES = FAST_MODE ? [0.8, 0.9, 1.0, 1.1, 1.2] : [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];

function sanitizeSegment(v: string): string {
  return (v || 'unknown')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function readFirstExisting(paths: string[]): Buffer | null {
  for (const p of paths) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
}

function readTemplateCandidates(
  items: Array<{ label: string; filePath: string }>,
  options?: { iconSizedOnly?: boolean }
): Array<{ label: string; data: Buffer }> {
  const iconSizedOnly = options?.iconSizedOnly ?? true;
  return items
    .filter((i) => fs.existsSync(i.filePath))
    .map((i) => ({ label: i.label, data: fs.readFileSync(i.filePath) }))
    .filter((i) => (iconSizedOnly ? isIconSizedTemplate(i.data) : i.data.length > 0));
}

function isIconSizedTemplate(buf: Buffer, maxW = 320, maxH = 320): boolean {
  try {
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(buf);
    return png.width > 6 && png.height > 6 && png.width <= maxW && png.height <= maxH;
  } catch {
    return false;
  }
}
const ENABLE_CLICK_ANNOTATION = (process.env.PIPELINE_ANNOTATE_CLICKS ?? '0') === '1';

// â”€â”€ Types â”€â”€

interface StepResult {
  step: string;
  passed: boolean;
  diffRatio?: number;
  details: string;
}

interface TestGame {
  id: string;
  name: string;
  category: string;
  subType?: string;
  lobbyPath: string;
  directUrl?: string; // Direct URL fallback for games that can't be found via search
  external?: boolean; // True if game is on a non-Betway domain (skip login/lobby)
  username?: string; // Optional per-game login override
  password?: string; // Optional per-game login override
}

interface MatchMarker {
  x: number;
  y: number;
  r: number;
}

interface ClickValidation {
  ok: boolean;
  templateFound: boolean;
  clicked: boolean;
  visualChange: boolean;
  diffRatio: number;
}

interface GameTemplateSet {
  gameId: string;
  gameDir: string;
  betTemplates: Array<{ label: string; data: Buffer }>;
  betWindowTemplates: Array<{ label: string; data: Buffer }>;
  spinTemplates: Array<{ label: string; data: Buffer }>;
  autoSpinTemplates: Array<{ label: string; data: Buffer }>;
  autoSpinActiveTemplates: Array<{ label: string; data: Buffer }>;
  hamburgerTemplates: Array<{ label: string; data: Buffer }>;
  paytableTemplates: Array<{ label: string; data: Buffer }>;
}

function getGameTemplateDir(gameId: string): string {
  return path.resolve(GAME_TEMPLATE_ROOT, sanitizeSegment(gameId));
}

function loadGameTemplates(gameId: string): GameTemplateSet {
  const gameDir = getGameTemplateDir(gameId);

  const betTemplates = readTemplateCandidates([
    { label: 'game-bet-before', filePath: path.join(gameDir, 'Bet-icon-before-click.png') },
    { label: 'game-bet', filePath: path.join(gameDir, 'bet.png') },
    { label: 'tmp-bet-before', filePath: path.resolve(TMP_DIR, 'Bet-icon-before-click.png') },
    { label: 'tmp-bet', filePath: path.resolve(TMP_DIR, 'bet.png') },
    { label: 'reports-bet', filePath: path.resolve(process.cwd(), 'reports', 'screenshots', 'bet.png') },
  ]);
  const betActive = betTemplates.some(t => t.label.startsWith('game-'))
    ? betTemplates.filter(t => t.label.startsWith('game-'))
    : betTemplates;

  const betWindowTemplates = readTemplateCandidates(
    [
      { label: 'game-bet-window', filePath: path.join(gameDir, 'bet-icon-after-click-pop-up-window.png') },
      { label: 'tmp-bet-window', filePath: path.resolve(TMP_DIR, 'bet-icon-after-click-pop-up-window.png') },
      { label: 'reports-betwindow', filePath: path.resolve(process.cwd(), 'reports', 'screenshots', 'betwindow.png') },
    ],
    { iconSizedOnly: false }
  );
  const betWindowActive = betWindowTemplates.some(t => t.label.startsWith('game-'))
    ? betWindowTemplates.filter(t => t.label.startsWith('game-'))
    : betWindowTemplates;

  const spinTemplates = readTemplateCandidates([
    { label: 'game-spin', filePath: path.join(gameDir, 'spin.png') },
    { label: 'tmp-spin', filePath: path.resolve(TMP_DIR, 'spin.png') },
    { label: 'reports-spin-active', filePath: path.resolve(process.cwd(), 'reports', 'screenshots', 'spin-active.png') },
    { label: 'reports-spin', filePath: path.resolve(process.cwd(), 'reports', 'screenshots', 'spin.png') },
    { label: 'reports-Spin', filePath: path.resolve(process.cwd(), 'reports', 'Spin.png') },
    { label: 'screenshots-spin', filePath: path.resolve(process.cwd(), 'screenshots', 'spin.png') },
    { label: 'screenshots-spin-active', filePath: path.resolve(process.cwd(), 'screenshots', 'spin-active.png') },
  ]);
  const spinActive = spinTemplates.some(t => t.label === 'game-spin')
    ? spinTemplates.filter(t => t.label === 'game-spin')
    : spinTemplates;

  const autoSpinTemplates = readTemplateCandidates([
    { label: 'game-auto-spin', filePath: path.join(gameDir, 'auto-spin.png') },
    { label: 'tmp-auto-spin', filePath: path.resolve(TMP_DIR, 'Auto-spin-icon-visible-before-click.png') },
    { label: 'tmp-auto-spin-alt', filePath: path.resolve(TMP_DIR, 'auto-spin.png') },
  ]);

  const autoSpinActiveTemplates = readTemplateCandidates([
    { label: 'game-auto-spin-active', filePath: path.join(gameDir, 'auto-spin-active.png') },
    { label: 'tmp-auto-spin-active', filePath: path.resolve(TMP_DIR, 'Auto-spin-icon-visible-after-click.png') },
    { label: 'tmp-auto-spin-active-alt', filePath: path.resolve(TMP_DIR, 'auto-spin-active.png') },
  ]);

  const hamburgerTemplates = readTemplateCandidates([
    { label: 'game-hamburger', filePath: path.join(gameDir, 'hamburger-menu.png') },
    { label: 'tmp-hamburger', filePath: path.resolve(TMP_DIR, 'hamuburger-menu.png') },
    { label: 'reports-hamburger', filePath: path.resolve(process.cwd(), 'reports', 'screenshots', 'hamuburger-menu.png') },
  ]);

  const paytableTemplates = readTemplateCandidates([
    { label: 'game-paytable', filePath: path.join(gameDir, 'paytable-option-region.png') },
    { label: 'tmp-paytable', filePath: path.resolve(TMP_DIR, 'paytable-icon-visible-after-hamburger-menu-click.png') },
    { label: 'reports-paytable', filePath: path.resolve(process.cwd(), 'reports', 'screenshots', 'paytable-icon-visible-after-hamburger-menu-click.png') },
  ]);

  return {
    gameId,
    gameDir,
    betTemplates: betActive,
    betWindowTemplates: betWindowActive,
    spinTemplates: spinActive,
    autoSpinTemplates,
    autoSpinActiveTemplates,
    hamburgerTemplates,
    paytableTemplates,
  };
}

// â”€â”€ Test games: one representative per category â”€â”€

const DEFAULT_TEST_GAMES: TestGame[] = [
  {
    id: 'starburst',
    name: 'Starburst',
    category: 'slots',
    lobbyPath: '/lobby/casino-games/slots',
  },
  {
    id: 'aviator',
    name: 'Aviator',
    category: 'crash-games',
    lobbyPath: '/lobby/casino-games',
  },
  {
    id: 'blackjack-classic',
    name: 'Classic Blackjack',
    category: 'table-game',
    subType: 'blackjack',
    lobbyPath: '/lobby/casino-games/table-games',
  },
  {
    id: 'crazy-time',
    name: 'Crazy Time',
    category: 'live-casino',
    lobbyPath: '/Livegames',
    directUrl: '/Livegames/crazy-time',
  },
  {
    id: 'ancient-fortunes-poseidon-megaways',
    name: 'Ancient Fortunes Poseidon Megaways',
    category: 'slots',
    lobbyPath: '/lobby/casino-games/slots',
  },
  {
    id: 'disco-beats',
    name: 'Disco Beats',
    category: 'slots',
    lobbyPath: '/lobby/casino-games/slots',
  },
];

/**
 * Load test games from PIPELINE_GAMES_JSON env var if set,
 * otherwise fall back to the default hardcoded list.
 */
function loadTestGames(): TestGame[] {
  // Priority 1: Read from well-known file (reliable on all platforms)
  const gamesFilePath = path.resolve(process.cwd(), 'tmp', 'pipeline-games.json');
  try {
    if (fs.existsSync(gamesFilePath)) {
      const raw = fs.readFileSync(gamesFilePath, 'utf-8');
      const data = raw.replace(/^\uFEFF/, '').trim();
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`Loaded ${parsed.length} game(s) from ${gamesFilePath}`);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to read pipeline-games.json:', err);
  }

  // Priority 2: Read from env var (fallback for direct CLI usage)
  const envJson = process.env.PIPELINE_GAMES_JSON;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson.replace(/^\uFEFF/, '').trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      console.warn('Failed to parse PIPELINE_GAMES_JSON, using defaults');
    }
  }

  return DEFAULT_TEST_GAMES;
}

const TEST_GAMES: TestGame[] = loadTestGames();

// â”€â”€ Helpers â”€â”€

/**
 * Compare two screenshot buffers byte-by-byte.
 * Returns true if more than `threshold`% of bytes differ.
 */
function compareScreenshots(
  before: Buffer,
  after: Buffer,
  threshold = 0.01
): { changed: boolean; diffRatio: number } {
  const len = Math.min(before.length, after.length);
  if (len === 0) return { changed: false, diffRatio: 0 };

  let diffCount = 0;
  for (let i = 0; i < len; i++) {
    if (before[i] !== after[i]) diffCount++;
  }

  // Also account for size difference
  diffCount += Math.abs(before.length - after.length);
  const totalLen = Math.max(before.length, after.length);
  const diffRatio = diffCount / totalLen;

  return { changed: diffRatio > threshold, diffRatio };
}

/**
 * Compare a central gameplay region only (exclude top menus and right-side control rail).
 */
function compareScreenshotsInRegion(
  before: Buffer,
  after: Buffer,
  region: { x0: number; y0: number; x1: number; y1: number },
  threshold = 0.01
): { changed: boolean; diffRatio: number } {
  try {
    const { PNG } = require('pngjs');
    const b = PNG.sync.read(before);
    const a = PNG.sync.read(after);
    const width = Math.min(b.width, a.width);
    const height = Math.min(b.height, a.height);
    if (width <= 1 || height <= 1) return { changed: false, diffRatio: 0 };

    const x0 = Math.max(0, Math.min(width - 1, Math.floor(region.x0)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(region.y0)));
    const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(region.x1)));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(region.y1)));

    let diff = 0;
    let total = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const idx = (width * y + x) << 2;
        // Compare RGB only.
        const d =
          Math.abs(b.data[idx] - a.data[idx]) +
          Math.abs(b.data[idx + 1] - a.data[idx + 1]) +
          Math.abs(b.data[idx + 2] - a.data[idx + 2]);
        if (d > 18) diff++;
        total++;
      }
    }
    if (total === 0) return { changed: false, diffRatio: 0 };
    const diffRatio = diff / total;
    return { changed: diffRatio > threshold, diffRatio };
  } catch {
    return compareScreenshots(before, after, threshold);
  }
}

/**
 * Save a screenshot buffer to disk for debugging.
 */
function saveScreenshot(buffer: Buffer, gameId: string, stepName: string): string {
  const gameDir = path.join(SCREENSHOT_DIR, sanitizeSegment(gameId));
  if (!fs.existsSync(gameDir)) {
    fs.mkdirSync(gameDir, { recursive: true });
  }
  const filePath = path.join(gameDir, `${stepName}.png`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function readBetText(page: any, gamePage: any): Promise<string> {
  try {
    const fromWidget = (await gamePage.getBet().catch(() => '')) || '';
    if (fromWidget && fromWidget !== '0') return fromWidget.trim();
  } catch {}
  try {
    const bodyText = (await page.locator('body').textContent({ timeout: 2000 })) || '';
    const m = bodyText.match(/\b(?:bet|stake)\b[^\n\r]{0,30}([R$€£]?\s?\d[\d,\s]*\.?\d{0,2})/i);
    if (m?.[1]) return m[1].trim();
  } catch {}
  return 'not-detected';
}

function drawCircleOnPng(buffer: Buffer, marker: MatchMarker): Buffer {
  // Lazy import to keep startup light.
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(buffer);

  const cx = Math.round(marker.x);
  const cy = Math.round(marker.y);
  const radius = Math.max(10, Math.round(marker.r));
  const thickness = 4;

  for (let y = Math.max(0, cy - radius - thickness); y < Math.min(png.height, cy + radius + thickness); y++) {
    for (let x = Math.max(0, cx - radius - thickness); x < Math.min(png.width, cx + radius + thickness); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= radius - thickness && dist <= radius + thickness) {
        const idx = (png.width * y + x) << 2;
        png.data[idx] = 255;     // red
        png.data[idx + 1] = 0;   // green
        png.data[idx + 2] = 0;   // blue
        png.data[idx + 3] = 255; // alpha
      }
    }
  }

  return PNG.sync.write(png);
}

function withMarker(buffer: Buffer, marker: MatchMarker | null): Buffer {
  if (!ENABLE_CLICK_ANNOTATION) return buffer;
  if (!marker) return buffer;
  try {
    return drawCircleOnPng(buffer, marker);
  } catch {
    return buffer;
  }
}

/**
 * Get lobby navigation function name for a category.
 */
function getLobbyAction(category: GameCategory): string {
  switch (category) {
    case 'slots': return 'gotoSlots';
    case 'table-game': return 'gotoTableGames';
    case 'live-casino': return 'gotoLiveGames';
    default: return 'goto';
  }
}

async function clickMainGameRel(page: any, gamePage: any, relX: number, relY: number, label: string): Promise<boolean> {
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return false;
  const box = main.boundingBox;
  const x = box.x + box.width * relX;
  const y = box.y + box.height * relY;
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  return true;
}

async function isLikelyGglGameNow(page: any, directUrl?: string): Promise<boolean> {
  try {
    const urls = [
      page.url(),
      directUrl || '',
      ...page.frames().map((f: any) => f.url()),
    ]
      .filter(Boolean)
      .map((u: string) => u.toLowerCase());

    return urls.some((u: string) =>
      u.includes('installprogram.eu') || u.includes('-gtp') || u.includes('ggl')
    );
  } catch {
    const fallback = `${page.url()} ${directUrl || ''}`.toLowerCase();
    return fallback.includes('installprogram.eu') || fallback.includes('-gtp') || fallback.includes('ggl');
  }
}

let gglLastBetMarker: MatchMarker | null = null;
let gglLastBetWindowMatch: any | null = null;
let gglLastSpinMarker: MatchMarker | null = null;
let gglLastAutoSpinMarker: MatchMarker | null = null;

async function gglFindSpinIconMatch(main: any, templates: GameTemplateSet): Promise<any | null> {
  if (templates.spinTemplates.length === 0) return null;
  try {
    const buf = await main.locator.screenshot({ timeout: 60_000 });
    const w = main.boundingBox.width;
    const h = main.boundingBox.height;
    const spinRegion = {
      x0: Math.floor(w * 0.86),
      y0: Math.floor(h * 0.80),
      x1: Math.floor(w * 0.998),
      y1: Math.floor(h * 0.99),
    };
    let best: any | null = null;
    for (const tpl of templates.spinTemplates) {
      let match = findTemplateMatchMultiScale(
        buf,
        tpl.data,
        SPIN_SCALES,
        { region: spinRegion, step: 2, maxScore: 0.22, timeBudgetMs: FAST(1200, 700) }
      );
      if (!match) {
        const robust = findTemplateMatchRobust(buf, tpl.data, {
          scales: ROBUST_SCALES,
          maxScore: 0.22,
          relaxedMaxScore: 0.28,
          steps: [2, 1],
          timeBudgetMs: FAST(1000, 600),
          regions: [spinRegion],
        });
        if (robust) match = robust;
      }
      if (match && (!best || match.score < best.score)) best = { ...match, templateLabel: tpl.label };
    }
    return best || null;
  } catch {
    return null;
  }
}

async function gglFindBetWindow(main: any, templates: GameTemplateSet): Promise<any | null> {
  if (templates.betWindowTemplates.length === 0) return null;
  try {
    const buf = await main.locator.screenshot({ timeout: 60_000 });
    let best: any | null = null;
    for (const tpl of templates.betWindowTemplates) {
      let match = findTemplateMatchMultiScale(
        buf,
        tpl.data,
        [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1],
        { step: 2, maxScore: 0.24, timeBudgetMs: FAST(1800, 900) }
      );
      if (!match) {
        const robust = findTemplateMatchRobust(buf, tpl.data, {
          scales: [0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1],
          maxScore: 0.24,
          relaxedMaxScore: 0.3,
          steps: [2, 1],
          timeBudgetMs: FAST(1400, 800),
        });
        if (robust) match = robust;
      }
      if (match && (!best || match.score < best.score)) best = { ...match, templateLabel: tpl.label };
    }
    return best;
  } catch {
    return null;
  }
}

async function gglBetPopupOpen(page: any, gamePage: any, templates: GameTemplateSet): Promise<ClickValidation> {
  // Bet icon on the lower-right rail (for this provider/game family).
  // Strict validation: image must be found on screen using reports/screenshots/bet.png.
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  gglLastBetMarker = null;

  if (templates.betTemplates.length === 0) {
    console.log(`[GGL bet] template missing for ${templates.gameId}: bet icon template not found in ${templates.gameDir}`);
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }
  if (templates.betWindowTemplates.length === 0) {
    console.log(`[GGL bet] bet-window template missing for ${templates.gameId} in ${templates.gameDir}`);
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  try {
    const before = await main.locator.screenshot({ timeout: 60_000 });
    const buf = before;
    const w = main.boundingBox.width;
    const h = main.boundingBox.height;
    const spinMatch = await gglFindSpinIconMatch(main, templates);
    const region = {
      x0: Math.floor(w * 0.84),
      // Lower-right control rail only (avoid reel/top false matches).
      y0: Math.floor(h * 0.76),
      x1: Math.floor(w * 0.998),
      y1: Math.floor(h * 0.995),
    };
    const popupBefore = await gglFindBetWindow(main, templates);
    if (popupBefore) {
      gglLastBetWindowMatch = popupBefore;
      console.log('[GGL bet] bet popup already open, skipping bet-icon click');
      return { ok: true, templateFound: true, clicked: false, visualChange: true, diffRatio: 0 };
    }
    let match: any | null = null;
    for (const tpl of templates.betTemplates) {
      let candidate = findTemplateMatchMultiScale(
        buf,
        tpl.data,
        [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4],
        { region, step: 2, maxScore: 0.2, timeBudgetMs: FAST(1800, 900) }
      );
      if (!candidate) {
        const robust = findTemplateMatchRobust(buf, tpl.data, {
          scales: ROBUST_SCALES,
          maxScore: 0.2,
          relaxedMaxScore: 0.26,
          steps: [2, 1],
          timeBudgetMs: FAST(1200, 700),
          regions: [region],
        });
        if (robust) {
          const inRightRail = robust.x >= region.x0 && robust.x <= region.x1 && robust.y >= region.y0 && robust.y <= region.y1;
          if (inRightRail) candidate = robust;
        }
      }
      if (candidate && (!match || candidate.score < match.score)) {
        match = { ...candidate, templateLabel: tpl.label };
      }
    }
    if (!match) {
      console.log('[GGL bet] template NOT found on screen');
      return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
    }

    if (spinMatch) {
      const betCenterX = match.x + match.width / 2;
      const betCenterY = match.y + match.height / 2;
      const spinCenterX = spinMatch.x + spinMatch.width / 2;
      const spinCenterY = spinMatch.y + spinMatch.height / 2;
      const minGapY = Math.max(match.height * 1.25, h * 0.045);
      const isBelowSpin = betCenterY >= (spinCenterY + minGapY);
      const xAlignedWithSpinRail = Math.abs(betCenterX - spinCenterX) <= (w * 0.05);
      const tooCloseToSpin = Math.abs(betCenterY - spinCenterY) < (h * 0.06);
      if (!isBelowSpin || !xAlignedWithSpinRail || tooCloseToSpin) {
        console.log(`[GGL bet] rejected candidate near spin (bet x=${match.x},y=${match.y}; spin x=${spinMatch.x},y=${spinMatch.y})`);
        return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
      }
    }

    console.log(`[GGL bet] template FOUND (${match.templateLabel || 'unknown'}) score=${match.score.toFixed(3)} scale=${match.scale} x=${match.x} y=${match.y}`);
    const clickX = main.boundingBox.x + match.x + match.width / 2;
    const clickY = main.boundingBox.y + match.y + match.height / 2;
    gglLastBetMarker = {
      x: clickX,
      y: clickY,
      r: Math.max(18, Math.round(Math.max(match.width, match.height) * 0.55)),
    };
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(FAST(900, 450));
    const after = await main.locator.screenshot({ timeout: 60_000 });
    const clickDiff = compareScreenshots(before, after, 0.002);
    const betWindowMatch = await gglFindBetWindow(main, templates);
    gglLastBetWindowMatch = betWindowMatch;
    const popupFound = Boolean(betWindowMatch);
    if (!popupFound) {
      console.log('[GGL bet] betwindow template NOT found after icon click');
    }
    return {
      ok: popupFound,
      templateFound: true,
      clicked: true,
      visualChange: clickDiff.changed || popupFound,
      diffRatio: clickDiff.diffRatio,
    };
  } catch {
    console.log('[GGL bet] template match failed with runtime error');
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }
}

async function gglBetPopupClose(page: any, gamePage: any, templates: GameTemplateSet): Promise<boolean> {
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return false;
  let popup = gglLastBetWindowMatch;
  if (!popup) popup = await gglFindBetWindow(main, templates);
  if (!popup) return false;

  const box = main.boundingBox;
  const closeX = box.x + popup.x + popup.width * 0.95;
  const closeY = box.y + popup.y + popup.height * 0.08;
  gglLastBetMarker = { x: closeX, y: closeY, r: 22 };
  const before = await main.locator.screenshot({ timeout: 60_000 });
  await page.mouse.click(closeX, closeY);
  await page.waitForTimeout(FAST(700, 350));
  const after = await main.locator.screenshot({ timeout: 60_000 });
  const closeDiff = compareScreenshots(before, after, 0.002);
  const popupAfter = await gglFindBetWindow(main, templates);
  const closed = closeDiff.changed || !popupAfter;
  if (closed) gglLastBetWindowMatch = null;
  return closed;
}

async function gglSelectTier(page: any, gamePage: any, tier: 'min' | 'max' | 'median', templates: GameTemplateSet): Promise<ClickValidation> {
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return { ok: false, templateFound: true, clicked: false, visualChange: false, diffRatio: 0 };
  const before = await main.locator.screenshot({ timeout: 60_000 });
  let popup = gglLastBetWindowMatch;
  if (!popup) popup = await gglFindBetWindow(main, templates);
  if (!popup) return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };

  const box = main.boundingBox;
  const rowY = box.y + popup.y + popup.height * 0.22;
  // Use positions relative to matched bet-window template, not canvas hardcoded points.
  const relX = tier === 'max' ? 0.22 : tier === 'median' ? 0.40 : 0.78;
  const x = box.x + popup.x + popup.width * relX;
  gglLastBetMarker = { x, y: rowY, r: 22 };
  await page.mouse.click(x, rowY);
  const clicked = true;

  await page.waitForTimeout(FAST(600, 300));
  const after = await main.locator.screenshot({ timeout: 60_000 });
  const tierDiff = compareScreenshots(before, after, 0.002);
  return {
    ok: clicked && tierDiff.changed,
    templateFound: true,
    clicked,
    visualChange: tierDiff.changed,
    diffRatio: tierDiff.diffRatio,
  };
}

async function gglSpinWithValidation(page: any, gamePage: any, templates: GameTemplateSet): Promise<ClickValidation> {
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return { ok: false, templateFound: true, clicked: false, visualChange: false, diffRatio: 0 };
  gglLastSpinMarker = null;

  if (templates.spinTemplates.length === 0) {
    console.log(`[GGL spin] template missing for ${templates.gameId}: spin template not found in ${templates.gameDir}`);
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  const before = await main.locator.screenshot({ timeout: 60_000 });
  const w = main.boundingBox.width;
  const h = main.boundingBox.height;
  const region = {
    x0: Math.floor(w * 0.86),
    y0: Math.floor(h * 0.80),
    x1: Math.floor(w * 0.998),
    y1: Math.floor(h * 0.99),
  };

  let match: any | null = null;
  for (const tpl of templates.spinTemplates) {
    let candidate = findTemplateMatchMultiScale(
      before,
      tpl.data,
      SPIN_SCALES,
      { region, step: 2, maxScore: 0.22, timeBudgetMs: FAST(1800, 900) }
    );
    if (!candidate) {
      const robust = findTemplateMatchRobust(before, tpl.data, {
        scales: ROBUST_SCALES,
        maxScore: 0.22,
        relaxedMaxScore: 0.28,
        steps: [2, 1],
        timeBudgetMs: FAST(1400, 800),
        regions: [region],
      });
      if (robust) {
        const inRightRail = robust.x >= region.x0 && robust.x <= region.x1 && robust.y >= region.y0 && robust.y <= region.y1;
        if (inRightRail) {
          candidate = robust;
          console.log(`[GGL spin] robust match confidence=${robust.confidence} score=${robust.score.toFixed(3)} scale=${robust.scale} x=${robust.x} y=${robust.y}`);
        } else {
          console.log(`[GGL spin] robust candidate rejected (outside spin region): x=${robust.x}, y=${robust.y}`);
        }
      }
    }
    if (candidate && (!match || candidate.score < match.score)) {
      match = { ...candidate, templateLabel: tpl.label };
    }
  }

  if (!match) {
    console.log('[GGL spin] template NOT found on screen');
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  // Reject ambiguous matches on upper-right rail (often bet-related controls).
  if (match.y + match.height / 2 < h * 0.80) {
    console.log(`[GGL spin] rejected high-rail match at y=${match.y}; expected lower rail spin`);
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  console.log(`[GGL spin] template FOUND (${match.templateLabel || 'unknown'}) score=${match.score.toFixed(3)} scale=${match.scale} x=${match.x} y=${match.y}`);
  const clickX = main.boundingBox.x + match.x + match.width / 2;
  const clickY = main.boundingBox.y + match.y + match.height / 2;
  gglLastSpinMarker = {
    x: clickX,
    y: clickY,
    r: Math.max(18, Math.round(Math.max(match.width, match.height) * 0.55)),
  };
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(FAST(900, 450));
  const popupAfterClick = await gglFindBetWindow(main, templates);
  if (popupAfterClick) {
    console.log('[GGL spin] click opened bet popup; treating as non-spin and closing popup');
    gglLastBetWindowMatch = popupAfterClick;
    await gglBetPopupClose(page, gamePage, templates).catch(() => {});
    // Retry on the same right rail but lower than the ambiguous icon.
    const retryYOffset = Math.max(match.height * 1.2, h * 0.08);
    const retryYCanvas = Math.min(h * 0.95, match.y + match.height / 2 + retryYOffset);
    const retryX = main.boundingBox.x + match.x + match.width / 2;
    const retryY = main.boundingBox.y + retryYCanvas;
    gglLastSpinMarker = { x: retryX, y: retryY, r: 24 };
    console.log(`[GGL spin] retrying lower-rail click at x=${Math.round(retryX)}, y=${Math.round(retryY)}`);
    await page.mouse.click(retryX, retryY);
    await page.waitForTimeout(FAST(1200, 700));
    const popupAfterRetry = await gglFindBetWindow(main, templates);
    if (popupAfterRetry) {
      gglLastBetWindowMatch = popupAfterRetry;
      await gglBetPopupClose(page, gamePage, templates).catch(() => {});
      return { ok: false, templateFound: true, clicked: true, visualChange: false, diffRatio: 0 };
    }
  }
  await page.waitForTimeout(FAST(900, 450));
  const after = await main.locator.screenshot({ timeout: 60_000 });
  const reelRegion = {
    x0: Math.floor(w * 0.08),
    y0: Math.floor(h * 0.18),
    x1: Math.floor(w * 0.78),
    y1: Math.floor(h * 0.90),
  };
  const spinDiff = compareScreenshotsInRegion(before, after, reelRegion, 0.01);

  return {
    ok: spinDiff.changed,
    templateFound: true,
    clicked: true,
    visualChange: spinDiff.changed,
    diffRatio: spinDiff.diffRatio,
  };
}

async function gglAutoSpinWithValidation(page: any, gamePage: any, templates: GameTemplateSet): Promise<ClickValidation> {
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  gglLastAutoSpinMarker = null;

  if (templates.autoSpinTemplates.length === 0) {
    console.log(`[GGL auto-spin] template missing for ${templates.gameId}: auto-spin template not found in ${templates.gameDir}`);
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  const before = await main.locator.screenshot({ timeout: 60_000 });
  const w = main.boundingBox.width;
  const h = main.boundingBox.height;
  const autoSpinRegion = {
    x0: Math.floor(w * 0.70),
    y0: Math.floor(h * 0.76),
    x1: Math.floor(w * 0.93),
    y1: Math.floor(h * 0.995),
  };

  let match: any | null = null;
  for (const tpl of templates.autoSpinTemplates) {
    let candidate = findTemplateMatchMultiScale(
      before,
      tpl.data,
      [0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.4],
      { region: autoSpinRegion, step: 2, maxScore: 0.26, timeBudgetMs: FAST(1800, 900) }
    );
    if (!candidate) {
      const robust = findTemplateMatchRobust(before, tpl.data, {
        scales: ROBUST_SCALES,
        maxScore: 0.26,
        relaxedMaxScore: 0.34,
        steps: [2, 1],
        timeBudgetMs: FAST(1400, 800),
        regions: [autoSpinRegion],
      });
      if (robust) candidate = robust;
    }
    if (candidate && (!match || candidate.score < match.score)) {
      match = { ...candidate, templateLabel: tpl.label };
    }
  }

  if (!match) {
    console.log('[GGL auto-spin] template NOT found on screen');
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  const clickX = main.boundingBox.x + match.x + match.width / 2;
  const clickY = main.boundingBox.y + match.y + match.height / 2;
  gglLastAutoSpinMarker = {
    x: clickX,
    y: clickY,
    r: Math.max(18, Math.round(Math.max(match.width, match.height) * 0.55)),
  };

  console.log(`[GGL auto-spin] template FOUND (${match.templateLabel || 'unknown'}) score=${match.score.toFixed(3)} scale=${match.scale} x=${match.x} y=${match.y}`);
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(FAST(1000, 500));

  const after = await main.locator.screenshot({ timeout: 60_000 });
  const rightRailRegion = {
    x0: Math.floor(w * 0.65),
    y0: Math.floor(h * 0.70),
    x1: Math.floor(w * 0.998),
    y1: Math.floor(h * 0.995),
  };
  const autoSpinDiff = compareScreenshotsInRegion(before, after, rightRailRegion, 0.003);

  let activeMatchFound = false;
  if (templates.autoSpinActiveTemplates.length > 0) {
    for (const tpl of templates.autoSpinActiveTemplates) {
      let activeMatch = findTemplateMatchMultiScale(
        after,
        tpl.data,
        [0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.4],
        { region: rightRailRegion, step: 2, maxScore: 0.30, timeBudgetMs: FAST(1800, 900) }
      );
      if (!activeMatch) {
        activeMatch = findTemplateMatchRobust(after, tpl.data, {
          scales: ROBUST_SCALES,
          maxScore: 0.30,
          relaxedMaxScore: 0.36,
          steps: [2, 1],
          timeBudgetMs: FAST(1400, 800),
          regions: [rightRailRegion],
        });
      }
      if (activeMatch) {
        activeMatchFound = true;
        break;
      }
    }
  }

  // Toggle auto-spin back off if it was likely turned on.
  if (activeMatchFound || autoSpinDiff.changed) {
    await page.mouse.click(clickX, clickY).catch(() => {});
    await page.waitForTimeout(FAST(700, 350));
  }

  return {
    ok: autoSpinDiff.changed || activeMatchFound,
    templateFound: true,
    clicked: true,
    visualChange: autoSpinDiff.changed || activeMatchFound,
    diffRatio: autoSpinDiff.diffRatio,
  };
}

async function gglOpenPaytableViaHamburger(page: any, gamePage: any, templates: GameTemplateSet): Promise<ClickValidation> {
  const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
  if (!main) return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  if (templates.hamburgerTemplates.length === 0 || templates.paytableTemplates.length === 0) {
    console.log(`[GGL paytable] missing hamburger/paytable templates for ${templates.gameId} in ${templates.gameDir}`);
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  const before = await main.locator.screenshot({ timeout: 60_000 });
  const w = main.boundingBox.width;
  const h = main.boundingBox.height;
  const topLeftRegion = {
    x0: 0,
    y0: 0,
    x1: Math.floor(w * 0.35),
    y1: Math.floor(h * 0.35),
  };

  let hamburgerMatch: any | null = null;
  for (const tpl of templates.hamburgerTemplates) {
    const m = findTemplateMatchMultiScale(
      before,
      tpl.data,
      [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
      { region: topLeftRegion, step: 2, maxScore: 0.26, timeBudgetMs: FAST(1200, 700) }
    );
    if (m && (!hamburgerMatch || m.score < hamburgerMatch.score)) hamburgerMatch = { ...m, templateLabel: tpl.label };
  }
  if (!hamburgerMatch) {
    return { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
  }

  const hamburgerX = main.boundingBox.x + hamburgerMatch.x + hamburgerMatch.width / 2;
  const hamburgerY = main.boundingBox.y + hamburgerMatch.y + hamburgerMatch.height / 2;
  gglLastBetMarker = { x: hamburgerX, y: hamburgerY, r: Math.max(18, Math.round(Math.max(hamburgerMatch.width, hamburgerMatch.height) * 0.55)) };
  await page.mouse.click(hamburgerX, hamburgerY);
  await page.waitForTimeout(FAST(700, 350));

  const afterHamburger = await main.locator.screenshot({ timeout: 60_000 });
  let paytableMatch: any | null = null;
  for (const tpl of templates.paytableTemplates) {
    let m = findTemplateMatchMultiScale(
      afterHamburger,
      tpl.data,
      [0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3],
      { region: topLeftRegion, step: 2, maxScore: 0.30, timeBudgetMs: FAST(1600, 900) }
    );
    if (!m) {
      const robust = findTemplateMatchRobust(afterHamburger, tpl.data, {
        regions: [topLeftRegion],
        scales: [0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3],
        steps: [2, 1],
        maxScore: 0.28,
        relaxedMaxScore: 0.34,
        timeBudgetMs: FAST(1200, 700),
      });
      if (robust) m = robust;
    }
    if (m && (!paytableMatch || m.score < paytableMatch.score)) paytableMatch = { ...m, templateLabel: tpl.label };
  }
  if (!paytableMatch) {
    return { ok: false, templateFound: true, clicked: true, visualChange: false, diffRatio: 0 };
  }

  const paytableX = main.boundingBox.x + paytableMatch.x + paytableMatch.width / 2;
  const paytableY = main.boundingBox.y + paytableMatch.y + paytableMatch.height / 2;
  gglLastBetMarker = { x: paytableX, y: paytableY, r: Math.max(18, Math.round(Math.max(paytableMatch.width, paytableMatch.height) * 0.55)) };
  await page.mouse.click(paytableX, paytableY);
  await page.waitForTimeout(FAST(1200, 700));
  const afterPaytable = await main.locator.screenshot({ timeout: 60_000 });
  const paytableDiff = compareScreenshots(afterHamburger, afterPaytable, 0.002);
  return {
    ok: paytableDiff.changed,
    templateFound: true,
    clicked: true,
    visualChange: paytableDiff.changed,
    diffRatio: paytableDiff.diffRatio,
  };
}
// â”€â”€ Test Suite â”€â”€

test.describe('Game Pipeline Validation', () => {

  // Login before each test (skipped for external games)
  test.beforeEach(async ({ page, loginPage }, testInfo) => {
    const titleMatch = testInfo.title.match(/^Pipeline:\s*(.+?)\s*\(/);
    const currentGame = titleMatch
      ? TEST_GAMES.find(g => g.name === titleMatch[1].trim())
      : undefined;

    if (currentGame?.external) {
      console.log(`[beforeEach] External game (${currentGame.name}) - skipping Betway login`);
      return;
    }

    const username = currentGame?.username || process.env.BETWAY_USERNAME || '222212222';
    const password = currentGame?.password || process.env.BETWAY_PASSWORD || '1234567890';
    console.log(`[beforeEach] Logging in with ${currentGame?.username ? 'per-game' : 'default'} credentials`);
    let loginHomeUrl: string | null = null;
    const rawDirectUrl = (currentGame?.directUrl || '').trim();
    if (/^https?:\/\//i.test(rawDirectUrl)) {
      try {
        const parsed = new URL(rawDirectUrl);
        if (parsed.hostname.toLowerCase().includes('betway')) {
          loginHomeUrl = parsed.origin + '/';
        }
      } catch {
        loginHomeUrl = null;
      }
    }
    if (loginHomeUrl) {
      await page.goto(loginHomeUrl);
    } else {
      await loginPage.gotoHome();
    }
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(FAST(2000, 1000));
    await loginPage.login(username, password);
    await page.waitForTimeout(3000);
  });

  for (const game of TEST_GAMES) {
    const category = resolveGameCategory(game);
    const isExternal = game.external === true;

    test(`Pipeline: ${game.name} (${game.category})`, async ({ page, lobbyPage, gamePage }, testInfo) => {
      // Increase timeout for full pipeline (games load slowly, especially with parallel workers)
      const pipelineTimeoutMs = Number(process.env.PIPELINE_TEST_TIMEOUT_MS || 600_000);
      test.setTimeout(Number.isFinite(pipelineTimeoutMs) ? pipelineTimeoutMs : 600_000);
      const gameTemplates = loadGameTemplates(game.id);
      console.log(`[templates] game=${game.id} dir=${gameTemplates.gameDir} bet=${gameTemplates.betTemplates.length} spin=${gameTemplates.spinTemplates.length} autoSpin=${gameTemplates.autoSpinTemplates.length}/${gameTemplates.autoSpinActiveTemplates.length} hamburger=${gameTemplates.hamburgerTemplates.length} paytable=${gameTemplates.paytableTemplates.length}`);

      const results: StepResult[] = [];

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 1: Lobby Navigation
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let lobbyScreenshot: Buffer;
      if (isExternal) {
        // External game: navigate directly to game URL (no lobby)
        console.log(`\n[Step 1] External game â€” navigating directly to ${game.directUrl}...`);
        await page.goto(game.directUrl!);
        await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(FAST(5000, 2500));

        lobbyScreenshot = await page.screenshot();
        saveScreenshot(lobbyScreenshot, game.id, '01-lobby');
        await testInfo.attach('Step 1: Direct Navigation', { body: lobbyScreenshot, contentType: 'image/png' });

        results.push({
          step: 'Lobby Navigation',
          passed: true,
          details: `External game â€” direct URL: ${game.directUrl}`,
        });
        console.log(`  [Step 1] PASS - External direct navigation`);
      } else {
        console.log(`\n[Step 1] Navigating to ${category} lobby...`);
        const lobbyAction = getLobbyAction(category);
        await (lobbyPage as any)[lobbyAction]();
        await page.waitForLoadState('domcontentloaded');

        lobbyScreenshot = await page.screenshot();
        saveScreenshot(lobbyScreenshot, game.id, '01-lobby');
        await testInfo.attach('Step 1: Lobby', { body: lobbyScreenshot, contentType: 'image/png' });

        const lobbyUrl = page.url();
        const lobbyPassed = lobbyUrl.includes('lobby') || lobbyUrl.includes('Livegames') || lobbyUrl.includes('livegames');
        results.push({
          step: 'Lobby Navigation',
          passed: lobbyPassed,
          details: `URL: ${lobbyUrl}`,
        });
        console.log(`  [Step 1] ${lobbyPassed ? 'PASS' : 'FAIL'} - ${lobbyUrl}`);
      }

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 2: Play Button Click / Game Launch
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (isExternal) {
        // External game: already navigated in Step 1, auto-pass Step 2
        console.log(`[Step 2] External game â€” already loaded via direct URL`);
        const afterPlayScreenshot = await page.screenshot();
        saveScreenshot(afterPlayScreenshot, game.id, '02-after-play');
        await testInfo.attach('Step 2: Game Loaded', { body: afterPlayScreenshot, contentType: 'image/png' });

        results.push({
          step: 'Play Button Clicked',
          passed: true,
          details: `External game â€” direct URL used`,
        });
        console.log(`  [Step 2] PASS - External game loaded directly`);
      } else {
        console.log(`[Step 2] Opening ${game.name}...`);
        const urlBeforeOpen = page.url();
        if (game.directUrl) {
          // Prefer direct URL for reliable navigation (avoids lobby search picking wrong game)
          console.log(`  [Step 2] Using direct URL: ${game.directUrl}`);
          await page.goto(game.directUrl);
        } else {
          try {
            await lobbyPage.openGame(game.name, 'play');
          } catch (e: any) {
            console.log(`  [Step 2] Search failed: ${e.message}`);
          }
        }
        await page.waitForTimeout(3000);

        const afterPlayScreenshot = await page.screenshot();
        saveScreenshot(afterPlayScreenshot, game.id, '02-after-play');
        await testInfo.attach('Step 2: After Play Click', { body: afterPlayScreenshot, contentType: 'image/png' });

        const urlAfterOpen = page.url();
        const urlChanged = urlAfterOpen !== urlBeforeOpen;
        // Some games (e.g. Aviator) load in-page via iframe without URL change
        const lobbyScreenDiff = compareScreenshots(lobbyScreenshot, afterPlayScreenshot);
        const playPassed = urlChanged || lobbyScreenDiff.changed;
        results.push({
          step: 'Play Button Clicked',
          passed: playPassed,
          details: urlChanged
            ? `URL changed: ${urlBeforeOpen} -> ${urlAfterOpen}`
            : `In-page load (${(lobbyScreenDiff.diffRatio * 100).toFixed(1)}% screen diff)`,
        });
        console.log(`  [Step 2] ${playPassed ? 'PASS' : 'FAIL'} - URL changed: ${urlChanged}, screen diff: ${(lobbyScreenDiff.diffRatio * 100).toFixed(1)}%`);
      }

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 3: Game Element Loaded
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      console.log(`[Step 3] Waiting for game to load...`);
      await gamePage.waitForGameLoad(60000);

      const gameLoadedScreenshot = await page.screenshot({ timeout: 30000 }).catch(async () => {
        console.log('  [Step 3] Screenshot timed out, retrying...');
      await page.waitForTimeout(FAST(5000, 2500));
        return await page.screenshot({ timeout: 30000 }).catch(() => Buffer.alloc(0));
      });
      if (gameLoadedScreenshot.length > 0) {
        saveScreenshot(gameLoadedScreenshot, game.id, '03-game-loaded');
        await testInfo.attach('Step 3: Game Loaded', { body: gameLoadedScreenshot, contentType: 'image/png' });
      }

      const gameType = await gamePage.getGameType();
      const gameLoadPassed = gameType === 'canvas' || gameType === 'iframe';
      results.push({
        step: 'Game Element Loaded',
        passed: gameLoadPassed,
        details: `Game type: ${gameType}`,
      });
      console.log(`  [Step 3] ${gameLoadPassed ? 'PASS' : 'FAIL'} - Type: ${gameType}`);

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 4: Continue/Accept Button
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      console.log(`[Step 4] Handling Continue/Accept buttons...`);
      const gameUrlBeforeDismiss = page.url();
      const beforeContinue = await page.screenshot();
      saveScreenshot(beforeContinue, game.id, '04a-before-continue');
      await testInfo.attach('Step 4a: Before Continue', { body: beforeContinue, contentType: 'image/png' });

      // Attempt 1: GamePage clickContinueButtonIfPresent
      await gamePage.clickContinueButtonIfPresent();
      await page.waitForTimeout(FAST(2000, 1000));

      let afterContinue = await page.screenshot();
      let continueScreenDiff = compareScreenshots(beforeContinue, afterContinue);

      // Attempt 2: Scroll down (button may be below fold) and retry
      if (!continueScreenDiff.changed) {
        console.log(`  [Step 4] Screen unchanged after first attempt â€” scrolling and retrying...`);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(FAST(1000, 500));
        await gamePage.clickContinueButtonIfPresent();
        await page.waitForTimeout(3000);
        afterContinue = await page.screenshot();
        continueScreenDiff = compareScreenshots(beforeContinue, afterContinue);
      }

      // Attempt 3: Scroll down and directly target "I Accept"/"I ACCEPT" buttons
      // The accept button is often below the fold (e.g. Hot Hot Betway "Symbol Prediction" page)
      // (Avoid dismissGameIntroScreens â€” its broad selectors like a:has-text("Play") can navigate away)
      if (!continueScreenDiff.changed) {
        console.log(`  [Step 4] Still unchanged â€” scrolling down and trying direct I Accept click...`);

        // Scroll down to reveal buttons below the fold
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(FAST(1000, 500));

        // Some games require checking "Do not show again" before Continue/Accept is enabled.
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
        for (const sel of dontShowSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
              await el.scrollIntoViewIfNeeded().catch(() => {});
              await el.click({ force: true }).catch(() => {});
              console.log(`  [Step 4] Clicked do-not-show-again control: ${sel}`);
              await page.waitForTimeout(700);
              break;
            }
          } catch { /* continue */ }
        }

        const acceptSelectors = [
          'button:has-text("I ACCEPT")',
          'button:has-text("I Accept")',
          'button:has-text("ACCEPT")',
          'button:has-text("Accept")',
          'button:has-text("I Agree")',
          'button:has-text("I AGREE")',
          'button:has-text("Got it")',
          'button:has-text("GOT IT")',
          'a:has-text("I ACCEPT")',
          'a:has-text("I Accept")',
          'div:has-text("I ACCEPT") >> visible=true',
          'span:has-text("I ACCEPT") >> visible=true',
          '[class*="accept"]',
          '[class*="agree"]',
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
        let acceptClicked = false;
        for (const sel of acceptSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(`  [Step 4] Found accept button: ${sel}`);
              // Scroll the button into view first
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await page.waitForTimeout(500);
              await btn.click();
              await page.waitForTimeout(FAST(2000, 1000));
              acceptClicked = true;
              break;
            }
          } catch { /* selector not found, try next */ }
        }

        // If no selector matched, try canvas/iframe click zones for right-arrow intro controls.
        if (!acceptClicked) {
          console.log(`  [Step 4] No accept button found by selector â€” trying arrow click zones...`);
          const mainElement = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
          if (mainElement) {
            const box = mainElement.boundingBox;
            const clickZones = [
              { x: box.x + box.width * 0.88, y: box.y + box.height * 0.52, name: 'right-arrow-zone' },
              { x: box.x + box.width * 0.94, y: box.y + box.height * 0.52, name: 'right-edge-arrow-zone' },
              { x: box.x + box.width * 0.5, y: box.y + box.height * 0.85, name: 'bottom-center' },
            ];
            for (const z of clickZones) {
              await page.mouse.click(z.x, z.y);
              console.log(`  [Step 4] Clicked ${z.name} at (${Math.round(z.x)}, ${Math.round(z.y)})`);
              await page.waitForTimeout(FAST(1000, 500));
            }
          } else {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(500);
            const viewport = page.viewportSize() || { width: 1366, height: 768 };
            await page.mouse.click(viewport.width / 2, viewport.height - 50);
        await page.waitForTimeout(FAST(2000, 1000));
          }
        }

        afterContinue = await page.screenshot();
        continueScreenDiff = compareScreenshots(beforeContinue, afterContinue);
      }

      // Safety check: if URL changed (accidental navigation), go back to the game
      const gameUrlAfterDismiss = page.url();
      if (gameUrlAfterDismiss !== gameUrlBeforeDismiss) {
        console.log(`  [Step 4] WARNING: URL changed during dismiss! Navigating back to game...`);
        console.log(`  [Step 4]   Before: ${gameUrlBeforeDismiss}`);
        console.log(`  [Step 4]   After:  ${gameUrlAfterDismiss}`);
        await page.goto(gameUrlBeforeDismiss);
            await page.waitForTimeout(FAST(5000, 2500));
        await gamePage.waitForGameLoad(30000).catch(() => {});
        afterContinue = await page.screenshot();
        continueScreenDiff = compareScreenshots(beforeContinue, afterContinue);
      }

      saveScreenshot(afterContinue, game.id, '04b-after-continue');
      await testInfo.attach('Step 4b: After Continue', { body: afterContinue, contentType: 'image/png' });

      const playableResult = await isGamePlayable(page);
      const continueDismissed = continueScreenDiff.changed;

      // Check if overlay text is still visible on page (indicates overlay NOT dismissed)
      let overlayStillVisible = false;
      try {
        const bodyText = await page.locator('body').textContent({ timeout: 3000 }) || '';
        const overlayKeywords = /\b(I Accept|I ACCEPT|Accept All|ACCEPT ALL|Do not show again|DON'T SHOW AGAIN|DON’T SHOW AGAIN)\b/i;
        overlayStillVisible = overlayKeywords.test(bodyText);
        if (overlayStillVisible) {
          console.log(`  [Step 4] WARNING: Overlay text still detected on page after all attempts`);
        }
      } catch { /* timeout reading body text is fine */ }

      // overlayCleared: true if overlay was dismissed AND no overlay text remains
      const overlayCleared = (continueDismissed && !overlayStillVisible) || (playableResult.playable && !overlayStillVisible);

      results.push({
        step: 'Continue/Accept Handled',
        passed: overlayCleared || (gameType === 'canvas' && !overlayStillVisible),
        diffRatio: continueScreenDiff.diffRatio,
        details: `Dismissed: ${continueDismissed} (${(continueScreenDiff.diffRatio * 100).toFixed(1)}% diff), Playable: ${playableResult.playable} (${playableResult.reason})${overlayStillVisible ? ' [OVERLAY STILL VISIBLE]' : ''}`,
      });
      console.log(`  [Step 4] ${overlayCleared ? 'PASS' : 'WARN'} - dismissed: ${continueDismissed}, overlayCleared: ${overlayCleared}, overlayStillVisible: ${overlayStillVisible}`);

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 5: Credits/Balance Visible
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      console.log(`[Step 5] Checking credits/balance visibility...`);
      const creditsResult = await verifyCreditsWithRetry(page, FAST_MODE ? 2 : 3);

      const creditsScreenshot = await page.screenshot();
      saveScreenshot(creditsScreenshot, game.id, '05-credits');
      await testInfo.attach('Step 5: Credits State', { body: creditsScreenshot, contentType: 'image/png' });
      const creditsText = creditsResult.visible ? creditsResult.text : 'not-detected';

      // Canvas-based games may not expose text credits â€” a visible canvas is acceptable
      const creditsPassed = creditsResult.visible || gameType === 'canvas';
      results.push({
        step: 'Credits Visible',
        passed: creditsPassed,
        details: creditsResult.visible
          ? `Credits: ${creditsText} (${creditsResult.attemptDetails})`
          : `Credits not found as text (gameType: ${gameType}) â€” ${creditsResult.attemptDetails}`,
      });
      console.log(`  [Step 5] ${creditsPassed ? 'PASS' : 'FAIL'} - creditsText=${creditsText}`);

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 6: Spin
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      console.log(`[Step 6] Performing ${category} spin...`);
      const beforeGameplay = await page.screenshot();
      saveScreenshot(beforeGameplay, game.id, '06a-before-gameplay');
      await testInfo.attach('Step 6a: Before Spin', { body: beforeGameplay, contentType: 'image/png' });

      const isGglGameplay = await isLikelyGglGameNow(page, game.directUrl);
      let gameplayActions: string[] = [];
      let gglSpinValidation: ClickValidation = { ok: false, templateFound: false, clicked: false, visualChange: false, diffRatio: 0 };
      try {
        if (isGglGameplay && category === 'slots') {
          // Strict mode for this provider: only template-based spin click using reports/screenshots/spin.png
          gglSpinValidation = await gglSpinWithValidation(page, gamePage, gameTemplates);
          gameplayActions = [
            'template-spin-click',
            `template-found:${gglSpinValidation.templateFound}`,
            `spin-clicked:${gglSpinValidation.clicked}`,
            `spin-visual-change:${gglSpinValidation.visualChange}`,
          ];
          console.log(`  [Step 6] Template spin validation: found=${gglSpinValidation.templateFound}, clicked=${gglSpinValidation.clicked}, changed=${gglSpinValidation.visualChange}, diff=${(gglSpinValidation.diffRatio * 100).toFixed(2)}%`);
        } else {
          const gameplayPromise = performGameplay(page, gamePage, category, {
            postActionWaitMs: FAST(5000, 2000),
            betIncreaseTimes: 0,
            subType: game.subType,
            gameLoadTimeout: 30000,
          });
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), FAST(45000, 20000)));
          const gameplayResult = await Promise.race([gameplayPromise, timeoutPromise]);

          if (gameplayResult) {
            gameplayActions = gameplayResult.actionsPerformed;
            console.log(`  [Step 6] Actions: ${gameplayResult.actionsPerformed.join(', ')}`);
          } else {
            console.log(`  [Step 6] Gameplay timed out (45s safety) â€” capturing state as-is`);
          }
        }
      } catch (err: any) {
        console.log(`  [Step 6] Gameplay error (may be canvas-based): ${err.message}`);
      }

      await page.waitForTimeout(FAST(2000, 1000)).catch(() => {});
      let afterGameplay = await page.screenshot();
      let gameplayDiff = compareScreenshots(beforeGameplay, afterGameplay);

      if (!gameplayDiff.changed && !isGglGameplay) {
        console.log(`  [Step 6] No screen change â€” retrying with extra clicks and wait...`);
        const retryElement = await gamePage.canvasHelper.getMainGameElement();
        if (retryElement) {
          const box = retryElement.boundingBox;
          await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.92);
          await page.waitForTimeout(FAST(1000, 500));
          await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
          await page.waitForTimeout(FAST(1000, 500));
          await page.keyboard.press('Space');
          await page.waitForTimeout(FAST(5000, 2500));
        }
        afterGameplay = await page.screenshot();
        gameplayDiff = compareScreenshots(beforeGameplay, afterGameplay);
      }

      const afterGameplayMarked = withMarker(afterGameplay, gglLastSpinMarker);
      saveScreenshot(afterGameplayMarked, game.id, '06b-after-gameplay');
      await testInfo.attach('Step 6b: After Spin', { body: afterGameplayMarked, contentType: 'image/png' });

      const spinActionLogged = gameplayActions.some((a) => a.toLowerCase().includes('spin'));
      const gameplayPassed = isGglGameplay
        ? (creditsPassed && gglSpinValidation.ok && spinActionLogged)
        : gameplayDiff.changed;
      results.push({
        step: 'Step 6: Spin',
        passed: gameplayPassed,
        diffRatio: gameplayDiff.diffRatio,
        details: `Actions: ${gameplayActions.join(', ') || 'none'}, Spin logged: ${spinActionLogged}, Spin clicked: ${gglSpinValidation.clicked}, Spin visual change: ${gglSpinValidation.visualChange} (${(gglSpinValidation.diffRatio * 100).toFixed(2)}% diff), Screen changed: ${gameplayDiff.changed} (${(gameplayDiff.diffRatio * 100).toFixed(2)}% diff)${!overlayCleared && !gameplayDiff.changed ? ' [overlay may be blocking]' : ''}`,
      });
      console.log(`  [Step 6] ${gameplayPassed ? 'PASS' : 'WARN'} - ${(gameplayDiff.diffRatio * 100).toFixed(2)}% diff`);

      // STEP 7: Min Bet
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (category !== 'live-casino' && category !== 'crash-games') {
        console.log(`[Step 7] Setting minimum bet...`);
        const beforeMinBet = await page.screenshot();
        saveScreenshot(beforeMinBet, game.id, '07a-before-minbet');
        await testInfo.attach('Step 7a: Before Min Bet', { body: beforeMinBet, contentType: 'image/png' });

        let minBetActionPerformed = false;
        let minTemplateFound = false;
        let minOpenValidated = false;
        let minSelectValidated = false;
        try {
          const isGgl = await isLikelyGglGameNow(page, game.directUrl);
          if (isGgl) {
            const opened = await gglBetPopupOpen(page, gamePage, gameTemplates);
            const popupShot = withMarker(await page.screenshot(), gglLastBetMarker);
            saveScreenshot(popupShot, game.id, '07aa-betpopup-open');
            await testInfo.attach('Step 7aa: Bet Popup Open', { body: popupShot, contentType: 'image/png' });
            minTemplateFound = opened.templateFound;
            minOpenValidated = opened.ok;

            const selected = await gglSelectTier(page, gamePage, 'min', gameTemplates);
            const selectedShot = withMarker(await page.screenshot(), gglLastBetMarker);
            saveScreenshot(selectedShot, game.id, '07ab-min-selected');
            await testInfo.attach('Step 7ab: Min Selected', { body: selectedShot, contentType: 'image/png' });
            minSelectValidated = selected.ok;

            const closed = await gglBetPopupClose(page, gamePage, gameTemplates);
            minBetActionPerformed = opened.ok && selected.ok && closed;
          } else {
            minBetActionPerformed = await gamePage.decreaseBet(20); // 20 clicks to ensure we reach minimum
          }
          await page.waitForTimeout(FAST(1500, 700));
        } catch {
          console.log('  [Step 7] decreaseBet threw (canvas-based controls) â€” continuing');
        }

        const afterMinBet = withMarker(await page.screenshot(), gglLastBetMarker);
        saveScreenshot(afterMinBet, game.id, '07b-after-minbet');
        await testInfo.attach('Step 7b: After Min Bet', { body: afterMinBet, contentType: 'image/png' });
        const minBetText = await readBetText(page, gamePage);

        const minBetDiff = compareScreenshots(beforeMinBet, afterMinBet);
        const minBetPassed = minBetActionPerformed && minBetDiff.changed;
        results.push({
          step: 'Min Bet',
          passed: minBetPassed,
          diffRatio: minBetDiff.diffRatio,
          details: `Min bet text: ${minBetText}, Action performed: ${minBetActionPerformed}, Template found: ${minTemplateFound}, Popup validated: ${minOpenValidated}, Tier validated: ${minSelectValidated}, Screen changed: ${minBetDiff.changed} (${(minBetDiff.diffRatio * 100).toFixed(2)}% diff)${!overlayCleared && !minBetDiff.changed ? ' [overlay may be blocking]' : ''}`,
        });
        console.log(`  [Step 7] ${minBetPassed ? 'PASS' : 'WARN'} - minBetText=${minBetText}, diff=${(minBetDiff.diffRatio * 100).toFixed(2)}%`);
      } else {
        results.push({
          step: 'Min Bet',
          passed: true,
          details: `Skipped for ${category} â€” bet controls not applicable`,
        });
        console.log(`  [Step 7] SKIP - Bet controls not applicable for ${category}`);
      }

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 8: Max Bet
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (category !== 'live-casino' && category !== 'crash-games') {
        console.log(`[Step 8] Setting maximum bet...`);
        const beforeMaxBet = await page.screenshot();
        saveScreenshot(beforeMaxBet, game.id, '08a-before-maxbet');
        await testInfo.attach('Step 8a: Before Max Bet', { body: beforeMaxBet, contentType: 'image/png' });

        let maxBetActionPerformed = false;
        let maxBetPopupDiffRatio = 0;
        let maxBetSelectDiffRatio = 0;
        let isGglMaxBet = false;
        let maxTemplateFound = false;
        let maxOpenValidated = false;
        let maxSelectValidated = false;
        try {
          isGglMaxBet = await isLikelyGglGameNow(page, game.directUrl);
          if (isGglMaxBet) {
            const opened = await gglBetPopupOpen(page, gamePage, gameTemplates);
            const popupShot = withMarker(await page.screenshot(), gglLastBetMarker);
            saveScreenshot(popupShot, game.id, '08aa-betpopup-open');
            await testInfo.attach('Step 8aa: Bet Popup Open', { body: popupShot, contentType: 'image/png' });
            maxBetPopupDiffRatio = compareScreenshots(beforeMaxBet, popupShot).diffRatio;
            maxTemplateFound = opened.templateFound;
            maxOpenValidated = opened.ok;

            const selected = await gglSelectTier(page, gamePage, 'max', gameTemplates);
            const selectedShot = withMarker(await page.screenshot(), gglLastBetMarker);
            saveScreenshot(selectedShot, game.id, '08ab-max-selected');
            await testInfo.attach('Step 8ab: Max Selected', { body: selectedShot, contentType: 'image/png' });
            maxBetSelectDiffRatio = compareScreenshots(popupShot, selectedShot).diffRatio;
            maxSelectValidated = selected.ok;

            const closed = await gglBetPopupClose(page, gamePage, gameTemplates);
            maxBetActionPerformed = opened.ok && selected.ok && closed;
          } else {
            maxBetActionPerformed = await gamePage.setMaxBet();
          }
          await page.waitForTimeout(FAST(1500, 700));
        } catch {
          console.log('  [Step 8] setMaxBet threw (canvas-based controls) â€” continuing');
        }

        const afterMaxBet = withMarker(await page.screenshot(), gglLastBetMarker);
        saveScreenshot(afterMaxBet, game.id, '08b-after-maxbet');
        await testInfo.attach('Step 8b: After Max Bet', { body: afterMaxBet, contentType: 'image/png' });
        const maxBetText = await readBetText(page, gamePage);

        const maxBetDiff = compareScreenshots(beforeMaxBet, afterMaxBet);
        const maxBetInteractedInGgl = maxBetPopupDiffRatio > 0.001 || maxBetSelectDiffRatio > 0.001;
        const maxBetPassed = maxBetActionPerformed && (maxBetDiff.changed || (isGglMaxBet && maxBetInteractedInGgl));
        results.push({
          step: 'Max Bet',
          passed: maxBetPassed,
          diffRatio: maxBetDiff.diffRatio,
          details: `Max bet text: ${maxBetText}, Action performed: ${maxBetActionPerformed}, Template found: ${maxTemplateFound}, Popup validated: ${maxOpenValidated}, Tier validated: ${maxSelectValidated}, Screen changed: ${maxBetDiff.changed} (${(maxBetDiff.diffRatio * 100).toFixed(2)}% diff), Popup diff: ${(maxBetPopupDiffRatio * 100).toFixed(2)}%, Select diff: ${(maxBetSelectDiffRatio * 100).toFixed(2)}%${!overlayCleared && !maxBetDiff.changed ? ' [overlay may be blocking]' : ''}`,
        });
        console.log(`  [Step 8] ${maxBetPassed ? 'PASS' : 'WARN'} - maxBetText=${maxBetText}, diff=${(maxBetDiff.diffRatio * 100).toFixed(2)}%`);
      } else {
        results.push({
          step: 'Max Bet',
          passed: true,
          details: `Skipped for ${category} â€” bet controls not applicable`,
        });
        console.log(`  [Step 8] SKIP - Bet controls not applicable for ${category}`);
      }

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // STEP 9: Bet Reset (decrease from max for safe gameplay)
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (category !== 'live-casino' && category !== 'crash-games') {
        console.log(`[Step 9] Resetting bet from max for safe gameplay...`);
        const beforeBetReset = await page.screenshot();
        saveScreenshot(beforeBetReset, game.id, '09a-before-betreset');
        await testInfo.attach('Step 9a: Before Bet Reset', { body: beforeBetReset, contentType: 'image/png' });

        let betResetActionPerformed = false;
        let betResetPopupDiffRatio = 0;
        let betResetSelectDiffRatio = 0;
        let isGglBetReset = false;
        let resetTemplateFound = false;
        let resetOpenValidated = false;
        let resetSelectValidated = false;
        try {
          isGglBetReset = await isLikelyGglGameNow(page, game.directUrl);
          if (isGglBetReset) {
            const opened = await gglBetPopupOpen(page, gamePage, gameTemplates);
            const popupShot = withMarker(await page.screenshot(), gglLastBetMarker);
            saveScreenshot(popupShot, game.id, '09aa-betpopup-open');
            await testInfo.attach('Step 9aa: Bet Popup Open', { body: popupShot, contentType: 'image/png' });
            betResetPopupDiffRatio = compareScreenshots(beforeBetReset, popupShot).diffRatio;
            resetTemplateFound = opened.templateFound;
            resetOpenValidated = opened.ok;

            const selected = await gglSelectTier(page, gamePage, 'median', gameTemplates);
            const selectedShot = withMarker(await page.screenshot(), gglLastBetMarker);
            saveScreenshot(selectedShot, game.id, '09ab-median-selected');
            await testInfo.attach('Step 9ab: Median Selected', { body: selectedShot, contentType: 'image/png' });
            betResetSelectDiffRatio = compareScreenshots(popupShot, selectedShot).diffRatio;
            resetSelectValidated = selected.ok;

            const closed = await gglBetPopupClose(page, gamePage, gameTemplates);
            betResetActionPerformed = opened.ok && selected.ok && closed;
          } else {
            betResetActionPerformed = await gamePage.resetBetAfterMax(12); // Decrease from max to avoid draining balance
          }
          await page.waitForTimeout(FAST(1500, 700));
        } catch {
          console.log('  [Step 9] decreaseBet threw (canvas-based controls) â€” continuing');
        }

        const afterBetReset = withMarker(await page.screenshot(), gglLastBetMarker);
        saveScreenshot(afterBetReset, game.id, '09b-after-betreset');
        await testInfo.attach('Step 9b: After Bet Reset', { body: afterBetReset, contentType: 'image/png' });

        const betResetDiff = compareScreenshots(beforeBetReset, afterBetReset);
        const betResetInteractedInGgl = betResetPopupDiffRatio > 0.001 || betResetSelectDiffRatio > 0.001;
        const betResetPassed = betResetActionPerformed && (betResetDiff.changed || (isGglBetReset && betResetInteractedInGgl));
        results.push({
          step: 'Bet Reset',
          passed: betResetPassed,
          diffRatio: betResetDiff.diffRatio,
          details: `Action performed: ${betResetActionPerformed}, Template found: ${resetTemplateFound}, Popup validated: ${resetOpenValidated}, Tier validated: ${resetSelectValidated}, Screen changed: ${betResetDiff.changed} (${(betResetDiff.diffRatio * 100).toFixed(2)}% diff), Popup diff: ${(betResetPopupDiffRatio * 100).toFixed(2)}%, Select diff: ${(betResetSelectDiffRatio * 100).toFixed(2)}%${!overlayCleared && !betResetDiff.changed ? ' [overlay may be blocking]' : ''}`,
        });
        console.log(`  [Step 9] ${betResetPassed ? 'PASS' : 'WARN'} - ${(betResetDiff.diffRatio * 100).toFixed(2)}% diff`);
      } else {
        results.push({
          step: 'Bet Reset',
          passed: true,
          details: `Skipped for ${category} â€” bet controls not applicable`,
        });
        console.log(`  [Step 9] SKIP - Bet controls not applicable for ${category}`);
      }

      // STEP 10: Paytable / Info
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (category !== 'live-casino' && category !== 'crash-games') {
        console.log(`[Step 10] Opening Paytable/Info panel...`);
        const beforePaytable = await page.screenshot();
        saveScreenshot(beforePaytable, game.id, '10a-before-paytable');
        await testInfo.attach('Step 10a: Before Paytable', { body: beforePaytable, contentType: 'image/png' });

        let infoActionPerformed = false;
        const isGglPaytable = await isLikelyGglGameNow(page, game.directUrl);
        try {
          if (isGglPaytable) {
            const gglPaytable = await gglOpenPaytableViaHamburger(page, gamePage, gameTemplates);
            infoActionPerformed = gglPaytable.ok;
            console.log(`  [Step 10] GGL paytable via hamburger: found=${gglPaytable.templateFound}, clicked=${gglPaytable.clicked}, changed=${gglPaytable.visualChange}, diff=${(gglPaytable.diffRatio * 100).toFixed(2)}%`);
          } else {
            infoActionPerformed = await gamePage.openInfo();
            await page.waitForTimeout(FAST(2000, 900));
          }
        } catch {
          console.log('  [Step 10] openInfo threw (canvas-based controls) â€” continuing');
        }

        const afterPaytable = await page.screenshot();
        saveScreenshot(afterPaytable, game.id, '10b-after-paytable');
        await testInfo.attach('Step 10b: After Paytable', { body: afterPaytable, contentType: 'image/png' });

        const paytableDiff = compareScreenshots(beforePaytable, afterPaytable);
        const paytablePassed = infoActionPerformed && (paytableDiff.changed || isGglPaytable);
        results.push({
          step: 'Step 10: Paytable/Info',
          passed: paytablePassed,
          diffRatio: paytableDiff.diffRatio,
          details: `Action performed: ${infoActionPerformed}, Screen changed: ${paytableDiff.changed} (${(paytableDiff.diffRatio * 100).toFixed(2)}% diff), GGL mode: ${isGglPaytable}${!overlayCleared && !paytableDiff.changed ? ' [overlay may be blocking]' : ''}`,
        });
        console.log(`  [Step 10] ${paytablePassed ? 'PASS' : 'WARN'} - ${(paytableDiff.diffRatio * 100).toFixed(2)}% diff`);

        // Close info panel before continuing
        try {
          if (isGglPaytable) {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(700);
          } else {
            await gamePage.closeInfo();
          }
          await page.waitForTimeout(FAST(1000, 500));
        } catch {
          console.log('  [Step 10] closeInfo threw â€” continuing');
        }
      } else {
        results.push({
          step: 'Step 10: Paytable/Info',
          passed: true,
          details: `Skipped for ${category} â€” no traditional paytable`,
        });
        console.log(`  [Step 10] SKIP - No traditional paytable for ${category}`);
      }

      // STEP 11: Auto-Spin
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (category === 'slots') {
        console.log(`[Step 11] Validating Auto-Spin via template matching...`);
        const beforeAutoSpin = await page.screenshot();
        saveScreenshot(beforeAutoSpin, game.id, '11a-before-autospin');
        await testInfo.attach('Step 11a: Before Auto-Spin', { body: beforeAutoSpin, contentType: 'image/png' });

        let autoSpinValidation: ClickValidation = {
          ok: false,
          templateFound: false,
          clicked: false,
          visualChange: false,
          diffRatio: 0,
        };

        const isGglAutoSpin = await isLikelyGglGameNow(page, game.directUrl);
        try {
          if (isGglAutoSpin) {
            autoSpinValidation = await gglAutoSpinWithValidation(page, gamePage, gameTemplates);
          } else {
            const main = await gamePage.canvasHelper.getMainGameElement().catch(() => null);
            if (main) {
              const box = main.boundingBox;
              const clickX = box.x + box.width * 0.79;
              const clickY = box.y + box.height * 0.90;
              gglLastAutoSpinMarker = { x: clickX, y: clickY, r: 22 };
              await page.mouse.click(clickX, clickY);
              await page.waitForTimeout(FAST(1000, 500));
              const afterProbe = await page.screenshot();
              const diff = compareScreenshots(beforeAutoSpin, afterProbe, 0.003);
              autoSpinValidation = {
                ok: diff.changed,
                templateFound: true,
                clicked: true,
                visualChange: diff.changed,
                diffRatio: diff.diffRatio,
              };
              // Toggle back to keep game state stable
              await page.mouse.click(clickX, clickY).catch(() => {});
              await page.waitForTimeout(FAST(700, 350));
            }
          }
        } catch (err: any) {
          console.log(`  [Step 11] Auto-Spin validation error: ${err.message}`);
        }

        const afterAutoSpin = withMarker(await page.screenshot(), gglLastAutoSpinMarker);
        saveScreenshot(afterAutoSpin, game.id, '11b-after-autospin');
        await testInfo.attach('Step 11b: After Auto-Spin', { body: afterAutoSpin, contentType: 'image/png' });

        results.push({
          step: 'Step 11: Auto-Spin',
          passed: autoSpinValidation.ok,
          diffRatio: autoSpinValidation.diffRatio,
          details: `Template found: ${autoSpinValidation.templateFound}, Clicked: ${autoSpinValidation.clicked}, Visual change: ${autoSpinValidation.visualChange}, Diff: ${(autoSpinValidation.diffRatio * 100).toFixed(2)}%`,
        });
        console.log(`  [Step 11] ${autoSpinValidation.ok ? 'PASS' : 'WARN'} - template=${autoSpinValidation.templateFound}, clicked=${autoSpinValidation.clicked}, diff=${(autoSpinValidation.diffRatio * 100).toFixed(2)}%`);
      } else {
        results.push({
          step: 'Step 11: Auto-Spin',
          passed: true,
          details: `Skipped for ${category} - auto-spin is slot specific`,
        });
        console.log(`  [Step 11] SKIP - Auto-spin not applicable for ${category}`);
      }

      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      // STEP 12: Summary
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const finalScreenshot = await page.screenshot();
      saveScreenshot(finalScreenshot, game.id, '12-final');
      await testInfo.attach('Step 12: Final State', { body: finalScreenshot, contentType: 'image/png' });

      console.log(`\n${'='.repeat(60)}`);
      console.log(`  Pipeline Results: ${game.name} (${game.category})`);
      console.log(`${'='.repeat(60)}`);
      for (const r of results) {
        const status = r.passed ? 'PASS' : 'FAIL';
        const diff = r.diffRatio !== undefined ? ` [${(r.diffRatio * 100).toFixed(1)}% diff]` : '';
        console.log(`  ${status}  ${r.step}${diff}`);
        console.log(`         ${r.details}`);
      }
      const passCount = results.filter(r => r.passed).length;
      console.log(`\n  Score: ${passCount}/${results.length} steps passed`);
      console.log(`${'='.repeat(60)}\n`);

      // Attach summary as text
      const summaryText = results.map(r =>
        `${r.passed ? 'PASS' : 'FAIL'} | ${r.step} | ${r.details}`
      ).join('\n');
      await testInfo.attach('Pipeline Summary', {
        body: Buffer.from(summaryText, 'utf-8'),
        contentType: 'text/plain',
      });

      // Critical assertions â€” game must have loaded and at least half the steps passed
      expect(gameLoadPassed, `Game element should be visible (canvas or iframe)`).toBeTruthy();
      expect(passCount).toBeGreaterThanOrEqual(Math.ceil(results.length * 0.5));
    });
  }
});





