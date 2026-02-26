/**
 * Verification Service
 *
 * Replicates the exact same filtering logic as har-load-tester.ts
 * (via har-verification-report.ts) to prove which APIs were included/excluded.
 */

import * as fs from 'fs';
import { HarEntry, ClassifiedEntry, GameVerification } from '../types/dashboard-types';

// ── EXACT SAME filter constants from har-load-tester.ts ──

const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
];

// ── EXACT SAME filter logic from har-load-tester.ts filterApiRequests() ──

export function classifyEntry(entry: HarEntry): { included: boolean; reason: string } {
  const url = entry.request.url;
  if (url.startsWith('data:')) return { included: false, reason: 'Data URI' };
  if (url.startsWith('blob:')) return { included: false, reason: 'Blob URL' };
  if (url.startsWith('wss:') || url.startsWith('ws:')) return { included: false, reason: 'WebSocket URL' };

  const urlPath = url.split('?')[0].toLowerCase();
  for (const ext of STATIC_EXTENSIONS) {
    if (urlPath.endsWith(ext)) return { included: false, reason: `Static asset (${ext})` };
  }

  if (url.includes('/assets/') && !url.includes('/api/')) return { included: false, reason: 'Asset path (/assets/)' };
  if (url.includes('/static/') && !url.includes('/api/')) return { included: false, reason: 'Static path (/static/)' };
  if (url.includes('cdn.') || url.includes('.cdn.')) return { included: false, reason: 'CDN domain' };

  return { included: true, reason: '' };
}

// ── User action detection ──

export function detectUserAction(url: string, method: string, idx: number, total: number): string {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('/login') || lowerUrl.includes('/auth') || lowerUrl.includes('/signin') || lowerUrl.includes('/token')) return 'Login';
  if (lowerUrl.includes('/session') || lowerUrl.includes('header-username') || lowerUrl.includes('header-password')) return 'Login';

  if (lowerUrl.includes('/lobby') || lowerUrl.includes('/casino-games/slots') || lowerUrl.includes('casino-search')) return 'Lobby Navigation';
  if (lowerUrl.includes('/search') || lowerUrl.includes('/categories') || lowerUrl.includes('/featured')) return 'Lobby Navigation';

  if (lowerUrl.includes('/game/') && (lowerUrl.includes('launch') || lowerUrl.includes('open') || lowerUrl.includes('init'))) return 'Game Launch';
  if (lowerUrl.includes('/gamelaunch') || lowerUrl.includes('/gc/') || lowerUrl.includes('iframe')) return 'Game Launch';

  if (lowerUrl.includes('/spin') || lowerUrl.includes('/bet') || lowerUrl.includes('/round') ||
      lowerUrl.includes('/wager') || lowerUrl.includes('/stake') || lowerUrl.includes('/result') ||
      lowerUrl.includes('/play/') || lowerUrl.includes('/rng')) return 'Gameplay (Bet/Spin)';

  if (lowerUrl.includes('.json') || lowerUrl.includes('/config') || lowerUrl.includes('/settings') ||
      lowerUrl.includes('/manifest') || lowerUrl.includes('/version') || lowerUrl.includes('/paytable')) return 'Game Config Load';

  if (lowerUrl.includes('analytics') || lowerUrl.includes('tracking') || lowerUrl.includes('telemetry') ||
      lowerUrl.includes('google') || lowerUrl.includes('facebook') || lowerUrl.includes('doubleclick') ||
      lowerUrl.includes('hotjar') || lowerUrl.includes('clarity') || lowerUrl.includes('segment') ||
      lowerUrl.includes('appsflyer') || lowerUrl.includes('/collect') || lowerUrl.includes('/event') ||
      lowerUrl.includes('/pixel') || lowerUrl.includes('/beacon') || lowerUrl.includes('bat.bing') ||
      lowerUrl.includes('optimizely') || lowerUrl.includes('newrelic') || lowerUrl.includes('sentry')) return 'Analytics/Tracking';

  if (lowerUrl.includes('/user') || lowerUrl.includes('/account') || lowerUrl.includes('/balance') ||
      lowerUrl.includes('/wallet') || lowerUrl.includes('/player') || lowerUrl.includes('/profile')) return 'User/Account';

  if (lowerUrl.includes('betway.co.za')) return 'Betway Platform';

  return 'Other';
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
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

// ── Main verification function ──

export function verifyHarFile(harFilePath: string, gameName: string, gameId: string): GameVerification {
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

    if (classification.included) includedEntries.push(classified);
    else excludedEntries.push(classified);

    if (!methodBreakdown[method]) methodBreakdown[method] = { included: 0, excluded: 0 };
    if (classification.included) methodBreakdown[method].included++;
    else methodBreakdown[method].excluded++;

    if (!domainBreakdown[domain]) domainBreakdown[domain] = { included: 0, excluded: 0 };
    if (classification.included) domainBreakdown[domain].included++;
    else domainBreakdown[domain].excluded++;
  }

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
