/**
 * GamePulse Dashboard Server
 *
 * Express server that serves the interactive dashboard UI and provides
 * REST API endpoints for HAR recording, load testing, and report generation.
 *
 * Usage: npm run dashboard
 * Opens at: http://localhost:4000
 */

import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { apiRouter } from './routes/api-routes';
import { sseRouter } from './routes/sse-routes';
import { pipelineRouter } from './routes/pipeline-routes';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '4000', 10);
const publicDir = path.join(__dirname, 'public');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes (must be before static to take priority)
// Pipeline routes first (more specific path before less specific)
app.use('/api/pipeline', pipelineRouter);
app.use('/api', apiRouter);
app.use('/api', sseRouter);

// Serve static frontend files (index.html, css, js)
app.use(express.static(publicDir));

// Serve Playwright test report at /test-report
const playwrightReportDir = path.join(__dirname, '..', 'playwright-report');
app.use('/test-report', express.static(playwrightReportDir));

// Serve pipeline validation screenshots at /test-report/pipeline
const pipelineReportDir = path.join(__dirname, '..', 'reports', 'pipeline-validation');
app.use('/test-report/pipeline', express.static(pipelineReportDir));

// Fallback: serve index.html for GET requests, 404 JSON for others
app.use((req, res) => {
  if (req.method === 'GET') {
    res.sendFile(path.join(publicDir, 'index.html'));
  } else {
    res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  GamePulse Dashboard`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`${'='.repeat(60)}\n`);

  // Open browser (fire-and-forget, detached)
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', `http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [`http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [`http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* ignore if browser cannot be opened */ }
});

// Keep the server reference alive
server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the existing process or use DASHBOARD_PORT env var.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// Graceful shutdown (only on explicit Ctrl+C)
process.on('SIGINT', () => {
  console.log('\nShutting down GamePulse dashboard...');
  server.close(() => process.exit(0));
});
