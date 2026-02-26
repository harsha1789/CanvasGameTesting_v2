import * as fs from 'fs';
import * as path from 'path';

interface HarEntry {
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    postData?: {
      text?: string;
      mimeType?: string;
    };
  };
  response: {
    status: number;
    content?: {
      text?: string;
    };
  };
}

interface TimelineEvent {
  time: string;
  type: string;
  detail: string;
  confidence: 'confirmed' | 'inferred';
}

interface ValidationCheck {
  key: string;
  title: string;
  passed: boolean;
  confidence: 'confirmed' | 'inferred';
  evidence: string[];
}

interface ServiceBusEventInfo {
  EventType?: number;
  EventSequence?: number;
  betdirection?: number;
  feature?: number;
  action?: string;
  component?: string;
  item?: string;
  ResponseDuration?: number;
  TransactionId?: number;
}

interface PlayRequestInfo {
  time: string;
  url: string;
  status: number;
  verbex?: string;
  chipSize?: string;
  numChips?: string;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function getArgValue(xml: string, key: string): string | undefined {
  const match = xml.match(new RegExp(`${key}="([^"]+)"`, 'i'));
  return match?.[1];
}

function readHarEntries(harPath: string): HarEntry[] {
  const content = fs.readFileSync(harPath, 'utf-8');
  const parsed = JSON.parse(content);
  return parsed.log?.entries || [];
}

function extractServiceBusEvents(entries: HarEntry[]): Array<{ time: string; event: ServiceBusEventInfo; host: string }> {
  const result: Array<{ time: string; event: ServiceBusEventInfo; host: string }> = [];
  for (const entry of entries) {
    const url = entry.request.url;
    if (!url.includes('servicebus.windows.net/h5events/messages')) continue;
    const postText = entry.request.postData?.text;
    if (!postText) continue;
    const payload = safeJsonParse<{ EventInfo?: ServiceBusEventInfo }>(postText);
    if (!payload?.EventInfo) continue;
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return 'unknown';
      }
    })();
    result.push({ time: entry.startedDateTime, event: payload.EventInfo, host });
  }
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

function extractPlayRequests(entries: HarEntry[]): PlayRequestInfo[] {
  const calls: PlayRequestInfo[] = [];

  for (const entry of entries) {
    const isPlayApi = entry.request.method === 'POST' &&
      /\/casino\/play\/public\/v1\/games\/module\/\d+\/client\/\d+\/play/i.test(entry.request.url);
    if (!isPlayApi) continue;

    const postText = entry.request.postData?.text || '';
    const payload = safeJsonParse<{ packet?: { payload?: string } }>(postText);
    const xml = payload?.packet?.payload || '';

    calls.push({
      time: entry.startedDateTime,
      url: entry.request.url,
      status: entry.response.status,
      verbex: getArgValue(xml, 'verbex'),
      chipSize: getArgValue(xml, 'chipSize'),
      numChips: getArgValue(xml, 'numChips'),
    });
  }

  return calls.sort((a, b) => a.time.localeCompare(b.time));
}

