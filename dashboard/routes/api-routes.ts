/**
 * API Routes — REST endpoints for the GamePulse dashboard.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { RecordingService } from '../services/recording-service';
import { LoadTestService } from '../services/load-test-service';
import { ReportService } from '../services/report-service';
import { PdfReportService } from '../services/pdf-report-service';
import { listHarFiles } from '../services/har-file-service';
import { parseExcelFile, excelRowToGameInput } from '../services/excel-parser-service';
import { progressEmitter } from './sse-routes';
import {
  PipelineSession,
  DashboardHarRecordResult,
  GameInput,
  FeatureFlags,
  DEFAULT_FEATURES,
  GameApiReport,
  GameVerification,
} from '../types/dashboard-types';

const router = Router();

// ── Multer config for Excel upload ──
const upload = multer({
  dest: path.resolve(__dirname, '..', 'uploads'),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('Only .xlsx and .xls files are allowed'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Session state (single-user local tool) ──
let currentSession: PipelineSession = {
  id: '',
  status: 'idle',
  startTime: 0,
  games: [],
  features: DEFAULT_FEATURES,
  harResults: [],
  loadTestResults: [],
  apiReports: [],
  verifications: [],
};

// ── Cached analysis data ──
let cachedApiReports: GameApiReport[] = [];
let cachedVerifications: GameVerification[] = [];
let cachedComparison: any = null;

function resetSession() {
  currentSession = {
    id: '',
    status: 'idle',
    startTime: 0,
    games: [],
    features: DEFAULT_FEATURES,
    harResults: [],
    loadTestResults: [],
    apiReports: [],
    verifications: [],
  };
}

function generateSessionId(): string {
  return `gp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Helper: Load game catalog ──
function loadGameCatalog(): any[] {
  try {
    const catalogPath = path.resolve(process.cwd(), 'config', 'games-catalog.json');
    const data = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    return data.games || [];
  } catch { return []; }
}

function loadConfig(): any {
  try {
    const configPath = path.resolve(process.cwd(), 'config', 'har-load-test-config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch { return {}; }
}

// ── Helpers ──

/** Returns true only while a pipeline is actively running */
function isBusy(): boolean {
  return !['idle', 'complete', 'error'].includes(currentSession.status);
}

// ── Routes ──

// Get games catalog
router.get('/games/catalog', (_req: Request, res: Response) => {
  const games = loadGameCatalog();
  res.json({ games });
});

// Get load test config
router.get('/config', (_req: Request, res: Response) => {
  res.json(loadConfig());
});

// Get current session status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    id: currentSession.id,
    status: currentSession.status,
    gamesTotal: currentSession.games.length,
    harResultsCount: currentSession.harResults.length,
    loadTestResultsCount: currentSession.loadTestResults.length,
  });
});

// List HAR files
router.get('/har-files', (_req: Request, res: Response) => {
  const catalog = loadGameCatalog();
  const nameMap: Record<string, string> = {};
  for (const g of catalog) nameMap[g.id] = g.name;
  const harDir = path.resolve(process.cwd(), 'har-files');
  const files = listHarFiles(harDir, nameMap);
  res.json({ files });
});

// Upload Excel
router.post('/upload-excel', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const rows = parseExcelFile(req.file.path);
    const games = rows.map(excelRowToGameInput);
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    res.json({ games, count: games.length });
  } catch (err: any) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    res.status(400).json({ error: `Failed to parse Excel: ${err.message}` });
  }
});

// Record HAR only
router.post('/record', async (req: Request, res: Response) => {
  if (isBusy()) {
    res.status(409).json({ error: 'A pipeline is already running' });
    return;
  }
  resetSession();

  const { games, features }: { games: GameInput[]; features: FeatureFlags } = req.body;
  if (!games || !games.length) {
    res.status(400).json({ error: 'No games provided' });
    return;
  }

  const sessionId = generateSessionId();
  currentSession.id = sessionId;
  currentSession.status = 'recording';
  currentSession.startTime = Date.now();
  currentSession.games = games;
  currentSession.features = features || DEFAULT_FEATURES;

  res.json({ sessionId });

  // Run async
  const config = loadConfig();
  const recorder = new RecordingService(config.harRecording);
  try {
    currentSession.harResults = await recorder.recordAllGames(games, currentSession.features, sessionId);
    currentSession.status = 'idle';
  } catch (err: any) {
    currentSession.status = 'error';
    currentSession.error = err.message;
    progressEmitter.emit('progress', { type: 'error', payload: { message: err.message } });
  }
});

