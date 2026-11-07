/**
 * Deterministic interpreter for `mg-scene@1` (docs/SCENE_FORMAT.md). Every frame is a pure function
 * of (scene, frame, settings, values, loaded assets). The only cache (text layout) is keyed by every
 * input that affects the layout, including a probe measurement of the active font.
 */
import type { AssetValues, Ctx2D, FrameInfo, LoadedAssets, ParamDef, TemplateDefinition } from '../types';
import {
  clamp01,
  cubicBezier,
  easeInBack,
  easeInCubic,
  easeInExpo,
  easeInOutBack,
  easeInOutCubic,
  easeInOutExpo,
  easeInOutQuad,
  easeInOutQuart,
  easeInQuad,
  easeInQuart,
  easeOutBack,
  easeOutCubic,
  easeOutElastic,
  easeOutExpo,
  easeOutQuad,
  easeOutQuart,
  lerp,
  linear,
  mixColors,
  parseColor,
  rgba,
  type Easing,
} from '../math';
import { layoutText, measureText, setFont, wrapText, type LaidOutChar, type TextLayout } from '../text';
import { imageSize, roundRectPath } from '../draw';
import { LENGTH_PATTERN, TIME_PATTERN } from './validate';
import type {
  AnimProp,
  BindableNumber,
  Color,
  CounterLayer,
  Ease,
  EaseName,
  Fill,
  FontDef,
  GroupLayer,
  ImageLayer,
  Keyframe,
  Layer,
  Length,
  LengthLiteral,
  Motion,
  NumberBinding,
  PresetName,
  Scene,
  SelectCases,
  StaggerUnit,
  Stroke,
  TextLayer,
  TextValue,
  TimeRef,
} from './types';

const EPS = 1e-9;

// ------------------------------------------------------------------ environment

export interface SceneEnv {
  ctx: Ctx2D;
  /** Canvas size in px. */
  w: number;
  h: number;
  /** Seconds since the scene start. */
  time: number;
  /** Time of `"end"` in seconds: the timestamp of the last frame, (durationFrames - 1) / fps. */
  end: number;
  values: AssetValues;
  params: Map<string, ParamDef>;
  images: LoadedAssets['images'];
}

/** Minimal environment for resolving values outside of drawing (tests, tools). */
export interface ValueEnv {
  w: number;
  h: number;
  values?: AssetValues;
  params?: Map<string, ParamDef>;
}

function paramValue(env: ValueEnv, key: string): unknown {
  const v = env.values?.[key];
  if (v !== undefined) return v;
  return env.params?.get(key)?.default;
}

function paramNumber(env: ValueEnv, key: string): number {
  const v = paramValue(env, key);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const d = env.params?.get(key)?.default;
  return typeof d === 'number' ? d : 0;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isCases = (v: unknown): v is SelectCases<unknown> => isObject(v) && 'cases' in v && 'param' in v;
const isBinding = (v: unknown): v is NumberBinding<unknown> => isObject(v) && 'param' in v && !('cases' in v);
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The case value for the select's current option; falls back to `default`, then to the case of the
 * select's declared default option. `undefined` only when none of these exist.
 */
export function selectCase<V>(c: SelectCases<V>, env: ValueEnv): V | undefined {
  const v = paramValue(env, c.param);
  if (typeof v === 'string' && hasOwn(c.cases, v)) return c.cases[v];
  if (c.default !== undefined) return c.default;
  const d = env.params?.get(c.param)?.default;
  if (typeof d === 'string' && hasOwn(c.cases, d)) return c.cases[d];
  return undefined;
}

/**
 * A number binding → number. Plain `{param}` → `plain(value)`; `map` and `ofMax` → a linear map onto
 * `out`, each out value converted with `out`.
 */
function resolveBinding<V>(b: NumberBinding<V>, env: ValueEnv, out: (v: V) => number, plain: (n: number) => number): number {
  const x = paramNumber(env, b.param);
  let t: number;
  let pair: [V, V];
  if ('map' in b) {
    const [a, c] = b.map.in;
    t = c === a ? 0 : (x - a) / (c - a);
    pair = b.map.out;
  } else if ('ofMax' in b) {
    let m = -Infinity;
    for (const k of b.ofMax) m = Math.max(m, paramNumber(env, k));
    t = m > 0 ? x / m : 0;
    pair = b.out;
  } else return plain(x);
  if (b.clamp) t = clamp01(t);
  return lerp(out(pair[0]), out(pair[1]), t);
}

/** Number, number binding (plain, map, ofMax) or select cases → number. */
export function resolveNumber(v: BindableNumber | undefined, env: ValueEnv, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  if (isCases(v)) return resolveNumber(selectCase(v, env) as BindableNumber | undefined, env, fallback);
  if (isBinding(v)) return resolveBinding(v, env, (o) => (typeof o === 'number' ? o : 0), (n) => n);
  return fallback;
}

/**
 * Length → px. Numbers (and number-param bindings) are percent of vmin.
 * `box` overrides the reference size (used inside fills, which resolve against the filled box).
 */
export function resolveLength(v: Length | undefined, env: ValueEnv, fallback = 0, box?: { w: number; h: number }): number {
  if (v === undefined) return fallback;
  if (isCases(v)) return resolveLength(selectCase(v, env) as Length | undefined, env, fallback, box);
  const w = box ? box.w : env.w;
  const h = box ? box.h : env.h;
  const vmin = Math.min(w, h);
  if (typeof v === 'number') return (v / 100) * vmin;
  if (typeof v === 'string') {
    const m = LENGTH_PATTERN.exec(v);
    if (!m) return fallback;
    const n = Number(m[1]);
    switch (m[2]) {
      case 'px':
        return n;
      case '%w':
        return (n / 100) * w;
      case '%h':
        return (n / 100) * h;
      default:
        return (n / 100) * vmin;
    }
  }
  if (isBinding(v))
    return resolveBinding<LengthLiteral>(
      v,
      env,
      (o) => resolveLength(o, env, 0, box),
      (n) => (n / 100) * vmin,
    );
  return fallback;
}

/** `5`, `"end"`, `"end-0.5"` → seconds. */
export function resolveTime(v: TimeRef | undefined, end: number, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  const m = TIME_PATTERN.exec(v);
  if (!m) return fallback;
  return end - (m[1] ? Number(m[1]) : 0);
}

const EASES: Record<EaseName, Easing> = {
  linear,
  inQuad: easeInQuad,
  outQuad: easeOutQuad,
  inOutQuad: easeInOutQuad,
  inCubic: easeInCubic,
  outCubic: easeOutCubic,
  inOutCubic: easeInOutCubic,
  inQuart: easeInQuart,
  outQuart: easeOutQuart,
  inOutQuart: easeInOutQuart,
  inExpo: easeInExpo,
  outExpo: easeOutExpo,
  inOutExpo: easeInOutExpo,
  inBack: easeInBack,
  outBack: easeOutBack,
  inOutBack: easeInOutBack,
  outElastic: easeOutElastic,
};
const bezierCache = new WeakMap<object, Easing>();

export function resolveEase(e: Ease | undefined, fallback: Easing = linear): Easing {
  if (e === undefined) return fallback;
  if (typeof e === 'string') return EASES[e] ?? fallback;
  let fn = bezierCache.get(e);
  if (!fn) {
    const [x1, y1, x2, y2] = e.cubicBezier;
    fn = cubicBezier(x1, y1, x2, y2);
    bezierCache.set(e, fn);
  }
  return fn;
}

// ------------------------------------------------------------------ text interpolation

const INTERP = /\{\{([^{}]*)\}\}/g;

/** A text value (string or select cases of strings) → the template string, before interpolation. */
export function resolveTextValue(v: TextValue | undefined, env: ValueEnv): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  return selectCase(v, env) ?? '';
}

