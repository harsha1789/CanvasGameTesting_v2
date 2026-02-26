/**
 * Pipeline Test Routes — REST endpoints for game validation testing.
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { progressEmitter } from './sse-routes';

const router = Router();

// ── Types ──

interface TestGame {
  id: string;
  name: string;
  category: string;
  subType?: string;
  lobbyPath: string;
  directUrl?: string;
  external?: boolean; // True if game is on a non-Betway domain
  username?: string;
  password?: string;
}

interface CatalogGame {
  id: string;
  name: string;
  url: string;
  category: string;
  subType?: string;
  provider: string;
  gameType: string;
  username?: string;
  password?: string;
}

interface StepResult {
  stepNum: number;
  stepName: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  details: string;
}

interface GameResult {
  gameId: string;
  gameName: string;
  category: string;
  steps: StepResult[];
  score: string;
  status: 'pass' | 'fail' | 'running' | 'pending';
}

interface PipelineTestSession {
  sessionId: string;
  status: 'idle' | 'running' | 'complete' | 'aborted' | 'error';
  startTime: number;
  endTime?: number;
  totalGames: number;
  completedGames: number;
  games: GameResult[];
  error?: string;
}

// ── State persistence ──

const SESSION_FILE = path.resolve(process.cwd(), 'tmp', 'last-pipeline-session.json');

function saveSession(session: PipelineTestSession): void {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
  } catch (err) {
    console.error('[pipeline] Failed to save session:', err);
  }
}

function loadSession(): PipelineTestSession {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (data && data.sessionId) return data;
    }
  } catch (err) {
    console.error('[pipeline] Failed to load session:', err);
  }
  return {
    sessionId: '',
    status: 'idle',
    startTime: 0,
    totalGames: 0,
    completedGames: 0,
    games: [],
  };
}

// ── State ──

let currentTestSession: PipelineTestSession = loadSession();

let childProcess: ChildProcess | null = null;
let currentGameId: string | null = null;

const TMP_DIR = path.resolve(process.cwd(), 'tmp');
const GAME_TEMPLATE_ROOT = path.resolve(TMP_DIR, 'game-templates');
const REQUIRED_GAME_TEMPLATES = [
  'Bet-icon-before-click.png',
  'bet.png',
  'spin.png',
  'auto-spin.png',
  'auto-spin-active.png',
  'hamburger-menu.png',
  'paytable-option-region.png',
];

function sanitizeFileSegment(value: string): string {
  return (value || 'unknown')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function resolveCaptureUrl(game: CatalogGame): string | null {
  const raw = (game.url || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).toString();
  } catch {
    const baseUrl = (process.env.BASE_URL || '').trim();
    if (!baseUrl) return null;
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return null;
    }
  }
}

function isBetwayUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes('betway');
  } catch {
    return false;
  }
}

function ensureTemplateMatcherExists(): { ok: boolean; reason?: string } {
  const matcherPath = path.resolve(process.cwd(), 'utils', 'image-template.ts');
  const pipelineSpecPath = path.resolve(process.cwd(), 'tests', 'validation', 'game-pipeline-validation.spec.ts');
  if (!fs.existsSync(matcherPath)) {
    return { ok: false, reason: `Template matcher not found: ${matcherPath}` };
  }
  if (!fs.existsSync(pipelineSpecPath)) {
    return { ok: false, reason: `Pipeline validation spec not found: ${pipelineSpecPath}` };
  }
  try {
    const spec = fs.readFileSync(pipelineSpecPath, 'utf-8');
    if (!spec.includes('findTemplateMatchMultiScale') || !spec.includes('findTemplateMatchRobust')) {
      return { ok: false, reason: 'Pipeline spec is not using shared image matching helpers from utils/image-template.ts' };
    }
  } catch (err) {
    return { ok: false, reason: `Unable to validate image matcher usage: ${(err as Error).message}` };
  }
  return { ok: true };
}

function emitPipelineLog(message: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  progressEmitter.emit('progress', {
    type: 'pipeline-test:log',
    payload: {
      message,
      stream,
      timestamp: Date.now(),
    },
  });
}

function runNodeScript(
  scriptPath: string,
  args: string[],
  onStdoutLine?: (line: string) => void,
  onStderrLine?: (line: string) => void,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let stdoutRemainder = '';
    let stderrRemainder = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdoutLine) {
        const merged = stdoutRemainder + text;
        const parts = merged.split(/\r?\n/);
        stdoutRemainder = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) onStdoutLine(trimmed);
        }
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderrLine) {
        const merged = stderrRemainder + text;
        const parts = merged.split(/\r?\n/);
        stderrRemainder = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) onStderrLine(trimmed);
        }
      }
    });
    proc.on('close', (code) => {
      if (onStdoutLine && stdoutRemainder.trim()) onStdoutLine(stdoutRemainder.trim());
      if (onStderrLine && stderrRemainder.trim()) onStderrLine(stderrRemainder.trim());
      resolve({ code, stdout, stderr });
    });
    proc.on('error', reject);
  });
}

async function runMandatoryImageCapture(
  catalogGames: CatalogGame[],
  headed: boolean,
): Promise<{ ok: boolean; copied: string[]; captureDir?: string; reason?: string; capturedGames?: string[]; skippedGames?: string[] }> {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  if (!fs.existsSync(GAME_TEMPLATE_ROOT)) fs.mkdirSync(GAME_TEMPLATE_ROOT, { recursive: true });

  const matcherStatus = ensureTemplateMatcherExists();
  if (!matcherStatus.ok) {
    return { ok: false, copied: [], reason: matcherStatus.reason };
  }

  const captureScript = path.resolve(process.cwd(), 'scripts', 'capture-game-feature-images.js');
  if (!fs.existsSync(captureScript)) {
    return { ok: false, copied: [], reason: `Capture script not found: ${captureScript}` };
  }

  const gamesWithUrl: Array<{ game: CatalogGame; captureUrl: string }> = [];
  const gamesMissingUrl: string[] = [];
  const skippedGames: string[] = [];
  for (const game of catalogGames) {
    const captureUrl = resolveCaptureUrl(game);
    if (!captureUrl) {
      gamesMissingUrl.push(game.name || game.id || 'unknown-game');
      continue;
    }
    if (isBetwayUrl(captureUrl)) {
      skippedGames.push(`${game.name || game.id || 'unknown-game'} (${game.id || 'no-id'})`);
      continue;
    }
    gamesWithUrl.push({ game, captureUrl });
  }
  if (gamesMissingUrl.length > 0) {
    return {
      ok: false,
      copied: [],
      reason: `Mandatory image capture failed. Missing URL for: ${gamesMissingUrl.join(', ')}`,
    };
  }
  const copied = new Set<string>();
  let latestCaptureDir = '';
  const capturedGames: string[] = [];
  for (const entry of gamesWithUrl) {
    const safeGameId = sanitizeFileSegment(entry.game.id || entry.game.name || 'game');
    const outDir = path.resolve(TMP_DIR, 'mandatory-feature-capture', safeGameId);
    const captureArgs = ['--url', entry.captureUrl, '--out', outDir];
    if (headed) captureArgs.push('--headed');
    emitPipelineLog(`[capture] ${entry.game.name} (${entry.game.id}) started`);
    const captureRun = await runNodeScript(
      captureScript,
      captureArgs,
      (line) => emitPipelineLog(`[capture:${entry.game.id}] ${line}`, 'stdout'),
      (line) => emitPipelineLog(`[capture:${entry.game.id}] ${line}`, 'stderr'),
    );
    if (captureRun.code !== 0) {
      return {
        ok: false,
        copied: Array.from(copied),
        captureDir: outDir,
        reason: `Capture failed for ${entry.game.name} (${entry.game.id}) with code ${captureRun.code}\n${captureRun.stdout}\n${captureRun.stderr}`.trim(),
      };
    }

    const captureOutLine = captureRun.stdout
      .split(/\r?\n/)
      .find((line) => line.includes('Capture complete. Output:'));
    const captureDir = captureOutLine ? captureOutLine.split('Output:')[1].trim() : outDir;
    latestCaptureDir = captureDir;
    emitPipelineLog(`[capture] ${entry.game.name} (${entry.game.id}) completed. Output: ${captureDir}`);

    const betSource = path.join(captureDir, '06-bet-icon-candidate.png');
    const spinSource = path.join(captureDir, '07-spin-icon-region.png');
    const autoSpinSource = path.join(captureDir, '08-auto-spin-icon-region.png');
    const autoSpinActiveSource = path.join(captureDir, '09-auto-spin-active-region.png');
    const hamburgerSource = path.join(captureDir, '03-hamburger-or-menu-icon.png');
    const paytableSource = path.join(captureDir, '05-paytable-option-region.png');
    if (!fs.existsSync(betSource) || !fs.existsSync(spinSource) || !fs.existsSync(autoSpinSource) || !fs.existsSync(autoSpinActiveSource) || !fs.existsSync(hamburgerSource) || !fs.existsSync(paytableSource)) {
      return {
        ok: false,
        copied: Array.from(copied),
        captureDir,
        reason: `Captured templates missing for ${entry.game.name} (${entry.game.id}) in ${captureDir}`,
      };
    }

    const gameTemplateDir = path.join(GAME_TEMPLATE_ROOT, safeGameId);
    if (!fs.existsSync(gameTemplateDir)) fs.mkdirSync(gameTemplateDir, { recursive: true });

    // Store templates in per-game folder used by pipeline gameplay test.
    const perGameBetBefore = path.join(gameTemplateDir, 'Bet-icon-before-click.png');
    const perGameBet = path.join(gameTemplateDir, 'bet.png');
    const perGameSpin = path.join(gameTemplateDir, 'spin.png');
    const perGameAutoSpin = path.join(gameTemplateDir, 'auto-spin.png');
    const perGameAutoSpinActive = path.join(gameTemplateDir, 'auto-spin-active.png');
    const perGameHamburger = path.join(gameTemplateDir, 'hamburger-menu.png');
    const perGamePaytable = path.join(gameTemplateDir, 'paytable-option-region.png');
    fs.copyFileSync(betSource, perGameBetBefore);
    fs.copyFileSync(betSource, perGameBet);
    fs.copyFileSync(spinSource, perGameSpin);
    fs.copyFileSync(autoSpinSource, perGameAutoSpin);
    fs.copyFileSync(autoSpinActiveSource, perGameAutoSpinActive);
    fs.copyFileSync(hamburgerSource, perGameHamburger);
    fs.copyFileSync(paytableSource, perGamePaytable);
    copied.add(path.basename(perGameBetBefore));
    copied.add(path.basename(perGameBet));
    copied.add(path.basename(perGameSpin));
    copied.add(path.basename(perGameAutoSpin));
    copied.add(path.basename(perGameAutoSpinActive));
    copied.add(path.basename(perGameHamburger));
    copied.add(path.basename(perGamePaytable));

    // Keep root-level defaults as fallback compatibility.
    fs.copyFileSync(betSource, path.join(TMP_DIR, 'Bet-icon-before-click.png'));
    fs.copyFileSync(betSource, path.join(TMP_DIR, 'bet.png'));
    fs.copyFileSync(spinSource, path.join(TMP_DIR, 'spin.png'));
    fs.copyFileSync(autoSpinSource, path.join(TMP_DIR, 'Auto-spin-icon-visible-before-click.png'));
    fs.copyFileSync(autoSpinActiveSource, path.join(TMP_DIR, 'Auto-spin-icon-visible-after-click.png'));
    copied.add('Bet-icon-before-click.png');
    copied.add('bet.png');
    copied.add('spin.png');
    copied.add('Auto-spin-icon-visible-before-click.png');
    copied.add('Auto-spin-icon-visible-after-click.png');
    capturedGames.push(`${entry.game.name} (${entry.game.id})`);
  }

  for (const entry of gamesWithUrl) {
    const safeGameId = sanitizeFileSegment(entry.game.id || entry.game.name || 'game');
    const gameTemplateDir = path.join(GAME_TEMPLATE_ROOT, safeGameId);
    const missing = REQUIRED_GAME_TEMPLATES.filter((name) => !fs.existsSync(path.join(gameTemplateDir, name)));
    if (missing.length > 0) {
      return {
        ok: false,
        copied: Array.from(copied),
        captureDir: latestCaptureDir,
        reason: `Mandatory image capture incomplete for ${entry.game.name} (${entry.game.id}). Missing in ${gameTemplateDir}: ${missing.join(', ')}`,
      };
    }
  }

  return { ok: true, copied: Array.from(copied), captureDir: latestCaptureDir, capturedGames, skippedGames };
}

// ── Catalog-to-TestGame mapping ──

function catalogToTestGame(game: CatalogGame): TestGame {
  let lobbyPath: string;
  let directUrl: string | undefined;

  switch (game.category) {
    case 'slots':
      lobbyPath = '/lobby/casino-games/slots';
      break;
    case 'crash-games':
      lobbyPath = '/lobby/casino-games';
      break;
    case 'table-game':
      lobbyPath = '/lobby/casino-games/table-games';
      break;
    case 'live-casino':
      lobbyPath = '/Livegames';
      directUrl = `/Livegames/${game.id}`;
      break;
    default:
      lobbyPath = '/lobby/casino-games';
  }

  // If the game has a URL, check if it's external (non-Betway) or internal
  let external = false;
  if (game.url) {
    try {
      const parsed = new URL(game.url);
      const isBetway = parsed.hostname.includes('betway');
      if (isBetway) {
        // Internal Betway game — use relative path
        directUrl = parsed.pathname + parsed.search;
      } else {
        // External game — keep full URL, skip Betway login/lobby
        directUrl = game.url;
        external = true;
      }
    } catch { /* ignore invalid URLs */ }
  }

  return {
    id: game.id,
    name: game.name,
    category: game.category,
    subType: game.subType,
    lobbyPath,
    directUrl,
    external,
    username: (game.username || '').trim() || undefined,
    password: (game.password || '').trim() || undefined,
  };
}

