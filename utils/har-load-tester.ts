import * as fs from 'fs';
import axios, { AxiosRequestConfig } from 'axios';

/**
 * A single entry from a HAR file
 */
export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    postData?: {
      mimeType: string;
      text: string;
    };
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
    };
  };
}

/**
 * Configuration for load testing
 */
export interface LoadTestConfig {
  virtualUsers: number;
  iterations: number;
  rampUpSeconds: number;
  thinkTimeMs: number;
  timeoutMs: number;
  includeStaticAssets: boolean;
}

/**
 * Metrics collected for each HTTP request during load test
 */
export interface RequestMetric {
  url: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
  virtualUserId: number;
  iteration: number;
  contentLength: number;
}

/**
 * Aggregated load test result for a single game
 */
export interface LoadTestResult {
  gameName: string;
  gameId: string;
  harFilePath: string;
  config: LoadTestConfig;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  medianResponseTimeMs: number;
  p90ResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  requestsPerSecond: number;
  totalDurationSec: number;
  errorRate: number;
  throughputKBps: number;
  statusCodeDistribution: Record<string, number>;
  topSlowestRequests: Array<{ url: string; method: string; responseTimeMs: number }>;
  errorSummary: Record<string, number>;
  metrics: RequestMetric[];
  startTime: number;
  endTime: number;
  harTotalEntries: number;
  harFilteredEntries: number;
}

// Extensions to skip when filtering out static assets
const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
];

// Headers to skip when replaying requests
const SKIP_HEADERS = new Set([
  'host', 'content-length', 'connection', 'accept-encoding',
  'transfer-encoding', 'upgrade', 'sec-websocket-key',
  'sec-websocket-version', 'sec-websocket-extensions',
]);

/**
 * HarLoadTester - Parses HAR files and replays API requests concurrently to perform load testing.
 *
 * Supports configurable virtual users, iterations, ramp-up, and think time.
 * Collects detailed per-request metrics and produces aggregated results.
 */
export class HarLoadTester {
  private defaultConfig: LoadTestConfig = {
    virtualUsers: 5,
    iterations: 2,
    rampUpSeconds: 5,
    thinkTimeMs: 500,
    timeoutMs: 30000,
    includeStaticAssets: false,
  };

  /**
   * Parse a HAR file and return its entries.
   */
  parseHarFile(harFilePath: string): HarEntry[] {
    if (!fs.existsSync(harFilePath)) {
      console.warn(`HAR file not found: ${harFilePath}`);
      return [];
    }

    const content = fs.readFileSync(harFilePath, 'utf-8');
    const har = JSON.parse(content);
    return har.log?.entries || [];
  }

  /**
   * Filter HAR entries to keep only API/dynamic requests (skip static assets).
   */
  filterApiRequests(entries: HarEntry[], includeStaticAssets: boolean): HarEntry[] {
    if (includeStaticAssets) return entries;

    return entries.filter(entry => {
      const url = entry.request.url.toLowerCase();

      // Skip data URIs
      if (url.startsWith('data:')) return false;

      // Skip blob URLs
      if (url.startsWith('blob:')) return false;

      // Skip WebSocket upgrade requests
      if (url.startsWith('wss:') || url.startsWith('ws:')) return false;

      // Skip static file extensions
      const urlPath = url.split('?')[0];
      if (STATIC_EXTENSIONS.some(ext => urlPath.endsWith(ext))) return false;

      // Skip common CDN/asset patterns
      if (url.includes('/assets/') && !url.includes('/api/')) return false;
      if (url.includes('/static/') && !url.includes('/api/')) return false;
      if (url.includes('cdn.') || url.includes('.cdn.')) return false;

      return true;
    });
  }

