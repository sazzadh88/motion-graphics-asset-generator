/**
 * Palette extraction: RGBA pixels -> up to 8 representative colors with coverage weights.
 *
 * Pipeline (all deterministic; same input -> byte-identical output):
 *  1. Subsample on a fixed 2D stride to <= ~20k pixels, skip alpha < 128.
 *  2. Histogram into 32^3 sRGB bins (bin mean color + count) -> weighted points in OKLab.
 *  3. Weighted k-means in OKLab with farthest-point init (score = dist^2 * sqrt(weight) * chroma
 *     boost, so small vivid colors get a center), capped iterations.
 *  4. Merge near-duplicate clusters, drop tiny ones (vivid ones get a lower floor), pick at most
 *     `maxColors` by weight + distinctness + chroma, give dropped weight to the nearest kept color.
 */
import type { Palette } from './types';
import { type Lab, labDistance, labToHex, linearToLab, srgb8ToLinear } from './color';

const MAX_SAMPLES = 20_000;
const MAX_ITER = 16;
const MERGE_DIST = 0.05;
const MIN_WEIGHT = 0.015;
const VIVID_CHROMA = 0.1;
const VIVID_MIN_WEIGHT = 0.004;
const NEUTRAL = '#808080';

interface Cluster {
  lab: Lab;
  w: number;
}