/** Replaces `{{param}}` / `{{param|upper}}` / `{{param|lower}}` with current param values. */
export function interpolateText(s: string, env: ValueEnv): string {
  return s.replace(INTERP, (_, body: string) => {
    const [name = '', filter] = body.split('|').map((x) => x.trim());
    const v = paramValue(env, name);
    const str = v === null || v === undefined ? '' : String(v);
    return filter === 'upper' ? str.toUpperCase() : filter === 'lower' ? str.toLowerCase() : str;
  });
}

// ------------------------------------------------------------------ colors and fills

export function resolveColor(c: Color, env: ValueEnv): string {
  if (typeof c === 'string') return rgba(parseColor(c));
  if (isCases(c)) return resolveColor(selectCase(c, env) ?? '#00000000', env);
  if ('mix' in c) return mixColors(resolveColor(c.mix[0], env), resolveColor(c.mix[1], env), c.t);
  const v = paramValue(env, c.param);
  const col = parseColor(typeof v === 'string' ? v : '#000000');
  return rgba({ ...col, a: col.a * (c.alpha ?? 1) });
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function resolveFill(f: Fill, env: SceneEnv, box: Box): string | CanvasGradient {
  if (isCases(f)) return resolveFill(selectCase(f, env) ?? '#00000000', env, box);
  if (typeof f === 'object' && 'linear' in f) {
    const a = (f.linear.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const g = env.ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    for (const [o, c] of f.linear.stops) g.addColorStop(clamp01(o), resolveColor(c, env));
    return g;
  }
  if (typeof f === 'object' && 'radial' in f) {
    const ref = { w: box.w, h: box.h };
    const cx = box.x + resolveLength(f.radial.cx, env, box.w / 2, ref);
    const cy = box.y + resolveLength(f.radial.cy, env, box.h / 2, ref);
    const r = Math.max(0.001, resolveLength(f.radial.r, env, 50, ref));
    const g = env.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, c] of f.radial.stops) g.addColorStop(clamp01(o), resolveColor(c, env));
    return g;
  }
  return resolveColor(f, env);
}

// ------------------------------------------------------------------ animated properties

const LENGTH_PROPS: ReadonlySet<string> = new Set(['x', 'y', 'width', 'height', 'radius']);

/** Value of a keyframe track at layer-local time `t` (seconds). */
export function sampleKeyframes(kfs: Keyframe[], t: number, toNumber: (v: Keyframe['v']) => number): number {
  const first = kfs[0] as Keyframe;
  if (t <= first.t || kfs.length === 1) return toNumber(first.v);
  const last = kfs[kfs.length - 1] as Keyframe;
  if (t >= last.t) return toNumber(last.v);
  let i = 0;
  while (i < kfs.length - 2 && t >= (kfs[i + 1] as Keyframe).t) i++;
  const a = kfs[i] as Keyframe;
  const b = kfs[i + 1] as Keyframe;
  const u = (t - a.t) / (b.t - a.t);
  return lerp(toNumber(a.v), toNumber(b.v), resolveEase(b.ease, linear)(u));
}

/** base → keyframes (replace) → ambient (adds). Preset effects are applied on top by the caller. */
function animated(layer: Layer, prop: AnimProp, base: number, lt: number, env: SceneEnv): number {
  const isLen = LENGTH_PROPS.has(prop);
  const toNum = (v: Keyframe['v']) => (isLen ? resolveLength(v as Length, env) : resolveNumber(v as BindableNumber, env, 0));
  const kfs = layer.keyframes?.[prop];
  let v = kfs && kfs.length ? sampleKeyframes(kfs, lt, toNum) : base;
  if (layer.ambient) {
    for (const a of layer.ambient) {
      if (a.prop !== prop) continue;
      const amp = isLen ? resolveLength(a.amplitude, env) : typeof a.amplitude === 'number' ? a.amplitude : 0;
      v += amp * Math.sin(2 * Math.PI * (lt / a.period + (a.phase ?? 0)));
    }
  }
  return v;
}

