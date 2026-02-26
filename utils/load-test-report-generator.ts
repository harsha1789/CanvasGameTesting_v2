import * as fs from 'fs';
import * as path from 'path';
import { LoadTestResult } from './har-load-tester';
import { HarRecordResult } from './har-recorder';

/**
 * Report configuration
 */
export interface ReportConfig {
  outputDir: string;
  title: string;
}

/**
 * LoadTestReportGenerator - Generates an HTML report from load test results.
 *
 * Produces a self-contained HTML file with:
 * - Overall summary across all games
 * - Per-game detailed metrics
 * - Status code distributions
 * - Error summaries
 * - Top slowest requests
 */
export class LoadTestReportGenerator {
  private config: ReportConfig;

  constructor(config?: Partial<ReportConfig>) {
    this.config = {
      outputDir: 'load-test-reports',
      title: 'Betway Game Load Test Report',
      ...config,
    };
  }

  /**
   * Generate the HTML report file.
   * Returns the path to the generated report.
   */
  generateReport(
    loadTestResults: LoadTestResult[],
    harRecordResults: HarRecordResult[]
  ): string {
    const outputDir = path.resolve(process.cwd(), this.config.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(outputDir, `load-test-report-${timestamp}.html`);

    const html = this.buildHtml(loadTestResults, harRecordResults);
    fs.writeFileSync(reportPath, html, 'utf-8');

    console.log(`\nReport generated: ${reportPath}`);
    return reportPath;
  }

  /**
   * Build full HTML content for the report.
   */
  private buildHtml(
    results: LoadTestResult[],
    harResults: HarRecordResult[]
  ): string {
    const overallSummary = this.computeOverallSummary(results);
    const generatedAt = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.config.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px; border-radius: 12px; margin-bottom: 24px; }
    header h1 { font-size: 28px; color: #f8fafc; margin-bottom: 8px; }
    header p { color: #94a3b8; font-size: 14px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .summary-card { background: #1e293b; border-radius: 10px; padding: 20px; border: 1px solid #334155; }
    .summary-card .label { font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 4px; }
    .summary-card .value { font-size: 28px; font-weight: 700; color: #f8fafc; }
    .summary-card .value.success { color: #22c55e; }
    .summary-card .value.danger { color: #ef4444; }
    .summary-card .value.warning { color: #f59e0b; }
    .summary-card .value.info { color: #3b82f6; }
    .section { background: #1e293b; border-radius: 10px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
    .section h2 { font-size: 20px; color: #f8fafc; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #334155; }
    .section h3 { font-size: 16px; color: #cbd5e1; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    table th { background: #334155; color: #e2e8f0; padding: 10px 14px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    table td { padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 14px; }
    table tr:hover { background: #334155; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge.success { background: #166534; color: #86efac; }
    .badge.fail { background: #7f1d1d; color: #fca5a5; }
    .badge.warning { background: #78350f; color: #fcd34d; }
    .game-section { margin-bottom: 20px; padding: 20px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; }
    .game-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .game-header h3 { margin: 0; font-size: 18px; color: #f8fafc; }
    .metrics-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric { background: #1e293b; padding: 12px; border-radius: 6px; }
    .metric .metric-label { font-size: 11px; text-transform: uppercase; color: #64748b; }
    .metric .metric-value { font-size: 20px; font-weight: 600; color: #f8fafc; }
    .status-dist { display: flex; gap: 8px; flex-wrap: wrap; }
    .status-chip { padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; }
    .status-chip.s2xx { background: #166534; color: #86efac; }
    .status-chip.s3xx { background: #1e3a5f; color: #93c5fd; }
    .status-chip.s4xx { background: #78350f; color: #fcd34d; }
    .status-chip.s5xx { background: #7f1d1d; color: #fca5a5; }
    .status-chip.s0 { background: #3f3f46; color: #a1a1aa; }
    .har-summary { margin-top: 12px; }
    .url-cell { max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 12px; }
    footer { text-align: center; padding: 20px; color: #475569; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${this.config.title}</h1>
      <p>Generated: ${generatedAt} | Games Tested: ${results.length} | Total Requests: ${overallSummary.totalRequests}</p>
    </header>

    <!-- Overall Summary Cards -->
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Games Tested</div>
        <div class="value info">${results.length}</div>
      </div>
      <div class="summary-card">
        <div class="label">Total Requests</div>
        <div class="value">${overallSummary.totalRequests.toLocaleString()}</div>
      </div>
      <div class="summary-card">
        <div class="label">Successful</div>
        <div class="value success">${overallSummary.successfulRequests.toLocaleString()}</div>
      </div>
      <div class="summary-card">
        <div class="label">Failed</div>
        <div class="value danger">${overallSummary.failedRequests.toLocaleString()}</div>
      </div>
      <div class="summary-card">
        <div class="label">Avg Response Time</div>
        <div class="value">${overallSummary.avgResponseTimeMs}ms</div>
      </div>
      <div class="summary-card">
        <div class="label">P95 Response Time</div>
        <div class="value warning">${overallSummary.p95ResponseTimeMs}ms</div>
      </div>
      <div class="summary-card">
        <div class="label">Overall Error Rate</div>
        <div class="value ${overallSummary.overallErrorRate > 10 ? 'danger' : overallSummary.overallErrorRate > 5 ? 'warning' : 'success'}">${overallSummary.overallErrorRate}%</div>
      </div>
      <div class="summary-card">
        <div class="label">Total Duration</div>
        <div class="value info">${overallSummary.totalDurationSec}s</div>
      </div>
    </div>

    <!-- HAR Recording Summary -->
    <div class="section">
      <h2>HAR Recording Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Game</th>
            <th>Provider</th>
            <th>Status</th>
            <th>HAR Entries</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${harResults.map(r => `
          <tr>
            <td>${r.gameName}</td>
            <td>-</td>
            <td><span class="badge ${r.success ? 'success' : 'fail'}">${r.success ? 'OK' : 'FAIL'}</span></td>
            <td>${r.totalEntries}</td>
            <td>${(r.durationMs / 1000).toFixed(1)}s</td>
            <td style="color:#ef4444;">${r.error || '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <!-- Games Comparison Table -->
    <div class="section">
      <h2>Load Test Comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Game</th>
            <th>Requests</th>
            <th>Success</th>
            <th>Failed</th>
            <th>Error Rate</th>
            <th>Avg (ms)</th>
            <th>Median (ms)</th>
            <th>P95 (ms)</th>
            <th>Max (ms)</th>
            <th>Req/s</th>
            <th>Throughput</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => `
          <tr>
            <td><strong>${r.gameName}</strong></td>
            <td>${r.totalRequests}</td>
            <td style="color:#22c55e;">${r.successfulRequests}</td>
            <td style="color:#ef4444;">${r.failedRequests}</td>
            <td><span class="badge ${r.errorRate > 10 ? 'fail' : r.errorRate > 5 ? 'warning' : 'success'}">${r.errorRate}%</span></td>
            <td>${r.avgResponseTimeMs}</td>
            <td>${r.medianResponseTimeMs}</td>
            <td>${r.p95ResponseTimeMs}</td>
            <td>${r.maxResponseTimeMs}</td>
            <td>${r.requestsPerSecond}</td>
            <td>${r.throughputKBps} KB/s</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <!-- Per-Game Detailed Results -->
    ${results.map(r => this.buildGameDetailSection(r)).join('')}

    <footer>
      Betway Automation Framework - Load Test Report | Powered by Playwright + Axios
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * Build the detailed section for a single game's results.
   */
  private buildGameDetailSection(result: LoadTestResult): string {
    const statusChips = Object.entries(result.statusCodeDistribution)
      .map(([code, count]) => {
        const cls = code.startsWith('2') ? 's2xx'
          : code.startsWith('3') ? 's3xx'
          : code.startsWith('4') ? 's4xx'
          : code.startsWith('5') ? 's5xx'
          : 's0';
        return `<span class="status-chip ${cls}">${code}: ${count}</span>`;
      }).join('');

    const errorRows = Object.entries(result.errorSummary)
      .map(([err, count]) => `<tr><td style="color:#fca5a5;">${this.escapeHtml(err)}</td><td>${count}</td></tr>`)
      .join('');

    const slowestRows = result.topSlowestRequests
      .slice(0, 5)
      .map(r => `<tr><td>${r.method}</td><td class="url-cell" title="${this.escapeHtml(r.url)}">${this.escapeHtml(this.truncateUrl(r.url))}</td><td>${r.responseTimeMs}ms</td></tr>`)
      .join('');

    return `
    <div class="section">
      <div class="game-header">
        <h2>${result.gameName}</h2>
        <span class="badge ${result.errorRate > 10 ? 'fail' : result.errorRate > 5 ? 'warning' : 'success'}">
          Error Rate: ${result.errorRate}%
        </span>
      </div>

      <div class="metrics-row">
        <div class="metric">
          <div class="metric-label">Total Requests</div>
          <div class="metric-value">${result.totalRequests}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Avg Response</div>
          <div class="metric-value">${result.avgResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">Median</div>
          <div class="metric-value">${result.medianResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">P90</div>
          <div class="metric-value">${result.p90ResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">P95</div>
          <div class="metric-value">${result.p95ResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">P99</div>
          <div class="metric-value">${result.p99ResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">Min</div>
          <div class="metric-value">${result.minResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">Max</div>
          <div class="metric-value">${result.maxResponseTimeMs}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">Req/s</div>
          <div class="metric-value">${result.requestsPerSecond}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Throughput</div>
          <div class="metric-value">${result.throughputKBps} KB/s</div>
        </div>
      </div>

      <h3>Status Code Distribution</h3>
      <div class="status-dist" style="margin-bottom:16px;">
        ${statusChips || '<span style="color:#64748b;">No requests</span>'}
      </div>

      ${errorRows ? `
      <h3>Error Summary</h3>
      <table>
        <thead><tr><th>Error</th><th>Count</th></tr></thead>
        <tbody>${errorRows}</tbody>
      </table>` : ''}

      ${slowestRows ? `
      <h3>Top 5 Slowest Requests</h3>
      <table>
        <thead><tr><th>Method</th><th>URL</th><th>Response Time</th></tr></thead>
        <tbody>${slowestRows}</tbody>
      </table>` : ''}

      <p style="color:#64748b; font-size:12px; margin-top:12px;">
        HAR file: ${result.harFilePath} | HAR entries: ${result.harTotalEntries} total, ${result.harFilteredEntries} filtered |
        VUs: ${result.config.virtualUsers} | Iterations: ${result.config.iterations} | Duration: ${result.totalDurationSec}s
      </p>
    </div>`;
  }

  /**
   * Compute overall summary across all game results.
   */
  private computeOverallSummary(results: LoadTestResult[]): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgResponseTimeMs: number;
    p95ResponseTimeMs: number;
    overallErrorRate: number;
    totalDurationSec: number;
  } {
    if (results.length === 0) {
      return {
        totalRequests: 0, successfulRequests: 0, failedRequests: 0,
        avgResponseTimeMs: 0, p95ResponseTimeMs: 0, overallErrorRate: 0, totalDurationSec: 0,
      };
    }

    const totalRequests = results.reduce((s, r) => s + r.totalRequests, 0);
    const successfulRequests = results.reduce((s, r) => s + r.successfulRequests, 0);
    const failedRequests = results.reduce((s, r) => s + r.failedRequests, 0);
    const totalDurationSec = Math.round(results.reduce((s, r) => s + r.totalDurationSec, 0) * 100) / 100;

    // Compute overall avg from all metrics
    const allResponseTimes = results.flatMap(r => r.metrics.map(m => m.responseTimeMs));
    allResponseTimes.sort((a, b) => a - b);

    const avgResponseTimeMs = allResponseTimes.length > 0
      ? Math.round(allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length)
      : 0;

    const p95Index = Math.ceil(0.95 * allResponseTimes.length) - 1;
    const p95ResponseTimeMs = allResponseTimes.length > 0
      ? allResponseTimes[Math.max(0, p95Index)]
      : 0;

    const overallErrorRate = totalRequests > 0
      ? Math.round((failedRequests / totalRequests) * 10000) / 100
      : 0;

    return {
      totalRequests, successfulRequests, failedRequests,
      avgResponseTimeMs, p95ResponseTimeMs, overallErrorRate, totalDurationSec,
    };
  }

  /**
   * Escape HTML special characters.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Truncate a URL for display purposes.
   */
  private truncateUrl(url: string): string {
    if (url.length <= 80) return url;
    try {
      const parsed = new URL(url);
      const pathPart = parsed.pathname + (parsed.search ? '?' + parsed.search.slice(0, 20) + '...' : '');
      return parsed.origin + (pathPart.length > 60 ? pathPart.slice(0, 60) + '...' : pathPart);
    } catch {
      return url.slice(0, 80) + '...';
    }
  }
}
