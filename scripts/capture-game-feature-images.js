const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const Tesseract = require('tesseract.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--headed') args.headed = true;
  }
  return args;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function cropPngBuffer(buffer, rect) {
  const src = PNG.sync.read(buffer);
  const x = clamp(Math.floor(rect.x), 0, src.width - 1);
  const y = clamp(Math.floor(rect.y), 0, src.height - 1);
  const w = clamp(Math.floor(rect.width), 1, src.width - x);
  const h = clamp(Math.floor(rect.height), 1, src.height - y);
  const dst = new PNG({ width: w, height: h });
  PNG.bitblt(src, dst, x, y, w, h, 0, 0);
  return PNG.sync.write(dst);
}

function diffRatio(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let diff = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff++;
  }
  diff += Math.abs(a.length - b.length);
  return diff / Math.max(a.length, b.length);
}

function findTemplate(haystackBuf, needleBuf, options = {}) {
  const hay = PNG.sync.read(haystackBuf);
  const ned = PNG.sync.read(needleBuf);
  if (ned.width > hay.width || ned.height > hay.height) return null;
  const region = options.region || { x0: 0, y0: 0, x1: hay.width - 1, y1: hay.height - 1 };
  const step = Math.max(1, options.step || 2);
  const maxScore = options.maxScore || 0.28;
  const timeBudgetMs = Math.max(100, options.timeBudgetMs || 1200);

  const xStart = clamp(region.x0, 0, hay.width - ned.width);
  const yStart = clamp(region.y0, 0, hay.height - ned.height);
  const xEnd = clamp(region.x1 - ned.width, 0, hay.width - ned.width);
  const yEnd = clamp(region.y1 - ned.height, 0, hay.height - ned.height);

  const sampleStep = Math.max(3, Math.floor(Math.min(ned.width, ned.height) / 10));
  const samples = [];
  for (let dy = 0; dy < ned.height; dy += sampleStep) {
    for (let dx = 0; dx < ned.width; dx += sampleStep) {
      if (alphaAt(ned, dx, dy) < 200) continue;
      samples.push({ dx, dy, g: grayAt(ned, dx, dy) });
      if (samples.length >= 140) break;
    }
    if (samples.length >= 140) break;
  }
  if (samples.length < 20) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const t0 = Date.now();
  for (let y = yStart; y <= yEnd; y += step) {
    for (let x = xStart; x <= xEnd; x += step) {
      if (Date.now() - t0 > timeBudgetMs) break;
      let acc = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        acc += Math.abs(grayAt(hay, x + s.dx, y + s.dy) - s.g);
      }
      const score = acc / (samples.length * 255);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y, width: ned.width, height: ned.height, score };
      }
    }
  }
  if (!best || best.score > maxScore) return null;
  return best;
}

function scalePngNearest(pngBuf, scale) {
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (Math.abs(scale - 1) < 1e-6) return pngBuf;
  const src = PNG.sync.read(pngBuf);
  const dstW = Math.max(1, Math.round(src.width * scale));
  const dstH = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    const sy = clamp(Math.floor(y / scale), 0, src.height - 1);
    for (let x = 0; x < dstW; x++) {
      const sx = clamp(Math.floor(x / scale), 0, src.width - 1);
      const sIdx = (src.width * sy + sx) << 2;
      const dIdx = (dstW * y + x) << 2;
      dst.data[dIdx] = src.data[sIdx];
      dst.data[dIdx + 1] = src.data[sIdx + 1];
      dst.data[dIdx + 2] = src.data[sIdx + 2];
      dst.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return PNG.sync.write(dst);
}

function findTemplateMultiScale(haystackBuf, needleBuf, scales, options) {
  let best = null;
  for (const s of scales) {
    const scaled = scalePngNearest(needleBuf, s);
    if (!scaled) continue;
    const m = findTemplate(haystackBuf, scaled, options);
    if (m && (!best || m.score < best.score)) best = { ...m, scale: s };
  }
  return best;
}

async function getMainCanvasBox(page) {
  const box = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('canvas, iframe, [id*="game" i], [class*="game" i]'));
    let best = null;
    let bestArea = 0;
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) {
        bestArea = area;
        best = { x: r.left, y: r.top, width: r.width, height: r.height };
      }
    }
    return best;
  });
  if (box && box.width > 100 && box.height > 100) return box;
  const vp = page.viewportSize() || { width: 1366, height: 768 };
  return { x: 0, y: 0, width: vp.width, height: vp.height };
}

