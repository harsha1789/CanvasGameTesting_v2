const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--refs') out.refsDir = argv[++i];
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--headed') out.headed = true;
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function grayAt(img, x, y) {
  const idx = (img.width * y + x) << 2;
  const r = img.data[idx];
  const g = img.data[idx + 1];
  const b = img.data[idx + 2];
  return (r * 3 + g * 6 + b) / 10;
}

function alphaAt(img, x, y) {
  const idx = (img.width * y + x) << 2;
  return img.data[idx + 3];
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

function findTemplate(haystackBuf, needleBuf, options = {}) {
  const hay = PNG.sync.read(haystackBuf);
  const ned = PNG.sync.read(needleBuf);
  if (ned.width > hay.width || ned.height > hay.height) return null;

  const step = Math.max(1, options.step || 2);
  const maxScore = options.maxScore || 0.24;
  const timeBudgetMs = Math.max(100, options.timeBudgetMs || 1500);
  const region = options.region || { x0: 0, y0: 0, x1: hay.width - 1, y1: hay.height - 1 };

  const rx0 = clamp(region.x0, 0, hay.width - 1);
  const ry0 = clamp(region.y0, 0, hay.height - 1);
  const rx1 = clamp(region.x1, 0, hay.width - 1);
  const ry1 = clamp(region.y1, 0, hay.height - 1);
  const xStart = clamp(rx0, 0, hay.width - ned.width);
  const yStart = clamp(ry0, 0, hay.height - ned.height);
  const xEnd = clamp(rx1 - ned.width, 0, hay.width - ned.width);
  const yEnd = clamp(ry1 - ned.height, 0, hay.height - ned.height);

  const sampleStep = Math.max(3, Math.floor(Math.min(ned.width, ned.height) / 10));
  const samples = [];
  for (let dy = 0; dy < ned.height; dy += sampleStep) {
    for (let dx = 0; dx < ned.width; dx += sampleStep) {
      if (alphaAt(ned, dx, dy) < 200) continue;
      samples.push({ dx, dy, g: grayAt(ned, dx, dy) });
      if (samples.length >= 160) break;
    }
    if (samples.length >= 160) break;
  }
  if (samples.length < 20) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const started = Date.now();
  for (let y = yStart; y <= yEnd; y += step) {
    for (let x = xStart; x <= xEnd; x += step) {
      if (Date.now() - started > timeBudgetMs) break;
      let acc = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const hg = grayAt(hay, x + s.dx, y + s.dy);
        acc += Math.abs(hg - s.g);
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

function findTemplateMultiScale(haystackBuf, needleBuf, scales, options) {
  let best = null;
  for (const s of scales) {
    const scaled = scalePngNearest(needleBuf, s);
    if (!scaled) continue;
    const match = findTemplate(haystackBuf, scaled, options);
    if (!match) continue;
    if (!best || match.score < best.score) best = { ...match, scale: s };
  }
  return best;
}

function drawRectAndCircle(pngBuf, match) {
  const img = PNG.sync.read(pngBuf);
  const x0 = clamp(Math.floor(match.x), 0, img.width - 1);
  const y0 = clamp(Math.floor(match.y), 0, img.height - 1);
  const x1 = clamp(Math.floor(match.x + match.width), 0, img.width - 1);
  const y1 = clamp(Math.floor(match.y + match.height), 0, img.height - 1);

  const setRed = (x, y) => {
    const idx = (img.width * y + x) << 2;
    img.data[idx] = 255;
    img.data[idx + 1] = 0;
    img.data[idx + 2] = 0;
    img.data[idx + 3] = 255;
  };
  for (let x = x0; x <= x1; x++) {
    setRed(x, y0);
    setRed(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    setRed(x0, y);
    setRed(x1, y);
  }

  const cx = Math.floor((x0 + x1) / 2);
  const cy = Math.floor((y0 + y1) / 2);
  const r = Math.max(8, Math.floor(Math.max(match.width, match.height) * 0.4));
  for (let y = cy - r - 2; y <= cy + r + 2; y++) {
    for (let x = cx - r - 2; x <= cx + r + 2; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d >= r - 2 && d <= r + 2) setRed(x, y);
    }
  }

  return PNG.sync.write(img);
}

function cropPng(pngBuf, match) {
  const src = PNG.sync.read(pngBuf);
  const x = clamp(Math.floor(match.x), 0, src.width - 1);
  const y = clamp(Math.floor(match.y), 0, src.height - 1);
  const w = clamp(Math.floor(match.width), 1, src.width - x);
  const h = clamp(Math.floor(match.height), 1, src.height - y);
  const dst = new PNG({ width: w, height: h });
  PNG.bitblt(src, dst, x, y, w, h, 0, 0);
  return PNG.sync.write(dst);
}

function runCapture(url, headed) {
  const args = ['scripts/capture-game-feature-images.js', '--url', url];
  if (headed) args.push('--headed');
  const r = spawnSync('node', args, { encoding: 'utf-8', cwd: process.cwd() });
  if (r.status !== 0) {
    throw new Error(`capture script failed:\n${r.stdout}\n${r.stderr}`);
  }
  const lines = (r.stdout || '').split(/\r?\n/);
  const outLine = lines.find((l) => l.includes('Capture complete. Output:'));
  if (!outLine) throw new Error(`cannot find capture output folder in:\n${r.stdout}`);
  return outLine.split('Output:')[1].trim();
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error('Usage: node scripts/match-game-feature-images.js --url "<game-url>" [--refs <dir>] [--out <dir>] [--headed]');
    process.exit(1);
  }

  const refsDir = args.refsDir || path.resolve(process.cwd(), 'tmp');
  const captureDir = runCapture(args.url, args.headed);
  const sourceCanvas = path.join(captureDir, '02-canvas-after-entry.png');
  if (!fs.existsSync(sourceCanvas)) {
    throw new Error(`source canvas not found: ${sourceCanvas}`);
  }
  const haystack = fs.readFileSync(sourceCanvas);

  const outDir = args.out || path.join(captureDir, 'matched-features');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const features = [
    { key: 'hamburger-menu', ref: 'hamuburger-menu.png', region: 'top-left' },
    { key: 'hamburger-menu-after', ref: 'hamburget-menu-after-click.png', region: 'top-left' },
    { key: 'paytable-icon', ref: 'paytable-icon-visible-after-hamburger-menu-click.png', region: 'top-left' },
    { key: 'sound-icon', ref: 'sound-on-off-icon-visible-after-humburger-click.png', region: 'top-left' },
    { key: 'bet-before', ref: 'Bet-icon-before-click.png', region: 'bottom-right' },
    { key: 'bet-after', ref: 'bet-icon-after-click-pop-up-window.png', region: 'right' },
    { key: 'spin', ref: 'spin.png', region: 'bottom-right' },
    { key: 'auto-spin-before', ref: 'Auto-spin-icon-visible-before-click.png', region: 'bottom-right' },
    { key: 'auto-spin-after', ref: 'Auto-spin-icon-visible-after-click.png', region: 'bottom-right' },
  ];

  const dims = PNG.sync.read(haystack);
  const regions = {
    'top-left': { x0: 0, y0: 0, x1: Math.floor(dims.width * 0.35), y1: Math.floor(dims.height * 0.35) },
    'bottom-right': { x0: Math.floor(dims.width * 0.74), y0: Math.floor(dims.height * 0.62), x1: dims.width - 1, y1: dims.height - 1 },
    right: { x0: Math.floor(dims.width * 0.70), y0: Math.floor(dims.height * 0.25), x1: dims.width - 1, y1: dims.height - 1 },
  };

  const manifest = {
    url: args.url,
    refsDir,
    captureDir,
    outDir,
    createdAt: new Date().toISOString(),
    matches: [],
  };

  for (const f of features) {
    const refPath = path.join(refsDir, f.ref);
    if (!fs.existsSync(refPath)) {
      manifest.matches.push({ feature: f.key, reference: f.ref, found: false, reason: 'reference not found' });
      continue;
    }
    const needle = fs.readFileSync(refPath);
    const region = regions[f.region] || regions.right;
    const match = findTemplateMultiScale(haystack, needle, [0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3], {
      region,
      step: 2,
      maxScore: 0.28,
      timeBudgetMs: 2200,
    });
    if (!match) {
      manifest.matches.push({ feature: f.key, reference: f.ref, found: false, reason: 'no match' });
      continue;
    }
    const annotated = drawRectAndCircle(haystack, match);
    const crop = cropPng(haystack, match);
    const annPath = path.join(outDir, `${f.key}-annotated.png`);
    const cropPath = path.join(outDir, `${f.key}-crop.png`);
    fs.writeFileSync(annPath, annotated);
    fs.writeFileSync(cropPath, crop);
    manifest.matches.push({
      feature: f.key,
      reference: f.ref,
      found: true,
      score: match.score,
      scale: match.scale,
      x: match.x,
      y: match.y,
      width: match.width,
      height: match.height,
      annotated: annPath,
      crop: cropPath,
    });
  }

  const manifestPath = path.join(outDir, 'feature-match-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Feature matching complete.`);
  console.log(`Capture folder: ${captureDir}`);
  console.log(`Matched output: ${outDir}`);
  for (const m of manifest.matches) {
    if (m.found) {
      console.log(` - ${m.feature}: MATCH score=${m.score.toFixed(3)} -> ${path.basename(m.crop)}`);
    } else {
      console.log(` - ${m.feature}: NO MATCH (${m.reason})`);
    }
  }
  console.log(`Manifest: ${manifestPath}`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