// Run load test only
router.post('/load-test', async (req: Request, res: Response) => {
  if (isBusy()) {
    res.status(409).json({ error: 'A pipeline is already running' });
    return;
  }
  resetSession();

  const { config: ltConfig } = req.body;
  const sessionId = generateSessionId();
  currentSession.id = sessionId;
  currentSession.status = 'load-testing';
  currentSession.startTime = Date.now();

  res.json({ sessionId });

  const catalog = loadGameCatalog();
  const nameMap: Record<string, string> = {};
  for (const g of catalog) nameMap[g.id] = g.name;
  const harDir = path.resolve(process.cwd(), 'har-files');
  const harFiles = listHarFiles(harDir, nameMap);

  const gamesToTest = harFiles.map(f => ({ gameName: f.gameName, gameId: f.gameId, harFilePath: f.filePath }));
  const ltService = new LoadTestService();

  try {
    currentSession.loadTestResults = await ltService.runForAllGames(gamesToTest, ltConfig || {}, sessionId);
    currentSession.status = 'idle';
  } catch (err: any) {
    currentSession.status = 'error';
    currentSession.error = err.message;
    progressEmitter.emit('progress', { type: 'error', payload: { message: err.message } });
  }
});

// Run full pipeline
router.post('/run-pipeline', async (req: Request, res: Response) => {
  if (isBusy()) {
    res.status(409).json({ error: 'A pipeline is already running' });
    return;
  }

  const { games, features, loadTestConfig }: { games: GameInput[]; features: FeatureFlags; loadTestConfig?: any } = req.body;
  if (!games || !games.length) {
    res.status(400).json({ error: 'No games provided' });
    return;
  }

  const sessionId = generateSessionId();
  resetSession();
  currentSession.id = sessionId;
  currentSession.status = 'recording';
  currentSession.startTime = Date.now();
  currentSession.games = games;
  currentSession.features = features || DEFAULT_FEATURES;

  res.json({ sessionId });

  const appConfig = loadConfig();

  try {
    // Phase 1: Record HAR files
    const recorder = new RecordingService(appConfig.harRecording);
    currentSession.harResults = await recorder.recordAllGames(games, currentSession.features, sessionId);

    // Phase 2: Load test (optional — controlled by checkbox on setup page)
    const loadTestEnabled = loadTestConfig?.enabled ?? true;
    if (loadTestEnabled) {
      currentSession.status = 'load-testing';
      const successfulGames = currentSession.harResults
        .filter(r => r.success && r.totalEntries > 0)
        .map(r => ({ gameName: r.gameName, gameId: r.gameId, harFilePath: r.harFilePath }));

      if (successfulGames.length > 0) {
        const ltService = new LoadTestService();
        currentSession.loadTestResults = await ltService.runForAllGames(successfulGames, loadTestConfig || appConfig.loadTest || {}, sessionId);
      }
    } else {
      console.log('[pipeline] Load testing skipped (disabled by user)');
    }

    // Phase 3: Generate reports / analysis
    currentSession.status = 'generating-reports';
    const reportService = new ReportService();

    const nameMap: Record<string, string> = {};
    for (const g of games) nameMap[g.id] = g.name;

    // Generate HTML report if we have load test results
    if (currentSession.loadTestResults.length > 0) {
      reportService.generateHtmlReport(currentSession.loadTestResults, currentSession.harResults);
    }

    // Generate analysis data
    cachedApiReports = reportService.getApiCoverageReports(nameMap);
    cachedVerifications = reportService.getVerificationReports(nameMap);
    cachedComparison = reportService.getComparisonData(cachedApiReports, cachedVerifications, currentSession.loadTestResults);

    currentSession.apiReports = cachedApiReports;
    currentSession.verifications = cachedVerifications;
    currentSession.status = 'complete';

    progressEmitter.emit('progress', {
      type: 'pipeline:complete',
      payload: {
        sessionId,
        harRecorded: currentSession.harResults.length,
        loadTested: currentSession.loadTestResults.length,
        gamesAnalyzed: cachedApiReports.length,
      },
    });
  } catch (err: any) {
    currentSession.status = 'error';
    currentSession.error = err.message;
    progressEmitter.emit('progress', { type: 'error', payload: { message: err.message } });
  }
});

// Abort current operation
router.post('/abort', (_req: Request, res: Response) => {
  const prevStatus = currentSession.status;
  if (prevStatus === 'idle') {
    res.json({ aborted: false, message: 'No operation running' });
    return;
  }
  currentSession.status = 'idle';
  currentSession.error = 'Aborted by user';
  progressEmitter.emit('progress', { type: 'log', payload: { message: 'Operation aborted by user', level: 'warn', timestamp: Date.now() } });
  progressEmitter.emit('progress', { type: 'error', payload: { message: `Pipeline aborted (was: ${prevStatus})` } });
  res.json({ aborted: true });
});

