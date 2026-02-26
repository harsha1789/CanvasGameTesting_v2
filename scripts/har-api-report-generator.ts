/**
 * HAR API Report Generator
 *
 * Parses all recorded HAR files, extracts every API call,
 * categorizes them by game area (Login, Lobby, Game Load, Gameplay, Analytics, etc.),
 * and generates a detailed HTML report.
 *
 * Usage:
 *   npx ts-node scripts/har-api-report-generator.ts
 */

import * as fs from 'fs';
import * as path from 'path';

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
    headers: Array<{ name: string; value: string }>;
    content: { size: number; mimeType: string; text?: string };
  };
  timings: {
    send: number;
    wait: number;
    receive: number;
  };
}

interface CategorizedEntry {
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

interface GameApiReport {
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

// ── Constants ──

const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.cur',
];

// Category detection rules: patterns mapped to game area categories
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  // Authentication & Session
  { pattern: /\/login/i, category: 'Authentication' },
  { pattern: /\/auth/i, category: 'Authentication' },
  { pattern: /\/token/i, category: 'Authentication' },
  { pattern: /\/session/i, category: 'Authentication' },
  { pattern: /\/oauth/i, category: 'Authentication' },
  { pattern: /\/signin/i, category: 'Authentication' },
  { pattern: /\/account\/validate/i, category: 'Authentication' },
  { pattern: /header-username|header-password/i, category: 'Authentication' },