// ------------------------------------------------------------------ motion presets

export interface Effect {
  dx: number;
  dy: number;
  alpha: number;
  scale: number;
  clip: 'none' | 'mask' | 'wipe-right' | 'wipe-left';
  /** Eased progress, 1 = at rest. */
  p: number;
}

export const IDENTITY: Effect = { dx: 0, dy: 0, alpha: 1, scale: 1, clip: 'none', p: 1 };

export const DEFAULT_MOTION_DURATION = 0.6;

/** A motion whose preset is a literal name (select cases resolved). */
export type ResolvedMotion = Motion & { preset: PresetName };

/** The literal preset of a motion; cases fall back to their default (or first case) without an env. */
function presetOf(m: Motion): PresetName {
  if (typeof m.preset === 'string') return m.preset;
  return m.preset.default ?? (Object.values(m.preset.cases)[0] as PresetName | undefined) ?? 'fade';
}

/** Resolves a select-driven preset name against the current param values. */
export function resolveMotion(m: Motion | undefined, env: ValueEnv): ResolvedMotion | undefined {
  if (!m) return undefined;
  if (typeof m.preset === 'string') return m as ResolvedMotion;
  return { ...m, preset: selectCase(m.preset, env) ?? presetOf(m) };
}

/** Per-unit start offset (seconds) and unit count for a motion over `n` units. */
export function staggerEach(m: Motion, n: number): number {
  if (m.stagger) return m.stagger.each;
  if (presetOf(m) === 'typewriter') return (m.duration ?? DEFAULT_MOTION_DURATION) / Math.max(1, n);
  return 0;
}

/**
 * State of a preset for one unit. `tau` = seconds since the unit's window opened (enter), or seconds
 * until the unit's window closes (exit: the exit is the enter played backwards).
 */
export function presetEffect(m: Motion, tau: number, env: ValueEnv): Effect {
  const dur = m.duration ?? DEFAULT_MOTION_DURATION;
  const preset = presetOf(m);
  if (preset === 'typewriter') return { ...IDENTITY, alpha: tau > EPS ? 1 : 0, p: tau > EPS ? 1 : 0 };
  const r = dur <= 0 ? (tau >= 0 ? 1 : 0) : clamp01(tau / dur);
  if (r >= 1) return IDENTITY;
  const p = resolveEase(m.ease, preset === 'pop' ? easeOutBack : easeOutCubic)(r);
  const moveDefault = preset === 'slide-left' || preset === 'slide-right' ? 10 : 6;
  const d = resolveLength(m.distance ?? moveDefault, env);
  const a = clamp01(p);
  switch (preset) {
    case 'fade':
      return { ...IDENTITY, alpha: a, p };
    case 'rise':
      return { ...IDENTITY, dy: (1 - p) * d, alpha: a, p };
    case 'drop':
      return { ...IDENTITY, dy: -(1 - p) * d, alpha: a, p };
    case 'slide-left':
      return { ...IDENTITY, dx: (1 - p) * d, alpha: a, p };
    case 'slide-right':
      return { ...IDENTITY, dx: -(1 - p) * d, alpha: a, p };
    case 'pop':
      return { ...IDENTITY, scale: Math.max(0, p), alpha: clamp01(r * 4), p };
    case 'scale-in':
      return { ...IDENTITY, scale: lerp(0.6, 1, p), alpha: a, p };
    case 'mask-up':
      return { ...IDENTITY, clip: 'mask', p };
    case 'wipe-right':
      return { ...IDENTITY, clip: 'wipe-right', p };
    case 'wipe-left':
      return { ...IDENTITY, clip: 'wipe-left', p };
  }
  return IDENTITY;
}

/** tau for unit `i` of an enter motion at layer-local time `lt`. */
export const enterTau = (m: Motion, lt: number, i: number, each: number): number => lt - (m.delay ?? 0) - i * each;
/** tau for unit `i` of an exit motion; `untilEnd` = layer end − now. */
export const exitTau = (m: Motion, untilEnd: number, i: number, each: number): number =>
  untilEnd - (m.delay ?? 0) - i * each;

/** Total duration of a motion across `n` units: duration + (n − 1) × each. */
export function motionSpan(m: Motion, n: number): number {
  const each = staggerEach(m, n);
  const dur = presetOf(m) === 'typewriter' ? 0 : (m.duration ?? DEFAULT_MOTION_DURATION);
  return dur + Math.max(0, n - 1) * each;
}

/**
 * Applies an effect for a unit with box `box`; `mask` is the clip box for mask-up.
 * Clips first (static), then moves/scales the content. Scale pivots on `pivot` (default: the box centre).
 */
function applyEffect(ctx: Ctx2D, e: Effect, box: Box, mask: Box, pivot?: { x: number; y: number }): void {
  if (e.clip === 'mask' && e.p < 1) {
    ctx.beginPath();
    ctx.rect(mask.x, mask.y, mask.w, mask.h);
    ctx.clip();
    ctx.translate(0, (1 - e.p) * (mask.y + mask.h - Math.min(mask.y, box.y)));
  } else if ((e.clip === 'wipe-right' || e.clip === 'wipe-left') && e.p < 1) {
    const p = clamp01(e.p);
    const big = Math.max(box.w, box.h) * 4 + 1e4;
    const x0 = e.clip === 'wipe-right' ? box.x : box.x + (1 - p) * box.w;
    ctx.beginPath();
    ctx.rect(x0, box.y - big, box.w * p, box.h + 2 * big);
    ctx.clip();
  }
  if (e.dx || e.dy) ctx.translate(e.dx, e.dy);
  if (e.scale !== 1) {
    const cx = pivot ? pivot.x : box.x + box.w / 2;
    const cy = pivot ? pivot.y : box.y + box.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(e.scale, e.scale);
    ctx.translate(-cx, -cy);
  }
}