async function dismissEntryOverlay(page, box) {
  const selectors = [
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    'button:has-text("Accept")',
    'button:has-text("I Accept")',
    'text=/I\\s*Accept/i',
    '[class*="next"]',
    '[aria-label*="next" i]',
    '[class*="arrow"]',
  ];
  for (const s of selectors) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  const points = [
    [0.88, 0.52],
    [0.94, 0.52],
    [0.50, 0.86],
    [0.50, 0.50],
  ];
  for (const [rx, ry] of points) {
    await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function isCreditsVisible(page) {
  // Balance is primary signal; credits is fallback.
  const selectors = [
    'text=/\\bbalance\\b/i',
    'text=/\\bbal\\b/i',
    'text=/\\bcash\\b/i',
    'text=/\\bamount\\b/i',
    '[class*="balance" i]',
    '[id*="balance" i]',
    '[aria-label*="balance" i]',
    '[title*="balance" i]',
    '[class*="credit" i]',
    '[id*="credit" i]',
  ];
  for (const s of selectors) {
    const loc = page.locator(s).first();
    if (await loc.isVisible({ timeout: 500 }).catch(() => false)) return true;
  }
  const bodyText = (await page.locator('body').textContent().catch(() => '')) || '';
  if (/\bbalance\b/i.test(bodyText)) return true;
  if (/\bbal\b/i.test(bodyText)) return true;
  if (/\bcash\b/i.test(bodyText)) return true;
  if (/\bcredits?\b/i.test(bodyText)) return true;
  if (/\b(R|\$|€|£)\s?\d[\d,]*\.?\d{0,2}\b/.test(bodyText)) return true;
  if (/\b\d[\d,]*\.?\d{0,2}\s?(R|\$|€|£)\b/.test(bodyText)) return true;

  // Template fallback: use any balance-like reference in tmp folder.
  try {
    const tmpDir = path.resolve(process.cwd(), 'tmp');
    const refFiles = fs.existsSync(tmpDir)
      ? fs.readdirSync(tmpDir)
          .filter((n) => /\.(png|jpg|jpeg)$/i.test(n))
          .filter((n) => /(balance|bal|credit|cash)/i.test(n))
          .map((n) => path.join(tmpDir, n))
      : [];
    if (refFiles.length > 0) {
      const box = await getMainCanvasBox(page);
      const canvasBuf = await page.screenshot({
        clip: {
          x: Math.max(0, Math.floor(box.x)),
          y: Math.max(0, Math.floor(box.y)),
          width: Math.max(1, Math.floor(box.width)),
          height: Math.max(1, Math.floor(box.height)),
        },
      });
      const region = {
        x0: 0,
        y0: Math.floor(box.height * 0.58),
        x1: Math.floor(box.width * 0.52),
        y1: Math.floor(box.height * 0.998),
      };
      for (const rf of refFiles) {
        const ref = fs.readFileSync(rf);
        const m = findTemplateMultiScale(canvasBuf, ref, [0.35, 0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3], {
          region,
          step: 2,
          maxScore: 0.48,
          timeBudgetMs: 2600,
        });
        if (m) return true;
      }
    }
  } catch {
    // Ignore template-fallback failures.
  }

  // OCR fallback: read bottom-left HUD text and look for balance/credits keywords.
  try {
    const box = await getMainCanvasBox(page);
    const clip = {
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y + box.height * 0.58)),
      width: Math.max(1, Math.floor(box.width * 0.55)),
      height: Math.max(1, Math.floor(box.height * 0.40)),
    };
    const hudBuf = await page.screenshot({ clip });
    const ocrPromise = Tesseract.recognize(hudBuf, 'eng', {
      logger: () => {},
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('ocr-timeout')), 14000));
    const ocr = await Promise.race([ocrPromise, timeoutPromise]);
    const text = ((ocr && ocr.data && ocr.data.text) || '').toLowerCase();
    if (/\bbalance\b/.test(text)) return true;
    if (/\bcredits?\b/.test(text)) return true;
    if (/\bcash\b/.test(text)) return true;
    if (/\b(R|\$|€|£)\s?\d[\d,]*\.?\d{0,2}\b/i.test(text)) return true;
    if (/\b\d[\d,]*\.?\d{0,2}\s?(R|\$|€|£)\b/i.test(text)) return true;
  } catch {
    // Ignore OCR failures and continue retry loop.
  }
  return false;
}