// ── Stdout parser ──

const STEP_NAMES = [
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
const TOTAL_PIPELINE_STEPS = STEP_NAMES.length;

function sanitizeConsoleLine(line: string): string {
  return line
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

function promoteNextPendingGameToRunning(): void {
  const nextPending = currentTestSession.games.find(g => g.status === 'pending');
  if (!nextPending) return;
  currentGameId = nextPending.gameId;
  nextPending.status = 'running';
}

function parseStdoutLine(line: string): void {
  const trimmed = sanitizeConsoleLine(line);
  if (!trimmed) return;

  // Match: [Step N] STATUS - details
  const stepMatch =
    trimmed.match(/\[Step\s+(\d+)\]\s*(PASS|FAIL|WARN|SKIP)\s*[-:–—]\s*(.*)/i) ||
    trimmed.match(/\[Step\s+(\d+)\]\s*(PASS|FAIL|WARN|SKIP)\b\s*(.*)/i);
  if (stepMatch) {
    const stepNum = parseInt(stepMatch[1], 10);
    const status = stepMatch[2].toUpperCase() as 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
    const details = stepMatch[3].trim();

    if (currentGameId) {
      const gameResult = currentTestSession.games.find(g => g.gameId === currentGameId);
      if (gameResult) {
        const stepName = STEP_NAMES[stepNum - 1] || `Step ${stepNum}`;
        gameResult.steps.push({ stepNum, stepName, status, details });

        progressEmitter.emit('progress', {
          type: 'pipeline-test:step-result',
          payload: { gameId: currentGameId, stepNum, stepName, status, details },
        });
      }
    }
    return;
  }

  // Match: Navigating to lobby (signals game start)
  const gameStartMatch = trimmed.match(/\[Step 1\]\s*Navigating to\s+(\w[\w-]*)\s*lobby/i);
  if (gameStartMatch && currentGameId) {
    progressEmitter.emit('progress', {
      type: 'pipeline-test:game-start',
      payload: {
        gameId: currentGameId,
        gameName: currentTestSession.games.find(g => g.gameId === currentGameId)?.gameName || currentGameId,
      },
    });
    return;
  }

  // Match: Score: N/M steps passed
  const scoreMatch = trimmed.match(/Score:\s*(\d+)\/(\d+)\s*steps\s*passed/i);
  if (scoreMatch && currentGameId) {
    const passed = parseInt(scoreMatch[1], 10);
    const total = parseInt(scoreMatch[2], 10);
    const gameResult = currentTestSession.games.find(g => g.gameId === currentGameId);
    if (gameResult) {
      gameResult.score = `${passed}/${total}`;
      gameResult.status = passed >= Math.ceil(total * 0.5) ? 'pass' : 'fail';
      currentTestSession.completedGames++;

      progressEmitter.emit('progress', {
        type: 'pipeline-test:game-complete',
        payload: { gameId: currentGameId, score: gameResult.score, status: gameResult.status },
      });
      promoteNextPendingGameToRunning();
    }
    return;
  }

  // Match Playwright test name to detect which game is running
  const testNameMatch = trimmed.match(/Pipeline:\s*(.+?)\s*\((.+?)\)/);
  if (testNameMatch) {
    const gameName = testNameMatch[1].trim();
    const gameResult = currentTestSession.games.find(g => g.gameName === gameName);
    if (gameResult) {
      currentGameId = gameResult.gameId;
      gameResult.status = 'running';
    }
    return;
  }
}

// ── Routes ──

router.post('/run', async (req: Request, res: Response) => {
  try {
    const { games, headed, annotateClicks, fastMode } = req.body;
    const fastModeEnabled = fastMode === false ? false : true;
    if (!games || !Array.isArray(games) || games.length === 0) {
      res.status(400).json({ error: 'No games provided' });
      return;
    }

    if (currentTestSession.status === 'running') {
      res.status(409).json({ error: 'Pipeline tests are already running' });
      return;
    }

    const catalogGames: CatalogGame[] = games;
    const testGames = catalogGames.map(catalogToTestGame);
    const sessionId = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  progressEmitter.emit('progress', {
    type: 'pipeline-test:log',
    payload: { message: 'Mandatory pre-step: capturing template images for every selected game...', stream: 'stdout', timestamp: Date.now() },
  });
  let captureResult: { ok: boolean; copied: string[]; captureDir?: string; reason?: string; capturedGames?: string[]; skippedGames?: string[] };
  try {
    captureResult = await runMandatoryImageCapture(catalogGames, !!headed);
  } catch (err) {
    const message = (err as Error).message || String(err);
    progressEmitter.emit('progress', {
      type: 'pipeline-test:log',
      payload: {
        message: `Mandatory capture crashed: ${message}`,
        stream: 'stderr',
        timestamp: Date.now(),
      },
    });
    res.status(500).json({ error: `Game testing aborted. Mandatory image capture crashed.\n${message}` });
    return;
  }
  if (!captureResult.ok) {
    progressEmitter.emit('progress', {
      type: 'pipeline-test:log',
      payload: {
        message: `Mandatory capture failed: ${captureResult.reason || 'unknown error'}`,
        stream: 'stderr',
        timestamp: Date.now(),
      },
    });
    res.status(400).json({
      error: `Game testing aborted. Mandatory image capture failed.\n${captureResult.reason || 'Unknown capture error'}`,
    });
    return;
  }
  progressEmitter.emit('progress', {
    type: 'pipeline-test:log',
    payload: {
      message: `Mandatory capture complete for ${captureResult.capturedGames?.length || 0} game(s), skipped ${captureResult.skippedGames?.length || 0} Betway game(s). FAST_MODE=${fastModeEnabled ? 'ON' : 'OFF'}. Templates: ${captureResult.copied.join(', ') || 'none'}. Latest capture dir: ${captureResult.captureDir || 'n/a'}`,
      stream: 'stdout',
      timestamp: Date.now(),
    },
  });
  if ((captureResult.skippedGames?.length || 0) > 0) {
    progressEmitter.emit('progress', {
      type: 'pipeline-test:log',
      payload: {
        message: `Capture skipped for Betway games: ${captureResult.skippedGames?.join(', ')}`,
        stream: 'stdout',
        timestamp: Date.now(),
      },
    });
  }

  currentTestSession = {
    sessionId,
    status: 'running',
    startTime: Date.now(),
    totalGames: catalogGames.length,
    completedGames: 0,
    games: catalogGames.map(g => ({
      gameId: g.id,
      gameName: g.name,
      category: g.category,
      steps: [],
      score: '',
      status: 'pending' as const,
    })),
  };

  currentGameId = null;

  const testSpecPath = 'tests/validation/game-pipeline-validation.spec.ts';

  progressEmitter.emit('progress', {
    type: 'pipeline-test:start',
    payload: {
      sessionId,
      totalGames: catalogGames.length,
      games: catalogGames.map(g => ({ id: g.id, name: g.name, category: g.category })),
    },
  });

  if (currentTestSession.games.length > 0) {
    currentGameId = currentTestSession.games[0].gameId;
    currentTestSession.games[0].status = 'running';
  }

  // Write games to a well-known file path (avoids Windows env var corruption issues)
  const gamesFilePath = path.resolve(process.cwd(), 'tmp', 'pipeline-games.json');
  const tmpDir = path.dirname(gamesFilePath);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(gamesFilePath, JSON.stringify(testGames, null, 2), 'utf-8');
  console.log('[pipeline] Wrote games file:', gamesFilePath);

  console.log('[pipeline] Running tests for', catalogGames.length, 'game(s)');

  // No -g filter needed: the test file reads games from tmp/pipeline-games.json
  // and only generates tests for those games. Avoiding -g also avoids Windows
  // cmd.exe quoting issues with game names that contain spaces.
  // Pipeline runs real-money/external games that can load very slowly.
  // Increase timeout at CLI level to avoid premature termination (does not modify the test file).
  const args = ['playwright', 'test', testSpecPath, '--config=playwright.pipeline.config.ts', '--project=chromium-desktop', '--workers=1', '--reporter=line', '--timeout=900000'];
  if (headed) args.push('--headed');
  console.log('[pipeline] Command: npx', args.join(' '), headed ? '(headed)' : '(headless)');

  childProcess = spawn('npx', args, {
    cwd: process.cwd(),
    // Paytable step runs at the end of the pipeline; keep it enabled by default.
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      PIPELINE_TEST_TIMEOUT_MS: '1200000',
      PIPELINE_ANNOTATE_CLICKS: annotateClicks ? '1' : '0',
      PIPELINE_AUTO_CAPTURE_IMAGES: '1',
      PIPELINE_FAST_MODE: fastModeEnabled ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  let stdoutBuffer = '';
  const logDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const stdoutLogPath = path.join(logDir, 'pipeline-last.log');
  const stderrLogPath = path.join(logDir, 'pipeline-last.err.log');
  const stdoutLog = fs.createWriteStream(stdoutLogPath, { flags: 'w' });
  const stderrLog = fs.createWriteStream(stderrLogPath, { flags: 'w' });
  stdoutLog.write(`[pipeline] sessionId=${sessionId} started=${new Date().toISOString()}\n`);
  stdoutLog.write(`[pipeline] cmd=npx ${args.join(' ')}\n\n`);

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    try { stdoutLog.write(text); } catch { /* ignore */ }
    console.log('[pipeline:stdout]', text.trimEnd());
    stdoutBuffer += text.replace(/\r/g, '\n');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      parseStdoutLine(line);
      // Stream log line to dashboard via SSE
      const cleaned = sanitizeConsoleLine(line);
      if (cleaned) {
        progressEmitter.emit('progress', {
          type: 'pipeline-test:log',
          payload: { message: cleaned, stream: 'stdout', timestamp: Date.now() },
        });
      }
    }
  });

  childProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      try { stderrLog.write(text + '\n'); } catch { /* ignore */ }
      console.log('[pipeline:stderr]', text);
      // Skip Node deprecation warnings
      if (!text.includes('DeprecationWarning') && !text.includes('--trace-deprecation')) {
        progressEmitter.emit('progress', {
          type: 'pipeline-test:log',
          payload: { message: text, stream: 'stderr', timestamp: Date.now() },
        });
      }
    }
  });

  childProcess.on('close', (code) => {
    console.log('[pipeline] Process exited with code:', code);
    if (stdoutBuffer.trim()) parseStdoutLine(stdoutBuffer);
    childProcess = null;
    try { stdoutLog.write(`\n[pipeline] exited code=${code} at=${new Date().toISOString()}\n`); } catch {}
    try { stdoutLog.end(); } catch {}
    try { stderrLog.end(); } catch {}

    // Clean up temp games file
    try { fs.unlinkSync(gamesFilePath); } catch { /* ignore */ }

    if (currentTestSession.status === 'aborted') return;

    currentTestSession.endTime = Date.now();
    for (const game of currentTestSession.games) {
      if (game.status === 'pending' || game.status === 'running') game.status = 'fail';
    }
    currentTestSession.status = 'complete';
    saveSession(currentTestSession);

    progressEmitter.emit('progress', {
      type: 'pipeline-test:complete',
      payload: {
        sessionId: currentTestSession.sessionId,
        totalGames: currentTestSession.totalGames,
        completedGames: currentTestSession.completedGames,
      },
    });
  });

  childProcess.on('error', (err) => {
    childProcess = null;
    try { fs.unlinkSync(gamesFilePath); } catch { /* ignore */ }
    currentTestSession.status = 'error';
    currentTestSession.error = err.message;
    currentTestSession.endTime = Date.now();
    saveSession(currentTestSession);
    progressEmitter.emit('progress', {
      type: 'error',
      payload: { message: `Pipeline test process error: ${err.message}` },
    });
  });

    res.json({ sessionId, totalGames: currentTestSession.totalGames });
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    console.error('[pipeline] /run failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Pipeline run failed: ${message}` });
    }
  }
});

