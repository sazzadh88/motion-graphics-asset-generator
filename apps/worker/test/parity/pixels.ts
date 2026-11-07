/** Pixel comparison helpers (RGBA buffers, 8 bits per channel). */

export interface Diff {
  /** Number of pixels with any channel different. */
  pixels: number;
  /** Largest absolute per-channel difference. */
  maxDelta: number;
  /** First differing pixel (x, y) with both values, or null when identical. */
  first: { x: number; y: number; a: number[]; b: number[] } | null;
}

export function diffRgba(a: Buffer, b: Buffer, width: number): Diff {
  if (a.length !== b.length) throw new Error(`buffer sizes differ: ${a.length} vs ${b.length}`);
  let pixels = 0;
  let maxDelta = 0;
  let first: Diff['first'] = null;
  for (let i = 0; i < a.length; i += 4) {
    let px = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      if (d > px) px = d;
    }
    if (px === 0) continue;
    pixels++;
    if (px > maxDelta) maxDelta = px;
    if (!first) {
      const p = i / 4;
      first = { x: p % width, y: Math.floor(p / width), a: [...a.subarray(i, i + 4)], b: [...b.subarray(i, i + 4)] };
    }
  }
  return { pixels, maxDelta, first };
}

export function describeDiff(label: string, d: Diff, total: number): string {
  if (!d.first) return `${label}: identical`;
  const f = d.first;
  return (
    `${label}: ${d.pixels}/${total} pixels differ (${((d.pixels / total) * 100).toFixed(3)}%), ` +
    `max channel delta ${d.maxDelta}; first at (${f.x},${f.y}) rgba(${f.a.join(',')}) vs rgba(${f.b.join(',')})`
  );
}

/** PSNR in dB (Infinity when identical). */
export function psnrFromMse(mse: number): number {
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

export interface Quality {
  psnr: number;
  maxDelta: number;
}

/**
 * Colour PSNR between a reference (RGBA) and a decoded frame.
 * `mode`: 'rgb' compares straight RGB (opaque frames; decoded may be RGB24 or RGBA);
 * 'premul' compares RGB premultiplied by the reference/decoded alpha (what is visible
 * after compositing, so colour under fully transparent pixels does not count).
 */
export function colourQuality(ref: Buffer, dec: Buffer, decChannels: 3 | 4, mode: 'rgb' | 'premul'): Quality {
  const n = ref.length / 4;
  if (dec.length !== n * decChannels) throw new Error(`decoded frame size ${dec.length} != ${n * decChannels}`);
  let se = 0;
  let maxDelta = 0;
  for (let p = 0; p < n; p++) {
    const r = p * 4;
    const d = p * decChannels;
    const ra = mode === 'premul' ? ref[r + 3]! / 255 : 1;
    const da = mode === 'premul' && decChannels === 4 ? dec[d + 3]! / 255 : 1;
    for (let c = 0; c < 3; c++) {
      const diff = ref[r + c]! * ra - dec[d + c]! * da;
      se += diff * diff;
      const ad = Math.abs(diff);
      if (ad > maxDelta) maxDelta = ad;
    }
  }
  return { psnr: psnrFromMse(se / (n * 3)), maxDelta: Math.round(maxDelta) };
}

/** Alpha-channel PSNR between two RGBA buffers. */
export function alphaQuality(ref: Buffer, dec: Buffer): Quality {
  let se = 0;
  let maxDelta = 0;
  for (let i = 3; i < ref.length; i += 4) {
    const d = ref[i]! - dec[i]!;
    se += d * d;
    if (Math.abs(d) > maxDelta) maxDelta = Math.abs(d);
  }
  return { psnr: psnrFromMse(se / (ref.length / 4)), maxDelta };
}

export function fmtDb(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(2)} dB` : 'inf (identical)';
}