function buildValidation(entries: HarEntry[], harPath: string): { checks: ValidationCheck[]; timeline: TimelineEvent[] } {
  const checks: ValidationCheck[] = [];
  const timeline: TimelineEvent[] = [];

  const versionedLoads = entries.filter(e =>
    e.request.method === 'GET' &&
    /\/MobileWebGames\/VersionedGames\//i.test(e.request.url) &&
    e.response.status >= 200 &&
    e.response.status < 400
  );

  const playCalls = extractPlayRequests(entries);
  const serviceBusEvents = extractServiceBusEvents(entries);

  const betDirectionDown = serviceBusEvents.filter(e => e.event.EventType === 3615 && e.event.betdirection === 0);
  const betDirectionUp = serviceBusEvents.filter(e => e.event.EventType === 3615 && e.event.betdirection === 1);
  const featureOpenEvents = serviceBusEvents.filter(e => e.event.EventType === 3605);
  const featureInteractEvents = serviceBusEvents.filter(e => e.event.EventType === 3604);

  // 1) Game loaded
  checks.push({
    key: 'game_loaded',
    title: 'Game Launch Assets Loaded',
    passed: versionedLoads.length > 0,
    confidence: 'confirmed',
    evidence: versionedLoads.slice(0, 3).map(v => `${v.startedDateTime} ${v.request.url}`),
  });
  if (versionedLoads.length > 0) {
    timeline.push({
      time: versionedLoads[0].startedDateTime,
      type: 'game_loaded',
      detail: 'Versioned game assets requested from provider host',
      confidence: 'confirmed',
    });
  }

  // 2) Bet placed / spin
  const spinCalls = playCalls.filter(c => (c.verbex || '').toLowerCase() === 'spin' && c.status === 200);
  checks.push({
    key: 'spin_request',
    title: 'Spin / Bet Request Sent',
    passed: spinCalls.length > 0,
    confidence: 'confirmed',
    evidence: spinCalls.map(s => `${s.time} ${s.url} verbex=${s.verbex} chipSize=${s.chipSize} numChips=${s.numChips}`),
  });
  for (const spin of spinCalls) {
    timeline.push({
      time: spin.time,
      type: 'spin',
      detail: `Spin API called (chipSize=${spin.chipSize || '?'}, numChips=${spin.numChips || '?'})`,
      confidence: 'confirmed',
    });
  }

  // 3) Min/Max bet movement
  checks.push({
    key: 'min_bet',
    title: 'Minimum Bet Direction Event',
    passed: betDirectionDown.length > 0,
    confidence: 'confirmed',
    evidence: betDirectionDown.map(e => `${e.time} EventType=3615 betdirection=0 host=${e.host}`),
  });
  checks.push({
    key: 'max_bet',
    title: 'Maximum Bet Direction Event',
    passed: betDirectionUp.length > 0,
    confidence: 'confirmed',
    evidence: betDirectionUp.map(e => `${e.time} EventType=3615 betdirection=1 host=${e.host}`),
  });
  if (betDirectionDown.length > 0) {
    timeline.push({
      time: betDirectionDown[0].time,
      type: 'min_bet',
      detail: 'Detected betdirection=0 event',
      confidence: 'confirmed',
    });
  }
  if (betDirectionUp.length > 0) {
    timeline.push({
      time: betDirectionUp[0].time,
      type: 'max_bet',
      detail: 'Detected betdirection=1 event',
      confidence: 'confirmed',
    });
  }

  // 4) Menu/Paytable behavior (inferred from feature event pattern)
  const paytablePatternDetected = featureOpenEvents.length > 0 && featureInteractEvents.length >= 2;
  checks.push({
    key: 'paytable_flow',
    title: 'Hamburger/Paytable Open-Interact-Close Pattern',
    passed: paytablePatternDetected,
    confidence: 'inferred',
    evidence: [
      ...featureOpenEvents.slice(0, 2).map(e => `${e.time} EventType=3605 feature=${String(e.event.feature ?? '')}`),
      ...featureInteractEvents.slice(0, 4).map(e => `${e.time} EventType=3604 feature=${String(e.event.feature ?? '')}`),
      'HAR does not label these events as paytable/menu explicitly; mapped via repeated feature events pattern.',
    ],
  });
  if (paytablePatternDetected) {
    timeline.push({
      time: featureOpenEvents[0].time,
      type: 'menu_paytable_inferred',
      detail: `Feature panel pattern found (open=${featureOpenEvents.length}, interactions=${featureInteractEvents.length})`,
      confidence: 'inferred',
    });
  }

  // 5) Post-spin validation telemetry
  const transactionEvents = serviceBusEvents.filter(e => (e.event.EventType === 0 || e.event.EventType === undefined) && typeof e.event.TransactionId === 'number');
  checks.push({
    key: 'spin_validated',
    title: 'Spin Transaction Validation Telemetry',
    passed: transactionEvents.length > 0,
    confidence: 'confirmed',
    evidence: transactionEvents.map(e => `${e.time} txId=${e.event.TransactionId} responseDuration=${e.event.ResponseDuration ?? 'n/a'}ms host=${e.host}`),
  });
  for (const tx of transactionEvents) {
    timeline.push({
      time: tx.time,
      type: 'spin_validation',
      detail: `Transaction recorded (id=${tx.event.TransactionId}, duration=${tx.event.ResponseDuration ?? 'n/a'}ms)`,
      confidence: 'confirmed',
    });
  }

  // sort timeline
  timeline.sort((a, b) => a.time.localeCompare(b.time));

  // Add metadata check
  checks.push({
    key: 'har_readable',
    title: 'HAR Parsed Successfully',
    passed: true,
    confidence: 'confirmed',
    evidence: [`${path.basename(harPath)} entries=${entries.length}`],
  });

  return { checks, timeline };
}

function printReport(harPath: string, checks: ValidationCheck[], timeline: TimelineEvent[]): void {
  console.log('\n========================================');
  console.log('HAR GAMEPLAY VALIDATION REPORT');
  console.log('========================================');
  console.log(`File: ${harPath}`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  const failed = checks.filter(c => !c.passed);
  const passed = checks.filter(c => c.passed);

  console.log(`Summary: ${passed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.log(`Failed checks: ${failed.map(f => f.key).join(', ')}`);
  }

  console.log('\nChecks:');
  for (const c of checks) {
    const status = c.passed ? 'PASS' : 'FAIL';
    console.log(`- [${status}] ${c.title} (${c.confidence})`);
    for (const e of c.evidence.slice(0, 5)) {
      console.log(`    - ${e}`);
    }
  }

  console.log('\nTimeline:');
  for (const t of timeline) {
    console.log(`- ${t.time} | ${t.type} | ${t.detail} (${t.confidence})`);
  }
}

function saveJsonReport(harPath: string, checks: ValidationCheck[], timeline: TimelineEvent[]): string {
  const outputDir = path.resolve(__dirname, '..', 'reports', 'har-validation');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(outputDir, `har-gameplay-validation-${ts}.json`);
  const payload = {
    sourceHar: harPath,
    generatedAt: new Date().toISOString(),
    passCount: checks.filter(c => c.passed).length,
    failCount: checks.filter(c => !c.passed).length,
    checks,
    timeline,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  return outPath;
}

function main(): void {
  const argPath = process.argv[2];
  const defaultHar = path.resolve(__dirname, '..', 'har-files', 'Four fold th gold ggl mobile-app1-gtp176.installprogram.eu.har');
  const harPath = argPath ? path.resolve(argPath) : defaultHar;

  if (!fs.existsSync(harPath)) {
    console.error(`HAR file not found: ${harPath}`);
    process.exit(1);
  }

  const entries = readHarEntries(harPath);
  const { checks, timeline } = buildValidation(entries, harPath);
  printReport(harPath, checks, timeline);
  const outPath = saveJsonReport(harPath, checks, timeline);
  console.log(`\nJSON report: ${outPath}`);

  const hasFailures = checks.some(c => !c.passed);
  process.exit(hasFailures ? 2 : 0);
}

main();