  /**
   * Execute a single HTTP request and collect metrics.
   */
  private async executeRequest(
    entry: HarEntry,
    config: LoadTestConfig,
    virtualUserId: number,
    iteration: number
  ): Promise<RequestMetric> {
    const startTime = Date.now();

    try {
      // Build headers, skipping problematic ones
      const headers: Record<string, string> = {};
      for (const h of entry.request.headers) {
        if (h.name.startsWith(':')) continue; // Skip HTTP/2 pseudo-headers
        if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
        headers[h.name] = h.value;
      }

      const requestConfig: AxiosRequestConfig = {
        method: entry.request.method.toLowerCase() as any,
        url: entry.request.url,
        headers,
        timeout: config.timeoutMs,
        validateStatus: () => true, // Accept all status codes
        maxRedirects: 5,
      };

      // Include POST/PUT body if present
      if (entry.request.postData?.text) {
        requestConfig.data = entry.request.postData.text;
        if (entry.request.postData.mimeType) {
          headers['Content-Type'] = entry.request.postData.mimeType;
        }
      }

      const response = await axios(requestConfig);
      const responseTimeMs = Date.now() - startTime;

      const contentLength = response.headers['content-length']
        ? parseInt(response.headers['content-length'], 10)
        : (typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data || '').length);

      return {
        url: entry.request.url,
        method: entry.request.method,
        statusCode: response.status,
        responseTimeMs,
        success: response.status >= 200 && response.status < 400,
        timestamp: startTime,
        virtualUserId,
        iteration,
        contentLength: contentLength || 0,
      };
    } catch (error: any) {
      const responseTimeMs = Date.now() - startTime;
      return {
        url: entry.request.url,
        method: entry.request.method,
        statusCode: 0,
        responseTimeMs,
        success: false,
        error: error.code || error.message,
        timestamp: startTime,
        virtualUserId,
        iteration,
        contentLength: 0,
      };
    }
  }

  /**
   * Simulate a single virtual user replaying all HAR entries for N iterations.
   */
  private async runVirtualUser(
    entries: HarEntry[],
    config: LoadTestConfig,
    userId: number
  ): Promise<RequestMetric[]> {
    const metrics: RequestMetric[] = [];

    for (let iter = 0; iter < config.iterations; iter++) {
      for (const entry of entries) {
        const metric = await this.executeRequest(entry, config, userId, iter);
        metrics.push(metric);

        // Think time between requests
        if (config.thinkTimeMs > 0) {
          await new Promise(resolve => setTimeout(resolve, config.thinkTimeMs));
        }
      }
    }

    return metrics;
  }

  /**
   * Run load test for a single game using its HAR file.
   */
  async runLoadTest(
    gameName: string,
    gameId: string,
    harFilePath: string,
    config?: Partial<LoadTestConfig>
  ): Promise<LoadTestResult> {
    const testConfig: LoadTestConfig = { ...this.defaultConfig, ...config };

    console.log(`\n========================================`);
    console.log(`Load Test: ${gameName}`);
    console.log(`========================================`);
    console.log(`  Virtual Users: ${testConfig.virtualUsers}`);
    console.log(`  Iterations per user: ${testConfig.iterations}`);
    console.log(`  Ramp-up: ${testConfig.rampUpSeconds}s`);
    console.log(`  Think time: ${testConfig.thinkTimeMs}ms`);

    // Parse HAR
    const allEntries = this.parseHarFile(harFilePath);
    const filteredEntries = this.filterApiRequests(allEntries, testConfig.includeStaticAssets);

    console.log(`  HAR total entries: ${allEntries.length}`);
    console.log(`  Filtered API entries: ${filteredEntries.length}`);

    if (filteredEntries.length === 0) {
      console.warn('  No API entries found after filtering. Returning empty result.');
      return this.buildEmptyResult(gameName, gameId, harFilePath, testConfig, allEntries.length);
    }

    const startTime = Date.now();
    const allMetrics: RequestMetric[] = [];

    // Calculate delay between each virtual user starting (ramp-up)
    const delayBetweenUsersMs = testConfig.virtualUsers > 1
      ? (testConfig.rampUpSeconds * 1000) / (testConfig.virtualUsers - 1)
      : 0;

    // Launch all virtual users with ramp-up delays
    const userPromises: Promise<RequestMetric[]>[] = [];

    for (let i = 0; i < testConfig.virtualUsers; i++) {
      const delay = i * delayBetweenUsersMs;

      const userPromise = (async () => {
        if (delay > 0) {
          await new Promise(r => setTimeout(r, delay));
        }
        console.log(`  [VU ${i + 1}/${testConfig.virtualUsers}] Started`);
        const metrics = await this.runVirtualUser(filteredEntries, testConfig, i);
        console.log(`  [VU ${i + 1}/${testConfig.virtualUsers}] Completed (${metrics.length} requests)`);
        return metrics;
      })();

      userPromises.push(userPromise);
    }

    // Wait for all virtual users to finish
    const userResults = await Promise.all(userPromises);
    for (const metrics of userResults) {
      allMetrics.push(...metrics);
    }

    const endTime = Date.now();

    // Build and return result
    const result = this.buildResult(
      gameName, gameId, harFilePath, testConfig,
      allMetrics, startTime, endTime,
      allEntries.length, filteredEntries.length
    );

    this.printResultSummary(result);

    return result;
  }

  /**
   * Build aggregated result from collected metrics.
   */
  private buildResult(
    gameName: string,
    gameId: string,
    harFilePath: string,
    config: LoadTestConfig,
    metrics: RequestMetric[],
    startTime: number,
    endTime: number,
    harTotalEntries: number,
    harFilteredEntries: number
  ): LoadTestResult {
    const responseTimes = metrics.map(m => m.responseTimeMs).sort((a, b) => a - b);
    const successCount = metrics.filter(m => m.success).length;
    const totalDurationSec = (endTime - startTime) / 1000;
    const totalBytes = metrics.reduce((sum, m) => sum + m.contentLength, 0);

    // Status code distribution
    const statusDist: Record<string, number> = {};
    for (const m of metrics) {
      const key = String(m.statusCode);
      statusDist[key] = (statusDist[key] || 0) + 1;
    }

    // Error summary
    const errorSummary: Record<string, number> = {};
    for (const m of metrics) {
      if (!m.success && m.error) {
        errorSummary[m.error] = (errorSummary[m.error] || 0) + 1;
      }
    }

    // Top 10 slowest requests
    const topSlowest = [...metrics]
      .sort((a, b) => b.responseTimeMs - a.responseTimeMs)
      .slice(0, 10)
      .map(m => ({ url: m.url, method: m.method, responseTimeMs: m.responseTimeMs }));

    return {
      gameName,
      gameId,
      harFilePath,
      config,
      totalRequests: metrics.length,
      successfulRequests: successCount,
      failedRequests: metrics.length - successCount,
      avgResponseTimeMs: responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0,
      minResponseTimeMs: responseTimes.length > 0 ? responseTimes[0] : 0,
      maxResponseTimeMs: responseTimes.length > 0 ? responseTimes[responseTimes.length - 1] : 0,
      medianResponseTimeMs: this.percentile(responseTimes, 50),
      p90ResponseTimeMs: this.percentile(responseTimes, 90),
      p95ResponseTimeMs: this.percentile(responseTimes, 95),
      p99ResponseTimeMs: this.percentile(responseTimes, 99),
      requestsPerSecond: totalDurationSec > 0
        ? Math.round((metrics.length / totalDurationSec) * 100) / 100
        : 0,
      totalDurationSec: Math.round(totalDurationSec * 100) / 100,
      errorRate: metrics.length > 0
        ? Math.round(((metrics.length - successCount) / metrics.length) * 10000) / 100
        : 0,
      throughputKBps: totalDurationSec > 0
        ? Math.round((totalBytes / 1024 / totalDurationSec) * 100) / 100
        : 0,
      statusCodeDistribution: statusDist,
      topSlowestRequests: topSlowest,
      errorSummary,
      metrics,
      startTime,
      endTime,
      harTotalEntries,
      harFilteredEntries,
    };
  }

  /**
   * Build an empty result when no entries are available.
   */
  private buildEmptyResult(
    gameName: string,
    gameId: string,
    harFilePath: string,
    config: LoadTestConfig,
    harTotalEntries: number
  ): LoadTestResult {
    const now = Date.now();
    return {
      gameName, gameId, harFilePath, config,
      totalRequests: 0, successfulRequests: 0, failedRequests: 0,
      avgResponseTimeMs: 0, minResponseTimeMs: 0, maxResponseTimeMs: 0,
      medianResponseTimeMs: 0, p90ResponseTimeMs: 0, p95ResponseTimeMs: 0, p99ResponseTimeMs: 0,
      requestsPerSecond: 0, totalDurationSec: 0, errorRate: 0, throughputKBps: 0,
      statusCodeDistribution: {}, topSlowestRequests: [], errorSummary: {},
      metrics: [], startTime: now, endTime: now,
      harTotalEntries, harFilteredEntries: 0,
    };
  }

  /**
   * Calculate a percentile value from a sorted array.
   */
  private percentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, index)];
  }

  /**
   * Print a summary of load test results to console.
   */
  private printResultSummary(result: LoadTestResult): void {
    console.log(`\n  --- Results for ${result.gameName} ---`);
    console.log(`  Total Requests:    ${result.totalRequests}`);
    console.log(`  Successful:        ${result.successfulRequests}`);
    console.log(`  Failed:            ${result.failedRequests}`);
    console.log(`  Error Rate:        ${result.errorRate}%`);
    console.log(`  Avg Response:      ${result.avgResponseTimeMs}ms`);
    console.log(`  Median Response:   ${result.medianResponseTimeMs}ms`);
    console.log(`  P90 Response:      ${result.p90ResponseTimeMs}ms`);
    console.log(`  P95 Response:      ${result.p95ResponseTimeMs}ms`);
    console.log(`  P99 Response:      ${result.p99ResponseTimeMs}ms`);
    console.log(`  Min Response:      ${result.minResponseTimeMs}ms`);
    console.log(`  Max Response:      ${result.maxResponseTimeMs}ms`);
    console.log(`  Requests/sec:      ${result.requestsPerSecond}`);
    console.log(`  Throughput:        ${result.throughputKBps} KB/s`);
    console.log(`  Total Duration:    ${result.totalDurationSec}s`);

    if (Object.keys(result.statusCodeDistribution).length > 0) {
      console.log(`  Status Codes:`);
      for (const [code, count] of Object.entries(result.statusCodeDistribution)) {
        console.log(`    ${code}: ${count}`);
      }
    }

    if (Object.keys(result.errorSummary).length > 0) {
      console.log(`  Errors:`);
      for (const [err, count] of Object.entries(result.errorSummary)) {
        console.log(`    ${err}: ${count}`);
      }
    }
  }
}
