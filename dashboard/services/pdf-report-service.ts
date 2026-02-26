/**
 * PDF Report Service
 *
 * Generates a simplified, non-expert-friendly PDF report with game screenshots.
 * Uses Playwright to render an HTML template to PDF (A4 format).
 */

import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { DashboardHarRecordResult, LoadTestResult } from '../types/dashboard-types';
import { ScreenshotService } from './screenshot-service';
import { resolveGameCategory, GameCategory } from '../../utils/gameplay-actions';

interface GameReportData {
  gameName: string;
  gameId: string;
  provider: string;
  category: GameCategory;
  screenshotLanding?: string;
  screenshotBet?: string;
  screenshotSpin?: string;
  loadResult?: LoadTestResult;
  features: string[];
}

export class PdfReportService {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir || path.resolve(process.cwd(), 'load-test-reports');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate a PDF report and return the file path.
   */
  async generateReport(
    harResults: DashboardHarRecordResult[],
    loadTestResults: LoadTestResult[],
    games: Array<{ id: string; name: string; provider?: string; category?: string; features?: any }>
  ): Promise<string> {
    const reportData = this.buildReportData(harResults, loadTestResults, games);
    const html = this.buildHtml(reportData);

    const dateStr = new Date().toISOString().slice(0, 10);
    const outputPath = path.join(this.outputDir, `gamepulse-report-${dateStr}.pdf`);

    // Use Chrome for Testing with --headless=new flag
    // (Playwright's headless shell binary crashes on this Windows setup)
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\HT67091\\AppData\\Local';
    const chromeExe = path.join(localAppData, 'ms-playwright', 'chromium-1208', 'chrome-win64', 'chrome.exe');
    console.log('[PDF] Launching Chrome for Testing at:', chromeExe);
    const browser = await chromium.launch({
      headless: false,
      executablePath: chromeExe,
      args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    console.log('[PDF] Chrome launched successfully');
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1000);
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      await context.close();
    } finally {
      await browser.close();
    }

    return outputPath;
  }

  private buildReportData(
    harResults: DashboardHarRecordResult[],
    loadTestResults: LoadTestResult[],
    games: Array<{ id: string; name: string; provider?: string; category?: string; features?: any }>
  ): GameReportData[] {
    return harResults.filter(r => r.success).map(har => {
      const gameInput = games.find(g => g.id === har.gameId);
      const loadResult = loadTestResults.find(r => r.gameId === har.gameId);
      const category = resolveGameCategory(gameInput || { category: 'slots' });

      const features: string[] = [];
      if (gameInput?.features) {
        const f = gameInput.features;
        if (f.login) features.push('Login');
        if (f.lobbyNavigation) features.push('Lobby Navigation');
        if (f.gameLaunch) features.push('Game Launch');
        // Use gameplay-aware label instead of old Bet/Spin
        if (f.gameplay !== false) {
          features.push(this.getGameplayLabel(category));
        } else {
          if (f.betAdjustment) features.push('Bet Adjustment');
          if (f.spin) features.push('Spin');
        }
      }
      if (features.length === 0) {
        features.push('Login', 'Lobby Navigation', 'Game Launch', this.getGameplayLabel(category));
      }

      return {
        gameName: har.gameName,
        gameId: har.gameId,
        provider: gameInput?.provider || 'Unknown',
        category,
        screenshotLanding: har.screenshotLanding,
        screenshotBet: har.screenshotBet,
        screenshotSpin: har.screenshotSpin,
        loadResult,
        features,
      };
    });
  }

  private getGameplayLabel(category: GameCategory): string {
    switch (category) {
      case 'slots': return 'Slot Gameplay (Bet + Spin)';
      case 'crash-games': return 'Crash Gameplay (Bet + Wait)';
      case 'table-game': return 'Table Gameplay (Deal + Actions)';
      case 'live-casino': return 'Live Casino (Stream + Bet)';
      default: return 'Gameplay';
    }
  }

  // ── Health classification helpers ──

  private getHealthColor(loadResult?: LoadTestResult): 'green' | 'yellow' | 'red' {
    if (!loadResult) return 'yellow';
    if (loadResult.errorRate > 10 || loadResult.avgResponseTimeMs > 5000) return 'red';
    if (loadResult.errorRate > 5 || loadResult.avgResponseTimeMs > 2000) return 'yellow';
    return 'green';
  }

  private getHealthLabel(color: 'green' | 'yellow' | 'red'): string {
    if (color === 'green') return 'Healthy';
    if (color === 'yellow') return 'Needs Attention';
    return 'Issues Found';
  }

  private getPassFail(loadResult?: LoadTestResult): boolean {
    if (!loadResult) return false;
    return loadResult.errorRate <= 10 && loadResult.avgResponseTimeMs <= 5000;
  }