const chromaOf = (p: Lab): number => Math.hypot(p.a, p.b);
const dist2 = (p: Lab, q: Lab): number => (p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;

export function extractPalette(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: { maxColors?: number } = {},
): Palette {
  const maxColors = Math.max(1, Math.min(8, Math.floor(opts.maxColors ?? 6) || 6));
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.min(Math.floor(height), w > 0 ? Math.floor(data.length / 4 / w) : 0));

  // 1 + 2: strided sampling into a 32x32x32 histogram.
  const BINS = 32 * 32 * 32;
  const count = new Float64Array(BINS);
  const sumR = new Float64Array(BINS);
  const sumG = new Float64Array(BINS);
  const sumB = new Float64Array(BINS);
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / MAX_SAMPLES)));
  const start = step >> 1;
  for (let y = Math.min(start, h - 1); y >= 0 && y < h; y += step) {
    for (let x = Math.min(start, w - 1); x >= 0 && x < w; x += step) {
      const i = (y * w + x) * 4;
      if ((data[i + 3] as number) < 128) continue;
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      count[k] = (count[k] as number) + 1;
      sumR[k] = (sumR[k] as number) + r;
      sumG[k] = (sumG[k] as number) + g;
      sumB[k] = (sumB[k] as number) + b;
    }
  }
  const pts: Cluster[] = [];
  let total = 0;
  for (let k = 0; k < BINS; k++) {
    const c = count[k] as number;
    if (!c) continue;
    const r = Math.round((sumR[k] as number) / c);
    const g = Math.round((sumG[k] as number) / c);
    const b = Math.round((sumB[k] as number) / c);
    pts.push({ lab: linearToLab(srgb8ToLinear(r), srgb8ToLinear(g), srgb8ToLinear(b)), w: c });
    total += c;
  }
  if (!pts.length) return { colors: [{ hex: NEUTRAL, weight: 1 }] };
  for (const p of pts) p.w /= total;

  // 3: farthest-point init + weighted Lloyd iterations.
  const k0 = Math.min(pts.length, maxColors + 6);
  let heaviest = 0;
  for (let i = 1; i < pts.length; i++) if ((pts[i] as Cluster).w > (pts[heaviest] as Cluster).w) heaviest = i;
  const centers: Lab[] = [{ ...(pts[heaviest] as Cluster).lab }];
  const minD = pts.map((p) => dist2(p.lab, centers[0] as Lab));
  while (centers.length < k0) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as Cluster;
      const d = minD[i] as number;
      if (d < 1e-6) continue;
      const score = d * Math.sqrt(p.w) * (1 + 3 * chromaOf(p.lab));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const c = { ...(pts[best] as Cluster).lab };
    centers.push(c);
    for (let i = 0; i < pts.length; i++) minD[i] = Math.min(minD[i] as number, dist2((pts[i] as Cluster).lab, c));
  }
  const assign = new Int32Array(pts.length).fill(-1);
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      const p = (pts[i] as Cluster).lab;
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(p, centers[c] as Lab);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        changed = true;
      }
    }
    if (!changed) break;
    const acc = centers.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as Cluster;
      const a = acc[assign[i] as number] as { L: number; a: number; b: number; w: number };
      a.L += p.lab.L * p.w;
      a.a += p.lab.a * p.w;
      a.b += p.lab.b * p.w;
      a.w += p.w;
    }
    acc.forEach((a, c) => {
      if (a.w > 0) centers[c] = { L: a.L / a.w, a: a.a / a.w, b: a.b / a.w };
    });
  }
  let clusters: Cluster[] = centers.map((lab) => ({ lab, w: 0 }));
  for (let i = 0; i < pts.length; i++) (clusters[assign[i] as number] as Cluster).w += (pts[i] as Cluster).w;
  clusters = clusters.filter((c) => c.w > 0);

  // 4a: merge near-duplicates (closest pair first).
  for (;;) {
    let bi = -1;
    let bj = -1;
    let bd = MERGE_DIST;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const d = labDistance((clusters[i] as Cluster).lab, (clusters[j] as Cluster).lab);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    if (bi < 0) break;
    const a = clusters[bi] as Cluster;
    const b = clusters[bj] as Cluster;
    const sw = a.w + b.w;
    clusters[bi] = {
      lab: {
        L: (a.lab.L * a.w + b.lab.L * b.w) / sw,
        a: (a.lab.a * a.w + b.lab.a * b.w) / sw,
        b: (a.lab.b * a.w + b.lab.b * b.w) / sw,
      },
      w: sw,
    };
    clusters.splice(bj, 1);
  }
  clusters.sort((p, q) => q.w - p.w || p.lab.L - q.lab.L);

  // 4b: drop tiny clusters (vivid ones survive down to a lower floor), keep at least 2 if possible.
  let kept = clusters.filter(
    (c) => c.w >= MIN_WEIGHT || (chromaOf(c.lab) >= VIVID_CHROMA && c.w >= VIVID_MIN_WEIGHT),
  );
  for (const c of clusters) {
    if (kept.length >= Math.min(2, clusters.length)) break;
    if (!kept.includes(c)) kept.push(c);
  }

  // 4c: cap at maxColors: heaviest first, then by sqrt(weight) * distinctness * chroma boost.
  if (kept.length > maxColors) {
    const sel: Cluster[] = [kept[0] as Cluster];
    const rest = kept.slice(1);
    while (sel.length < maxColors && rest.length) {
      let bi = 0;
      let bs = -1;
      rest.forEach((c, i) => {
        const d = Math.min(...sel.map((s) => labDistance(s.lab, c.lab)));
        const s = Math.sqrt(c.w) * d * (1 + 4 * chromaOf(c.lab));
        if (s > bs) {
          bs = s;
          bi = i;
        }
      });
      sel.push(rest.splice(bi, 1)[0] as Cluster);
    }
    kept = sel;
  }

  // Give every cluster's weight to its nearest kept color, so weights reflect coverage and sum to 1.
  const weights = kept.map(() => 0);
  for (const c of clusters) {
    let bi = 0;
    let bd = Infinity;
    kept.forEach((k, i) => {
      const d = dist2(k.lab, c.lab);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    weights[bi] = (weights[bi] as number) + c.w;
  }
  const byHex = new Map<string, number>();
  kept.forEach((k, i) => {
    const hex = labToHex(k.lab);
    byHex.set(hex, (byHex.get(hex) ?? 0) + (weights[i] as number));
  });
  const sum = [...byHex.values()].reduce((s, v) => s + v, 0) || 1;
  const colors = [...byHex.entries()]
    .map(([hex, wt]) => ({ hex, weight: Math.round((wt / sum) * 10000) / 10000 }))
    .sort((p, q) => q.weight - p.weight || (p.hex < q.hex ? -1 : p.hex > q.hex ? 1 : 0));
  return { colors };
}