// ------------------------------------------------------------------ text layout (memoized)

const CAP_HEIGHT: Record<string, number> = { 'Inter Variable': 0.727, 'Montserrat Variable': 0.7, Anton: 0.74 };
const PROBE = 'Hamburgefonstiv 0123456789';

interface ResolvedFont {
  family: string;
  weight: number;
  size: number;
  italic: boolean;
  lineHeight: number;
  /** px */
  letterSpacing: number;
}

function fontSpec(f: ResolvedFont) {
  return { family: f.family, weight: f.weight, size: f.size, style: f.italic ? ('italic' as const) : ('normal' as const) };
}

function resolveFont(f: FontDef, env: SceneEnv): ResolvedFont {
  const size = Math.max(1, resolveLength(f.size, env, 40));
  return {
    family: f.family,
    weight: f.weight ?? 400,
    size,
    italic: f.italic ?? false,
    lineHeight: f.lineHeight ?? 1.1,
    letterSpacing: (f.letterSpacing ?? 0) * size,
  };
}

const layoutCache = new Map<string, TextLayout>();
const LAYOUT_CACHE_MAX = 256;

/** Font-dependent probe width: makes the cache key change when the actual font face changes. */
function probe(ctx: Ctx2D): number {
  return ctx.measureText(PROBE).width;
}

function cached(key: string, build: () => TextLayout): TextLayout {
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const v = build();
  if (layoutCache.size >= LAYOUT_CACHE_MAX) {
    const oldest = layoutCache.keys().next().value;
    if (oldest !== undefined) layoutCache.delete(oldest);
  }
  layoutCache.set(key, v);
  return v;
}

/** Test hook: empties the layout cache (output never depends on it). */
export function clearSceneLayoutCache(): void {
  layoutCache.clear();
}