  private getSpeedLabel(avgMs: number): string {
    if (avgMs <= 500) return 'Fast';
    if (avgMs <= 2000) return 'Normal';
    return 'Slow';
  }

  private getSpeedColor(avgMs: number): string {
    if (avgMs <= 500) return '#16a34a';
    if (avgMs <= 2000) return '#ca8a04';
    return '#dc2626';
  }

  private getTopErrorType(loadResult: LoadTestResult): string {
    const errors = loadResult.errorSummary || {};
    const entries = Object.entries(errors);
    if (entries.length === 0) return 'None';
    entries.sort((a, b) => b[1] - a[1]);
    const [type] = entries[0];
    // Simplify long error types
    if (type.length > 50) return type.slice(0, 47) + '...';
    return type;
  }

  private generateInsight(data: GameReportData): string {
    const lr = data.loadResult;
    if (!lr) return 'No load test data available for this game.';

    const lines: string[] = [];

    // Summary line
    if (lr.errorRate === 0) {
      lines.push(`${data.gameName} passed all tests with zero errors and ${Math.round(lr.avgResponseTimeMs)}ms average response time.`);
    } else if (lr.errorRate <= 5) {
      lines.push(`${data.gameName} performed well with a low error rate of ${lr.errorRate.toFixed(1)}% and ${Math.round(lr.avgResponseTimeMs)}ms average response time.`);
    } else {
      lines.push(`${data.gameName} showed a ${lr.errorRate.toFixed(1)}% error rate (${lr.failedRequests} of ${lr.totalRequests} requests failed) with ${Math.round(lr.avgResponseTimeMs)}ms average response time.`);
    }

    // Actionable recommendations
    const recommendations: string[] = [];

    // Error-based recommendations
    if (lr.errorRate > 0) {
      const errors = lr.errorSummary || {};
      const errorTypes = Object.entries(errors).sort((a, b) => b[1] - a[1]);
      for (const [type, count] of errorTypes.slice(0, 2)) {
        const statusMatch = type.match(/^(\d{3})/);
        if (statusMatch) {
          const status = parseInt(statusMatch[1]);
          if (status === 401 || status === 403) {
            recommendations.push(`Fix authentication: ${count} requests returned ${status}. Consider implementing token refresh during load tests or using session-based auth that doesn't expire mid-test.`);
          } else if (status === 429) {
            recommendations.push(`Rate limiting detected: ${count} requests returned 429. Add request throttling or increase rate limits for the tested endpoints.`);
          } else if (status >= 500) {
            recommendations.push(`Server errors: ${count} requests returned ${status}. Check server logs for the failing endpoints and consider adding retry logic or scaling backend resources.`);
          }
        }
      }
    }

    // Speed-based recommendations
    if (lr.avgResponseTimeMs > 2000) {
      recommendations.push(`Slow responses (${Math.round(lr.avgResponseTimeMs)}ms avg): Identify the slowest endpoints in the HAR file and check for database query optimization, caching opportunities, or CDN configuration.`);
    } else if (lr.avgResponseTimeMs > 500) {
      recommendations.push(`Response times are acceptable (${Math.round(lr.avgResponseTimeMs)}ms avg) but could improve. Consider adding response caching for static game assets and API results.`);
    }

    // Capacity recommendation
    if (lr.requestsPerSecond < 10) {
      recommendations.push(`Low throughput (${lr.requestsPerSecond.toFixed(1)} req/s): The API may struggle under heavy user load. Test with higher VU counts to find the breaking point.`);
    }

    // General recommendation if no specific ones
    if (recommendations.length === 0 && lr.errorRate === 0) {
      recommendations.push('All APIs performed well under test conditions. Consider increasing virtual users (VU) to find the performance ceiling.');
    }

    if (recommendations.length > 0) {
      lines.push('Recommendations: ' + recommendations.join(' '));
    }

    return lines.join(' ');
  }

  // ── HTML Generation ──