router.get('/results', (_req: Request, res: Response) => {
  res.json(currentTestSession);
});

router.post('/clear', (_req: Request, res: Response) => {
  if (currentTestSession.status === 'running') {
    res.status(400).json({ cleared: false, error: 'Cannot clear while tests are running. Abort first.' });
    return;
  }
  currentTestSession = {
    sessionId: '',
    status: 'idle',
    startTime: 0,
    totalGames: 0,
    completedGames: 0,
    games: [],
  };
  childProcess = null;
  currentGameId = null;
  try { fs.unlinkSync(SESSION_FILE); } catch { /* ignore */ }
  res.json({ cleared: true });
});

router.post('/abort', (_req: Request, res: Response) => {
  if (!childProcess || currentTestSession.status !== 'running') {
    res.json({ aborted: false });
    return;
  }

  currentTestSession.status = 'aborted';
  currentTestSession.endTime = Date.now();
  for (const game of currentTestSession.games) {
    if (game.status === 'pending' || game.status === 'running') game.status = 'fail';
  }

  try {
    childProcess.kill('SIGTERM');
    const proc = childProcess;
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
  } catch {}
  childProcess = null;
  saveSession(currentTestSession);

  progressEmitter.emit('progress', {
    type: 'pipeline-test:complete',
    payload: {
      sessionId: currentTestSession.sessionId,
      totalGames: currentTestSession.totalGames,
      completedGames: currentTestSession.completedGames,
      aborted: true,
    },
  });

  res.json({ aborted: true });
});

