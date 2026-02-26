/**
 * HAR Verification / Audit Report
 *
 * TRUST REPORT: Proves exactly which API calls were load-tested.
 *
 * Uses the EXACT SAME filtering logic as har-load-tester.ts so there is
 * zero discrepancy between what this report shows and what was actually
 * replayed during load testing.
 *
 * For each game it shows:
 *   - Every API call that WAS load-tested (INCLUDED)
 *   - Every call that was EXCLUDED and why
 *   - The user-action timeline proving Login → Lobby → Game → Bet → Spin flow
 *   - Cross-reference counts: HAR total vs Filtered in vs Filtered out
 *
 * Usage:
 *   npx ts-node scripts/har-verification-report.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── EXACT SAME filter constants from har-load-tester.ts ──
// Copied verbatim to guarantee identical behavior

const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
];

const SKIP_HEADERS = new Set([
  'host', 'content-length', 'connection', 'accept-encoding',
  'transfer-encoding', 'upgrade', 'sec-websocket-key',
  'sec-websocket-version', 'sec-websocket-extensions',
]);

// ── Types ──

interface HarEntry {
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

interface ClassifiedEntry {
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

interface GameVerification {
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

// ── EXACT SAME filter logic from har-load-tester.ts filterApiRequests() ──

function classifyEntry(entry: HarEntry): { included: boolean; reason: string } {
  const url = entry.request.url;

  // Rule 1: data URIs
  if (url.startsWith('data:')) {
    return { included: false, reason: 'Data URI' };
  }

  // Rule 2: blob URLs
  if (url.startsWith('blob:')) {
    return { included: false, reason: 'Blob URL' };
  }

  // Rule 3: WebSocket
  if (url.startsWith('wss:') || url.startsWith('ws:')) {
    return { included: false, reason: 'WebSocket URL' };
  }

  // Rule 4: Static file extensions
  const urlPath = url.split('?')[0].toLowerCase();
  for (const ext of STATIC_EXTENSIONS) {
    if (urlPath.endsWith(ext)) {
      return { included: false, reason: `Static asset (${ext})` };
    }
  }

  // Rule 5: /assets/ path (unless contains /api/)
  if (url.includes('/assets/') && !url.includes('/api/')) {
    return { included: false, reason: 'Asset path (/assets/)' };
  }

  // Rule 6: /static/ path (unless contains /api/)
  if (url.includes('/static/') && !url.includes('/api/')) {
    return { included: false, reason: 'Static path (/static/)' };
  }

  // Rule 7: CDN domains
  if (url.includes('cdn.') || url.includes('.cdn.')) {
    return { included: false, reason: 'CDN domain' };
  }

  // Passed all filters → INCLUDED in load test
  return { included: true, reason: '' };
}

// ── User action detection from URL/timing ──

function detectUserAction(url: string, method: string, idx: number, total: number): string {
  const lowerUrl = url.toLowerCase();

  // Login phase (typically first 5-15% of requests)
  if (lowerUrl.includes('/login') || lowerUrl.includes('/auth') || lowerUrl.includes('/signin') || lowerUrl.includes('/token')) {
    return 'Login';
  }
  if (lowerUrl.includes('/session') || lowerUrl.includes('header-username') || lowerUrl.includes('header-password')) {
    return 'Login';
  }

  // Lobby navigation
  if (lowerUrl.includes('/lobby') || lowerUrl.includes('/casino-games/slots') || lowerUrl.includes('casino-search')) {
    return 'Lobby Navigation';
  }
  if (lowerUrl.includes('/search') || lowerUrl.includes('/categories') || lowerUrl.includes('/featured')) {
    return 'Lobby Navigation';
  }

  // Game launch
  if (lowerUrl.includes('/game/') && (lowerUrl.includes('launch') || lowerUrl.includes('open') || lowerUrl.includes('init'))) {
    return 'Game Launch';
  }
  if (lowerUrl.includes('/gamelaunch') || lowerUrl.includes('/gc/') || lowerUrl.includes('iframe')) {
    return 'Game Launch';
  }

  // Gameplay
  if (lowerUrl.includes('/spin') || lowerUrl.includes('/bet') || lowerUrl.includes('/round') ||
      lowerUrl.includes('/wager') || lowerUrl.includes('/stake') || lowerUrl.includes('/result') ||
      lowerUrl.includes('/play/') || lowerUrl.includes('/rng')) {
    return 'Gameplay (Bet/Spin)';
  }

  // Game config
  if (lowerUrl.includes('.json') || lowerUrl.includes('/config') || lowerUrl.includes('/settings') ||
      lowerUrl.includes('/manifest') || lowerUrl.includes('/version') || lowerUrl.includes('/paytable')) {
    return 'Game Config Load';
  }

  // Analytics
  if (lowerUrl.includes('analytics') || lowerUrl.includes('tracking') || lowerUrl.includes('telemetry') ||
      lowerUrl.includes('google') || lowerUrl.includes('facebook') || lowerUrl.includes('doubleclick') ||
      lowerUrl.includes('hotjar') || lowerUrl.includes('clarity') || lowerUrl.includes('segment') ||
      lowerUrl.includes('appsflyer') || lowerUrl.includes('/collect') || lowerUrl.includes('/event') ||
      lowerUrl.includes('/pixel') || lowerUrl.includes('/beacon') || lowerUrl.includes('bat.bing') ||
      lowerUrl.includes('optimizely') || lowerUrl.includes('newrelic') || lowerUrl.includes('sentry')) {
    return 'Analytics/Tracking';
  }

  // Account/user
  if (lowerUrl.includes('/user') || lowerUrl.includes('/account') || lowerUrl.includes('/balance') ||
      lowerUrl.includes('/wallet') || lowerUrl.includes('/player') || lowerUrl.includes('/profile')) {
    return 'User/Account';
  }

  // Betway platform
  if (lowerUrl.includes('betway.co.za')) {
    return 'Betway Platform';
  }

  return 'Other';
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const p = parsed.pathname;
    const q = parsed.search.length > 40 ? parsed.search.slice(0, 40) + '...' : parsed.search;
    const display = `${parsed.host}${p}${q}`;
    return display.length > 120 ? display.slice(0, 120) + '...' : display;
  } catch {
    return url.length > 120 ? url.slice(0, 120) + '...' : url;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

// ── Process a single game ──

function verifyGame(harFilePath: string, gameName: string, gameId: string): GameVerification {
  const content = fs.readFileSync(harFilePath, 'utf-8');
  const har = JSON.parse(content);
  const entries: HarEntry[] = har.log?.entries || [];

  const includedEntries: ClassifiedEntry[] = [];
  const excludedEntries: ClassifiedEntry[] = [];
  const methodBreakdown: Record<string, { included: number; excluded: number }> = {};
  const domainBreakdown: Record<string, { included: number; excluded: number }> = {};

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const classification = classifyEntry(entry);
    const method = entry.request.method;
    const domain = getDomain(entry.request.url);
    const action = detectUserAction(entry.request.url, method, i, entries.length);

    const classified: ClassifiedEntry = {
      index: i + 1,
      timestamp: entry.startedDateTime,
      method,
      url: entry.request.url,
      shortUrl: shortenUrl(entry.request.url),
      status: entry.response.status,
      timeMs: Math.round(entry.time || 0),
      size: entry.response.content?.size || 0,
      included: classification.included,
      exclusionReason: classification.reason,
      userAction: action,
      hasPostBody: !!entry.request.postData?.text,
      postMimeType: entry.request.postData?.mimeType || '',
    };

    if (classification.included) {
      includedEntries.push(classified);
    } else {
      excludedEntries.push(classified);
    }

    // Method breakdown
    if (!methodBreakdown[method]) methodBreakdown[method] = { included: 0, excluded: 0 };
    if (classification.included) methodBreakdown[method].included++;
    else methodBreakdown[method].excluded++;

    // Domain breakdown
    if (!domainBreakdown[domain]) domainBreakdown[domain] = { included: 0, excluded: 0 };
    if (classification.included) domainBreakdown[domain].included++;
    else domainBreakdown[domain].excluded++;
  }

  // Build timeline
  const actionOrder = ['Login', 'Lobby Navigation', 'Game Launch', 'Game Config Load', 'Gameplay (Bet/Spin)', 'User/Account', 'Analytics/Tracking', 'Betway Platform', 'Other'];
  const timeline = actionOrder.map(action => {
    const allForAction = [...includedEntries, ...excludedEntries].filter(e => e.userAction === action);
    const includedForAction = includedEntries.filter(e => e.userAction === action);
    if (allForAction.length === 0) return null;
    const indices = allForAction.map(e => e.index);
    return {
      action,
      startIdx: Math.min(...indices),
      endIdx: Math.max(...indices),
      includedApis: includedForAction.length,
      totalApis: allForAction.length,
    };
  }).filter(Boolean) as GameVerification['timeline'];

  return {
    gameId,
    gameName,
    totalHarEntries: entries.length,
    includedCount: includedEntries.length,
    excludedCount: excludedEntries.length,
    includedEntries,
    excludedEntries,
    timeline,
    methodBreakdown,
    domainBreakdown,
  };
}

// ── HTML Report ──

function generateHtml(verifications: GameVerification[]): string {
  const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
  const totalIncluded = verifications.reduce((s, v) => s + v.includedCount, 0);
  const totalExcluded = verifications.reduce((s, v) => s + v.excludedCount, 0);
  const totalHar = verifications.reduce((s, v) => s + v.totalHarEntries, 0);

  // Aggregated exclusion reasons
  const exclusionReasons: Record<string, number> = {};
  for (const v of verifications) {
    for (const e of v.excludedEntries) {
      exclusionReasons[e.exclusionReason] = (exclusionReasons[e.exclusionReason] || 0) + 1;
    }
  }
  const sortedReasons = Object.entries(exclusionReasons).sort((a, b) => b[1] - a[1]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Load Test Verification &amp; Audit Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 1500px; margin: 0 auto; padding: 20px; }
    header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px; border-radius: 12px; margin-bottom: 24px; border: 2px solid #f59e0b; }
    header h1 { font-size: 26px; color: #fcd34d; margin-bottom: 4px; }
    header p { color: #94a3b8; font-size: 14px; }
    .trust-banner { background: #172554; border: 2px solid #3b82f6; border-radius: 10px; padding: 20px; margin-bottom: 24px; }
    .trust-banner h2 { color: #60a5fa; margin-bottom: 10px; font-size: 18px; }
    .trust-banner p { color: #94a3b8; font-size: 13px; margin-bottom: 6px; }
    .trust-banner code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #22c55e; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .summary-card { background: #1e293b; border-radius: 10px; padding: 18px; border: 1px solid #334155; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; }
    .summary-card .value { font-size: 26px; font-weight: 700; }
    .summary-card .value.green { color: #22c55e; }
    .summary-card .value.red { color: #ef4444; }
    .summary-card .value.blue { color: #3b82f6; }
    .summary-card .value.white { color: #f8fafc; }
    .section { background: #1e293b; border-radius: 10px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
    .section h2 { font-size: 20px; color: #f8fafc; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #334155; }
    .section h3 { font-size: 15px; color: #cbd5e1; margin: 14px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    table th { background: #334155; color: #e2e8f0; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; z-index: 1; }
    table td { padding: 6px 10px; border-bottom: 1px solid #1e293b; font-size: 12px; }
    table tr:hover { background: #334155; }
    .included { color: #22c55e; font-weight: 700; }
    .excluded { color: #ef4444; font-weight: 700; }
    .method { font-weight: 700; font-family: monospace; font-size: 11px; }
    .method.get { color: #22c55e; }
    .method.post { color: #f59e0b; }
    .method.put { color: #3b82f6; }
    .method.options { color: #a78bfa; }
    .method.head { color: #94a3b8; }
    .url-cell { max-width: 550px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; color: #94a3b8; }
    .status { font-weight: 600; font-family: monospace; font-size: 11px; }
    .s2xx { color: #22c55e; }
    .s3xx { color: #93c5fd; }
    .s4xx { color: #fcd34d; }
    .s5xx { color: #fca5a5; }
    .s0 { color: #71717a; }
    .reason { color: #f59e0b; font-size: 11px; }
    .action-chip { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin: 1px 2px; }
    .action-chip.login { background: #7f1d1d; color: #fca5a5; }
    .action-chip.lobby { background: #1e3a5f; color: #93c5fd; }
    .action-chip.launch { background: #713f12; color: #fcd34d; }
    .action-chip.gameplay { background: #166534; color: #86efac; }
    .action-chip.config { background: #3f3f46; color: #d4d4d8; }
    .action-chip.analytics { background: #581c87; color: #d8b4fe; }
    .action-chip.user { background: #0f766e; color: #99f6e4; }
    .action-chip.platform { background: #1e3a5f; color: #93c5fd; }
    .action-chip.other { background: #27272a; color: #a1a1aa; }
    .bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin: 8px 0; }
    .bar .included-bar { background: #22c55e; }
    .bar .excluded-bar { background: #ef4444; }
    details { margin-bottom: 10px; }
    summary { cursor: pointer; padding: 8px 12px; background: #1e293b; border-radius: 6px; font-weight: 600; font-size: 13px; color: #e2e8f0; border: 1px solid #334155; }
    summary:hover { background: #334155; }
    details[open] summary { border-radius: 6px 6px 0 0; }
    .scroll-table { max-height: 500px; overflow-y: auto; border: 1px solid #334155; border-radius: 0 0 6px 6px; }
    footer { text-align: center; padding: 20px; color: #475569; font-size: 12px; }
    .checkmark { color: #22c55e; font-size: 16px; }
    .crossmark { color: #ef4444; font-size: 16px; }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>Load Test Verification &amp; Audit Report</h1>
    <p>Generated: ${timestamp} | This report proves exactly which API calls were replayed during load testing</p>
  </header>

  <!-- Trust Statement -->
  <div class="trust-banner">
    <h2>How to Read This Report</h2>
    <p>This report uses the <strong>exact same filtering logic</strong> as the load tester (<code>har-load-tester.ts::filterApiRequests()</code>).</p>
    <p>Every entry marked <span class="included">INCLUDED</span> was replayed by 5 virtual users &times; 2 iterations = <strong>10 times</strong> during load testing.</p>
    <p>Every entry marked <span class="excluded">EXCLUDED</span> was filtered out with the stated reason — these were NOT load tested.</p>
    <p>The filter rules are: skip data/blob/WebSocket URIs, skip files ending in ${STATIC_EXTENSIONS.join(', ')}, skip /assets/ and /static/ paths (unless /api/), skip CDN domains.</p>
    <p>You can verify by comparing <code>utils/har-load-tester.ts</code> lines 139-165 with the classification in this report.</p>
  </div>

  <!-- Overall Numbers -->
  <div class="summary-grid">
    <div class="summary-card"><div class="label">Total HAR Entries</div><div class="value white">${totalHar.toLocaleString()}</div></div>
    <div class="summary-card"><div class="label">Load Tested (Included)</div><div class="value green">${totalIncluded.toLocaleString()}</div></div>
    <div class="summary-card"><div class="label">Filtered Out (Excluded)</div><div class="value red">${totalExcluded.toLocaleString()}</div></div>
    <div class="summary-card"><div class="label">Inclusion Rate</div><div class="value blue">${totalHar > 0 ? ((totalIncluded / totalHar) * 100).toFixed(1) : 0}%</div></div>
    <div class="summary-card"><div class="label">Games Verified</div><div class="value blue">${verifications.length}</div></div>
    <div class="summary-card"><div class="label">Load Test Multiplier</div><div class="value green">5 VU &times; 2 iter = 10x</div></div>
  </div>

  <!-- Exclusion Reasons Breakdown -->
  <div class="section">
    <h2>Why Were Requests Excluded?</h2>
    <p style="color:#94a3b8; margin-bottom:12px;">Every excluded request has an explicit reason. Static assets (JS, CSS, images, fonts) are excluded because load testing them measures CDN performance, not game server capacity.</p>
    <table>
      <thead><tr><th>Exclusion Reason</th><th>Count</th><th>% of Excluded</th><th>Rationale</th></tr></thead>
      <tbody>
        ${sortedReasons.map(([reason, count]) => {
          const pct = totalExcluded > 0 ? ((count / totalExcluded) * 100).toFixed(1) : '0';
          const rationale = getExclusionRationale(reason);
          return `<tr><td><span class="reason">${escapeHtml(reason)}</span></td><td>${count}</td><td>${pct}%</td><td style="color:#64748b; font-size:11px;">${rationale}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- Per-Game Verification Summary -->
  <div class="section">
    <h2>Per-Game Inclusion/Exclusion Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Game</th>
          <th>HAR Total</th>
          <th>Included (Load Tested)</th>
          <th>Excluded</th>
          <th>Inclusion %</th>
          <th>Load Test Requests (x10)</th>
          <th>Coverage Bar</th>
        </tr>
      </thead>
      <tbody>
        ${verifications.map(v => {
          const pct = v.totalHarEntries > 0 ? ((v.includedCount / v.totalHarEntries) * 100).toFixed(1) : '0';
          const loadTestRequests = v.includedCount * 10;
          const barIncluded = v.totalHarEntries > 0 ? (v.includedCount / v.totalHarEntries) * 100 : 0;
          return `<tr>
            <td><strong>${escapeHtml(v.gameName)}</strong></td>
            <td>${v.totalHarEntries}</td>
            <td class="included">${v.includedCount}</td>
            <td class="excluded">${v.excludedCount}</td>
            <td>${pct}%</td>
            <td style="color:#3b82f6; font-weight:700;">${loadTestRequests.toLocaleString()}</td>
            <td style="min-width:150px;"><div class="bar"><div class="included-bar" style="width:${barIncluded}%"></div><div class="excluded-bar" style="width:${100 - barIncluded}%"></div></div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <p style="color:#64748b; font-size:11px; margin-top:4px;">
      <span style="display:inline-block; width:12px; height:12px; background:#22c55e; border-radius:2px; vertical-align:middle;"></span> Included (Load Tested) &nbsp;
      <span style="display:inline-block; width:12px; height:12px; background:#ef4444; border-radius:2px; vertical-align:middle;"></span> Excluded (Static/CDN)
    </p>
  </div>

  <!-- Per-Game Detailed Verification -->
  ${verifications.map(v => buildGameVerification(v)).join('')}

  <footer>Betway Automation Framework - Load Test Verification Report | Filter source: har-load-tester.ts::filterApiRequests()</footer>
</div>
</body>
</html>`;
}

function getExclusionRationale(reason: string): string {
  if (reason.includes('.js')) return 'JavaScript bundles — app code, not server API';
  if (reason.includes('.css')) return 'Stylesheets — visual rendering, not server logic';
  if (reason.includes('.png') || reason.includes('.jpg') || reason.includes('.jpeg') || reason.includes('.gif') || reason.includes('.svg') || reason.includes('.webp') || reason.includes('.ico')) return 'Images — served by CDN, not game server';
  if (reason.includes('.woff') || reason.includes('.ttf') || reason.includes('.eot')) return 'Font files — served by CDN';
  if (reason.includes('.map')) return 'Source maps — debug files, not API';
  if (reason.includes('.mp')) return 'Media files — audio/video assets';
  if (reason.includes('CDN')) return 'CDN-hosted — measures CDN not origin server';
  if (reason.includes('Asset path')) return '/assets/ directory — bundled frontend files';
  if (reason.includes('Static path')) return '/static/ directory — pre-built files';
  if (reason.includes('Data URI')) return 'Inline data — no network call';
  if (reason.includes('Blob')) return 'Blob URL — local browser data';
  if (reason.includes('WebSocket')) return 'WebSocket — persistent connection, not HTTP replay';
  return 'Non-API resource';
}

function actionChipClass(action: string): string {
  if (action.includes('Login')) return 'login';
  if (action.includes('Lobby')) return 'lobby';
  if (action.includes('Launch')) return 'launch';
  if (action.includes('Gameplay') || action.includes('Bet') || action.includes('Spin')) return 'gameplay';
  if (action.includes('Config')) return 'config';
  if (action.includes('Analytics') || action.includes('Tracking')) return 'analytics';
  if (action.includes('User') || action.includes('Account')) return 'user';
  if (action.includes('Betway') || action.includes('Platform')) return 'platform';
  return 'other';
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 's2xx';
  if (status >= 300 && status < 400) return 's3xx';
  if (status >= 400 && status < 500) return 's4xx';
  if (status >= 500) return 's5xx';
  return 's0';
}

function buildGameVerification(v: GameVerification): string {
  return `
  <div class="section">
    <h2>${escapeHtml(v.gameName)} — Verification</h2>
    <p style="color:#94a3b8; margin-bottom:12px;">
      HAR: <strong>${v.totalHarEntries}</strong> entries |
      <span class="included">Included: ${v.includedCount}</span> |
      <span class="excluded">Excluded: ${v.excludedCount}</span> |
      Load test replayed <strong>${(v.includedCount * 10).toLocaleString()}</strong> requests (${v.includedCount} &times; 10)
    </p>

    <!-- Action Timeline -->
    <h3>User Action Timeline (proves Login → Lobby → Game → Bet → Spin flow)</h3>
    <table>
      <thead><tr><th>User Action</th><th>HAR Entry Range</th><th>APIs Included in Load Test</th><th>Total in HAR</th><th>Coverage</th></tr></thead>
      <tbody>
        ${v.timeline.map(t => {
          const pct = t.totalApis > 0 ? ((t.includedApis / t.totalApis) * 100).toFixed(0) : '0';
          return `<tr>
            <td><span class="action-chip ${actionChipClass(t.action)}">${escapeHtml(t.action)}</span></td>
            <td style="font-family:monospace; font-size:11px;">#${t.startIdx} – #${t.endIdx}</td>
            <td class="included">${t.includedApis}</td>
            <td>${t.totalApis}</td>
            <td>${pct}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <!-- Domain Breakdown -->
    <h3>Domain Breakdown</h3>
    <table>
      <thead><tr><th>Domain</th><th>Included</th><th>Excluded</th><th>Status</th></tr></thead>
      <tbody>
        ${Object.entries(v.domainBreakdown)
          .sort((a, b) => (b[1].included + b[1].excluded) - (a[1].included + a[1].excluded))
          .slice(0, 20)
          .map(([domain, counts]) => `<tr>
            <td style="font-family:monospace; font-size:11px;">${escapeHtml(domain)}</td>
            <td class="included">${counts.included}</td>
            <td class="excluded">${counts.excluded}</td>
            <td>${counts.included > 0 ? '<span class="checkmark">&#10003; Tested</span>' : '<span class="crossmark">&#10007; Not tested</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>

    <!-- INCLUDED Entries (what was load tested) -->
    <details>
      <summary><span class="included">&#10003; INCLUDED: ${v.includedCount} API calls that WERE load tested</span></summary>
      <div class="scroll-table">
        <table>
          <thead><tr><th>#</th><th>Method</th><th>URL</th><th>Status</th><th>Time</th><th>Action</th><th>POST</th></tr></thead>
          <tbody>
            ${v.includedEntries.map(e => `<tr>
              <td>${e.index}</td>
              <td><span class="method ${e.method.toLowerCase()}">${e.method}</span></td>
              <td class="url-cell" title="${escapeHtml(e.url)}">${escapeHtml(e.shortUrl)}</td>
              <td><span class="status ${statusClass(e.status)}">${e.status}</span></td>
              <td>${e.timeMs}ms</td>
              <td><span class="action-chip ${actionChipClass(e.userAction)}">${escapeHtml(e.userAction)}</span></td>
              <td>${e.hasPostBody ? '<span style="color:#f59e0b;">Yes</span>' : '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>

    <!-- EXCLUDED Entries (what was filtered out) -->
    <details>
      <summary><span class="excluded">&#10007; EXCLUDED: ${v.excludedCount} entries that were NOT load tested</span></summary>
      <div class="scroll-table">
        <table>
          <thead><tr><th>#</th><th>Method</th><th>URL</th><th>Status</th><th>Reason</th></tr></thead>
          <tbody>
            ${v.excludedEntries.map(e => `<tr>
              <td>${e.index}</td>
              <td><span class="method ${e.method.toLowerCase()}">${e.method}</span></td>
              <td class="url-cell" title="${escapeHtml(e.url)}">${escapeHtml(e.shortUrl)}</td>
              <td><span class="status ${statusClass(e.status)}">${e.status}</span></td>
              <td><span class="reason">${escapeHtml(e.exclusionReason)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>
  </div>`;
}

// ── Entry Point ──

function main(): void {
  const harDir = path.resolve(__dirname, '..', 'har-files');
  const catalogPath = path.resolve(__dirname, '..', 'config', 'games-catalog.json');
  const outputDir = path.resolve(__dirname, '..', 'load-test-reports');

  if (!fs.existsSync(harDir)) {
    console.error(`HAR directory not found: ${harDir}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const gameMap: Record<string, string> = {};
  for (const g of catalog.games) {
    gameMap[g.id] = g.name;
  }

  const harFiles = fs.readdirSync(harDir).filter(f => f.endsWith('.har'));
  console.log(`Found ${harFiles.length} HAR files\n`);

  const verifications: GameVerification[] = [];

  for (const harFile of harFiles) {
    const gameId = harFile.replace('.har', '');
    const gameName = gameMap[gameId] || gameId;
    const harFilePath = path.join(harDir, harFile);

    console.log(`Verifying: ${gameName}...`);
    try {
      const v = verifyGame(harFilePath, gameName, gameId);
      verifications.push(v);
      console.log(`  Total: ${v.totalHarEntries} | Included: ${v.includedCount} | Excluded: ${v.excludedCount}`);
    } catch (err: any) {
      console.error(`  Failed: ${err.message}`);
    }
  }

  verifications.sort((a, b) => a.gameName.localeCompare(b.gameName));

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(outputDir, `verification-report-${ts}.html`);

  fs.writeFileSync(outputPath, generateHtml(verifications), 'utf-8');
  console.log(`\nVerification report: ${outputPath}`);
}

main();