  // User & Account
  { pattern: /\/user\//i, category: 'User & Account' },
  { pattern: /\/account/i, category: 'User & Account' },
  { pattern: /\/profile/i, category: 'User & Account' },
  { pattern: /\/balance/i, category: 'User & Account' },
  { pattern: /\/wallet/i, category: 'User & Account' },
  { pattern: /\/player/i, category: 'User & Account' },
  { pattern: /\/member/i, category: 'User & Account' },

  // Lobby & Navigation
  { pattern: /\/lobby/i, category: 'Lobby & Navigation' },
  { pattern: /\/casino-games/i, category: 'Lobby & Navigation' },
  { pattern: /\/slots\/?$/i, category: 'Lobby & Navigation' },
  { pattern: /\/categories/i, category: 'Lobby & Navigation' },
  { pattern: /\/search/i, category: 'Lobby & Navigation' },
  { pattern: /\/casino.*search/i, category: 'Lobby & Navigation' },
  { pattern: /\/games\/?(\?|$)/i, category: 'Lobby & Navigation' },
  { pattern: /\/promotions/i, category: 'Lobby & Navigation' },
  { pattern: /\/jackpot/i, category: 'Lobby & Navigation' },
  { pattern: /\/featured/i, category: 'Lobby & Navigation' },

  // Game Launch & Loading
  { pattern: /\/game\/launch/i, category: 'Game Launch' },
  { pattern: /\/game\/open/i, category: 'Game Launch' },
  { pattern: /\/game\/init/i, category: 'Game Launch' },
  { pattern: /\/game\/start/i, category: 'Game Launch' },
  { pattern: /\/game\/load/i, category: 'Game Launch' },
  { pattern: /\/game\/config/i, category: 'Game Launch' },
  { pattern: /\/gamelaunch/i, category: 'Game Launch' },
  { pattern: /\/launch\?/i, category: 'Game Launch' },
  { pattern: /\/iframe.*game/i, category: 'Game Launch' },
  { pattern: /\/gc\//i, category: 'Game Launch' },

  // Game Provider APIs (gameplay: spin, bet, round)
  { pattern: /\/spin/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/bet/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/round/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/play\//i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/wager/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/stake/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/result/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/win/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/rng/i, category: 'Gameplay (Spin/Bet)' },
  { pattern: /\/gameround/i, category: 'Gameplay (Spin/Bet)' },

  // Game Configuration & Assets
  { pattern: /\/game.*config/i, category: 'Game Config & Assets' },
  { pattern: /\/game.*asset/i, category: 'Game Config & Assets' },
  { pattern: /\/paytable/i, category: 'Game Config & Assets' },
  { pattern: /\/rules/i, category: 'Game Config & Assets' },
  { pattern: /\/rtp/i, category: 'Game Config & Assets' },
  { pattern: /\.json(\?|$)/i, category: 'Game Config & Assets' },
  { pattern: /\/manifest/i, category: 'Game Config & Assets' },
  { pattern: /\/version/i, category: 'Game Config & Assets' },
  { pattern: /\/settings/i, category: 'Game Config & Assets' },

  // Analytics & Tracking
  { pattern: /\/analytics/i, category: 'Analytics & Tracking' },
  { pattern: /\/tracking/i, category: 'Analytics & Tracking' },
  { pattern: /\/telemetry/i, category: 'Analytics & Tracking' },
  { pattern: /\/event/i, category: 'Analytics & Tracking' },
  { pattern: /\/pixel/i, category: 'Analytics & Tracking' },
  { pattern: /\/beacon/i, category: 'Analytics & Tracking' },
  { pattern: /\/collect/i, category: 'Analytics & Tracking' },
  { pattern: /\/log\?/i, category: 'Analytics & Tracking' },
  { pattern: /google.*analytics/i, category: 'Analytics & Tracking' },
  { pattern: /googletagmanager/i, category: 'Analytics & Tracking' },
  { pattern: /gtm\.js/i, category: 'Analytics & Tracking' },
  { pattern: /facebook.*tr/i, category: 'Analytics & Tracking' },
  { pattern: /doubleclick/i, category: 'Analytics & Tracking' },
  { pattern: /hotjar/i, category: 'Analytics & Tracking' },
  { pattern: /segment\./i, category: 'Analytics & Tracking' },
  { pattern: /mixpanel/i, category: 'Analytics & Tracking' },
  { pattern: /amplitude/i, category: 'Analytics & Tracking' },
  { pattern: /bat\.bing/i, category: 'Analytics & Tracking' },
  { pattern: /clarity\.ms/i, category: 'Analytics & Tracking' },
  { pattern: /optimizely/i, category: 'Analytics & Tracking' },
  { pattern: /newrelic/i, category: 'Analytics & Tracking' },
  { pattern: /sentry/i, category: 'Analytics & Tracking' },
  { pattern: /datadog/i, category: 'Analytics & Tracking' },
  { pattern: /appsflyer/i, category: 'Analytics & Tracking' },
  { pattern: /adjust\.com/i, category: 'Analytics & Tracking' },
  { pattern: /branch\.io/i, category: 'Analytics & Tracking' },

  // Content Delivery / CDN
  { pattern: /cdn\./i, category: 'CDN & Static Assets' },
  { pattern: /\.cdn\./i, category: 'CDN & Static Assets' },
  { pattern: /cloudfront/i, category: 'CDN & Static Assets' },
  { pattern: /cloudflare/i, category: 'CDN & Static Assets' },
  { pattern: /akamai/i, category: 'CDN & Static Assets' },
  { pattern: /fastly/i, category: 'CDN & Static Assets' },

  // Responsible Gambling / Compliance
  { pattern: /\/responsible/i, category: 'Compliance & RG' },
  { pattern: /\/kyc/i, category: 'Compliance & RG' },
  { pattern: /\/verification/i, category: 'Compliance & RG' },
  { pattern: /\/limits/i, category: 'Compliance & RG' },
  { pattern: /\/self-exclusion/i, category: 'Compliance & RG' },

  // Betway-specific API patterns
  { pattern: /betway\.co\.za\/api/i, category: 'Betway Platform API' },
  { pattern: /betway\.co\.za\/_next/i, category: 'Betway Frontend (Next.js)' },
  { pattern: /betway\.co\.za\/.*\.html/i, category: 'Lobby & Navigation' },
];

// ── Helpers ──

function isStaticAsset(url: string): boolean {
  const urlPath = url.split('?')[0].toLowerCase();
  return STATIC_EXTENSIONS.some(ext => urlPath.endsWith(ext));
}

function categorizeUrl(url: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(url)) {
      return rule.category;
    }
  }

  // Fallback heuristics
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('betway')) return 'Betway Platform API';
    if (host.includes('google') || host.includes('gstatic')) return 'Analytics & Tracking';
    if (host.includes('facebook') || host.includes('fb.')) return 'Analytics & Tracking';

