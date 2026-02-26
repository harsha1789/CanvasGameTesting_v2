/**
 * Report Service — Orchestrates analysis from all services and returns JSON data.
 */

import * as path from 'path';
import * as fs from 'fs';
import { LoadTestResult } from '../../utils/har-load-tester';
import { LoadTestReportGenerator } from '../../utils/load-test-report-generator';
import { HarRecordResult } from '../../utils/har-recorder';
import { analyzeHarApiCoverage } from './api-categorization-service';
import { verifyHarFile } from './verification-service';
import { listHarFiles } from './har-file-service';
import { GameApiReport, GameVerification } from '../types/dashboard-types';
import { progressEmitter } from '../routes/sse-routes';

export class ReportService {
  private harDir: string;
  private reportDir: string;

  constructor(harDir?: string, reportDir?: string) {
    this.harDir = harDir || path.resolve(process.cwd(), 'har-files');
    this.reportDir = reportDir || path.resolve(process.cwd(), 'load-test-reports');
  }

  private emit(type: string, payload: any) {
    progressEmitter.emit('progress', { type, payload });
  }

  /**
   * Generate the static HTML load test report using the existing generator.
   */
  generateHtmlReport(loadTestResults: LoadTestResult[], harResults: HarRecordResult[]): string {
    this.emit('report:generating', { type: 'performance' });
    const generator = new LoadTestReportGenerator({
      outputDir: this.reportDir,
      title: 'GamePulse Load Test Report',
    });
    const reportPath = generator.generateReport(loadTestResults, harResults);
    this.emit('report:complete', { type: 'performance', success: true });
    return reportPath;
  }

  /**
   * Run API categorization analysis on all HAR files, return JSON.
   */
  getApiCoverageReports(gameNameMap?: Record<string, string>): GameApiReport[] {
    this.emit('report:generating', { type: 'api-coverage' });
    const harFiles = listHarFiles(this.harDir, gameNameMap);
    const reports: GameApiReport[] = [];

    for (const file of harFiles) {
      try {
        const report = analyzeHarApiCoverage(file.filePath, file.gameName, file.gameId);
        reports.push(report);
      } catch (err: any) {
        this.emit('log', { message: `API analysis failed for ${file.gameName}: ${err.message}`, level: 'error', timestamp: Date.now() });
      }
    }

    this.emit('report:complete', { type: 'api-coverage', success: true });
    return reports;
  }

  /**
   * Run verification analysis on all HAR files, return JSON.
   */
  getVerificationReports(gameNameMap?: Record<string, string>): GameVerification[] {
    this.emit('report:generating', { type: 'verification' });
    const harFiles = listHarFiles(this.harDir, gameNameMap);
    const verifications: GameVerification[] = [];

    for (const file of harFiles) {
      try {
        const v = verifyHarFile(file.filePath, file.gameName, file.gameId);
        verifications.push(v);
      } catch (err: any) {
        this.emit('log', { message: `Verification failed for ${file.gameName}: ${err.message}`, level: 'error', timestamp: Date.now() });
      }
    }

    this.emit('report:complete', { type: 'verification', success: true });
    return verifications;
  }

  /**
   * Build comparison data across all games.
   */
  getComparisonData(apiReports: GameApiReport[], verifications: GameVerification[], loadTestResults?: LoadTestResult[]) {
    const games = apiReports.map(report => {
      const verification = verifications.find(v => v.gameId === report.gameId);
      const loadResult = loadTestResults?.find(r => r.gameId === report.gameId);

      return {
        gameId: report.gameId,
        gameName: report.gameName,
        totalEntries: report.totalEntries,
        apiEntries: report.apiEntries,
        staticEntries: report.staticEntries,
        uniqueEndpoints: report.uniqueEndpoints,
        categories: report.categorySummary.length,
        inclusionRate: verification ? Math.round((verification.includedCount / verification.totalHarEntries) * 100) : 0,
        includedCount: verification?.includedCount || 0,
        excludedCount: verification?.excludedCount || 0,
        avgResponseTimeMs: loadResult?.avgResponseTimeMs,
        p95ResponseTimeMs: loadResult?.p95ResponseTimeMs,
        errorRate: loadResult?.errorRate,
        requestsPerSecond: loadResult?.requestsPerSecond,
        categoryBreakdown: report.categorySummary.reduce((acc, c) => {
          acc[c.category] = c.count;
          return acc;
        }, {} as Record<string, number>),
      };
    });

    // Collect all categories across all games
    const allCategories = Array.from(new Set(apiReports.flatMap(r => r.categorySummary.map(c => c.category))));

    return { games, allCategories };
  }
}
