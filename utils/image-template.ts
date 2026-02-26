import { PNG } from 'pngjs';

export type TemplateMatchRegion = { x0: number; y0: number; x1: number; y1: number };

export type TemplateMatchResult = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number; // 0..1 (lower is better)
};

export type TemplateMatchResultWithScale = TemplateMatchResult & { scale: number };
export type TemplateMatchRobustResult = TemplateMatchResultWithScale & {
  region: TemplateMatchRegion;
  confidence: 'high' | 'medium' | 'low';
};

type FindTemplateOptions = {
  region?: TemplateMatchRegion;
  step?: number;
  maxScore?: number;
  timeBudgetMs?: number;
};

type FindTemplateInternalOptions = FindTemplateOptions & {
  stopOnFirstGood?: boolean;
};

type PngImageLike = {
  width: number;
  data: Uint8Array;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function grayAt(img: PngImageLike, x: number, y: number): number {
  const idx = (img.width * y + x) << 2;
  const r = img.data[idx];
  const g = img.data[idx + 1];
  const b = img.data[idx + 2];
  // Luma-ish, integer math
  return (r * 3 + g * 6 + b) / 10;
}

function alphaAt(img: PngImageLike, x: number, y: number): number {
  const idx = (img.width * y + x) << 2;
  return img.data[idx + 3];
}

/**
 * Very small, dependency-free template matcher for UI icons on canvas screenshots.
 * Returns best match position and normalized score (0..1). Lower is better.
 */
function findTemplateMatchInternal(
  haystackPng: Buffer,
  needlePng: Buffer,
  options: FindTemplateInternalOptions = {}
): TemplateMatchResult | null {
  const hay = PNG.sync.read(haystackPng);
  const ned = PNG.sync.read(needlePng);

  if (ned.width > hay.width || ned.height > hay.height) return null;

  const step = Math.max(1, options.step ?? 2);
  const maxScore = options.maxScore ?? 0.14;
  const stopOnFirstGood = options.stopOnFirstGood ?? true;
  const timeBudgetMs = Math.max(50, options.timeBudgetMs ?? 350);

  const rx0 = options.region ? clamp(options.region.x0, 0, hay.width - 1) : 0;
  const ry0 = options.region ? clamp(options.region.y0, 0, hay.height - 1) : 0;
  const rx1 = options.region ? clamp(options.region.x1, 0, hay.width - 1) : hay.width - 1;
  const ry1 = options.region ? clamp(options.region.y1, 0, hay.height - 1) : hay.height - 1;

  const xStart = clamp(rx0, 0, hay.width - ned.width);
  const yStart = clamp(ry0, 0, hay.height - ned.height);
  const xEnd = clamp(rx1 - ned.width, 0, hay.width - ned.width);
  const yEnd = clamp(ry1 - ned.height, 0, hay.height - ned.height);

  // Sample a subset of pixels for speed (grid sample).
  const sampleStep = Math.max(3, Math.floor(Math.min(ned.width, ned.height) / 10));
  const samples: Array<{ dx: number; dy: number; g: number }> = [];
  const maxSamples = 120;
  const alphaThreshold = 200;
  for (let dy = 0; dy < ned.height; dy += sampleStep) {
    for (let dx = 0; dx < ned.width; dx += sampleStep) {
      // Ignore transparent pixels in the template (icons are often exported with transparent background).
      if (alphaAt(ned, dx, dy) < alphaThreshold) continue;
      samples.push({ dx, dy, g: grayAt(ned, dx, dy) });
      if (samples.length >= maxSamples) break;
    }
    if (samples.length >= maxSamples) break;
  }
  if (samples.length < 20) return null;

  let bestScore = Number.POSITIVE_INFINITY;
  let bestX = -1;
  let bestY = -1;

  const start = Date.now();
  for (let y = yStart; y <= yEnd; y += step) {
    for (let x = xStart; x <= xEnd; x += step) {
      if (Date.now() - start > timeBudgetMs) {
        if (bestX < 0) return null;
        if (bestScore > maxScore) return null;
        return { x: bestX, y: bestY, width: ned.width, height: ned.height, score: bestScore };
      }

      let acc = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const hg = grayAt(hay, x + s.dx, y + s.dy);
        acc += Math.abs(hg - s.g);
        // Early exit if already worse than current best.
        if (bestScore !== Number.POSITIVE_INFINITY && acc >= bestScore * samples.length * 255) break;
      }

      const score = acc / (samples.length * 255);
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
        if (stopOnFirstGood && bestScore <= maxScore) {
          return { x: bestX, y: bestY, width: ned.width, height: ned.height, score: bestScore };
        }
      }
    }
  }

  if (bestX < 0) return null;
  if (bestScore > maxScore) return null;
  return { x: bestX, y: bestY, width: ned.width, height: ned.height, score: bestScore };
}

