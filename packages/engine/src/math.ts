/** Pure math helpers: clamping, easing, interpolation, colors, seeded RNG. No Date/Math.random. */

export type Easing = (t: number) => number;

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Inverse of lerp: where `v` sits between a and b (unclamped). */
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, inLo: number, inHi: number, outLo: number, outHi: number): number =>
  lerp(outLo, outHi, invLerp(inLo, inHi, v));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
/** Triangle wave 0..1..0 with the given period (same unit as `v`). */
export const pingPong = (v: number, period: number): number => {
  const p = ((v % period) + period) % period;
  const h = period / 2;
  return p <= h ? p / h : (period - p) / h;
};

// ------------------------------------------------------------- seconds <-> frames
export const secondsToFrames = (seconds: number, fps: number): number => Math.round(seconds * fps);
export const framesToSeconds = (frames: number, fps: number): number => frames / fps;
/** Frame offset for the n-th item in a staggered sequence. */
export const stagger = (index: number, delayFrames: number): number => index * delayFrames;

// ------------------------------------------------------------- easing
const snap =
  (fn: Easing): Easing =>
  (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : fn(t);
const outOf =
  (fn: Easing): Easing =>
  (t) =>
    1 - fn(1 - t);
const inOutOf =
  (fn: Easing): Easing =>
  (t) =>
    t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 - 2 * t) / 2;

export const linear: Easing = (t) => t;

export const easeInQuad: Easing = snap((t) => t * t);
export const easeOutQuad: Easing = snap(outOf((t) => t * t));
export const easeInOutQuad: Easing = snap(inOutOf((t) => t * t));

export const easeInCubic: Easing = snap((t) => t * t * t);
export const easeOutCubic: Easing = snap(outOf((t) => t * t * t));
export const easeInOutCubic: Easing = snap(inOutOf((t) => t * t * t));

export const easeInQuart: Easing = snap((t) => t * t * t * t);
export const easeOutQuart: Easing = snap(outOf((t) => t * t * t * t));
export const easeInOutQuart: Easing = snap(inOutOf((t) => t * t * t * t));

const expoIn: Easing = (t) => Math.pow(2, 10 * t - 10);
export const easeInExpo: Easing = snap(expoIn);
export const easeOutExpo: Easing = snap(outOf(expoIn));
export const easeInOutExpo: Easing = snap(inOutOf(expoIn));

const backIn =
  (c1: number): Easing =>
  (t) =>
    t * t * ((c1 + 1) * t - c1);
export const easeInBack: Easing = snap(backIn(1.70158));
export const easeOutBack: Easing = snap(outOf(backIn(1.70158)));
export const easeInOutBack: Easing = snap(inOutOf(backIn(1.70158 * 1.525)));

/** Spring-like overshoot that settles at 1. */
export const easeOutElastic: Easing = snap((t) => {
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
});

/** CSS-style cubic-bezier easing (x1,x2 must be within 0..1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return snap((x) => sy(solve(x)));
}

/** Named easings, handy for select params. */
export const easings = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeOutElastic,
} as const;

export interface InterpolateOptions {
  /** One easing for all segments, or one per segment. Default linear. */
  easing?: Easing | Easing[];
  /** Clamp output to the output range ends (default true). When false, extrapolates linearly. */
  clamp?: boolean;
}

/** Multi-segment interpolation (like Remotion's interpolate). inputRange must be non-decreasing. */
export function interpolate(
  x: number,
  inputRange: number[],
  outputRange: number[],
  opts: InterpolateOptions = {},
): number {
  const n = inputRange.length;
  if (n < 2 || n !== outputRange.length) throw new Error('interpolate: ranges must have equal length >= 2');
  for (let i = 1; i < n; i++) {
    if ((inputRange[i] as number) < (inputRange[i - 1] as number))
      throw new Error('interpolate: inputRange must be non-decreasing');
  }
  const doClamp = opts.clamp ?? true;
  let i = 0;
  while (i < n - 2 && x > (inputRange[i + 1] as number)) i++;
  const a = inputRange[i] as number;
  const b = inputRange[i + 1] as number;
  const o0 = outputRange[i] as number;
  const o1 = outputRange[i + 1] as number;
  let t = a === b ? (x >= b ? 1 : 0) : (x - a) / (b - a);
  if (doClamp) t = clamp01(t);
  const ease = Array.isArray(opts.easing) ? (opts.easing[i] ?? linear) : (opts.easing ?? linear);
  if (t >= 0 && t <= 1) t = ease(t);
  return lerp(o0, o1, t);
}

// ------------------------------------------------------------- colors
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses #rgb, #rrggbb, #rrggbbaa and rgb()/rgba() strings. Invalid input yields opaque black. */
export function parseColor(input: string): RGBA {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(input.trim());
  if (m) return { r: +(m[1] as string), g: +(m[2] as string), b: +(m[3] as string), a: m[4] === undefined ? 1 : +m[4] };
  let h = input.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

export function rgba({ r, g, b, a }: RGBA): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(clamp01(a) * 1000) / 1000})`;
}

/** Mixes two colors (t=0 -> a, t=1 -> b). Returns an rgba() string. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return rgba({
    r: lerp(ca.r, cb.r, t),
    g: lerp(ca.g, cb.g, t),
    b: lerp(ca.b, cb.b, t),
    a: lerp(ca.a, cb.a, t),
  });
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return rgba({ ...c, a: c.a * clamp01(alpha) });
}

/** WCAG relative luminance, 0..1. */
export function luminance(color: string): number {
  const { r, g, b } = parseColor(color);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Picks whichever of light/dark text has better contrast on `bg`. */
export function readableOn(bg: string, light = '#FFFFFF', dark = '#0B1020'): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

// ------------------------------------------------------------- seeded random
/** 32-bit FNV-1a string hash. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32 PRNG. Seed may be a number or string. Returns floats in [0, 1). */
export function createRng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngRange = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();
