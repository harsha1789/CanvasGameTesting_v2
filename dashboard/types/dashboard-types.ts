/**
 * Shared types for the GamePulse dashboard.
 */

import { HarRecordResult } from '../../utils/har-recorder';
import { LoadTestResult, LoadTestConfig } from '../../utils/har-load-tester';

// Re-export base types for convenience
export { HarRecordResult, LoadTestResult, LoadTestConfig };

// ── Extended HAR result with screenshot paths ──

export interface DashboardHarRecordResult extends HarRecordResult {
  screenshotLanding?: string;
  screenshotBet?: string;
  screenshotSpin?: string;
}

// ── Feature flags for selective recording ──

export interface FeatureFlags {
  login: boolean;
  lobbyNavigation: boolean;
  gameLaunch: boolean;
  betAdjustment: boolean;
  spin: boolean;
  gameplay?: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = {
  login: true,
  lobbyNavigation: true,
  gameLaunch: true,
  betAdjustment: true,
  spin: true,
  gameplay: true,
};

// ── Game input from UI / Excel ──

export interface GameInput {
  url: string;
  name: string;
  id: string;
  category: string;
  provider: string;
  subType?: string;
  features?: FeatureFlags;
}

export interface ExcelGameRow {
  url: string;
  name: string;
  features: string[];
}

// ── HAR file metadata ──

export interface HarFileInfo {
  gameId: string;
  gameName: string;
  filePath: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  entryCount: number;
  recordedAt: string;
}

// ── SSE events ──

export interface DashboardEvent {
  type: string;
  payload: any;
}

// ── Pipeline session ──

export interface PipelineSession {
  id: string;
  status: 'idle' | 'recording' | 'load-testing' | 'generating-reports' | 'complete' | 'error';
  startTime: number;
  games: GameInput[];
  features: FeatureFlags;
  harResults: HarRecordResult[];
  loadTestResults: LoadTestResult[];
  apiReports: any[];
  verifications: any[];
  error?: string;
}

// ── API categorization types (replicated from har-api-report-generator) ──

export interface CategorizedEntry {
  method: string;
  url: string;
  shortUrl: string;
  status: number;
  mimeType: string;
  size: number;
  timeMs: number;
  category: string;
  hasPostBody: boolean;
  postMimeType?: string;
}

export interface GameApiReport {
  gameId: string;
  gameName: string;
  harFilePath: string;
  totalEntries: number;
  apiEntries: number;
  staticEntries: number;
  categories: Record<string, CategorizedEntry[]>;
  categorySummary: Array<{ category: string; count: number; methods: string; avgTime: number }>;
  uniqueEndpoints: number;
  methodDistribution: Record<string, number>;
  topEndpointsByFrequency: Array<{ url: string; count: number; method: string }>;
}

// ── Verification types (replicated from har-verification-report) ──

export interface ClassifiedEntry {
  index: number;
  timestamp: string;
  method: string;
  url: string;
  shortUrl: string;
  status: number;
  timeMs: number;
  size: number;
  included: boolean;
  exclusionReason: string;
  userAction: string;
  hasPostBody: boolean;
  postMimeType: string;
}

export interface GameVerification {
  gameId: string;
  gameName: string;
  totalHarEntries: number;
  includedCount: number;
  excludedCount: number;
  includedEntries: ClassifiedEntry[];
  excludedEntries: ClassifiedEntry[];
  timeline: Array<{ action: string; startIdx: number; endIdx: number; includedApis: number; totalApis: number }>;
  methodBreakdown: Record<string, { included: number; excluded: number }>;
  domainBreakdown: Record<string, { included: number; excluded: number }>;
}

// ── HarEntry (minimal for parsing) ──

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    content: { size: number; mimeType: string };
  };
}
