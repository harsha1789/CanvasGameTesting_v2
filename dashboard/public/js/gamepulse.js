/**
 * GamePulse Dashboard — Main JavaScript Controller
 * Handles tab switching, API calls, SSE listener, game queue, and tab rendering.
 */

// ── State ──
let gameQueue = [];
let sseSource = null;
let currentStatus = 'idle';
let gameProgressMap = {};

// ── Tab Switching ──
document.querySelectorAll('.tab-bar .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = 'tab-' + btn.dataset.tab;
    document.getElementById(tabId).classList.add('active');

    // Load data when switching to result tabs
    if (btn.dataset.tab === 'har-files') loadHarFiles();
    if (btn.dataset.tab === 'performance') loadPerformance();
    if (btn.dataset.tab === 'api-coverage') loadApiCoverage();
    if (btn.dataset.tab === 'verification') loadVerification();
    if (btn.dataset.tab === 'comparison') loadComparison();
    if (btn.dataset.tab === 'game-testing') loadGameTesting();
  });
});

// ── SSE Connection ──
function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource('/api/events');

  sseSource.addEventListener('connected', () => {
    console.log('SSE connected');
  });

  const events = ['recording:start', 'recording:game-start', 'recording:step',
    'recording:game-complete', 'recording:complete', 'loadtest:start',
    'loadtest:game-start', 'loadtest:game-complete', 'loadtest:complete',
    'report:generating', 'report:complete', 'pipeline:complete', 'log', 'error',
    'pipeline-test:start', 'pipeline-test:game-start', 'pipeline-test:step-result',
    'pipeline-test:game-complete', 'pipeline-test:log', 'pipeline-test:complete'];

  events.forEach(evt => {
    sseSource.addEventListener(evt, (e) => {
      const data = JSON.parse(e.data);
      handleSSEEvent(evt, data);
    });
  });

  sseSource.onerror = () => {
    console.warn('SSE connection error, will retry...');
  };
}

function handleSSEEvent(type, data) {
  switch (type) {
    case 'recording:start':
      setStatus('recording');
      showProgress(data.totalGames);
      break;
    case 'recording:game-start':
      updateGameProgress(data.gameId, data.gameName, 'recording', data.steps || []);
      break;
    case 'recording:step':
      updateGameStep(data.gameId, data.step, 'running');
      break;
    case 'recording:game-complete':
      updateGameProgress(data.gameId, null, data.success ? 'done' : 'failed');
      if (data.success) updateGameStep(data.gameId, null, 'done');
      break;
    case 'recording:complete':
      break;
    case 'loadtest:start':
      setStatus('load-testing');
      break;
    case 'loadtest:game-start':
      updateGameProgress(data.gameId, data.gameName, 'load-testing');
      break;
    case 'loadtest:game-complete':
      updateGameProgress(data.gameId, null, 'done');
      break;
    case 'loadtest:complete':
      break;
    case 'report:generating':
      setStatus('generating-reports');
      break;
    case 'pipeline:complete':
      setStatus('complete');
      appendLog(`Pipeline complete: ${data.harRecorded} HAR recorded, ${data.loadTested} load tested, ${data.gamesAnalyzed} analyzed`, 'info');
      break;
    case 'log':
      appendLog(data.message, data.level);
      break;
    case 'error':
      setStatus('error');
      appendLog(data.message, 'error');
      break;
    case 'pipeline-test:start':
      ptIsRunning = true;
      ptUpdateAbortBtn();
      ptShowProgress(data.totalGames, data.games);
      ptShowLogs();
      ptAppendLog('Pipeline started — testing ' + data.totalGames + ' game(s)', 'info');
      break;
    case 'pipeline-test:game-start':
      ptUpdateGameRow(data.gameId, 'running');
      ptAppendLog('Starting: ' + (data.gameName || data.gameId), 'info');
      break;
    case 'pipeline-test:step-result':
      ptUpdateStepChip(data.gameId, data.stepNum, data.status);
      ptAppendLog('[Step ' + data.stepNum + '] ' + data.stepName + ' — ' + data.status + ': ' + data.details, data.status.toLowerCase());
      break;
    case 'pipeline-test:game-complete':
      ptUpdateGameRow(data.gameId, data.status, data.score);
      ptAppendLog('Completed: ' + data.gameId + ' — Score: ' + data.score + ' (' + data.status + ')', data.status === 'pass' ? 'pass' : 'fail');
      break;
    case 'pipeline-test:log':
      ptShowLogs();
      ptAppendLog(data.message, data.stream === 'stderr' ? 'stderr' : ptClassifyLog(data.message));
      break;
    case 'pipeline-test:complete':
      ptIsRunning = false;
      ptUpdateAbortBtn();
      loadPipelineResults();
      document.getElementById('pt-download-report').disabled = false;
      document.getElementById('pt-validate-report').disabled = false;
      ptAppendLog('Pipeline complete — ' + (data.completedGames || 0) + '/' + (data.totalGames || 0) + ' games tested' + (data.aborted ? ' (aborted)' : ''), 'info');
      break;
  }
}

// ── Status ──
function setStatus(status) {
  currentStatus = status;
  const badge = document.getElementById('status-badge');
  const pulse = badge.querySelector('.pulse');
  badge.className = 'status-badge ' + status;
  pulse.className = 'pulse ' + status;
  const labels = {
    'idle': 'Idle', 'recording': 'Recording...', 'load-testing': 'Load Testing...',
    'generating-reports': 'Generating Reports...', 'complete': 'Complete', 'error': 'Error'
  };
  badge.querySelector('.status-text').textContent = labels[status] || status;

  document.getElementById('btn-record-only').disabled = status !== 'idle' && status !== 'complete';
  document.getElementById('btn-run-pipeline').disabled = status !== 'idle' && status !== 'complete';
  document.getElementById('btn-abort').disabled = status === 'idle' || status === 'complete';
  document.getElementById('btn-download-pdf').disabled = status !== 'complete';
}

// ── Progress ──
function showProgress(totalGames) {
  document.getElementById('progress-panel').classList.remove('hidden');
  document.getElementById('progress-overview').innerHTML = `<p style="color: var(--text-muted); font-size: 12px;">Processing ${totalGames} game(s)...</p>`;
  document.getElementById('progress-steps').innerHTML = '';
  document.getElementById('live-log').innerHTML = '';
  gameProgressMap = {};
}

function updateGameProgress(gameId, gameName, status, steps) {
  if (!gameProgressMap[gameId]) {
    gameProgressMap[gameId] = { name: gameName || gameId, status: 'pending', steps: {} };
  }
  if (gameName) gameProgressMap[gameId].name = gameName;
  gameProgressMap[gameId].status = status;
  if (steps) steps.forEach(s => { gameProgressMap[gameId].steps[s] = 'pending'; });
  renderGameProgress();
}