function truncateLine(ctx: Ctx2D, line: string, maxWidth: number, ls: number): string {
  const chars = Array.from(line);
  while (chars.length && measureText(ctx, `${chars.join('').trimEnd()}…`, ls) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

interface TextOpts {
  maxWidth?: number;
  maxLines?: number;
  minSize?: number;
  align: 'left' | 'center' | 'right';
}

/** Wraps, auto-fits and lays out text. Leaves the final font set on ctx. */
export function layoutSceneText(ctx: Ctx2D, text: string, font: ResolvedFont, o: TextOpts): TextLayout {
  setFont(ctx, fontSpec(font));
  const key = JSON.stringify([
    text,
    font.family,
    font.weight,
    font.size,
    font.italic,
    font.lineHeight,
    font.letterSpacing,
    o.maxWidth ?? null,
    o.maxLines ?? null,
    o.minSize ?? null,
    o.align,
    probe(ctx),
  ]);
  const layout = cached(key, () => {
    const em = font.size ? font.letterSpacing / font.size : 0;
    let size = font.size;
    let lines: string[];
    const wrap = (s: number): string[] => {
      setFont(ctx, fontSpec({ ...font, size: s }));
      return o.maxWidth !== undefined ? wrapText(ctx, text, o.maxWidth, em * s) : text.split('\n');
    };
    lines = wrap(size);
    if (o.minSize !== undefined && o.maxWidth !== undefined) {
      const maxW = o.maxWidth;
      const min = Math.min(o.minSize, size);
      const words = text.split(/\s+/).filter(Boolean);
      const fits = (s: number, ls: string[]) =>
        (o.maxLines === undefined || ls.length <= o.maxLines) && words.every((w) => measureText(ctx, w, em * s) <= maxW);
      for (let i = 0; i < 80 && !fits(size, lines) && size > min; i++) {
        size = Math.max(min, size * 0.96);
        lines = wrap(size);
      }
    }
    const ls = em * size;
    setFont(ctx, fontSpec({ ...font, size }));
    if (o.maxLines !== undefined && lines.length > o.maxLines) {
      lines = lines.slice(0, o.maxLines);
      const lastIdx = o.maxLines - 1;
      lines[lastIdx] = truncateLine(ctx, lines[lastIdx] ?? '', o.maxWidth ?? Infinity, ls);
    }
    return layoutText(ctx, lines, size, {
      lineHeightPx: size * font.lineHeight,
      letterSpacing: ls,
      align: o.align,
      capHeightEm: CAP_HEIGHT[font.family] ?? 0.72,
    });
  });
  setFont(ctx, fontSpec({ ...font, size: layout.size }));
  return layout;
}

// ------------------------------------------------------------------ counter

/** Formats a counter value: fixed decimals, thousands separator on the integer part, no "-0". */
export function formatCounter(value: number, decimals = 0, separator = ','): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart = '0', frac] = fixed.split('.');
  const int = separator ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : intPart;
  const neg = value < 0 && Number(fixed) !== 0;
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Single-line layout with tabular digits (fixed digit cells) so counting does not jitter. */
function counterLayout(ctx: Ctx2D, text: string, numStart: number, numEnd: number, font: ResolvedFont): TextLayout {
  setFont(ctx, fontSpec(font));
  const key = JSON.stringify(['counter', text, numStart, numEnd, font, probe(ctx)]);
  return cached(key, () => {
    let digitW = 0;
    for (let d = 0; d <= 9; d++) digitW = Math.max(digitW, ctx.measureText(String(d)).width);
    const chars = Array.from(text);
    const out: LaidOutChar[] = [];
    let x = 0;
    let wordIndex = 0;
    let prevSpace = false;
    let k = 0;
    chars.forEach((ch, i) => {
      const w = ctx.measureText(ch).width;
      const tab = i >= numStart && i < numEnd && ch >= '0' && ch <= '9';
      const adv = tab ? digitW : w;
      if (ch === ' ') {
        if (!prevSpace && out.length) wordIndex++;
        prevSpace = true;
      } else {
        out.push({ ch, x: x + (tab ? (digitW - w) / 2 : 0), w, index: k++, wordIndex, lineIndex: 0 });
        prevSpace = false;
      }
      x += adv + (i < chars.length - 1 ? font.letterSpacing : 0);
    });
    const width = x;
    const lh = font.size * font.lineHeight;
    const cap = (CAP_HEIGHT[font.family] ?? 0.72) * font.size;
    const words = [] as TextLayout['words'];
    for (const c of out) {
      const wd = words[c.wordIndex];
      if (wd) {
        wd.chars.push(c);
        wd.w = c.x + c.w - wd.x;
        wd.text += c.ch;
      } else words[c.wordIndex] = { text: c.ch, x: c.x, w: c.w, index: c.wordIndex, lineIndex: 0, chars: [c] };
    }
    const denseWords = words.filter(Boolean);
    return {
      lines: [{ text, width, baseline: (lh + cap) / 2, words: denseWords }],
      words: denseWords,
      chars: out,
      width,
      height: lh,
      size: font.size,
      lineHeightPx: lh,
      letterSpacing: font.letterSpacing,
      align: 'left',
    };
  });
}

// ------------------------------------------------------------------ drawing

interface Frame {
  /** layer-local time */
  lt: number;
  /** seconds until the layer's end */
  untilEnd: number;
  /** enter/exit with select-driven presets resolved */
  enter?: ResolvedMotion;
  exit?: ResolvedMotion;
}

/** How a layer's numeric `start`/`end` are read: relative to `origin` (seconds) or scene-absolute. */
interface TimeBase {
  relative: boolean;
  origin: number;
}

const ABSOLUTE: TimeBase = { relative: false, origin: 0 };

function gateOpen(layer: Layer, env: SceneEnv): boolean {
  if (!layer.visibleIf) return true;
  const v = paramValue(env, layer.visibleIf.param);
  const type = env.params.get(layer.visibleIf.param)?.type;
  const on = type === 'image' ? typeof v === 'string' && v.length > 0 : v === true;
  return layer.visibleIf.not ? !on : on;
}

/** A layer's [start, end] in scene seconds. Numeric times in a relative group are offset by its start. */
export function layerWindow(layer: Layer, end: number, base: TimeBase = ABSOLUTE): [number, number] {
  // A missing start is 0 (relative: the group's start); a missing end and "end"/"end-x" are scene times.
  const shift = (v: TimeRef | undefined, missing: boolean) =>
    base.relative && (typeof v === 'number' || (v === undefined && missing)) ? base.origin : 0;
  return [resolveTime(layer.start, end, 0) + shift(layer.start, true), resolveTime(layer.end, end, end) + shift(layer.end, false)];
}

/** Combined layer-level effect of enter/exit when the layer is not drawn per unit. */
function layerEffects(fr: Frame, env: SceneEnv): Effect[] {
  const out: Effect[] = [];
  if (fr.exit) out.push(presetEffect(fr.exit, exitTau(fr.exit, fr.untilEnd, 0, 0), env));
  if (fr.enter) out.push(presetEffect(fr.enter, enterTau(fr.enter, fr.lt, 0, 0), env));
  return out;
}

function drawLayer(layer: Layer, env: SceneEnv, base: TimeBase = ABSOLUTE): void {
  if (!gateOpen(layer, env)) return;
  const [start, end] = layerWindow(layer, env.end, base);
  if (env.time < start - EPS || env.time > end + EPS) return;
  const fr: Frame = {
    lt: env.time - start,
    untilEnd: end - env.time,
    enter: resolveMotion(layer.enter, env),
    exit: resolveMotion(layer.exit, env),
  };
  const { ctx } = env;
  const lt = fr.lt;

  const x = animated(layer, 'x', resolveLength(layer.x, env, 0), lt, env);
  const y = animated(layer, 'y', resolveLength(layer.y, env, 0), lt, env);
  const rot = animated(layer, 'rotation', resolveNumber(layer.rotation, env, 0), lt, env);
  const s = animated(layer, 'scale', resolveNumber(layer.scale, env, 1), lt, env);
  const sx = animated(layer, 'scaleX', resolveNumber(layer.scaleX, env, 1), lt, env);
  const sy = animated(layer, 'scaleY', resolveNumber(layer.scaleY, env, 1), lt, env);
  const opacity = clamp01(animated(layer, 'opacity', resolveNumber(layer.opacity, env, 1), lt, env));
  if (opacity <= 0) return;

  const perUnit = (layer.type === 'text' || layer.type === 'counter') && !!(fr.enter || fr.exit);
  const effects = perUnit ? [] : layerEffects(fr, env);
  let alpha = opacity;
  let scaleK = 1;
  let dx = 0;
  let dy = 0;
  for (const e of effects) {
    alpha *= e.alpha;
    scaleK *= e.scale;
    dx += e.dx;
    dy += e.dy;
  }
  if (alpha <= 0 || scaleK === 0 || s * sx === 0 || s * sy === 0) return;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x + dx, y + dy);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(s * sx * scaleK, s * sy * scaleK);

  if (layer.type === 'group') {
    const g = layer as GroupLayer;
    const relative = g.timing ? g.timing === 'relative' : base.relative;
    const childBase: TimeBase = { relative, origin: start };
    for (const child of g.layers) drawLayer(child, env, childBase);
    ctx.restore();
    return;
  }

  const [ax, ay] = layer.anchor ?? [0.5, 0.5];
  const draw = (W: number, H: number, content: () => void) => {
    ctx.translate(-ax * W, -ay * H);
    const box = { x: 0, y: 0, w: W, h: H };
    for (const e of effects) if (e.clip !== 'none') applyEffect(ctx, { ...e, dx: 0, dy: 0, scale: 1 }, box, box);
    content();
  };

  switch (layer.type) {
    case 'rect': {
      const W = Math.max(0, animated(layer, 'width', resolveLength(layer.width, env), lt, env));
      const H = Math.max(0, animated(layer, 'height', resolveLength(layer.height, env), lt, env));
      const r = Math.max(0, animated(layer, 'radius', resolveLength(layer.radius, env, 0), lt, env));
      draw(W, H, () => {
        roundRectPath(ctx, 0, 0, W, H, r);
        paint(layer.fill, layer.stroke, env, { x: 0, y: 0, w: W, h: H });
      });
      break;
    }
    case 'ellipse': {
      const W = Math.max(0, animated(layer, 'width', resolveLength(layer.width, env), lt, env));
      const H = Math.max(0, animated(layer, 'height', resolveLength(layer.height, env), lt, env));
      draw(W, H, () => {
        ctx.beginPath();
        ctx.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
        paint(layer.fill, layer.stroke, env, { x: 0, y: 0, w: W, h: H });
      });
      break;
    }
    case 'polygon': {
      const R = Math.max(0, animated(layer, 'radius', resolveLength(layer.radius, env), lt, env));
      const inner = layer.innerRadius !== undefined ? Math.max(0, resolveLength(layer.innerRadius, env)) : undefined;
      draw(2 * R, 2 * R, () => {
        polygonPath(ctx, R, R, R, layer.sides, inner);
        paint(layer.fill, layer.stroke, env, { x: 0, y: 0, w: 2 * R, h: 2 * R });
      });
      break;
    }
    case 'image':
      drawImageLayer(layer, env, lt, draw, ax, ay);
      break;
    case 'text':
      drawTextLayer(layer, env, fr, ax, ay);
      break;
    case 'counter':
      drawCounterLayer(layer, env, fr, ax, ay);
      break;
  }
  ctx.restore();
}

