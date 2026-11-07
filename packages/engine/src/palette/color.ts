/**
 * Internal color math for the palette module: sRGB <-> linear <-> OKLab/OKLCH, gamut mapping by
 * chroma reduction, WCAG luminance. Pure functions, no allocation-heavy work, browser + Node safe.
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export interface Lch {
  L: number;
  C: number;
  /** Hue in radians. */
  h: number;
}

/** 8-bit sRGB channel -> linear light (0..1). */
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  LIN[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
export const srgb8ToLinear = (v: number): number => LIN[v] as number;

const linearToSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function linearToLab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab -> linear sRGB (may be out of the 0..1 gamut). */
export function labToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export const labToLch = ({ L, a, b }: Lab): Lch => ({ L, C: Math.hypot(a, b), h: Math.atan2(b, a) });
export const lchToLab = ({ L, C, h }: Lch): Lab => ({ L, a: C * Math.cos(h), b: C * Math.sin(h) });

export function hexToRgb8(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb8(hex);
  return linearToLab(srgb8ToLinear(r), srgb8ToLinear(g), srgb8ToLinear(b));
}

export const hexToLch = (hex: string): Lch => labToLch(hexToLab(hex));

const EPS = 1e-6;
const inGamut = (c: [number, number, number]): boolean =>
  c[0] >= -EPS && c[0] <= 1 + EPS && c[1] >= -EPS && c[1] <= 1 + EPS && c[2] >= -EPS && c[2] <= 1 + EPS;

/** Largest chroma <= C that is inside sRGB at (L, h). */
export function gamutChroma(L: number, C: number, h: number): number {
  if (L <= 0 || L >= 1) return 0;
  const ca = Math.cos(h);
  const sb = Math.sin(h);
  if (inGamut(labToLinear(L, C * ca, C * sb))) return C;
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(labToLinear(L, mid * ca, mid * sb))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** In-gamut linear sRGB for an OKLCH color (chroma reduced as needed). */
export function lchToLinearInGamut({ L, C, h }: Lch): [number, number, number] {
  const Lc = Math.min(1, Math.max(0, L));
  const c = gamutChroma(Lc, Math.max(0, C), h);
  const rgb = labToLinear(Lc, c * Math.cos(h), c * Math.sin(h));
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const hex2 = (v: number): string => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255).toString(16).padStart(2, '0');

export function linearToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}

export function labToHex({ L, a, b }: Lab): string {
  const lch = labToLch({ L, a, b });
  const [r, g, bb] = lchToLinearInGamut(lch);
  return linearToHex(r, g, bb);
}

export function lchToHex(lch: Lch): string {
  const [r, g, b] = lchToLinearInGamut(lch);
  return linearToHex(r, g, b);
}

/** WCAG relative luminance from linear sRGB. */
export const linearLuminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG luminance of an OKLCH color after gamut mapping. */
export function lchLuminance(lch: Lch): number {
  const [r, g, b] = lchToLinearInGamut(lch);
  return linearLuminance(r, g, b);
}

/** Euclidean OKLab distance. */
export const labDistance = (p: Lab, q: Lab): number => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

/** Finds the OKLCH lightness that gives WCAG luminance `y` at (C, h), chroma gamut-mapped. */
export function lightnessForLuminance(y: number, C: number, h: number): number {
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (lchLuminance({ L: mid, C, h }) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