    // Game provider domains
    if (host.includes('habanero') || host.includes('hab')) return 'Game Provider API';
    if (host.includes('netent') || host.includes('casinomodule')) return 'Game Provider API';
    if (host.includes('pragmatic') || host.includes('ppgames')) return 'Game Provider API';
    if (host.includes('redtiger') || host.includes('evolutiongaming')) return 'Game Provider API';
    if (host.includes('playngo') || host.includes('png')) return 'Game Provider API';
    if (host.includes('spribe')) return 'Game Provider API';

    return 'Other / Uncategorized';
  } catch {
    return 'Other / Uncategorized';
  }
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathPart = parsed.pathname;
    const queryPart = parsed.search.length > 30 ? parsed.search.slice(0, 30) + '...' : parsed.search;
    return `${parsed.host}${pathPart}${queryPart}`;
  } catch {
    return url.length > 100 ? url.slice(0, 100) + '...' : url;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Main logic ──

function parseHarAndCategorize(harFilePath: string, gameName: string, gameId: string): GameApiReport {
  const content = fs.readFileSync(harFilePath, 'utf-8');
  const har = JSON.parse(content);
  const entries: HarEntry[] = har.log?.entries || [];

  const categories: Record<string, CategorizedEntry[]> = {};
  const methodDist: Record<string, number> = {};
  const endpointFrequency: Record<string, { count: number; method: string }> = {};
  let apiCount = 0;
  let staticCount = 0;

  for (const entry of entries) {
    const url = entry.request.url;

    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('ws:') || url.startsWith('wss:')) {
      continue;
    }

    if (isStaticAsset(url)) {
      staticCount++;
      continue;
    }

    apiCount++;
    const category = categorizeUrl(url);
    const shortUrl = shortenUrl(url);
    const method = entry.request.method;

    // Count methods
    methodDist[method] = (methodDist[method] || 0) + 1;

    // Track endpoint frequency (by path, ignoring query)
    try {
      const parsed = new URL(url);
      const endpointKey = `${method} ${parsed.host}${parsed.pathname}`;
      if (!endpointFrequency[endpointKey]) {
        endpointFrequency[endpointKey] = { count: 0, method };
      }
      endpointFrequency[endpointKey].count++;
    } catch { /* ignore */ }

    const categorized: CategorizedEntry = {
      method,
      url,
      shortUrl,
      status: entry.response.status,
      mimeType: entry.response.content?.mimeType || '',
      size: entry.response.content?.size || 0,
      timeMs: Math.round(entry.time || 0),
      category,
      hasPostBody: !!entry.request.postData?.text,
      postMimeType: entry.request.postData?.mimeType,
    };

    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(categorized);
  }

  // Build category summary
  const categorySummary = Object.entries(categories)
    .map(([category, items]) => {
      const methods = Array.from(new Set(items.map(i => i.method))).join(', ');
      const avgTime = items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.timeMs, 0) / items.length)
        : 0;
      return { category, count: items.length, methods, avgTime };
    })
    .sort((a, b) => b.count - a.count);

  // Unique endpoints
  const uniqueEndpoints = Object.keys(endpointFrequency).length;

  // Top endpoints
  const topEndpointsByFrequency = Object.entries(endpointFrequency)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([url, data]) => ({ url, count: data.count, method: data.method }));

  return {
    gameId,
    gameName,
    harFilePath,
    totalEntries: entries.length,
    apiEntries: apiCount,
    staticEntries: staticCount,
    categories,
    categorySummary,
    uniqueEndpoints,
    methodDistribution: methodDist,
    topEndpointsByFrequency,
  };
}