function polygonPath(ctx: Ctx2D, cx: number, cy: number, r: number, sides: number, inner?: number): void {
  const n = inner !== undefined ? sides * 2 : sides;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const rr = inner !== undefined && i % 2 === 1 ? inner : r;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/** Fills and strokes the current path. */
function paint(fill: Fill | undefined, stroke: Stroke | undefined, env: SceneEnv, box: Box): void {
  const { ctx } = env;
  if (fill !== undefined) {
    ctx.fillStyle = resolveFill(fill, env, box);
    ctx.fill();
  }
  if (stroke) {
    const lw = resolveLength(stroke.width, env, 0);
    if (lw > 0) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = resolveColor(stroke.color, env);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.setLineDash(stroke.dash ? stroke.dash.map((d) => Math.max(0, resolveLength(d, env))) : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawImageLayer(
  layer: ImageLayer,
  env: SceneEnv,
  lt: number,
  draw: (W: number, H: number, content: () => void) => void,
  ax: number,
  ay: number,
): void {
  const v = paramValue(env, layer.src.param);
  const img = env.images[layer.src.param];
  if (!v || !img) return;
  const size = imageSize(img);
  if (!size.w || !size.h) return;
  const W = Math.max(0, animated(layer, 'width', resolveLength(layer.width, env), lt, env));
  const H = Math.max(0, animated(layer, 'height', resolveLength(layer.height, env), lt, env));
  const r = Math.max(0, animated(layer, 'radius', resolveLength(layer.radius, env, 0), lt, env));
  const { ctx } = env;
  draw(W, H, () => {
    const cover = layer.fit === 'cover';
    const k = cover ? Math.max(W / size.w, H / size.h) : Math.min(W / size.w, H / size.h);
    const dw = size.w * k;
    const dh = size.h * k;
    // contain: the image sits inside its box at the anchor (e.g. [0, 1] → bottom-left).
    const dx = cover ? (W - dw) / 2 : (W - dw) * ax;
    const dy = cover ? (H - dh) / 2 : (H - dh) * ay;
    const clipX = cover ? 0 : dx;
    const clipY = cover ? 0 : dy;
    const clipW = cover ? W : dw;
    const clipH = cover ? H : dh;
    if (cover || r > 0) {
      ctx.save();
      roundRectPath(ctx, clipX, clipY, clipW, clipH, r);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    } else ctx.drawImage(img, dx, dy, dw, dh);
  });
}

// ---------------------------------------------------------------- text + counter drawing

interface BlockGeom {
  layout: TextLayout;
  /** Box size including padding. */
  W: number;
  H: number;
  padX: number;
  padY: number;
  /** x offset of the text block's own box inside the layer box (counter alignment). */
  textX: number;
  /** Width of the text area inside the padding. */
  textW: number;
}

function unitIndex(c: LaidOutChar, by: StaggerUnit | 'all'): number {
  return by === 'char' ? c.index : by === 'word' ? c.wordIndex : by === 'line' ? c.lineIndex : 0;
}

function unitCount(layout: TextLayout, by: StaggerUnit | 'all'): number {
  return by === 'char' ? layout.chars.length : by === 'word' ? layout.words.length : by === 'line' ? layout.lines.length : 1;
}

function unitsOf(m: Motion): StaggerUnit | 'all' {
  if (m.stagger) return m.stagger.by;
  const preset = presetOf(m);
  if (preset === 'typewriter') return 'char';
  if (preset === 'mask-up') return 'line';
  return 'all';
}

/**
 * Draws background + glyphs of a laid-out block in box coordinates, with per-unit effects. Whole-block
 * units (`all`) and the background scale around the layer's anchor point, like every other layer type;
 * per-unit motions (stagger, mask-up lines, typewriter chars) scale glyphs around each unit's own centre.
 */
function drawBlock(
  layer: TextLayer | CounterLayer,
  g: BlockGeom,
  font: ResolvedFont,
  color: string,
  env: SceneEnv,
  fr: Frame,
  visibleChars: number,
  background?: { fill: Fill; radius: number },
): void {
  const { ctx } = env;
  const { layout } = g;
  const enter = fr.enter;
  const exit = fr.exit;
  const enterBy = enter ? unitsOf(enter) : 'all';
  const exitBy = exit ? unitsOf(exit) : 'all';
  const enterEach = enter ? staggerEach(enter, unitCount(layout, enterBy)) : 0;
  const exitEach = exit ? staggerEach(exit, unitCount(layout, exitBy)) : 0;
  const effectOf = (m: Motion | undefined, kind: 'enter' | 'exit', i: number, each: number): Effect =>
    !m
      ? IDENTITY
      : presetEffect(m, kind === 'enter' ? enterTau(m, fr.lt, i, each) : exitTau(m, fr.untilEnd, i, each), env);

  const lh = layout.lineHeightPx;
  const size = layout.size;
  const ox = g.padX + g.textX + (layout.align === 'center' ? g.textW / 2 : layout.align === 'right' ? g.textW : 0);
  const oy = g.padY;
  const full: Box = { x: 0, y: 0, w: g.W, h: g.H };
  const [ax, ay] = layer.anchor ?? [0.5, 0.5];
  const anchorPt = { x: ax * g.W, y: ay * g.H };
  const pivotOf = (by: StaggerUnit | 'all') => (by === 'all' ? anchorPt : undefined);

  const lineBox = (li: number): Box => {
    const line = layout.lines[li];
    const width = line ? line.width : 0;
    const left = layout.align === 'center' ? -width / 2 : layout.align === 'right' ? -width : 0;
    return { x: ox + left, y: oy + li * lh, w: width, h: lh };
  };
  const maskBox = (li: number): Box => {
    const line = layout.lines[li];
    const base = oy + (line ? line.baseline : 0);
    const top = Math.min(oy + li * lh, base - 1.05 * size);
    const bottom = Math.max(oy + (li + 1) * lh, base + 0.3 * size);
    return { x: -g.W - size, y: top, w: g.W * 3 + size * 2, h: bottom - top };
  };
  const unitBox = (c: LaidOutChar, by: StaggerUnit | 'all'): Box => {
    if (by === 'all') return full;
    if (by === 'line') return lineBox(c.lineIndex);
    const top = oy + c.lineIndex * lh;
    if (by === 'word') {
      const w = layout.words[c.wordIndex];
      return w ? { x: ox + w.x, y: top, w: w.w, h: lh } : { x: ox + c.x, y: top, w: c.w, h: lh };
    }
    return { x: ox + c.x, y: top, w: c.w, h: lh };
  };

  // background follows the first unit of each motion (timing), applied to the whole box around the anchor
  if (background) {
    const eX = effectOf(exit, 'exit', 0, exitEach);
    const eE = effectOf(enter, 'enter', 0, enterEach);
    const a = eX.alpha * eE.alpha;
    if (a > 0 && eX.scale !== 0 && eE.scale !== 0) {
      ctx.save();
      applyEffect(ctx, eX, full, full, anchorPt);
      applyEffect(ctx, eE, full, full, anchorPt);
      ctx.globalAlpha *= a;
      roundRectPath(ctx, 0, 0, g.W, g.H, background.radius);
      ctx.fillStyle = resolveFill(background.fill, env, full);
      ctx.fill();
      ctx.restore();
    }
  }

  if (parseColor(color).a <= 0) return;
  setFont(ctx, fontSpec({ ...font, size }));
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const chars = layout.chars;
  const enterDone = !enter || fr.lt - (enter.delay ?? 0) >= motionSpan(enter, unitCount(layout, enterBy)) + EPS;
  const exitDone = !exit || fr.untilEnd - (exit.delay ?? 0) >= motionSpan(exit, unitCount(layout, exitBy)) + EPS;
  const atRest = enterDone && exitDone && visibleChars >= chars.length;
  if (atRest && layout.letterSpacing === 0 && layer.type === 'text') {
    layout.lines.forEach((line, li) => {
      if (!line.text) return;
      const left = layout.align === 'center' ? -line.width / 2 : layout.align === 'right' ? -line.width : 0;
      ctx.fillText(line.text, ox + left, oy + line.baseline);
    });
    return;
  }
  for (const c of chars) {
    if (c.index >= visibleChars) continue;
    const eX = effectOf(exit, 'exit', unitIndex(c, exitBy), exitEach);
    const eE = effectOf(enter, 'enter', unitIndex(c, enterBy), enterEach);
    const a = eX.alpha * eE.alpha;
    if (a <= 0 || eX.scale === 0 || eE.scale === 0) continue;
    const base = oy + (layout.lines[c.lineIndex]?.baseline ?? 0);
    const plain = eX === IDENTITY && eE === IDENTITY;
    if (plain) {
      ctx.fillText(c.ch, ox + c.x, base);
      continue;
    }
    ctx.save();
    applyEffect(ctx, eX, unitBox(c, exitBy), maskBox(c.lineIndex), pivotOf(exitBy));
    applyEffect(ctx, eE, unitBox(c, enterBy), maskBox(c.lineIndex), pivotOf(enterBy));
    ctx.globalAlpha *= a;
    ctx.fillText(c.ch, ox + c.x, base);
    ctx.restore();
  }
}

function padding(p: Length | [Length, Length] | undefined, env: SceneEnv): [number, number] {
  if (p === undefined) return [0, 0];
  if (Array.isArray(p)) return [resolveLength(p[0], env, 0), resolveLength(p[1], env, 0)];
  const v = resolveLength(p, env, 0);
  return [v, v];
}

function drawTextLayer(layer: TextLayer, env: SceneEnv, fr: Frame, ax: number, ay: number): void {
  const text = interpolateText(resolveTextValue(layer.text, env), env);
  if (!text.trim()) return;
  const { ctx } = env;
  const font = resolveFont(layer.font, env);
  const layout = layoutSceneText(ctx, text, font, {
    maxWidth: layer.maxWidth !== undefined ? Math.max(1, resolveLength(layer.maxWidth, env)) : undefined,
    maxLines: layer.maxLines,
    minSize: layer.autoFit ? Math.max(1, resolveLength(layer.autoFit.minSize, env)) : undefined,
    align: layer.align ?? 'left',
  });
  const [padX, padY] = layer.background ? padding(layer.background.padding, env) : [0, 0];
  const W = layout.width + 2 * padX;
  const H = layout.height + 2 * padY;
  const progress = clamp01(animated(layer, 'progress', resolveNumber(layer.progress, env, 1), fr.lt, env));
  const visible = progress >= 1 ? Infinity : Math.floor(progress * layout.chars.length + 1e-6);
  ctx.translate(-ax * W, -ay * H);
  drawBlock(
    layer,
    { layout, W, H, padX, padY, textX: 0, textW: layout.width },
    font,
    resolveColor(layer.color, env),
    env,
    fr,
    visible,
    layer.background
      ? { fill: layer.background.fill, radius: Math.max(0, resolveLength(layer.background.radius, env, 0)) }
      : undefined,
  );
}

export const DEFAULT_COUNT: NonNullable<CounterLayer['count']> = { duration: 1.5, delay: 0 };

/** Counter value at layer-local time. */
export function counterValue(layer: CounterLayer, lt: number, env: ValueEnv): number {
  const from = resolveNumber(layer.from, env, 0);
  const to = resolveNumber(layer.to, env, 0);
  let p: number;
  const kfs = layer.keyframes?.progress;
  if (kfs && kfs.length) p = sampleKeyframes(kfs, lt, (v) => resolveNumber(v as BindableNumber, env, 0));
  else {
    const c = layer.count ?? DEFAULT_COUNT;
    const r = clamp01((lt - (c.delay ?? 0)) / c.duration);
    p = r >= 1 ? 1 : resolveEase(c.ease, easeOutCubic)(r);
  }
  if (layer.ambient) {
    for (const a of layer.ambient)
      if (a.prop === 'progress' && typeof a.amplitude === 'number')
        p += a.amplitude * Math.sin(2 * Math.PI * (lt / a.period + (a.phase ?? 0)));
  }
  if (p === 1) return to;
  const v = lerp(from, to, p);
  const step = layer.step;
  if (!step || !(step > 0)) return v;
  // Whole steps from `from` toward `to`: a step is shown only once the value has reached it.
  const dir = to >= from ? 1 : -1;
  const travelled = (v - from) * dir;
  const n = travelled >= 0 ? Math.floor(travelled / step + 1e-9) : Math.ceil(travelled / step - 1e-9);
  return from + dir * n * step;
}

function drawCounterLayer(layer: CounterLayer, env: SceneEnv, fr: Frame, ax: number, ay: number): void {
  const { ctx } = env;
  const font = resolveFont(layer.font, env);
  const prefix = layer.prefix !== undefined ? interpolateText(resolveTextValue(layer.prefix, env), env) : '';
  const suffix = layer.suffix !== undefined ? interpolateText(resolveTextValue(layer.suffix, env), env) : '';
  const dec = layer.decimals ?? 0;
  const sep = layer.separator ?? ',';
  const fmt = (v: number) => formatCounter(v, dec, sep);
  const build = (n: string) => counterLayout(ctx, `${prefix}${n}${suffix}`, Array.from(prefix).length, Array.from(prefix).length + n.length, font);
  const layout = build(fmt(counterValue(layer, fr.lt, env)));
  // The box reserves the wider of the start/end values so the layout does not jump while counting.
  const wFrom = build(fmt(resolveNumber(layer.from, env, 0))).width;
  const wTo = build(fmt(resolveNumber(layer.to, env, 0))).width;
  const W = Math.max(layout.width, wFrom, wTo);
  const H = layout.height;
  const align = layer.align ?? 'left';
  const textX = align === 'center' ? (W - layout.width) / 2 : align === 'right' ? W - layout.width : 0;
  ctx.translate(-ax * W, -ay * H);
  setFont(ctx, fontSpec(font));
  drawBlock(layer, { layout, W, H, padX: 0, padY: 0, textX, textW: layout.width }, font, resolveColor(layer.color, env), env, fr, Infinity);
}

// ------------------------------------------------------------------ template

/** Draws one frame of a validated scene. Pure: output depends only on the arguments. */
export function renderScene(scene: Scene, f: FrameInfo, values: AssetValues, loaded: LoadedAssets): void {
  const params = new Map(scene.params.map((p) => [p.key, p] as const));
  renderWith(scene, params, f, values, loaded);
}

function renderWith(scene: Scene, params: Map<string, ParamDef>, f: FrameInfo, values: AssetValues, loaded: LoadedAssets): void {
  const env: SceneEnv = {
    ctx: f.ctx,
    w: f.width,
    h: f.height,
    time: f.time,
    end: Math.max(0, (f.durationFrames - 1) / f.fps),
    values,
    params,
    images: loaded.images ?? {},
  };
  const { ctx } = env;
  ctx.save();
  ctx.globalAlpha = 1;
  if (!f.transparent && scene.background) {
    ctx.fillStyle = resolveFill(scene.background, env, { x: 0, y: 0, w: f.width, h: f.height });
    ctx.fillRect(0, 0, f.width, f.height);
  }
  for (const layer of scene.layers) drawLayer(layer, env);
  ctx.restore();
}

/** Wraps a validated scene as a regular engine template. */
export function templateFromScene(scene: Scene): TemplateDefinition {
  const params = new Map(scene.params.map((p) => [p.key, p] as const));
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    category: scene.category,
    defaultSettings: { ...scene.defaultSettings },
    params: scene.params,
    fonts: [...scene.fonts],
    render(f, values, loaded) {
      renderWith(scene, params, f, values, loaded);
    },
  };
}