// ── Report generation ──

const SCREENSHOT_STEPS: Record<number, string> = {
  1: '01-lobby',
  2: '02-after-play',
  3: '03-game-loaded',
  4: '04b-after-continue',
  5: '05-credits',
  6: '06b-after-gameplay',
  7: '07b-after-minbet',
  8: '08b-after-maxbet',
  9: '09b-after-betreset',
  10: '10b-after-paytable',
  11: '11b-after-autospin',
};

function loadScreenshotBase64(gameId: string, stepKey: string): string | null {
  const screenshotDir = path.resolve(process.cwd(), 'reports', 'pipeline-validation');
  const gameDir = path.join(screenshotDir, gameId);
  const nestedPath = path.join(gameDir, `${stepKey}.png`);
  const legacyPath = path.join(screenshotDir, `${gameId}-${stepKey}.png`);
  try {
    if (fs.existsSync(nestedPath)) {
      const data = fs.readFileSync(nestedPath);
      return `data:image/png;base64,${data.toString('base64')}`;
    }
    if (fs.existsSync(legacyPath)) {
      const data = fs.readFileSync(legacyPath);
      return `data:image/png;base64,${data.toString('base64')}`;
    }
  } catch { /* ignore */ }
  return null;
}

function statusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'PASS': return '#10b981';
    case 'FAIL': return '#ef4444';
    case 'WARN': return '#f59e0b';
    case 'SKIP': return '#6b7280';
    default: return '#6b7280';
  }
}