function generateHtml(reports: GameApiReport[]): string {
  const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
  const totalApis = reports.reduce((s, r) => s + r.apiEntries, 0);
  const totalEndpoints = reports.reduce((s, r) => s + r.uniqueEndpoints, 0);

  // Aggregate categories across all games
  const allCategories: Record<string, number> = {};
  for (const r of reports) {
    for (const cs of r.categorySummary) {
      allCategories[cs.category] = (allCategories[cs.category] || 0) + cs.count;
    }
  }
  const sortedCategories = Object.entries(allCategories).sort((a, b) => b[1] - a[1]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Betway Load Test - API Call Detail Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 1500px; margin: 0 auto; padding: 20px; }
    header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px; border-radius: 12px; margin-bottom: 24px; }
    header h1 { font-size: 26px; color: #f8fafc; margin-bottom: 4px; }
    header p { color: #94a3b8; font-size: 14px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .summary-card { background: #1e293b; border-radius: 10px; padding: 18px; border: 1px solid #334155; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; }
    .summary-card .value { font-size: 26px; font-weight: 700; color: #f8fafc; }
    .summary-card .value.info { color: #3b82f6; }
    .summary-card .value.success { color: #22c55e; }
    .section { background: #1e293b; border-radius: 10px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
    .section h2 { font-size: 20px; color: #f8fafc; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #334155; }
    .section h3 { font-size: 16px; color: #cbd5e1; margin: 16px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    table th { background: #334155; color: #e2e8f0; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; }
    table td { padding: 7px 12px; border-bottom: 1px solid #1e293b; font-size: 13px; }
    table tr:hover { background: #334155; }
    .method { font-weight: 700; font-family: monospace; font-size: 12px; }
    .method.get { color: #22c55e; }
    .method.post { color: #f59e0b; }
    .method.put { color: #3b82f6; }
    .method.delete { color: #ef4444; }
    .method.options { color: #a78bfa; }
    .method.head { color: #94a3b8; }
    .url-cell { max-width: 600px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; color: #94a3b8; }
    .status { font-weight: 600; font-family: monospace; }
    .status.s2xx { color: #22c55e; }
    .status.s3xx { color: #93c5fd; }
    .status.s4xx { color: #fcd34d; }
    .status.s5xx { color: #fca5a5; }
    .status.s0 { color: #71717a; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge.cat { background: #1e3a5f; color: #93c5fd; }
    .badge.count { background: #334155; color: #e2e8f0; }
    .cat-chip { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 12px; margin: 2px 4px 2px 0; }
    .cat-chip.auth { background: #7f1d1d; color: #fca5a5; }
    .cat-chip.lobby { background: #1e3a5f; color: #93c5fd; }
    .cat-chip.launch { background: #713f12; color: #fcd34d; }
    .cat-chip.gameplay { background: #166534; color: #86efac; }
    .cat-chip.config { background: #3f3f46; color: #d4d4d8; }
    .cat-chip.analytics { background: #581c87; color: #d8b4fe; }
    .cat-chip.provider { background: #0f766e; color: #99f6e4; }
    .cat-chip.platform { background: #1e3a5f; color: #93c5fd; }
    .cat-chip.other { background: #27272a; color: #a1a1aa; }
    .game-section { border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-bottom: 20px; background: #0f172a; }
    .game-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .game-header h3 { font-size: 18px; color: #f8fafc; margin: 0; }
    .cat-table-wrap { max-height: 400px; overflow-y: auto; border: 1px solid #334155; border-radius: 6px; }
    .areas-tested { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; }
    footer { text-align: center; padding: 20px; color: #475569; font-size: 12px; }
    details { margin-bottom: 12px; }
    summary { cursor: pointer; padding: 8px 12px; background: #1e293b; border-radius: 6px; font-weight: 600; font-size: 14px; color: #e2e8f0; border: 1px solid #334155; }
    summary:hover { background: #334155; }
    details[open] summary { border-radius: 6px 6px 0 0; }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>API Call Detail Report - Betway Game Load Test</h1>
    <p>Generated: ${timestamp} | Games Analyzed: ${reports.length} | Total API Calls: ${totalApis}</p>
  </header>

  <div class="summary-grid">
    <div class="summary-card"><div class="label">Games Analyzed</div><div class="value info">${reports.length}</div></div>
    <div class="summary-card"><div class="label">Total API Calls</div><div class="value">${totalApis.toLocaleString()}</div></div>
    <div class="summary-card"><div class="label">Unique Endpoints</div><div class="value success">${totalEndpoints}</div></div>
    <div class="summary-card"><div class="label">Categories Identified</div><div class="value info">${sortedCategories.length}</div></div>
  </div>

  <!-- What Areas Were Load Tested -->
  <div class="section" style="border: 2px solid #3b82f6;">
    <h2 style="color: #60a5fa;">Areas of Game Covered by Load Test</h2>
    <p style="margin-bottom:16px; color: #94a3b8;">
      Each game's HAR was captured during: <strong>Login &rarr; Lobby Navigation &rarr; Game Search &rarr; Game Launch &rarr; Bet &rarr; Spin &rarr; Wait</strong>.
      The load test replayed all captured API (non-static) requests with 5 virtual users &times; 2 iterations.
      Below are the game areas exercised during each phase:
    </p>
    <table>
      <thead>
        <tr>
          <th>User Action</th>
          <th>Game Area Tested</th>
          <th>API Categories Hit</th>
          <th>What This Tests Under Load</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Login</strong></td>
          <td>Authentication &amp; Session</td>
          <td><span class="cat-chip auth">Authentication</span><span class="cat-chip platform">User &amp; Account</span></td>
          <td>Session creation, credential validation, token generation under concurrent users</td>
        </tr>
        <tr>
          <td><strong>2. Navigate to Lobby</strong></td>
          <td>Casino Lobby</td>
          <td><span class="cat-chip lobby">Lobby &amp; Navigation</span><span class="cat-chip platform">Betway Platform API</span><span class="cat-chip analytics">Analytics</span></td>
          <td>Page rendering APIs, game catalog loading, CDN responses, frontend (Next.js SSR) under load</td>
        </tr>
        <tr>
          <td><strong>3. Search &amp; Open Game</strong></td>
          <td>Game Discovery &amp; Launch</td>
          <td><span class="cat-chip lobby">Lobby &amp; Navigation</span><span class="cat-chip launch">Game Launch</span><span class="cat-chip provider">Game Provider API</span></td>
          <td>Search endpoint throughput, game launch URL generation, iframe/provider handoff under concurrency</td>
        </tr>
        <tr>
          <td><strong>4. Game Load</strong></td>
          <td>Game Initialization</td>
          <td><span class="cat-chip launch">Game Launch</span><span class="cat-chip config">Game Config &amp; Assets</span><span class="cat-chip provider">Game Provider API</span></td>
          <td>Game configuration fetch, asset manifest load, provider API init, canvas/iframe setup under load</td>
        </tr>
        <tr>
          <td><strong>5. Click Bet</strong></td>
          <td>Bet Controls</td>
          <td><span class="cat-chip gameplay">Gameplay (Spin/Bet)</span><span class="cat-chip provider">Game Provider API</span></td>
          <td>Bet validation APIs, stake update calls (if HTML controls), provider bet-set endpoints</td>
        </tr>
        <tr>
          <td><strong>6. Click Spin</strong></td>
          <td>Spin / Game Round</td>
          <td><span class="cat-chip gameplay">Gameplay (Spin/Bet)</span><span class="cat-chip provider">Game Provider API</span></td>
          <td>Spin/round initiation, RNG result fetch, win calculation, balance update under concurrent spins</td>
        </tr>
        <tr>
          <td><strong>7. Post-Spin Wait</strong></td>
          <td>Background Activity</td>
          <td><span class="cat-chip analytics">Analytics &amp; Tracking</span><span class="cat-chip platform">Betway Platform API</span></td>
          <td>Event tracking, telemetry, keepalive/polling, analytics beacons under sustained load</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Aggregated Category Breakdown -->
  <div class="section">
    <h2>Aggregated API Categories Across All Games</h2>
    <table>
      <thead>
        <tr><th>Category</th><th>Total Calls</th><th>% of Total</th><th>Description</th></tr>
      </thead>
      <tbody>
        ${sortedCategories.map(([cat, count]) => {
          const pct = totalApis > 0 ? ((count / totalApis) * 100).toFixed(1) : '0';
          const desc = getCategoryDescription(cat);
          return `<tr><td><strong>${escapeHtml(cat)}</strong></td><td>${count}</td><td>${pct}%</td><td style="color:#94a3b8;">${desc}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- Per-Game Detail -->
  ${reports.map(r => buildGameSection(r)).join('')}

  <footer>Betway Automation Framework - API Call Detail Report | Generated from HAR files</footer>
</div>
</body>
</html>`;
}

function getCategoryDescription(cat: string): string {
  const descriptions: Record<string, string> = {
    'Authentication': 'Login, session creation, token validation, credential verification',
    'User & Account': 'User profile, balance queries, wallet, player info',
    'Lobby & Navigation': 'Casino lobby pages, game catalog, search, categories, page navigation',
    'Game Launch': 'Game initialization, launch URL generation, iframe setup, provider handoff',
    'Gameplay (Spin/Bet)': 'Spin requests, bet placement, round results, win calculations',
    'Game Config & Assets': 'Game configuration JSON, paytable data, rules, manifest files',
    'Analytics & Tracking': 'Google Analytics, tag managers, event tracking, telemetry beacons',
    'Game Provider API': 'Direct calls to game provider backends (Habanero, NetEnt, etc.)',
    'Betway Platform API': 'Betway\'s own backend API endpoints',
    'Betway Frontend (Next.js)': 'Next.js server-side rendering, page data, _next/ resources',
    'CDN & Static Assets': 'Content delivery network, cached resources',
    'Compliance & RG': 'Responsible gambling, KYC, limits, self-exclusion checks',
    'Other / Uncategorized': 'Miscellaneous API calls not matching known patterns',
  };
  return descriptions[cat] || '';
}

function buildGameSection(report: GameApiReport): string {
  const chipClass = (cat: string): string => {
    if (cat.includes('Auth')) return 'auth';
    if (cat.includes('Lobby')) return 'lobby';
    if (cat.includes('Launch')) return 'launch';
    if (cat.includes('Gameplay')) return 'gameplay';
    if (cat.includes('Config')) return 'config';
    if (cat.includes('Analytics') || cat.includes('Tracking')) return 'analytics';
    if (cat.includes('Provider')) return 'provider';
    if (cat.includes('Betway') || cat.includes('Platform')) return 'platform';
    return 'other';
  };

  return `
  <div class="section">
    <div class="game-header">
      <h2>${escapeHtml(report.gameName)}</h2>
      <span class="badge count">${report.apiEntries} API calls | ${report.uniqueEndpoints} unique endpoints</span>
    </div>

    <div class="areas-tested">
      ${report.categorySummary.map(cs =>
        `<span class="cat-chip ${chipClass(cs.category)}">${escapeHtml(cs.category)} (${cs.count})</span>`
      ).join('')}
    </div>

    <h3>Category Breakdown</h3>
    <table>
      <thead><tr><th>Category</th><th>Calls</th><th>HTTP Methods</th><th>Avg Time (ms)</th></tr></thead>
      <tbody>
        ${report.categorySummary.map(cs => `
        <tr>
          <td><strong>${escapeHtml(cs.category)}</strong></td>
          <td>${cs.count}</td>
          <td style="font-family:monospace; font-size:12px;">${cs.methods}</td>
          <td>${cs.avgTime}ms</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <h3>Top 15 Most Frequent Endpoints</h3>
    <table>
      <thead><tr><th>Method</th><th>Endpoint</th><th>Calls</th></tr></thead>
      <tbody>
        ${report.topEndpointsByFrequency.map(ep => `
        <tr>
          <td><span class="method ${ep.method.toLowerCase()}">${ep.method}</span></td>
          <td class="url-cell" title="${escapeHtml(ep.url)}">${escapeHtml(ep.url)}</td>
          <td>${ep.count}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    ${Object.entries(report.categories).map(([cat, entries]) => {
      // Deduplicate by endpoint for the listing
      const uniqueEntries: Record<string, CategorizedEntry & { count: number }> = {};
      for (const e of entries) {
        try {
          const parsed = new URL(e.url);
          const key = `${e.method} ${parsed.host}${parsed.pathname}`;
          if (!uniqueEntries[key]) {
            uniqueEntries[key] = { ...e, count: 1 };
          } else {
            uniqueEntries[key].count++;
          }
        } catch {
          const key = `${e.method} ${e.url}`;
          if (!uniqueEntries[key]) {
            uniqueEntries[key] = { ...e, count: 1 };
          } else {
            uniqueEntries[key].count++;
          }
        }
      }
      const sorted = Object.values(uniqueEntries).sort((a, b) => b.count - a.count);

      return `
      <details>
        <summary><span class="cat-chip ${chipClass(cat)}">${escapeHtml(cat)}</span> ${entries.length} calls, ${sorted.length} unique endpoints</summary>
        <div class="cat-table-wrap">
          <table>
            <thead><tr><th>Method</th><th>Endpoint</th><th>Status</th><th>Time (ms)</th><th>Calls</th><th>POST Body</th></tr></thead>
            <tbody>
              ${sorted.map(e => {
                const statusCls = e.status >= 200 && e.status < 300 ? 's2xx'
                  : e.status >= 300 && e.status < 400 ? 's3xx'
                  : e.status >= 400 && e.status < 500 ? 's4xx'
                  : e.status >= 500 ? 's5xx' : 's0';
                return `
              <tr>
                <td><span class="method ${e.method.toLowerCase()}">${e.method}</span></td>
                <td class="url-cell" title="${escapeHtml(e.url)}">${escapeHtml(e.shortUrl)}</td>
                <td><span class="status ${statusCls}">${e.status}</span></td>
                <td>${e.timeMs}</td>
                <td>${e.count}</td>
                <td>${e.hasPostBody ? `<span style="color:#f59e0b;">${escapeHtml(e.postMimeType || 'yes')}</span>` : '-'}</td>
              </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </details>`;
    }).join('')}
  </div>`;
}

// ── Entry point ──

function main(): void {
  const harDir = path.resolve(__dirname, '..', 'har-files');
  const catalogPath = path.resolve(__dirname, '..', 'config', 'games-catalog.json');
  const outputDir = path.resolve(__dirname, '..', 'load-test-reports');

  if (!fs.existsSync(harDir)) {
    console.error(`HAR directory not found: ${harDir}`);
    process.exit(1);
  }

  // Load game catalog for names
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const gameMap: Record<string, string> = {};
  for (const g of catalog.games) {
    gameMap[g.id] = g.name;
  }

  // Find all .har files
  const harFiles = fs.readdirSync(harDir).filter(f => f.endsWith('.har'));
  console.log(`Found ${harFiles.length} HAR files in ${harDir}`);

  const reports: GameApiReport[] = [];

  for (const harFile of harFiles) {
    const gameId = harFile.replace('.har', '');
    const gameName = gameMap[gameId] || gameId;
    const harFilePath = path.join(harDir, harFile);

    console.log(`Parsing: ${gameName} (${harFile})...`);
    try {
      const report = parseHarAndCategorize(harFilePath, gameName, gameId);
      reports.push(report);
      console.log(`  Total: ${report.totalEntries}, API: ${report.apiEntries}, Static: ${report.staticEntries}, Categories: ${report.categorySummary.length}`);
    } catch (err: any) {
      console.error(`  Failed to parse ${harFile}: ${err.message}`);
    }
  }

  // Sort reports by game name
  reports.sort((a, b) => a.gameName.localeCompare(b.gameName));

  // Generate HTML
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(outputDir, `api-detail-report-${timestamp}.html`);

  const html = generateHtml(reports);
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log(`\nReport generated: ${outputPath}`);
}

main();
