/**
 * API Categorization Service
 *
 * Replicates the analysis logic from scripts/har-api-report-generator.ts
 * as importable functions. The CATEGORY_RULES and helpers are copied
 * verbatim to guarantee identical categorization.
 */

import * as fs from 'fs';
import { HarEntry, CategorizedEntry, GameApiReport } from '../types/dashboard-types';

// ── Constants (verbatim from har-api-report-generator.ts) ──

const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.cur',
];

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\/login/i, category: 'Authentication' },
  { pattern: /\/auth/i, category: 'Authentication' },
  { pattern: /\/token/i, category: 'Authentication' },
  { pattern: /\/session/i, category: 'Authentication' },
  { pattern: /\/oauth/i, category: 'Authentication' },
  { pattern: /\/signin/i, category: 'Authentication' },
  { pattern: /\/account\/validate/i, category: 'Authentication' },
  { pattern: /header-username|header-password/i, category: 'Authentication' },

  { pattern: /\/user\//i, category: 'User & Account' },
  { pattern: /\/account/i, category: 'User & Account' },
  { pattern: /\/profile/i, category: 'User & Account' },
  { pattern: /\/balance/i, category: 'User & Account' },
  { pattern: /\/wallet/i, category: 'User & Account' },
  { pattern: /\/player/i, category: 'User & Account' },
  { pattern: /\/member/i, category: 'User & Account' },

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

  { pattern: /\/game.*config/i, category: 'Game Config & Assets' },
  { pattern: /\/game.*asset/i, category: 'Game Config & Assets' },
  { pattern: /\/paytable/i, category: 'Game Config & Assets' },
  { pattern: /\/rules/i, category: 'Game Config & Assets' },
  { pattern: /\/rtp/i, category: 'Game Config & Assets' },
  { pattern: /\.json(\?|$)/i, category: 'Game Config & Assets' },
  { pattern: /\/manifest/i, category: 'Game Config & Assets' },
  { pattern: /\/version/i, category: 'Game Config & Assets' },
  { pattern: /\/settings/i, category: 'Game Config & Assets' },

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

  { pattern: /cdn\./i, category: 'CDN & Static Assets' },
  { pattern: /\.cdn\./i, category: 'CDN & Static Assets' },
  { pattern: /cloudfront/i, category: 'CDN & Static Assets' },
  { pattern: /cloudflare/i, category: 'CDN & Static Assets' },
  { pattern: /akamai/i, category: 'CDN & Static Assets' },
  { pattern: /fastly/i, category: 'CDN & Static Assets' },

  { pattern: /\/responsible/i, category: 'Compliance & RG' },
  { pattern: /\/kyc/i, category: 'Compliance & RG' },
  { pattern: /\/verification/i, category: 'Compliance & RG' },
  { pattern: /\/limits/i, category: 'Compliance & RG' },
  { pattern: /\/self-exclusion/i, category: 'Compliance & RG' },

  { pattern: /betway\.co\.za\/api/i, category: 'Betway Platform API' },
  { pattern: /betway\.co\.za\/_next/i, category: 'Betway Frontend (Next.js)' },
  { pattern: /betway\.co\.za\/.*\.html/i, category: 'Lobby & Navigation' },
];

// ── Helpers ──

function isStaticAsset(url: string): boolean {
  const urlPath = url.split('?')[0].toLowerCase();
  return STATIC_EXTENSIONS.some(ext => urlPath.endsWith(ext));
}

export function categorizeUrl(url: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(url)) {
      return rule.category;
    }
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('betway')) return 'Betway Platform API';
    if (host.includes('google') || host.includes('gstatic')) return 'Analytics & Tracking';
    if (host.includes('facebook') || host.includes('fb.')) return 'Analytics & Tracking';
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

// ── Main analysis function ──

export function analyzeHarApiCoverage(harFilePath: string, gameName: string, gameId: string): GameApiReport {
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
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('ws:') || url.startsWith('wss:')) continue;

    if (isStaticAsset(url)) {
      staticCount++;
      continue;
    }

    apiCount++;
    const category = categorizeUrl(url);
    const shortUrl = shortenUrl(url);
    const method = entry.request.method;

    methodDist[method] = (methodDist[method] || 0) + 1;

    try {
      const parsed = new URL(url);
      const endpointKey = `${method} ${parsed.host}${parsed.pathname}`;
      if (!endpointFrequency[endpointKey]) endpointFrequency[endpointKey] = { count: 0, method };
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

    if (!categories[category]) categories[category] = [];
    categories[category].push(categorized);
  }

  const categorySummary = Object.entries(categories)
    .map(([category, items]) => ({
      category,
      count: items.length,
      methods: Array.from(new Set(items.map(i => i.method))).join(', '),
      avgTime: items.length > 0 ? Math.round(items.reduce((s, i) => s + i.timeMs, 0) / items.length) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const topEndpoints = Object.entries(endpointFrequency)
    .map(([url, data]) => ({ url, count: data.count, method: data.method }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const uniqueEndpoints = Object.keys(endpointFrequency).length;

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
    topEndpointsByFrequency: topEndpoints,
  };
}

export function getCategoryDescription(category: string): string {
  const descriptions: Record<string, string> = {
    'Authentication': 'Login, token refresh, session management',
    'User & Account': 'Player balance, wallet, profile data',
    'Lobby & Navigation': 'Game listing, search, promotions',
    'Game Launch': 'Game initialization and iframe loading',
    'Gameplay (Spin/Bet)': 'Bet placement, spin, round results',
    'Game Config & Assets': 'Game configuration, paytable, rules',
    'Analytics & Tracking': 'Google Analytics, Hotjar, Segment, etc.',
    'CDN & Static Assets': 'Content delivery, cached resources',
    'Game Provider API': 'Third-party game provider endpoints',
    'Betway Platform API': 'Betway-specific backend APIs',
    'Betway Frontend (Next.js)': 'Next.js page data and chunks',
    'Compliance & RG': 'Responsible gambling, KYC, limits',
    'Other / Uncategorized': 'Unclassified API calls',
  };
  return descriptions[category] || '';
}