function generateReportHtml(session: PipelineTestSession): string {
  const games = session.games;
  const passedGames = games.filter(g => g.status === 'pass').length;
  const failedGames = games.filter(g => g.status === 'fail').length;
  const totalSteps = games.reduce((s, g) => s + g.steps.length, 0);
  const passedSteps = games.reduce((s, g) => s + g.steps.filter(st => st.status === 'PASS').length, 0);
  const passRate = games.length > 0 ? ((passedGames / games.length) * 100).toFixed(1) : '0';
  const dateStr = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
  const duration = session.endTime && session.startTime
    ? Math.round((session.endTime - session.startTime) / 1000)
    : 0;
  const durationStr = duration > 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`;

  const gamesSections = games.map(game => {
    const scoreColor = game.status === 'pass' ? '#10b981' : '#ef4444';
    const scoreIcon = game.status === 'pass' ? 'PASSED' : 'FAILED';

    // Generate step rows - if no steps captured, generate placeholder rows from screenshots
    let stepRows = '';
    if (game.steps.length > 0) {
      stepRows = game.steps.map(step => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;">${step.stepNum}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${step.stepName}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;">
            <span style="background:${statusColor(step.status)};color:#fff;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:600;">${step.status}</span>
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;font-size:12px;color:#aaa;">${step.details}</td>
        </tr>
      `).join('');
    } else {
      // No step data captured - show placeholder rows based on available screenshots
      for (let i = 1; i <= TOTAL_PIPELINE_STEPS; i++) {
        const stepKey = SCREENSHOT_STEPS[i];
        const hasScreenshot = stepKey && loadScreenshotBase64(game.gameId, stepKey);
        const stepName = STEP_NAMES[i - 1] || `Step ${i}`;
        const statusLabel = hasScreenshot ? 'EVIDENCE' : 'NO DATA';
        const statusBg = hasScreenshot ? '#3b82f6' : '#6b7280';
        stepRows += `
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;">${i}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #333;">${stepName}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;">
              <span style="background:${statusBg};color:#fff;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:600;">${statusLabel}</span>
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #333;font-size:12px;color:#888;">Step result not captured - see screenshot below</td>
          </tr>
        `;
      }
    }

    // Collect screenshots
    const screenshots: string[] = [];
    for (let i = 1; i <= TOTAL_PIPELINE_STEPS; i++) {
      const stepKey = SCREENSHOT_STEPS[i];
      if (!stepKey) continue;
      const b64 = loadScreenshotBase64(game.gameId, stepKey);
      if (b64) {
        const stepName = STEP_NAMES[i - 1] || `Step ${i}`;
        const step = game.steps.find(s => s.stepNum === i);
        const status = step ? step.status : (b64 ? 'EVIDENCE' : '-');
        const statusBgColor = step ? statusColor(step.status) : '#3b82f6';
        screenshots.push(`
          <div style="display:inline-block;margin:6px;text-align:center;vertical-align:top;">
            <div style="font-size:11px;color:#aaa;margin-bottom:4px;">Step ${i}: ${stepName}
              <span style="background:${statusBgColor};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">${status}</span>
            </div>
            <img src="${b64}" alt="Step ${i}" style="max-width:280px;border:1px solid #444;border-radius:4px;">
          </div>
        `);
      }
    }

    return `
      <div style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:20px;margin-bottom:20px;page-break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div>
            <h3 style="margin:0;font-size:18px;color:#e0e0e0;">${game.gameName}</h3>
            <span style="font-size:12px;color:#888;">Category: ${game.category}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:24px;font-weight:700;color:${scoreColor};">${game.score || '-'}</div>
            <div style="font-size:11px;font-weight:600;color:${scoreColor};">${scoreIcon}</div>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <thead>
            <tr style="background:#2a2a3e;">
              <th style="padding:8px 10px;text-align:center;color:#aaa;font-size:11px;border-bottom:2px solid #444;width:50px;">#</th>
              <th style="padding:8px 10px;text-align:left;color:#aaa;font-size:11px;border-bottom:2px solid #444;">Test Step</th>
              <th style="padding:8px 10px;text-align:center;color:#aaa;font-size:11px;border-bottom:2px solid #444;width:80px;">Status</th>
              <th style="padding:8px 10px;text-align:left;color:#aaa;font-size:11px;border-bottom:2px solid #444;">Details</th>
            </tr>
          </thead>
          <tbody>
            ${stepRows || '<tr><td colspan="4" style="padding:10px;color:#666;">No step data captured</td></tr>'}
          </tbody>
        </table>

        ${screenshots.length > 0 ? `
          <div style="margin-top:12px;">
            <h4 style="margin:0 0 8px 0;font-size:13px;color:#aaa;">Screenshot Evidence</h4>
            <div style="overflow-x:auto;">
              ${screenshots.join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GamePulse - Game Testing Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #121220; color: #e0e0e0; margin: 0; padding: 20px; }
    @media print {
      body { background: #fff; color: #222; padding: 10px; }
      .summary-card { background: #f5f5f5 !important; border-color: #ddd !important; }
      .summary-card .label { color: #666 !important; }
      .summary-card .value { color: #222 !important; }
      div[style*="background:#1e1e2e"] { background: #f9f9f9 !important; border-color: #ddd !important; }
      table tr[style*="background:#2a2a3e"] { background: #eee !important; }
      th, td { color: #333 !important; border-color: #ddd !important; }
      h3, h4 { color: #222 !important; }
      span[style*="color:#aaa"], span[style*="color:#888"] { color: #666 !important; }
    }
  </style>
</head>
<body>
  <div style="max-width:1100px;margin:0 auto;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:30px;padding:20px;border-bottom:2px solid #333;">
      <h1 style="margin:0;font-size:28px;color:#00d4ff;">GamePulse</h1>
      <p style="margin:4px 0 0 0;font-size:14px;color:#888;">Game Testing Report</p>
      <p style="margin:8px 0 0 0;font-size:12px;color:#666;">${dateStr} | Session: ${session.sessionId} | Duration: ${durationStr}</p>
    </div>

    <!-- Summary -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px;">
      <div class="summary-card" style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:16px;text-align:center;">
        <div class="label" style="font-size:11px;color:#888;margin-bottom:4px;">Games Tested</div>
        <div class="value" style="font-size:28px;font-weight:700;color:#00d4ff;">${games.length}</div>
      </div>
      <div class="summary-card" style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:16px;text-align:center;">
        <div class="label" style="font-size:11px;color:#888;margin-bottom:4px;">Passed</div>
        <div class="value" style="font-size:28px;font-weight:700;color:#10b981;">${passedGames}</div>
      </div>
      <div class="summary-card" style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:16px;text-align:center;">
        <div class="label" style="font-size:11px;color:#888;margin-bottom:4px;">Failed</div>
        <div class="value" style="font-size:28px;font-weight:700;color:#ef4444;">${failedGames}</div>
      </div>
      <div class="summary-card" style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:16px;text-align:center;">
        <div class="label" style="font-size:11px;color:#888;margin-bottom:4px;">Pass Rate</div>
        <div class="value" style="font-size:28px;font-weight:700;color:${parseFloat(passRate) >= 80 ? '#10b981' : parseFloat(passRate) >= 50 ? '#f59e0b' : '#ef4444'};">${passRate}%</div>
      </div>
      <div class="summary-card" style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:16px;text-align:center;">
        <div class="label" style="font-size:11px;color:#888;margin-bottom:4px;">Steps Passed</div>
        <div class="value" style="font-size:28px;font-weight:700;color:#00d4ff;">${passedSteps}/${totalSteps}</div>
      </div>
    </div>

    <!-- What Was Tested -->
    <div style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:16px;margin-bottom:24px;">
      <h3 style="margin:0 0 8px 0;font-size:14px;color:#aaa;">Test Scenarios (per game)</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 1:</strong> Lobby Navigation</td><td style="padding:4px 10px;color:#888;font-size:12px;">Navigate to game category lobby, verify page loads</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 2:</strong> Play Button Click</td><td style="padding:4px 10px;color:#888;font-size:12px;">Find and click Play button, verify game opens</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 3:</strong> Game Element Loaded</td><td style="padding:4px 10px;color:#888;font-size:12px;">Verify game iframe/canvas loads within timeout</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 4:</strong> Continue/Accept</td><td style="padding:4px 10px;color:#888;font-size:12px;">Handle any Continue/Accept overlays, verify screen changes</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 5:</strong> Credits/Balance</td><td style="padding:4px 10px;color:#888;font-size:12px;">Verify credits or balance indicator is visible</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 6:</strong> Spin</td><td style="padding:4px 10px;color:#888;font-size:12px;">Click spin button and verify gameplay response</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 7:</strong> Min Bet</td><td style="padding:4px 10px;color:#888;font-size:12px;">Decrease bet to minimum, verify state change via screenshot diff</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 8:</strong> Max Bet</td><td style="padding:4px 10px;color:#888;font-size:12px;">Click max bet button, verify state change via screenshot diff</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 9:</strong> Bet Reset</td><td style="padding:4px 10px;color:#888;font-size:12px;">Decrease bet from max for safe gameplay balance</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 10:</strong> Paytable/Info</td><td style="padding:4px 10px;color:#888;font-size:12px;">Open info/paytable panel and verify panel state change</td></tr>
          <tr><td style="padding:4px 10px;color:#e0e0e0;font-size:13px;"><strong>Step 11:</strong> Auto-Spin</td><td style="padding:4px 10px;color:#888;font-size:12px;">Template match auto-spin icon, click it, and verify state change via image diff</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Per-game results -->
    <h2 style="font-size:18px;color:#e0e0e0;margin-bottom:12px;">Detailed Results</h2>
    ${gamesSections}

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;border-top:1px solid #333;margin-top:20px;">
      <p style="font-size:11px;color:#666;">Generated by GamePulse Dashboard | Betway Casino Game Testing</p>
      <p style="font-size:11px;color:#666;">Built by Harsha Toshniwal - Zensar Technologies</p>
    </div>
  </div>
</body>
</html>`;
}

// Path where report is saved for validation tests
const REPORT_FILE_PATH = path.resolve(process.cwd(), 'game-testing-report.html');

router.get('/download-report', (_req: Request, res: Response) => {
  if (currentTestSession.status !== 'complete' && currentTestSession.status !== 'aborted') {
    res.status(400).json({ error: 'Tests have not completed yet. Run tests first.' });
    return;
  }
  if (currentTestSession.games.length === 0) {
    res.status(400).json({ error: 'No test results available.' });
    return;
  }

  const html = generateReportHtml(currentTestSession);

  // Save report to disk for validation tests
  try {
    fs.writeFileSync(REPORT_FILE_PATH, html, 'utf-8');
    console.log('[pipeline] Report saved to:', REPORT_FILE_PATH);
  } catch (err) {
    console.error('[pipeline] Failed to save report:', err);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="game-testing-report-${dateStr}.html"`);
  res.send(html);
});

// ── Report validation ──

interface ValidationResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  output: string;
  errors: string[];
}

router.post('/validate-report', async (_req: Request, res: Response) => {
  if (currentTestSession.status !== 'complete' && currentTestSession.status !== 'aborted') {
    res.status(400).json({ error: 'Tests have not completed yet. Run tests first.' });
    return;
  }
  if (currentTestSession.games.length === 0) {
    res.status(400).json({ error: 'No test results available.' });
    return;
  }

  // Generate and save report to disk
  const html = generateReportHtml(currentTestSession);
  try {
    fs.writeFileSync(REPORT_FILE_PATH, html, 'utf-8');
    console.log('[pipeline] Report saved for validation:', REPORT_FILE_PATH);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save report for validation: ' + (err as Error).message });
    return;
  }

  // Run validation tests
  const testSpecPath = path.resolve(process.cwd(), 'tests', 'validation', 'report-validation.spec.ts');

  if (!fs.existsSync(testSpecPath)) {
    res.status(500).json({ error: 'Validation test file not found: ' + testSpecPath });
    return;
  }

  const startTime = Date.now();
  const fullCmd = `npx playwright test "${testSpecPath}" --project=chromium-desktop --reporter=json 2>&1`;

  console.log('[pipeline] Running report validation tests...');

  const validationProcess = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/c', fullCmd], {
        cwd: process.cwd(),
        env: { ...process.env, REPORT_PATH: REPORT_FILE_PATH, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn('npx', ['playwright', 'test', testSpecPath, '--project=chromium-desktop', '--reporter=json'], {
        cwd: process.cwd(),
        env: { ...process.env, REPORT_PATH: REPORT_FILE_PATH, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

  let stdout = '';
  let stderr = '';

  validationProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  validationProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  validationProcess.on('close', (code) => {
    const duration = Date.now() - startTime;
    console.log('[pipeline] Validation tests completed with code:', code);

    // Parse JSON output from Playwright
    let result: ValidationResult = {
      passed: code === 0,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      duration,
      output: stdout,
      errors: [],
    };

    try {
      // Find JSON in output (may have other text mixed in)
      const jsonMatch = stdout.match(/\{[\s\S]*"suites"[\s\S]*\}/);
      if (jsonMatch) {
        const jsonReport = JSON.parse(jsonMatch[0]);

        // Count tests from suites
        const countTests = (suites: any[]): { total: number; passed: number; failed: number; skipped: number } => {
          let total = 0, passed = 0, failed = 0, skipped = 0;
          for (const suite of suites) {
            if (suite.specs) {
              for (const spec of suite.specs) {
                for (const test of spec.tests || []) {
                  total++;
                  if (test.status === 'expected' || test.status === 'passed') passed++;
                  else if (test.status === 'skipped') skipped++;
                  else failed++;
                }
              }
            }
            if (suite.suites) {
              const nested = countTests(suite.suites);
              total += nested.total;
              passed += nested.passed;
              failed += nested.failed;
              skipped += nested.skipped;
            }
          }
          return { total, passed, failed, skipped };
        };

        const counts = countTests(jsonReport.suites || []);
        result.totalTests = counts.total;
        result.passedTests = counts.passed;
        result.failedTests = counts.failed;
        result.skippedTests = counts.skipped;

        // Extract error messages
        const extractErrors = (suites: any[]): string[] => {
          const errors: string[] = [];
          for (const suite of suites) {
            if (suite.specs) {
              for (const spec of suite.specs) {
                for (const test of spec.tests || []) {
                  if (test.status !== 'expected' && test.status !== 'passed' && test.status !== 'skipped') {
                    for (const result of test.results || []) {
                      if (result.error) {
                        errors.push(`${spec.title}: ${result.error.message || result.error}`);
                      }
                    }
                  }
                }
              }
            }
            if (suite.suites) {
              errors.push(...extractErrors(suite.suites));
            }
          }
          return errors;
        };

        result.errors = extractErrors(jsonReport.suites || []);
      }
    } catch (parseErr) {
      console.error('[pipeline] Failed to parse validation output:', parseErr);
      // If JSON parsing fails, try to count from line output
      const passedMatch = stdout.match(/(\d+) passed/);
      const failedMatch = stdout.match(/(\d+) failed/);
      const skippedMatch = stdout.match(/(\d+) skipped/);
      if (passedMatch) result.passedTests = parseInt(passedMatch[1], 10);
      if (failedMatch) result.failedTests = parseInt(failedMatch[1], 10);
      if (skippedMatch) result.skippedTests = parseInt(skippedMatch[1], 10);
      result.totalTests = result.passedTests + result.failedTests + result.skippedTests;
    }

    res.json(result);
  });

  validationProcess.on('error', (err) => {
    res.status(500).json({
      error: 'Failed to run validation tests: ' + err.message,
      passed: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      duration: Date.now() - startTime,
      output: '',
      errors: [err.message],
    });
  });
});

router.get('/screenshot/:gameId/:step', (req: Request, res: Response) => {
  const gameId = req.params.gameId as string;
  const step = req.params.step as string;
  const screenshotDir = path.resolve(process.cwd(), 'reports', 'pipeline-validation');
  const nestedPath = path.join(screenshotDir, gameId, `${step}.png`);
  const legacyPath = path.join(screenshotDir, `${gameId}-${step}.png`);
  const filePath = fs.existsSync(nestedPath) ? nestedPath : legacyPath;
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Screenshot not found' });
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(filePath);
});

export { router as pipelineRouter };