// Force-reset a stuck session (clears all state back to idle)
router.post('/reset', (_req: Request, res: Response) => {
  const prevStatus = currentSession.status;
  resetSession();
  progressEmitter.emit('progress', { type: 'log', payload: { message: `Session force-reset (was: ${prevStatus})`, level: 'warn', timestamp: Date.now() } });
  res.json({ reset: true, previousStatus: prevStatus });
});

// ── Results endpoints ──

router.get('/results/performance', (_req: Request, res: Response) => {
  res.json({ results: currentSession.loadTestResults });
});

router.get('/results/api-coverage', (_req: Request, res: Response) => {
  // Use cached or generate on-demand
  if (cachedApiReports.length === 0) {
    const reportService = new ReportService();
    const catalog = loadGameCatalog();
    const nameMap: Record<string, string> = {};
    for (const g of catalog) nameMap[g.id] = g.name;
    cachedApiReports = reportService.getApiCoverageReports(nameMap);
  }
  // Return a lightweight version (without full entry arrays to avoid huge payloads)
  const lightweight = cachedApiReports.map(r => ({
    gameId: r.gameId,
    gameName: r.gameName,
    totalEntries: r.totalEntries,
    apiEntries: r.apiEntries,
    staticEntries: r.staticEntries,
    uniqueEndpoints: r.uniqueEndpoints,
    methodDistribution: r.methodDistribution,
    categorySummary: r.categorySummary,
    topEndpointsByFrequency: r.topEndpointsByFrequency,
  }));
  res.json({ reports: lightweight });
});

router.get('/results/verification', (_req: Request, res: Response) => {
  if (cachedVerifications.length === 0) {
    const reportService = new ReportService();
    const catalog = loadGameCatalog();
    const nameMap: Record<string, string> = {};
    for (const g of catalog) nameMap[g.id] = g.name;
    cachedVerifications = reportService.getVerificationReports(nameMap);
  }
  // Lightweight version
  const lightweight = cachedVerifications.map(v => ({
    gameId: v.gameId,
    gameName: v.gameName,
    totalHarEntries: v.totalHarEntries,
    includedCount: v.includedCount,
    excludedCount: v.excludedCount,
    timeline: v.timeline,
    methodBreakdown: v.methodBreakdown,
    domainBreakdown: v.domainBreakdown,
  }));
  res.json({ verifications: lightweight });
});

router.get('/results/comparison', (_req: Request, res: Response) => {
  if (!cachedComparison) {
    if (cachedApiReports.length === 0 || cachedVerifications.length === 0) {
      const reportService = new ReportService();
      const catalog = loadGameCatalog();
      const nameMap: Record<string, string> = {};
      for (const g of catalog) nameMap[g.id] = g.name;
      if (cachedApiReports.length === 0) cachedApiReports = reportService.getApiCoverageReports(nameMap);
      if (cachedVerifications.length === 0) cachedVerifications = reportService.getVerificationReports(nameMap);
    }
    const reportService = new ReportService();
    cachedComparison = reportService.getComparisonData(cachedApiReports, cachedVerifications, currentSession.loadTestResults);
  }
  res.json(cachedComparison);
});

// Download PDF report
router.get('/download-report', async (_req: Request, res: Response) => {
  if (currentSession.status !== 'complete') {
    res.status(400).json({ error: 'Pipeline has not completed yet. Run the full pipeline first.' });
    return;
  }

  try {
    const pdfService = new PdfReportService();
    const harResults = currentSession.harResults as DashboardHarRecordResult[];
    const games = currentSession.games.map(g => ({
      id: g.id,
      name: g.name,
      provider: g.provider,
      category: g.category,
      features: g.features || currentSession.features,
    }));

    const pdfPath = await pdfService.generateReport(
      harResults,
      currentSession.loadTestResults,
      games
    );

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="gamepulse-report-${dateStr}.pdf"`);
    const stream = fs.createReadStream(pdfPath);
    stream.pipe(res);
    stream.on('error', () => {
      res.status(500).json({ error: 'Failed to read generated PDF' });
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to generate PDF report: ${err.message}` });
  }
});

// Reset session
router.post('/reset', (_req: Request, res: Response) => {
  resetSession();
  cachedApiReports = [];
  cachedVerifications = [];
  cachedComparison = null;
  res.json({ success: true });
});

export { router as apiRouter };