async function ensureReadyForCapture(page, maxAttempts = 16) {
  for (let i = 1; i <= maxAttempts; i++) {
    const box = await getMainCanvasBox(page);
    await dismissEntryOverlay(page, box);
    await page.waitForTimeout(2200);
    if (await isCreditsVisible(page)) {
      return { ok: true, attempts: i, box };
    }
  }
  const box = await getMainCanvasBox(page);
  return { ok: false, attempts: maxAttempts, box };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error('Usage: node scripts/capture-game-feature-images.js --url "<game-url>" [--out <dir>] [--headed]');
    process.exit(1);
  }

  const outDir = args.out || path.resolve(process.cwd(), 'tmp', `feature-capture-${tsStamp()}`);
  ensureDir(outDir);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  const manifest = {
    url: args.url,
    outDir,
    capturedAt: new Date().toISOString(),
    files: [],
    clickProbes: [],
  };

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(8000);

    const full0 = path.join(outDir, '00-loaded-full.png');
    await page.screenshot({ path: full0, fullPage: true });
    manifest.files.push(path.basename(full0));

    const box0 = await getMainCanvasBox(page);
    const canvas0Buf = await page.screenshot({
      clip: {
        x: Math.max(0, Math.floor(box0.x)),
        y: Math.max(0, Math.floor(box0.y)),
        width: Math.max(1, Math.floor(box0.width)),
        height: Math.max(1, Math.floor(box0.height)),
      },
    });
    const canvas0 = path.join(outDir, '01-canvas-before-entry.png');
    fs.writeFileSync(canvas0, canvas0Buf);
    manifest.files.push(path.basename(canvas0));

    const ready = await ensureReadyForCapture(page, 16);
    if (!ready.ok) {
      const failPath = path.join(outDir, '01b-failed-prereq-no-credits.png');
      await page.screenshot({ path: failPath, fullPage: true });
      manifest.files.push(path.basename(failPath));
      const manifestPath = path.join(outDir, 'manifest.json');
      manifest.prerequisite = {
        continueClicked: true,
        creditsVisible: false,
        attempts: ready.attempts,
        status: 'failed',
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      throw new Error(`Prerequisite failed: credits/balance not visible after ${ready.attempts} continue attempts.`);
    }
    manifest.prerequisite = {
      continueClicked: true,
      creditsVisible: true,
      attempts: ready.attempts,
      status: 'passed',
    };
    await page.waitForTimeout(1500);

    const box1 = await getMainCanvasBox(page);
    const canvas1Buf = await page.screenshot({
      clip: {
        x: Math.max(0, Math.floor(box1.x)),
        y: Math.max(0, Math.floor(box1.y)),
        width: Math.max(1, Math.floor(box1.width)),
        height: Math.max(1, Math.floor(box1.height)),
      },
    });
    const canvas1 = path.join(outDir, '02-canvas-after-entry.png');
    fs.writeFileSync(canvas1, canvas1Buf);
    manifest.files.push(path.basename(canvas1));

    // Capture hamburger / paytable areas (top-left region).
    const hamburgerCrop = cropPngBuffer(canvas1Buf, {
      x: box1.width * 0.01,
      y: box1.height * 0.01,
      width: box1.width * 0.16,
      height: box1.height * 0.16,
    });
    const hamburgerPath = path.join(outDir, '03-hamburger-or-menu-icon.png');
    fs.writeFileSync(hamburgerPath, hamburgerCrop);
    manifest.files.push(path.basename(hamburgerPath));

    // Try opening menu then capture paytable option region.
    await page.mouse.click(box1.x + box1.width * 0.06, box1.y + box1.height * 0.05).catch(() => {});
    await page.waitForTimeout(600);
    const menuBuf = await page.screenshot({
      clip: {
        x: Math.max(0, Math.floor(box1.x)),
        y: Math.max(0, Math.floor(box1.y)),
        width: Math.max(1, Math.floor(box1.width)),
        height: Math.max(1, Math.floor(box1.height)),
      },
    });
    const menuPath = path.join(outDir, '04-menu-open-canvas.png');
    fs.writeFileSync(menuPath, menuBuf);
    manifest.files.push(path.basename(menuPath));

    const paytableCrop = cropPngBuffer(menuBuf, {
      x: box1.width * 0.03,
      y: box1.height * 0.08,
      width: box1.width * 0.24,
      height: box1.height * 0.24,
    });
    const paytablePath = path.join(outDir, '05-paytable-option-region.png');
    fs.writeFileSync(paytablePath, paytableCrop);
    manifest.files.push(path.basename(paytablePath));

    // Probe lower-right rail for bet click (popup-like change).
    const probePoints = [
      [0.92, 0.76],
      [0.92, 0.82],
      [0.92, 0.88],
      [0.88, 0.82],
      [0.88, 0.88],
    ];
    let bestProbe = null;
    for (const [rx, ry] of probePoints) {
      const before = await page.screenshot({
        clip: {
          x: Math.max(0, Math.floor(box1.x)),
          y: Math.max(0, Math.floor(box1.y)),
          width: Math.max(1, Math.floor(box1.width)),
          height: Math.max(1, Math.floor(box1.height)),
        },
      });
      const x = box1.x + box1.width * rx;
      const y = box1.y + box1.height * ry;
      await page.mouse.click(x, y).catch(() => {});
      await page.waitForTimeout(700);
      const after = await page.screenshot({
        clip: {
          x: Math.max(0, Math.floor(box1.x)),
          y: Math.max(0, Math.floor(box1.y)),
          width: Math.max(1, Math.floor(box1.width)),
          height: Math.max(1, Math.floor(box1.height)),
        },
      });
      const ratio = diffRatio(before, after);
      manifest.clickProbes.push({ rx, ry, x: Math.round(x), y: Math.round(y), diffRatio: ratio });
      if (!bestProbe || ratio > bestProbe.diffRatio) {
        bestProbe = { rx, ry, x, y, diffRatio: ratio };
      }
      // Attempt close with Escape to keep probing stable.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }

    const best = bestProbe || { rx: 0.92, ry: 0.82, x: box1.x + box1.width * 0.92, y: box1.y + box1.height * 0.82, diffRatio: 0 };
    const betCrop = cropPngBuffer(canvas1Buf, {
      x: (best.x - box1.x) - 64,
      y: (best.y - box1.y) - 64,
      width: 128,
      height: 128,
    });
    const betPath = path.join(outDir, '06-bet-icon-candidate.png');
    fs.writeFileSync(betPath, betCrop);
    manifest.files.push(path.basename(betPath));

    // Spin icon region in lower-right rail (separate from bet candidate).
    const spinCrop = cropPngBuffer(canvas1Buf, {
      x: box1.width * 0.84,
      y: box1.height * 0.78,
      width: box1.width * 0.16,
      height: box1.height * 0.21,
    });
    const spinPath = path.join(outDir, '07-spin-icon-region.png');
    fs.writeFileSync(spinPath, spinCrop);
    manifest.files.push(path.basename(spinPath));

    // Auto-spin icon region (typically left of spin controls on slot rails).
    const autoSpinBeforeCrop = cropPngBuffer(canvas1Buf, {
      x: box1.width * 0.72,
      y: box1.height * 0.78,
      width: box1.width * 0.16,
      height: box1.height * 0.21,
    });
    const autoSpinBeforePath = path.join(outDir, '08-auto-spin-icon-region.png');
    fs.writeFileSync(autoSpinBeforePath, autoSpinBeforeCrop);
    manifest.files.push(path.basename(autoSpinBeforePath));

    // Try to toggle auto-spin and capture the same region as an "active" template.
    const autoSpinX = box1.x + box1.width * 0.79;
    const autoSpinY = box1.y + box1.height * 0.90;
    await page.mouse.click(autoSpinX, autoSpinY).catch(() => {});
    await page.waitForTimeout(900);
    const autoSpinAfterCanvas = await page.screenshot({
      clip: {
        x: Math.max(0, Math.floor(box1.x)),
        y: Math.max(0, Math.floor(box1.y)),
        width: Math.max(1, Math.floor(box1.width)),
        height: Math.max(1, Math.floor(box1.height)),
      },
    });
    const autoSpinAfterCrop = cropPngBuffer(autoSpinAfterCanvas, {
      x: box1.width * 0.72,
      y: box1.height * 0.78,
      width: box1.width * 0.16,
      height: box1.height * 0.21,
    });
    const autoSpinAfterPath = path.join(outDir, '09-auto-spin-active-region.png');
    fs.writeFileSync(autoSpinAfterPath, autoSpinAfterCrop);
    manifest.files.push(path.basename(autoSpinAfterPath));

    // Toggle back if the control is toggle-based.
    await page.mouse.click(autoSpinX, autoSpinY).catch(() => {});
    await page.waitForTimeout(500);

    // Final evidence screenshot.
    const finalPath = path.join(outDir, '99-final-full.png');
    await page.screenshot({ path: finalPath, fullPage: true });
    manifest.files.push(path.basename(finalPath));

    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`Capture complete. Output: ${outDir}`);
    console.log(`Files captured: ${manifest.files.length}`);
    for (const f of manifest.files) console.log(` - ${f}`);
    console.log(`Manifest: ${manifestPath}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