function updateGameStep(gameId, step, status) {
  if (!gameProgressMap[gameId]) return;
  if (step) gameProgressMap[gameId].steps[step] = status;
  else Object.keys(gameProgressMap[gameId].steps).forEach(s => { gameProgressMap[gameId].steps[s] = status; });
  renderGameProgress();
}

const STEP_LABELS = {
  'login': 'Login',
  'lobby': 'Lobby',
  'game-launch': 'Game Launch',
  'bet': 'Bet',
  'spin': 'Spin',
  'gameplay-slots': 'Slot Gameplay',
  'gameplay-crash-games': 'Crash Gameplay',
  'gameplay-table-game': 'Table Gameplay',
  'gameplay-live-casino': 'Live Gameplay',
};

function renderGameProgress() {
  const container = document.getElementById('progress-steps');
  container.innerHTML = Object.entries(gameProgressMap).map(([id, game]) => {
    const stepIcons = { 'pending': '&#9675;', 'running': '&#9684;', 'done': '&#10003;', 'failed': '&#10007;' };
    const stepsHtml = Object.entries(game.steps).map(([step, st]) =>
      `<span class="step-chip ${st}">${stepIcons[st] || ''} ${STEP_LABELS[step] || step}</span>`
    ).join('');
    const statusLabel = { 'recording': 'Recording', 'load-testing': 'Load Testing', 'done': 'Done', 'failed': 'Failed', 'pending': 'Waiting' };
    return `<div class="game-progress-row">
      <span class="game-name">${esc(game.name)}</span>
      <span style="font-size:11px;color:var(--text-dim);">${statusLabel[game.status] || game.status}</span>
      <div class="step-list">${stepsHtml}</div>
    </div>`;
  }).join('');
}

function appendLog(message, level) {
  const log = document.getElementById('live-log');
  const ts = new Date().toLocaleTimeString();
  log.innerHTML += `<div class="log-line ${level}">[${ts}] ${esc(message)}</div>`;
  log.scrollTop = log.scrollHeight;
}

// ── Game Queue ──
function addGameToQueue(url, name, category, provider, subType) {
  if (!url) return;
  const id = extractIdFromUrl(url);
  name = name || extractNameFromUrl(url);
  if (gameQueue.find(g => g.id === id)) return;
  const game = { url, name, id, category: category || 'slots', provider: provider || 'Unknown' };
  if (subType) game.subType = subType;
  gameQueue.push(game);
  renderQueue();
}

function removeFromQueue(id) {
  gameQueue = gameQueue.filter(g => g.id !== id);
  renderQueue();
}

function clearQueue() {
  gameQueue = [];
  renderQueue();
}

function renderQueue() {
  document.getElementById('queue-count').textContent = gameQueue.length;
  const tbody = document.querySelector('#game-queue-table tbody');
  if (!gameQueue.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="queue-empty">No games in queue. Add games using the URL input or Excel upload above.</td></tr>';
    return;
  }
  tbody.innerHTML = gameQueue.map((g, i) => `<tr>
    <td>${i + 1}</td>
    <td style="color:var(--text-primary);font-weight:600;">${esc(g.name)}</td>
    <td style="font-size:11px;color:var(--cyan);">${g.category || 'slots'}</td>
    <td style="font-size:11px;color:var(--text-dim);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(g.url)}</td>
    <td><button class="btn small danger" onclick="removeFromQueue('${g.id}')">Remove</button></td>
  </tr>`).join('');
}

// ── URL helpers ──
function extractNameFromUrl(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || 'unknown-game';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return 'Unknown Game'; }
}
function extractIdFromUrl(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || 'unknown-game'; }
  catch { return 'unknown-game'; }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Event Listeners: Setup Tab ──
document.getElementById('btn-add-url').addEventListener('click', () => {
  const url = document.getElementById('game-url').value.trim();
  const name = document.getElementById('game-name').value.trim();
  addGameToQueue(url, name);
  document.getElementById('game-url').value = '';
  document.getElementById('game-name').value = '';
});

document.getElementById('game-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-url').click();
});

document.getElementById('btn-clear-queue').addEventListener('click', clearQueue);
document.getElementById('btn-select-all').addEventListener('click', () => {
  document.querySelectorAll('.feature-checkboxes input').forEach(cb => cb.checked = true);
});
document.getElementById('btn-deselect-all').addEventListener('click', () => {
  document.querySelectorAll('.feature-checkboxes input').forEach(cb => cb.checked = false);
});

// Drop zone
const dropZone = document.getElementById('drop-zone');
const excelInput = document.getElementById('excel-file');
dropZone.addEventListener('click', () => excelInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) uploadExcel(e.dataTransfer.files[0]);
});
excelInput.addEventListener('change', () => {
  if (excelInput.files.length) uploadExcel(excelInput.files[0]);
});

async function uploadExcel(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/upload-excel', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    data.games.forEach(g => {
      if (!gameQueue.find(q => q.id === g.id)) gameQueue.push(g);
    });
    renderQueue();
    document.getElementById('excel-preview').innerHTML = `<p style="color:var(--color-success);font-size:12px;">Loaded ${data.count} game(s) from Excel</p>`;
  } catch (err) {
    alert('Failed to upload Excel: ' + err.message);
  }
}

// ── Feature flags ──
function getFeatureFlags() {
  return {
    login: document.getElementById('feat-login').checked,
    lobbyNavigation: document.getElementById('feat-lobby').checked,
    gameLaunch: document.getElementById('feat-launch').checked,
    betAdjustment: document.getElementById('feat-bet').checked,
    spin: document.getElementById('feat-spin').checked,
  };
}

function getLoadTestConfig() {
  return {
    enabled: document.getElementById('cfg-load-test-enabled').checked,
    virtualUsers: parseInt(document.getElementById('cfg-vus').value) || 5,
    iterations: parseInt(document.getElementById('cfg-iterations').value) || 2,
    rampUpSeconds: parseInt(document.getElementById('cfg-rampup').value) || 5,
    thinkTimeMs: parseInt(document.getElementById('cfg-thinktime').value) || 500,
  };
}

// Toggle load test config inputs based on checkbox
(function () {
  const cb = document.getElementById('cfg-load-test-enabled');
  const opts = document.getElementById('load-test-options');
  function toggle() { opts.style.opacity = cb.checked ? '1' : '0.4'; opts.style.pointerEvents = cb.checked ? 'auto' : 'none'; }
  cb.addEventListener('change', toggle);
  toggle(); // initial state (unchecked = disabled)
})();