  private buildHtml(reportData: GameReportData[]): string {
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
${this.getCss()}
</style>
</head>
<body>

${this.buildCoverPage(dateStr, reportData.length)}

${reportData.map(data => this.buildGamePage(data)).join('\n')}

${this.buildSummaryPage(reportData)}

</body>
</html>`;
  }

  private buildCoverPage(dateStr: string, gameCount: number): string {
    return `
<div class="page cover-page">
  <div class="cover-content">
    <div class="cover-icon">&#9889;</div>
    <h1 class="cover-title">GamePulse<br>Load Test Report</h1>
    <div class="cover-meta">
      <p>${dateStr}</p>
      <p>${gameCount} game${gameCount !== 1 ? 's' : ''} tested</p>
    </div>
    <div class="cover-footer">Generated by GamePulse Dashboard</div>
  </div>
</div>`;
  }

  private getResultLabel(category: GameCategory): string {
    switch (category) {
      case 'slots': return 'After Spin';
      case 'crash-games': return 'After Round';
      case 'table-game': return 'After Deal';
      case 'live-casino': return 'After Betting';
      default: return 'After Gameplay';
    }
  }

  private buildGamePage(data: GameReportData): string {
    const health = this.getHealthColor(data.loadResult);
    const healthLabel = this.getHealthLabel(health);
    const pass = this.getPassFail(data.loadResult);
    const lr = data.loadResult;

    const landingImg = data.screenshotLanding ? ScreenshotService.toBase64DataUri(data.screenshotLanding) : null;
    const betImg = data.screenshotBet ? ScreenshotService.toBase64DataUri(data.screenshotBet) : null;
    const spinImg = data.screenshotSpin ? ScreenshotService.toBase64DataUri(data.screenshotSpin) : null;
    const hasScreenshots = landingImg || betImg || spinImg;
    const resultLabel = this.getResultLabel(data.category);

    // Use 2-column layout when bet screenshot is absent (unified gameplay mode)
    const hasBetScreenshot = !!betImg;

    return `
<div class="page game-page">
  <div class="game-header">
    <h2 class="game-title">${this.esc(data.gameName)}</h2>
    <span class="provider-tag">${this.esc(data.provider)}</span>
    <span class="category-tag">${this.esc(this.getGameplayLabel(data.category))}</span>
  </div>

  ${hasScreenshots ? `
  <div class="screenshots-row${hasBetScreenshot ? '' : ' screenshots-two'}">
    <div class="screenshot-box">
      <div class="screenshot-label">Game Loaded</div>
      ${landingImg ? `<img src="${landingImg}" class="screenshot-img" />` : '<div class="screenshot-placeholder">No screenshot</div>'}
    </div>
    ${hasBetScreenshot ? `
    <div class="screenshot-box">
      <div class="screenshot-label">Before ${resultLabel.replace('After ', '')}</div>
      <img src="${betImg}" class="screenshot-img" />
    </div>` : ''}
    <div class="screenshot-box">
      <div class="screenshot-label">${resultLabel}</div>
      ${spinImg ? `<img src="${spinImg}" class="screenshot-img" />` : '<div class="screenshot-placeholder">No screenshot</div>'}
    </div>
  </div>` : ''}

  <div class="health-banner health-${health}">
    <span class="health-dot health-dot-${health}"></span>
    <span class="health-text">Overall Health: <strong>${healthLabel}</strong></span>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Test Result</div>
      <div class="metric-value">
        <span class="badge ${pass ? 'badge-pass' : 'badge-fail'}">${pass ? 'PASS' : 'FAIL'}</span>
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Speed</div>
      <div class="metric-value" style="color: ${lr ? this.getSpeedColor(lr.avgResponseTimeMs) : '#6b7280'}">
        ${lr ? `${this.getSpeedLabel(lr.avgResponseTimeMs)} (${Math.round(lr.avgResponseTimeMs)}ms avg)` : 'N/A'}
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Success Rate</div>
      <div class="metric-value">
        ${lr ? `
          <div class="success-bar-container">
            <div class="success-bar" style="width: ${((lr.successfulRequests / lr.totalRequests) * 100).toFixed(1)}%; background: ${lr.errorRate <= 5 ? '#16a34a' : lr.errorRate <= 10 ? '#ca8a04' : '#dc2626'}"></div>
          </div>
          <span>${((lr.successfulRequests / lr.totalRequests) * 100).toFixed(1)}% of requests succeeded</span>
        ` : 'N/A'}
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Capacity</div>
      <div class="metric-value">
        ${lr ? `Can handle <strong>${lr.requestsPerSecond.toFixed(1)}</strong> requests per second` : 'N/A'}
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Errors Found</div>
      <div class="metric-value" style="color: ${lr && lr.failedRequests > 0 ? '#dc2626' : '#16a34a'}">
        ${lr ? `${lr.failedRequests} error${lr.failedRequests !== 1 ? 's' : ''}${lr.failedRequests > 0 ? ' &mdash; ' + this.esc(this.getTopErrorType(lr)) : ''}` : 'N/A'}
      </div>
    </div>
  </div>

  <div class="features-tested">
    <div class="section-label">What Was Tested</div>
    <div class="feature-chips">
      ${data.features.map(f => `<span class="feature-chip">${this.esc(f)}</span>`).join('')}
    </div>
  </div>

  <div class="insight-box">
    <div class="section-label">Key Finding</div>
    <p class="insight-text">${this.esc(this.generateInsight(data))}</p>
  </div>
</div>`;
  }

  private buildSummaryPage(reportData: GameReportData[]): string {
    if (reportData.length === 0) return '';

    const rows = reportData.map(data => {
      const lr = data.loadResult;
      const pass = this.getPassFail(lr);
      const health = this.getHealthColor(lr);
      return `
      <tr>
        <td class="cell-name">${this.esc(data.gameName)}</td>
        <td class="cell-provider">${this.esc(data.provider)}</td>
        <td class="cell-center"><span class="badge ${pass ? 'badge-pass' : 'badge-fail'}">${pass ? 'PASS' : 'FAIL'}</span></td>
        <td class="cell-center"><span class="health-dot-inline health-dot-${health}"></span>${this.getHealthLabel(health)}</td>
        <td class="cell-right">${lr ? Math.round(lr.avgResponseTimeMs) + 'ms' : '-'}</td>
        <td class="cell-right">${lr ? lr.errorRate.toFixed(1) + '%' : '-'}</td>
        <td class="cell-right">${lr ? lr.requestsPerSecond.toFixed(1) : '-'}</td>
      </tr>`;
    }).join('');

    return `
<div class="page summary-page">
  <h2 class="summary-title">Summary — All Games</h2>
  <table class="summary-table">
    <thead>
      <tr>
        <th>Game</th>
        <th>Provider</th>
        <th>Result</th>
        <th>Health</th>
        <th>Avg Speed</th>
        <th>Error Rate</th>
        <th>Capacity</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── CSS ──

  private getCss(): string {
    return `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #fff; }

.page {
  page-break-after: always;
  padding: 20px 0;
  min-height: 100%;
}
.page:last-child { page-break-after: avoid; }

/* ── Cover Page ── */
.cover-page {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.cover-content { padding: 40px; }
.cover-icon { font-size: 64px; margin-bottom: 20px; }
.cover-title { font-size: 36px; font-weight: 800; color: #0f172a; line-height: 1.2; margin-bottom: 24px; }
.cover-meta { font-size: 18px; color: #475569; line-height: 1.8; }
.cover-footer { margin-top: 60px; font-size: 12px; color: #94a3b8; }

/* ── Game Page ── */
.game-page { padding: 10px 0; }
.game-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
.game-title { font-size: 22px; font-weight: 700; color: #0f172a; }
.provider-tag { font-size: 12px; background: #e2e8f0; color: #475569; padding: 2px 10px; border-radius: 12px; }
.category-tag { font-size: 11px; background: #eff6ff; color: #1d4ed8; padding: 2px 10px; border-radius: 12px; }

/* ── Screenshots ── */
.screenshots-row { display: flex; gap: 8px; margin-bottom: 14px; }
.screenshots-two .screenshot-box { flex: 1; max-width: 50%; }
.screenshot-box { flex: 1; text-align: center; }
.screenshot-label { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.screenshot-img { width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 6px; max-height: 160px; object-fit: contain; background: #f8fafc; }
.screenshot-placeholder { height: 100px; background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 11px; }

/* ── Health Banner ── */
.health-banner { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 8px; margin-bottom: 14px; font-size: 15px; }
.health-green { background: #f0fdf4; border: 1px solid #bbf7d0; }
.health-yellow { background: #fefce8; border: 1px solid #fef08a; }
.health-red { background: #fef2f2; border: 1px solid #fecaca; }
.health-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.health-dot-green { background: #16a34a; }
.health-dot-yellow { background: #ca8a04; }
.health-dot-red { background: #dc2626; }

/* ── Metrics Grid ── */
.metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
.metric-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
.metric-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.metric-value { font-size: 14px; color: #1e293b; }

.badge { display: inline-block; padding: 2px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-pass { background: #dcfce7; color: #15803d; }
.badge-fail { background: #fee2e2; color: #b91c1c; }

.success-bar-container { width: 100%; height: 8px; background: #fee2e2; border-radius: 4px; margin-bottom: 4px; }
.success-bar { height: 100%; border-radius: 4px; }

/* ── Features ── */
.features-tested { margin-bottom: 12px; }
.section-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.feature-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.feature-chip { background: #eff6ff; color: #1d4ed8; padding: 3px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; }

/* ── Insight ── */
.insight-box { background: #f8fafc; border-left: 3px solid #3b82f6; padding: 10px 14px; border-radius: 0 8px 8px 0; }
.insight-text { font-size: 13px; color: #334155; line-height: 1.5; }

/* ── Summary Page ── */
.summary-page { padding: 10px 0; }
.summary-title { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
.summary-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.summary-table th { background: #f1f5f9; color: #475569; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; }
.summary-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
.cell-name { font-weight: 600; color: #0f172a; }
.cell-provider { color: #64748b; }
.cell-center { text-align: center; }
.cell-right { text-align: right; font-variant-numeric: tabular-nums; }
.health-dot-inline { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; vertical-align: middle; }
`;
  }
}