/**
 * Very small, dependency-free template matcher for UI icons on canvas screenshots.
 * Returns best match position and normalized score (0..1). Lower is better.
 */
export function findTemplateMatch(
  haystackPng: Buffer,
  needlePng: Buffer,
  options: FindTemplateOptions = {}
): TemplateMatchResult | null {
  return findTemplateMatchInternal(haystackPng, needlePng, { ...options, stopOnFirstGood: true });
}

/**
 * Robust matcher for dynamic UI layouts:
 * - scans multiple regions
 * - scans multiple scales
 * - evaluates full search (not first-hit) and picks global best score.
 */
export function findTemplateMatchRobust(
  haystackPng: Buffer,
  needlePng: Buffer,
  options: {
    regions?: TemplateMatchRegion[];
    scales?: number[];
    steps?: number[];
    maxScore?: number;
    relaxedMaxScore?: number;
    timeBudgetMs?: number;
  } = {}
): TemplateMatchRobustResult | null {
  const hay = PNG.sync.read(haystackPng);
  const defaultRegions: TemplateMatchRegion[] = [
    { x0: 0, y0: 0, x1: hay.width - 1, y1: hay.height - 1 },
    { x0: Math.floor(hay.width * 0.72), y0: Math.floor(hay.height * 0.05), x1: hay.width - 1, y1: Math.floor(hay.height * 0.95) },
    { x0: Math.floor(hay.width * 0.78), y0: Math.floor(hay.height * 0.05), x1: hay.width - 1, y1: Math.floor(hay.height * 0.55) },
    { x0: Math.floor(hay.width * 0.78), y0: Math.floor(hay.height * 0.40), x1: hay.width - 1, y1: hay.height - 1 },
    { x0: Math.floor(hay.width * 0.55), y0: Math.floor(hay.height * 0.55), x1: hay.width - 1, y1: hay.height - 1 },
  ];
  const regions = options.regions && options.regions.length > 0 ? options.regions : defaultRegions;
  const scales = options.scales && options.scales.length > 0 ? options.scales : [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];
  const steps = options.steps && options.steps.length > 0 ? options.steps : [2, 1];
  const maxScore = options.maxScore ?? 0.2;
  const relaxedMaxScore = options.relaxedMaxScore ?? 0.26;
  const timeBudgetMs = Math.max(200, options.timeBudgetMs ?? 1000);

  let best: TemplateMatchRobustResult | null = null;

  for (const region of regions) {
    for (const step of steps) {
      for (const scale of scales) {
        const scaled = scalePngNearest(needlePng, scale);
        if (!scaled) continue;
        const res = findTemplateMatchInternal(haystackPng, scaled, {
          region,
          step,
          maxScore: relaxedMaxScore,
          timeBudgetMs,
          stopOnFirstGood: false,
        });
        if (!res) continue;
        const withMeta: TemplateMatchRobustResult = {
          ...res,
          scale,
          region,
          confidence: res.score <= maxScore ? 'high' : res.score <= Math.min(relaxedMaxScore, 0.23) ? 'medium' : 'low',
        };
        if (!best || withMeta.score < best.score) best = withMeta;
      }
    }
  }

  if (!best) return null;
  if (best.score > relaxedMaxScore) return null;
  return best;
}

export function scalePngNearest(pngBuf: Buffer, scale: number): Buffer | null {
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

export function findTemplateMatchMultiScale(
  haystackPng: Buffer,
  needlePng: Buffer,
  scales: number[],
  options: FindTemplateOptions = {}
): TemplateMatchResultWithScale | null {
  const uniqScales = Array.from(new Set((scales || []).filter(s => Number.isFinite(s) && s > 0)));
  if (uniqScales.length === 0) uniqScales.push(1);

  let best: TemplateMatchResultWithScale | null = null;
  for (const scale of uniqScales) {
    const scaled = scalePngNearest(needlePng, scale);
    if (!scaled) continue;
    const res = findTemplateMatch(haystackPng, scaled, options);
    if (!res) continue;
    const withScale: TemplateMatchResultWithScale = { ...res, scale };
    if (!best || withScale.score < best.score) best = withScale;
  }
  return best;
}