// ── Action Buttons ──
document.getElementById('btn-record-only').addEventListener('click', async () => {
  if (!gameQueue.length) { alert('Add games to the queue first'); return; }
  try {
    const res = await fetch('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: gameQueue, features: getFeatureFlags() }),
    });
    const data = await res.json();
    if (res.status === 409 && confirm(data.error + '\n\nForce-reset and retry?')) {
      await fetch('/api/reset', { method: 'POST' });
      setStatus('idle');
      return;
    }
    if (data.error) { alert(data.error); return; }
    showProgress(gameQueue.length);
  } catch (err) { alert('Error: ' + err.message); }
});

document.getElementById('btn-run-pipeline').addEventListener('click', async () => {
  if (!gameQueue.length) { alert('Add games to the queue first'); return; }
  try {
    const res = await fetch('/api/run-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        games: gameQueue,
        features: getFeatureFlags(),
        loadTestConfig: getLoadTestConfig(),
      }),
    });
    const data = await res.json();
    if (res.status === 409 && confirm(data.error + '\n\nForce-reset and retry?')) {
      await fetch('/api/reset', { method: 'POST' });
      setStatus('idle');
      return;
    }
    if (data.error) { alert(data.error); return; }
    showProgress(gameQueue.length);
  } catch (err) { alert('Error: ' + err.message); }
});

document.getElementById('btn-abort').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/abort', { method: 'POST' });
    const data = await res.json();
    if (data.aborted) {
      setStatus('idle');
    } else if (confirm('No active operation to abort. Force-reset the session?')) {
      await fetch('/api/reset', { method: 'POST' });
      setStatus('idle');
    }
  } catch { /* ignore */ }
});

document.getElementById('btn-download-pdf').addEventListener('click', async () => {
  const btn = document.getElementById('btn-download-pdf');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating PDF...';
  try {
    const res = await fetch('/api/download-report');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      alert('Failed to generate PDF: ' + (err.error || res.statusText));
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `gamepulse-report-${dateStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error downloading PDF: ' + err.message);
  } finally {
    btn.textContent = origText;
    btn.disabled = currentStatus !== 'complete';
  }
});

// ── Load Catalog on startup ──
async function loadCatalog() {
  try {
    const res = await fetch('/api/games/catalog');
    const data = await res.json();
    if (data.games && data.games.length > 0) {
      const catalogDiv = document.getElementById('catalog-games');
      if (catalogDiv) {
        catalogDiv.innerHTML = '<h3 style="margin-bottom:8px;">Quick Add from Catalog</h3><div style="display:flex;gap:6px;flex-wrap:wrap;">'
          + data.games.map(g => `<button class="btn small secondary" onclick="addGameToQueue('${g.url}','${esc(g.name)}','${g.category || 'slots'}','${g.provider || 'Unknown'}','${g.subType || ''}')">${esc(g.name)} <span style="font-size:9px;opacity:0.6;">${g.category || 'slots'}</span></button>`).join('')
          + '</div>';
      }
    }
  } catch { /* ignore */ }
}

// ── Tab Data Loaders ──

async function loadHarFiles() {
  try {
    const res = await fetch('/api/har-files');
    const data = await res.json();
    const tbody = document.querySelector('#har-files-table tbody');
    if (!data.files || !data.files.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="queue-empty">No HAR files found. Record some games first.</td></tr>';
      return;
    }
    tbody.innerHTML = data.files.map(f => `<tr>
      <td style="color:var(--text-primary);font-weight:600;">${esc(f.gameName)}</td>
      <td>${f.fileSizeFormatted}</td>
      <td>${f.entryCount.toLocaleString()}</td>
      <td style="color:var(--text-dim);font-size:11px;">${new Date(f.recordedAt).toLocaleString()}</td>
      <td><span style="color:var(--color-success);font-size:11px;">&#10003; Available</span></td>
    </tr>`).join('');
  } catch { /* ignore */ }
}

async function loadPerformance() {
  const container = document.getElementById('performance-content');
  try {
    const res = await fetch('/api/results/performance');
    const data = await res.json();
    if (!data.results || !data.results.length) {
      container.innerHTML = '<div class="empty-state"><h3>No Performance Data</h3><p>Run the full pipeline to generate load test results.</p></div>';
      return;
    }
    const results = data.results;
    const totalReqs = results.reduce((s, r) => s + r.totalRequests, 0);
    const totalSuccess = results.reduce((s, r) => s + r.successfulRequests, 0);
    const totalFail = results.reduce((s, r) => s + r.failedRequests, 0);
    const avgRT = Math.round(results.reduce((s, r) => s + r.avgResponseTimeMs, 0) / results.length);
    const avgErrRate = (results.reduce((s, r) => s + r.errorRate, 0) / results.length).toFixed(1);

    let html = `<div class="summary-grid">
      <div class="summary-card"><div class="label">Games Tested</div><div class="value cyan">${results.length}</div></div>
      <div class="summary-card"><div class="label">Total Requests</div><div class="value white">${totalReqs.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Successful</div><div class="value green">${totalSuccess.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Failed</div><div class="value red">${totalFail.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Avg Response</div><div class="value blue">${avgRT}ms</div></div>
      <div class="summary-card"><div class="label">Avg Error Rate</div><div class="value ${parseFloat(avgErrRate) > 5 ? 'red' : 'green'}">${avgErrRate}%</div></div>
    </div>`;

    // Comparison table
    html += `<div class="section"><h2>Game Comparison</h2><div class="scroll-table"><table>
      <thead><tr><th>Game</th><th>Requests</th><th>Success</th><th>Failed</th><th>Error %</th><th>Avg (ms)</th><th>P95 (ms)</th><th>P99 (ms)</th><th>Req/s</th></tr></thead><tbody>`;
    results.forEach(r => {
      html += `<tr>
        <td style="color:var(--text-primary);font-weight:600;">${esc(r.gameName)}</td>
        <td>${r.totalRequests.toLocaleString()}</td>
        <td class="s2xx">${r.successfulRequests.toLocaleString()}</td>
        <td class="${r.failedRequests > 0 ? 's5xx' : ''}">${r.failedRequests.toLocaleString()}</td>
        <td style="color:${r.errorRate > 10 ? 'var(--color-danger)' : r.errorRate > 5 ? 'var(--color-warning)' : 'var(--color-success)'};font-weight:700;">${r.errorRate.toFixed(1)}%</td>
        <td>${Math.round(r.avgResponseTimeMs)}</td>
        <td>${Math.round(r.p95ResponseTimeMs)}</td>
        <td>${Math.round(r.p99ResponseTimeMs)}</td>
        <td>${r.requestsPerSecond.toFixed(1)}</td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;

    // Per-game details
    results.forEach(r => {
      const statusEntries = Object.entries(r.statusCodeDistribution || {});
      html += `<details class="section" style="padding:0;border:1px solid var(--border);"><summary style="padding:14px 20px;">${esc(r.gameName)} — ${r.totalRequests} requests, ${r.errorRate.toFixed(1)}% errors</summary>
        <div style="padding:16px 20px;">
          <div class="summary-grid">
            <div class="summary-card"><div class="label">Avg</div><div class="value blue">${Math.round(r.avgResponseTimeMs)}ms</div></div>
            <div class="summary-card"><div class="label">Median</div><div class="value blue">${Math.round(r.medianResponseTimeMs)}ms</div></div>
            <div class="summary-card"><div class="label">P90</div><div class="value cyan">${Math.round(r.p90ResponseTimeMs)}ms</div></div>
            <div class="summary-card"><div class="label">P95</div><div class="value cyan">${Math.round(r.p95ResponseTimeMs)}ms</div></div>
            <div class="summary-card"><div class="label">P99</div><div class="value red">${Math.round(r.p99ResponseTimeMs)}ms</div></div>
            <div class="summary-card"><div class="label">Req/s</div><div class="value green">${r.requestsPerSecond.toFixed(1)}</div></div>
          </div>
          ${statusEntries.length ? '<h3>Status Codes</h3><div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">' + statusEntries.map(([code, cnt]) => `<span class="step-chip ${parseInt(code) < 300 ? 'done' : parseInt(code) < 400 ? 'pending' : 'failed'}">${code}: ${cnt}</span>`).join('') + '</div>' : ''}
          ${r.topSlowestRequests && r.topSlowestRequests.length ? '<h3>Top 5 Slowest</h3><table><thead><tr><th>Method</th><th>URL</th><th>Time</th></tr></thead><tbody>' + r.topSlowestRequests.slice(0, 5).map(s => `<tr><td class="method ${s.method.toLowerCase()}">${s.method}</td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:11px;color:var(--text-dim);">${esc(s.url)}</td><td style="color:var(--color-danger);font-weight:700;">${Math.round(s.responseTimeMs)}ms</td></tr>`).join('') + '</tbody></table>' : ''}
        </div></details>`;
    });

    container.innerHTML = html;
  } catch { container.innerHTML = '<div class="empty-state"><h3>Error Loading Performance Data</h3></div>'; }
}

async function loadApiCoverage() {
  const container = document.getElementById('tab-api-coverage');
  try {
    const res = await fetch('/api/results/api-coverage');
    const data = await res.json();
    if (!data.reports || !data.reports.length) {
      container.innerHTML = '<div class="empty-state"><h3>No API Coverage Data</h3><p>Record HAR files first — analysis will be generated automatically.</p></div>';
      return;
    }
    const reports = data.reports;
    const totalApi = reports.reduce((s, r) => s + r.apiEntries, 0);
    const totalEntries = reports.reduce((s, r) => s + r.totalEntries, 0);
    const totalEndpoints = reports.reduce((s, r) => s + r.uniqueEndpoints, 0);

    // Aggregate categories
    const catAgg = {};
    reports.forEach(r => r.categorySummary.forEach(c => { catAgg[c.category] = (catAgg[c.category] || 0) + c.count; }));
    const sortedCats = Object.entries(catAgg).sort((a, b) => b[1] - a[1]);

    let html = `<div class="summary-grid">
      <div class="summary-card"><div class="label">Games Analyzed</div><div class="value cyan">${reports.length}</div></div>
      <div class="summary-card"><div class="label">Total HAR Entries</div><div class="value white">${totalEntries.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">API Calls</div><div class="value green">${totalApi.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Unique Endpoints</div><div class="value blue">${totalEndpoints.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Categories</div><div class="value cyan">${sortedCats.length}</div></div>
    </div>`;

    // Category breakdown
    html += `<div class="section"><h2>Category Breakdown (All Games)</h2><div class="scroll-table"><table>
      <thead><tr><th>Category</th><th>Total Calls</th><th>% of API Calls</th><th>Bar</th></tr></thead><tbody>`;
    const maxCat = sortedCats[0]?.[1] || 1;
    sortedCats.forEach(([cat, count]) => {
      const pct = ((count / totalApi) * 100).toFixed(1);
      const barW = (count / maxCat) * 100;
      html += `<tr>
        <td style="color:var(--text-primary);font-weight:600;">${esc(cat)}</td>
        <td>${count.toLocaleString()}</td>
        <td>${pct}%</td>
        <td style="width:200px;"><div style="background:var(--border);border-radius:3px;height:16px;overflow:hidden;"><div style="width:${barW}%;height:100%;background:var(--color-accent);border-radius:3px;"></div></div></td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';

    // Per-game
    reports.forEach(r => {
      const chips = r.categorySummary.map(c => `<span class="cat-chip other">${esc(c.category)} (${c.count})</span>`).join('');
      html += `<details class="section" style="padding:0;border:1px solid var(--border);"><summary style="padding:14px 20px;">${esc(r.gameName)} — ${r.apiEntries} API calls, ${r.uniqueEndpoints} endpoints</summary>
        <div style="padding:16px 20px;">
          <div style="margin-bottom:10px;">${chips}</div>
          <table><thead><tr><th>Category</th><th>Calls</th><th>Methods</th><th>Avg Time</th></tr></thead><tbody>
          ${r.categorySummary.map(c => `<tr><td style="color:var(--text-primary);">${esc(c.category)}</td><td>${c.count}</td><td style="font-family:monospace;font-size:11px;">${esc(c.methods)}</td><td>${c.avgTime}ms</td></tr>`).join('')}
          </tbody></table>
          ${r.topEndpointsByFrequency.length ? '<h3 style="margin-top:12px;">Top Endpoints</h3><table><thead><tr><th>Method</th><th>Endpoint</th><th>Hits</th></tr></thead><tbody>' + r.topEndpointsByFrequency.map(ep => `<tr><td class="method ${ep.method.toLowerCase()}">${ep.method}</td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:11px;color:var(--text-dim);">${esc(ep.url)}</td><td>${ep.count}</td></tr>`).join('') + '</tbody></table>' : ''}
        </div></details>`;
    });

    container.innerHTML = html;
  } catch { container.innerHTML = '<div class="empty-state"><h3>Error Loading API Coverage</h3></div>'; }
}

async function loadVerification() {
  const container = document.getElementById('tab-verification');
  try {
    const res = await fetch('/api/results/verification');
    const data = await res.json();
    if (!data.verifications || !data.verifications.length) {
      container.innerHTML = '<div class="empty-state"><h3>No Verification Data</h3><p>Record HAR files first — verification will be generated automatically.</p></div>';
      return;
    }
    const verifications = data.verifications;
    const totalHar = verifications.reduce((s, v) => s + v.totalHarEntries, 0);
    const totalIncluded = verifications.reduce((s, v) => s + v.includedCount, 0);
    const totalExcluded = verifications.reduce((s, v) => s + v.excludedCount, 0);
    const inclusionRate = totalHar > 0 ? ((totalIncluded / totalHar) * 100).toFixed(1) : '0';

    let html = `<div class="trust-banner">
      <h2>How to Verify This Data</h2>
      <p>This analysis uses the <strong>exact same filtering logic</strong> as <code>har-load-tester.ts::filterApiRequests()</code>.</p>
      <p>Every entry marked INCLUDED was replayed during load testing. Every EXCLUDED entry has a stated reason.</p>
    </div>`;

    html += `<div class="summary-grid">
      <div class="summary-card"><div class="label">Total HAR Entries</div><div class="value white">${totalHar.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Included (Load Tested)</div><div class="value green">${totalIncluded.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Excluded</div><div class="value red">${totalExcluded.toLocaleString()}</div></div>
      <div class="summary-card"><div class="label">Inclusion Rate</div><div class="value blue">${inclusionRate}%</div></div>
      <div class="summary-card"><div class="label">Games Verified</div><div class="value cyan">${verifications.length}</div></div>
    </div>`;

    // Per-game summary table
    html += `<div class="section"><h2>Per-Game Summary</h2><table>
      <thead><tr><th>Game</th><th>Total</th><th>Included</th><th>Excluded</th><th>Rate</th><th>Bar</th></tr></thead><tbody>`;
    verifications.forEach(v => {
      const rate = v.totalHarEntries > 0 ? ((v.includedCount / v.totalHarEntries) * 100).toFixed(1) : '0';
      html += `<tr>
        <td style="color:var(--text-primary);font-weight:600;">${esc(v.gameName)}</td>
        <td>${v.totalHarEntries.toLocaleString()}</td>
        <td style="color:var(--color-success);font-weight:700;">${v.includedCount}</td>
        <td style="color:var(--color-danger);font-weight:700;">${v.excludedCount}</td>
        <td>${rate}%</td>
        <td style="width:150px;"><div class="inclusion-bar"><div class="included" style="width:${rate}%"></div><div class="excluded" style="width:${100 - parseFloat(rate)}%"></div></div></td>
      </tr>`;
    });
    html += '</tbody></table></div>';

    // Per-game timeline
    verifications.forEach(v => {
      if (!v.timeline || !v.timeline.length) return;
      html += `<details class="section" style="padding:0;border:1px solid var(--border);"><summary style="padding:14px 20px;">${esc(v.gameName)} — ${v.includedCount} included, ${v.excludedCount} excluded</summary>
        <div style="padding:16px 20px;">
        <h3>Action Timeline</h3>
        <table><thead><tr><th>Action</th><th>HAR Range</th><th>Included</th><th>Total</th><th>Coverage</th></tr></thead><tbody>
        ${v.timeline.map(t => `<tr><td style="color:var(--text-primary);">${esc(t.action)}</td><td style="font-family:monospace;font-size:11px;">#${t.startIdx} – #${t.endIdx}</td><td style="color:var(--color-success);font-weight:700;">${t.includedApis}</td><td>${t.totalApis}</td><td>${t.totalApis > 0 ? Math.round((t.includedApis / t.totalApis) * 100) : 0}%</td></tr>`).join('')}
        </tbody></table>
        </div></details>`;
    });

    container.innerHTML = html;
  } catch { container.innerHTML = '<div class="empty-state"><h3>Error Loading Verification</h3></div>'; }
}

async function loadComparison() {
  const container = document.getElementById('tab-comparison');
  try {
    const res = await fetch('/api/results/comparison');
    const data = await res.json();
    if (!data.games || !data.games.length) {
      container.innerHTML = '<div class="empty-state"><h3>No Comparison Data</h3><p>Record HAR files and run the pipeline first.</p></div>';
      return;
    }

    let html = `<div class="section"><h2>Cross-Game Metrics Matrix</h2><div class="scroll-table"><table>
      <thead><tr><th>Game</th><th>HAR Entries</th><th>API Calls</th><th>Static</th><th>Endpoints</th><th>Categories</th><th>Inclusion %</th>
      ${data.games[0].avgResponseTimeMs !== undefined ? '<th>Avg RT</th><th>P95</th><th>Error %</th><th>Req/s</th>' : ''}</tr></thead><tbody>`;
    data.games.forEach(g => {
      html += `<tr>
        <td style="color:var(--text-primary);font-weight:600;">${esc(g.gameName)}</td>
        <td>${g.totalEntries.toLocaleString()}</td>
        <td style="color:var(--color-success);">${g.apiEntries.toLocaleString()}</td>
        <td style="color:var(--text-dim);">${g.staticEntries.toLocaleString()}</td>
        <td>${g.uniqueEndpoints}</td>
        <td>${g.categories}</td>
        <td><div class="inclusion-bar" style="width:100px;display:inline-flex;"><div class="included" style="width:${g.inclusionRate}%"></div><div class="excluded" style="width:${100 - g.inclusionRate}%"></div></div> ${g.inclusionRate}%</td>
        ${g.avgResponseTimeMs !== undefined ? `<td>${Math.round(g.avgResponseTimeMs)}ms</td><td>${Math.round(g.p95ResponseTimeMs)}ms</td><td style="color:${g.errorRate > 10 ? 'var(--color-danger)' : g.errorRate > 5 ? 'var(--color-warning)' : 'var(--color-success)'};font-weight:700;">${g.errorRate.toFixed(1)}%</td><td>${g.requestsPerSecond.toFixed(1)}</td>` : ''}
      </tr>`;
    });
    html += '</tbody></table></div></div>';

    // Category heatmap
    if (data.allCategories && data.allCategories.length) {
      const cats = data.allCategories.slice(0, 12);
      const colCount = cats.length + 1;
      html += `<div class="section"><h2>Category Heatmap</h2>
        <div class="heatmap" style="grid-template-columns: 160px repeat(${cats.length}, 1fr);">
        <div class="heatmap-header"></div>
        ${cats.map(c => `<div class="heatmap-header">${esc(c.length > 12 ? c.slice(0, 12) + '..' : c)}</div>`).join('')}`;

      const maxCount = Math.max(...data.games.flatMap(g => cats.map(c => g.categoryBreakdown[c] || 0)), 1);
      data.games.forEach(g => {
        html += `<div class="heatmap-label">${esc(g.gameName)}</div>`;
        cats.forEach(c => {
          const count = g.categoryBreakdown[c] || 0;
          const intensity = count > 0 ? 0.2 + (count / maxCount) * 0.8 : 0;
          const bg = count > 0 ? `rgba(6,182,212,${intensity.toFixed(2)})` : 'rgba(51,65,85,0.3)';
          html += `<div class="heatmap-cell" style="background:${bg};">${count || '-'}</div>`;
        });
      });
      html += '</div></div>';
    }

    container.innerHTML = html;
  } catch { container.innerHTML = '<div class="empty-state"><h3>Error Loading Comparison</h3></div>'; }
}

// ── Game Testing Tab ──

let ptCatalogGames = [];
let ptSelectedGameIds = new Set();
let ptManualGames = []; // Manually added games (not in catalog)
let ptIsRunning = false;
let ptGameTestingLoaded = false;

// Screenshot step names mapping (matches test spec file naming)
const PT_SCREENSHOT_STEPS = {
  1: '01-lobby',
  2: '02-after-play',
  3: '03-game-loaded',
  4: '04b-after-continue',
  5: '05-credits',
  6: '06b-after-gameplay',
  7: '07b-after-minbet',
  8: '08b-after-maxbet',
  9: '09b-after-betreset',
  10: '10b-after-paytable',
  11: '11b-after-autospin',
};

async function loadGameTesting() {
  if (ptGameTestingLoaded && ptCatalogGames.length > 0) return;
  try {
    const res = await fetch('/api/games/catalog');
    const data = await res.json();
    ptCatalogGames = data.games || [];
    renderPtGameGrid();
    ptGameTestingLoaded = true;
    // Also check for existing results
    loadPipelineResults();
  } catch { /* ignore */ }
}

function renderPtGameGrid() {
  const container = document.getElementById('pt-game-selection');
  if (!ptCatalogGames.length) {
    container.innerHTML = '<div class="empty-state"><p>No games in catalog.</p></div>';
    return;
  }

  // Group by category
  const groups = {};
  const categoryOrder = ['slots', 'crash-games', 'table-game', 'live-casino'];
  const categoryLabels = { 'slots': 'Slots', 'crash-games': 'Crash Games', 'table-game': 'Table Games', 'live-casino': 'Live Casino' };

  ptCatalogGames.forEach(g => {
    const cat = g.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(g);
  });

  let html = '';
  const orderedCats = categoryOrder.filter(c => groups[c]);
  // Add any categories not in our predefined order
  Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });

  orderedCats.forEach(cat => {
    html += `<div class="pt-category-header">${categoryLabels[cat] || cat} (${groups[cat].length})</div>`;
    html += '<div class="pt-game-grid">';
    groups[cat].forEach(g => {
      const checked = ptSelectedGameIds.has(g.id) ? 'checked' : '';
      const selectedClass = ptSelectedGameIds.has(g.id) ? 'selected' : '';
      html += `<label class="pt-game-checkbox ${selectedClass}" data-game-id="${g.id}">
        <input type="checkbox" ${checked} onchange="ptToggleGame('${g.id}', this)">
        <span class="pt-game-name">${esc(g.name)}</span>
        <span class="pt-game-provider">${esc(g.provider)}</span>
      </label>`;
    });
    html += '</div>';
  });

  container.innerHTML = html;
  ptUpdateSelectedCount();
}

function ptToggleGame(gameId, checkbox) {
  if (checkbox.checked) {
    ptSelectedGameIds.add(gameId);
    checkbox.closest('.pt-game-checkbox').classList.add('selected');
  } else {
    ptSelectedGameIds.delete(gameId);
    checkbox.closest('.pt-game-checkbox').classList.remove('selected');
  }
  ptUpdateSelectedCount();
}

function ptUpdateSelectedCount() {
  const el = document.getElementById('pt-selected-count');
  if (el) el.textContent = ptSelectedGameIds.size;
}

function ptUpdateAbortBtn() {
  const abortBtn = document.getElementById('pt-abort');
  const runBtn = document.getElementById('pt-run-selected');
  const runAllBtn = document.getElementById('pt-run-all');
  if (abortBtn) abortBtn.disabled = !ptIsRunning;
  if (runBtn) runBtn.disabled = ptIsRunning;
  if (runAllBtn) runAllBtn.disabled = ptIsRunning;
}

function ptShowProgress(totalGames, games) {
  const panel = document.getElementById('pt-progress-panel');
  panel.classList.remove('hidden');
  document.getElementById('pt-progress-overview').textContent = `Running pipeline validation on ${totalGames} game(s)...`;

  const container = document.getElementById('pt-progress-rows');
  const stepHeaders = ['Lobby', 'Play', 'Load', 'Continue', 'Credits', 'Spin', 'Min Bet', 'Max Bet', 'Bet Reset', 'Paytable', 'Auto-Spin'];
  container.innerHTML = (games || []).map(g =>
    `<div class="pt-progress-row" id="pt-prog-${g.id}">
      <span class="pt-prog-name" title="${esc(g.name)}">${esc(g.name)}</span>
      <span class="pt-prog-status" id="pt-prog-status-${g.id}" style="color:var(--text-dim);">Pending</span>
      <div class="pt-prog-steps">
        ${stepHeaders.map((s, i) => `<span class="pt-step-chip pending" id="pt-chip-${g.id}-${i + 1}">${s}</span>`).join('')}
      </div>
    </div>`
  ).join('');
}

function ptUpdateGameRow(gameId, status, score) {
  const statusEl = document.getElementById(`pt-prog-status-${gameId}`);
  if (!statusEl) return;

  const labels = { running: 'Running', pass: 'Passed', fail: 'Failed', pending: 'Pending' };
  const colors = { running: 'var(--color-info)', pass: 'var(--color-success)', fail: 'var(--color-danger)', pending: 'var(--text-dim)' };

  statusEl.textContent = score ? `${labels[status] || status} (${score})` : (labels[status] || status);
  statusEl.style.color = colors[status] || 'var(--text-dim)';
}

function ptUpdateStepChip(gameId, stepNum, status) {
  const chip = document.getElementById(`pt-chip-${gameId}-${stepNum}`);
  if (!chip) return;
  // Remove old status classes and add new one
  chip.className = `pt-step-chip ${status.toLowerCase()}`;
}

// ── Live Logs ──

function ptShowLogs() {
  const panel = document.getElementById('pt-logs-panel');
  if (panel) panel.style.display = 'block';
}

function ptAppendLog(message, cls) {
  const output = document.getElementById('pt-logs-output');
  if (!output) return;
  const line = document.createElement('span');
  line.className = 'pt-log-line ' + (cls || 'dim');
  const ts = new Date().toLocaleTimeString('en-ZA', { hour12: false });
  line.textContent = '[' + ts + '] ' + message;
  output.appendChild(line);
  output.appendChild(document.createTextNode('\n'));
  // Auto-scroll to bottom
  const container = output.parentElement;
  container.scrollTop = container.scrollHeight;
}

function ptClassifyLog(msg) {
  if (/\bPASS\b/i.test(msg)) return 'pass';
  if (/\bFAIL\b/i.test(msg)) return 'fail';
  if (/\bWARN\b/i.test(msg)) return 'warn';
  if (/\[Step \d+\]/i.test(msg)) return 'step';
  if (/Score:/i.test(msg) || /Pipeline Results/i.test(msg)) return 'info';
  return 'dim';
}

document.getElementById('pt-logs-clear')?.addEventListener('click', () => {
  const output = document.getElementById('pt-logs-output');
  if (output) output.innerHTML = '';
});

document.getElementById('pt-logs-toggle')?.addEventListener('click', () => {
  const container = document.getElementById('pt-logs-container');
  const btn = document.getElementById('pt-logs-toggle');
  if (container.classList.contains('collapsed')) {
    container.classList.remove('collapsed');
    btn.textContent = 'Collapse';
  } else {
    container.classList.add('collapsed');
    btn.textContent = 'Expand';
  }
});

async function startPipelineTests(games) {
  if (!games.length) { alert('No games selected'); return; }
  const headed = document.getElementById('pt-headed-mode')?.checked || false;
  const annotateClicks = document.getElementById('pt-annotate-clicks')?.checked || false;
  const autoCaptureImages = true;
  try {
    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games, headed, annotateClicks, autoCaptureImages }),
    });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: raw };
    }
    if (res.status === 409) {
      alert(data.error || 'Tests are already running');
      return;
    }
    if (!res.ok) {
      const msg = data.error || (`${res.status} ${res.statusText}`);
      ptShowLogs();
      ptAppendLog('Pipeline start failed: ' + msg, 'stderr');
      alert('Server error: ' + res.status + ' ' + res.statusText + '\n' + msg);
      return;
    }
    if (data.error) { alert(data.error); return; }
    // Progress handled by SSE events
  } catch (err) {
    alert('Failed to start pipeline tests: ' + err.message);
  }
}

async function loadPipelineResults() {
  try {
    const res = await fetch('/api/pipeline/results');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.games || !data.games.length || data.status === 'idle') {
      document.getElementById('pt-results-panel').style.display = 'none';
      document.getElementById('pt-download-report').disabled = true;
      document.getElementById('pt-validate-report').disabled = true;
      return;
    }
    renderPipelineResults(data);
    const canDownload = (data.status === 'complete' || data.status === 'aborted');
    document.getElementById('pt-download-report').disabled = !canDownload;
    document.getElementById('pt-validate-report').disabled = !canDownload;
  } catch { /* ignore */ }
}

function renderPipelineResults(session) {
  const panel = document.getElementById('pt-results-panel');
  panel.style.display = 'block';

  const games = session.games || [];
  const totalGames = games.length;
  const passedGames = games.filter(g => g.status === 'pass').length;
  const failedGames = games.filter(g => g.status === 'fail').length;
  const totalSteps = games.reduce((s, g) => s + g.steps.length, 0);
  const passedSteps = games.reduce((s, g) => s + g.steps.filter(st => st.status === 'PASS').length, 0);

  // Summary cards
  document.getElementById('pt-results-summary').innerHTML = `
    <div class="summary-card"><div class="label">Games Tested</div><div class="value cyan">${totalGames}</div></div>
    <div class="summary-card"><div class="label">Games Passed</div><div class="value green">${passedGames}</div></div>
    <div class="summary-card"><div class="label">Games Failed</div><div class="value red">${failedGames}</div></div>
    <div class="summary-card"><div class="label">Steps Passed</div><div class="value green">${passedSteps}/${totalSteps}</div></div>
    <div class="summary-card"><div class="label">Status</div><div class="value ${session.status === 'complete' ? 'cyan' : session.status === 'running' ? 'blue' : 'red'}">${session.status}</div></div>
  `;

  // Results table
  const tbody = document.getElementById('pt-results-body');
  tbody.innerHTML = games.map(g => {
    const stepCells = [];
    for (let i = 1; i <= 11; i++) {
      const step = g.steps.find(s => s.stepNum === i);
      if (step) {
        const cls = step.status.toLowerCase();
        const screenshotKey = PT_SCREENSHOT_STEPS[i];
        const hasScreenshot = screenshotKey ? true : false;
        const clickAttr = hasScreenshot ? `onclick="openPtScreenshot('${g.gameId}','${screenshotKey}','${esc(g.gameName)} - Step ${i}')" class="pt-step-chip ${cls} clickable"` : `class="pt-step-chip ${cls}"`;
        stepCells.push(`<td><span ${clickAttr}>${step.status}</span></td>`);
      } else {
        stepCells.push(`<td><span class="pt-step-chip pending">-</span></td>`);
      }
    }
    const scoreClass = g.status === 'pass' ? 'pt-score-pass' : 'pt-score-fail';
    return `<tr>
      <td>${esc(g.gameName)}</td>
      <td style="font-size:11px;color:var(--text-dim);">${esc(g.category)}</td>
      ${stepCells.join('')}
      <td class="${scoreClass}">${g.score || '-'}</td>
    </tr>`;
  }).join('');
}

function openPtScreenshot(gameId, step, title) {
  const modal = document.getElementById('pt-screenshot-modal');
  const img = document.getElementById('pt-modal-img');
  const titleEl = document.getElementById('pt-modal-title');
  titleEl.textContent = title;
  img.src = `/api/pipeline/screenshot/${encodeURIComponent(gameId)}/${encodeURIComponent(step)}`;
  img.onerror = function() { this.alt = 'Screenshot not available'; };
  modal.classList.remove('hidden');
}

function closePtScreenshotModal() {
  document.getElementById('pt-screenshot-modal').classList.add('hidden');
}

// ── Pipeline Test Report Download ──
document.getElementById('pt-download-report').addEventListener('click', async () => {
  const btn = document.getElementById('pt-download-report');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating Report...';
  try {
    const res = await fetch('/api/pipeline/download-report');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      alert('Failed to generate report: ' + (err.error || res.statusText));
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = 'game-testing-report-' + dateStr + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    // Enable validation button after download
    document.getElementById('pt-validate-report').disabled = false;
  } catch (err) {
    alert('Error downloading report: ' + err.message);
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
});

// ── Pipeline Test Report Validation ──
document.getElementById('pt-validate-report').addEventListener('click', async () => {
  const btn = document.getElementById('pt-validate-report');
  const resultsDiv = document.getElementById('pt-validation-results');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Running Validation...';
  resultsDiv.style.display = 'block';
  resultsDiv.innerHTML = '<div class="validation-loading">Running validation tests... This may take a moment.</div>';

  try {
    const res = await fetch('/api/pipeline/validate-report', { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      resultsDiv.innerHTML = `<div class="validation-error">Validation failed: ${data.error || res.statusText}</div>`;
      return;
    }

    // Render validation results
    const passedClass = data.passed ? 'validation-pass' : 'validation-fail';
    const passedIcon = data.passed ? '✓' : '✗';
    const passedText = data.passed ? 'PASSED' : 'FAILED';

    let errorsHtml = '';
    if (data.errors && data.errors.length > 0) {
      errorsHtml = `
        <div class="validation-errors">
          <h4>Failed Tests:</h4>
          <ul>
            ${data.errors.map(e => `<li>${esc(e)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    resultsDiv.innerHTML = `
      <div class="validation-summary ${passedClass}">
        <div class="validation-icon">${passedIcon}</div>
        <div class="validation-status">${passedText}</div>
        <div class="validation-stats">
          <span class="stat"><strong>${data.passedTests}</strong> passed</span>
          <span class="stat"><strong>${data.failedTests}</strong> failed</span>
          <span class="stat"><strong>${data.skippedTests}</strong> skipped</span>
          <span class="stat">Duration: ${(data.duration / 1000).toFixed(1)}s</span>
        </div>
      </div>
      ${errorsHtml}
    `;
  } catch (err) {
    resultsDiv.innerHTML = `<div class="validation-error">Error running validation: ${esc(err.message)}</div>`;
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
});

// Close modal on overlay click
document.addEventListener('click', (e) => {
  const modal = document.getElementById('pt-screenshot-modal');
  if (modal && e.target === modal) closePtScreenshotModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePtScreenshotModal();
});

// ── Game Testing Event Listeners ──

document.getElementById('pt-select-all')?.addEventListener('click', () => {
  ptCatalogGames.forEach(g => ptSelectedGameIds.add(g.id));
  document.querySelectorAll('.pt-game-checkbox input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.closest('.pt-game-checkbox').classList.add('selected'); });
  ptUpdateSelectedCount();
});

document.getElementById('pt-deselect-all')?.addEventListener('click', () => {
  ptSelectedGameIds.clear();
  document.querySelectorAll('.pt-game-checkbox input[type="checkbox"]').forEach(cb => { cb.checked = false; cb.closest('.pt-game-checkbox').classList.remove('selected'); });
  ptUpdateSelectedCount();
});

document.getElementById('pt-run-selected')?.addEventListener('click', () => {
  const catalogSelected = ptCatalogGames.filter(g => ptSelectedGameIds.has(g.id));
  // If manual queue has entries, treat "Run Selected" as manual-only to avoid
  // accidentally including stale catalog selections from a prior run.
  const allGames = ptManualGames.length > 0 ? [...ptManualGames] : [...catalogSelected];
  startPipelineTests(allGames);
});

document.getElementById('pt-run-all')?.addEventListener('click', () => {
  startPipelineTests(ptCatalogGames);
});

// ── Manual Game Input ──

function ptParseGameUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // e.g. /lobby/casino-games/game/sugartime-egt or /lobby/casino-games/slots/starburst
    const gameId = parts[parts.length - 1] || '';
    const gameName = gameId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let category = 'slots';
    const path = u.pathname.toLowerCase();
    if (path.includes('table-game')) category = 'table-game';
    else if (path.includes('livegame') || path.includes('live-casino')) category = 'live-casino';
    else if (path.includes('crash') || path.includes('aviator')) category = 'crash-games';
    return { id: gameId, name: gameName, category, url };
  } catch { return null; }
}

function ptRenderManualQueue() {
  const container = document.getElementById('pt-manual-queue');
  if (!ptManualGames.length) { container.innerHTML = ''; return; }
  container.innerHTML = ptManualGames.map((g, i) => `
    <div class="pt-manual-queue-item">
      <span class="pt-mq-name">${esc(g.name)}</span>
      <span class="pt-mq-cat">${esc(g.category)} | ${esc(g.provider || 'Unknown')}${g.username ? ' | creds: custom' : ''}</span>
      <span class="pt-mq-remove" onclick="ptRemoveManualGame(${i})">&times;</span>
    </div>
  `).join('');
}

function ptRemoveManualGame(index) {
  ptManualGames.splice(index, 1);
  ptRenderManualQueue();
}

document.getElementById('pt-add-game')?.addEventListener('click', () => {
  const urlInput = document.getElementById('pt-game-url');
  const nameInput = document.getElementById('pt-game-name');
  const catSelect = document.getElementById('pt-game-category');
  const providerInput = document.getElementById('pt-game-provider');
  const usernameInput = document.getElementById('pt-game-username');
  const passwordInput = document.getElementById('pt-game-password');

  const url = urlInput.value.trim();
  if (!url) { alert('Please enter a game URL'); return; }

  const parsed = ptParseGameUrl(url);
  if (!parsed) { alert('Invalid URL'); return; }

  const game = {
    id: parsed.id,
    name: nameInput.value.trim() || parsed.name,
    url: url,
    category: catSelect.value || parsed.category,
    provider: providerInput.value.trim() || 'Unknown',
    username: usernameInput.value.trim() || undefined,
    password: passwordInput.value.trim() || undefined,
    gameType: 'canvas',
  };

  // Check for duplicates
  if (ptManualGames.some(g => g.id === game.id)) { alert('Game already added'); return; }

  ptManualGames.push(game);
  ptRenderManualQueue();

  // Clear inputs
  urlInput.value = '';
  nameInput.value = '';
  providerInput.value = '';
  usernameInput.value = '';
  passwordInput.value = '';
  catSelect.value = 'slots';
});

document.getElementById('pt-abort')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/pipeline/abort', { method: 'POST' });
    const data = await res.json();
    if (data.aborted) {
      ptIsRunning = false;
      ptUpdateAbortBtn();
    }
  } catch { /* ignore */ }
});

// ── Init ──
connectSSE();
renderQueue();
loadCatalog();

// Sync UI with server session state on page load
(async function syncStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.status && data.status !== 'idle' && data.status !== 'complete') {
      setStatus(data.status);
      appendLog(`Reconnected — server reports status: ${data.status}`, 'warn');
    } else if (data.status === 'complete') {
      setStatus('complete');
    }
  } catch { /* server not reachable yet */ }
})();
