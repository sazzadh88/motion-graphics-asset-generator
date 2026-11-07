/**
 * TypeScript mirror of the `mg-scene@1` format (docs/SCENE_FORMAT.md).
 * These types describe a scene AFTER `validateScene` accepted it.
 */
import type { ParamDef, RenderSettings } from '../types';

export const SCENE_FORMAT = 'mg-scene@1';

export const SCENE_CATEGORIES = ['social', 'promo', 'broadcast', 'typography', 'data', 'event'] as const;
export type SceneCategory = (typeof SCENE_CATEGORIES)[number];

// ------------------------------------------------------------------ values

/** `{ "param": "key" }` — the current value of a declared param. */
export interface ParamBinding {
  param: string;
}

/** A literal length: number = percent of vmin, or a unit string `"50%w"`, `"40%h"`, `"12vmin"`, `"24px"`. */
export type LengthLiteral = number | string;

/**
 * `{ "param": "n", "map": { "in": [0, 100], "out": [a, b] }, "clamp": true }` — the number param mapped
 * linearly from `in` to `out` (out values are in the property's unit; extrapolates unless `clamp`).
 */
export interface MapBinding<V> {
  param: string;
  map: { in: [number, number]; out: [V, V] };
  clamp?: boolean;
}

/**
 * `{ "param": "v1", "ofMax": ["v1", "v2"], "out": [a, b] }` — `param / max(listed params)` (0 when that
 * max is ≤ 0) mapped linearly onto `out`. Auto-scales charts to their largest value.
 */
export interface OfMaxBinding<V> {
  param: string;
  ofMax: string[];
  out: [V, V];
  clamp?: boolean;
}

/** A number param binding: plain (`{param}`), linear `map`, or `ofMax` normalisation. */
export type NumberBinding<V> = ParamBinding | MapBinding<V> | OfMaxBinding<V>;

/**
 * `{ "param": "style", "cases": { "bold": a, "minimal": b }, "default": c }` — picks a value by the
 * current option of a select param. Case values are any non-`cases` value valid for the property.
 */
export interface SelectCases<V> {
  param: string;
  cases: Record<string, V>;
  default?: V;
}

/**
 * Literal length, a number-param binding (plain: percent of vmin; map/ofMax: `out` lengths), or select cases.
 */
export type Length = LengthLiteral | NumberBinding<LengthLiteral> | SelectCases<LengthLiteral | NumberBinding<LengthLiteral>>;

/** A plain number, a number-param binding (plain, map, ofMax) or select cases. */
export type BindableNumber = number | NumberBinding<number> | SelectCases<number | NumberBinding<number>>;

/** A text template (`{{param}}` interpolation) or select cases of templates. */
export type TextValue = string | SelectCases<string>;

export interface ColorBinding {
  param: string;
  /** Multiplies the color's alpha, 0..1. */
  alpha?: number;
}
export interface ColorMix {
  mix: [Color, Color];
  /** 0 → first color, 1 → second. */
  t: number;
}
/** `#RRGGBB` | `#RRGGBBAA` | binding | mix. */
export type BaseColor = string | ColorBinding | ColorMix;
/** A color, or select cases of colors. */
export type Color = BaseColor | SelectCases<BaseColor>;

export type GradientStop = [number, Color];
export interface LinearFill {
  linear: { angle: number; stops: GradientStop[] };
}
export interface RadialFill {
  radial: { cx: Length; cy: Length; r: Length; stops: GradientStop[] };
}
export type BaseFill = BaseColor | LinearFill | RadialFill;
/** A fill, or select cases of fills. */
export type Fill = BaseFill | SelectCases<BaseFill>;

/** Seconds from the scene start, `"end"` or `"end-<seconds>"`. */
export type TimeRef = number | string;

// ------------------------------------------------------------------ motion

export const EASE_NAMES = [
  'linear',
  'inQuad',
  'outQuad',
  'inOutQuad',
  'inCubic',
  'outCubic',
  'inOutCubic',
  'inQuart',
  'outQuart',
  'inOutQuart',
  'inExpo',
  'outExpo',
  'inOutExpo',
  'inBack',
  'outBack',
  'inOutBack',
  'outElastic',
] as const;
export type EaseName = (typeof EASE_NAMES)[number];
export type Ease = EaseName | { cubicBezier: [number, number, number, number] };

export const PRESETS = [
  'fade',
  'rise',
  'drop',
  'slide-left',
  'slide-right',
  'pop',
  'scale-in',
  'mask-up',
  'wipe-right',
  'wipe-left',
  'typewriter',
] as const;
export type PresetName = (typeof PRESETS)[number];

export const STAGGER_UNITS = ['char', 'word', 'line'] as const;
export type StaggerUnit = (typeof STAGGER_UNITS)[number];

export interface Motion {
  /** A preset name, or select cases of preset names. */
  preset: PresetName | SelectCases<PresetName>;
  /** Seconds, default 0.6. */
  duration?: number;
  /** Seconds, default 0. Enter: after `start`. Exit: the exit finishes this long before `end`. */
  delay?: number;
  /** Default `outCubic` (`outBack` for `pop`). */
  ease?: Ease;
  /** Move distance for rise/drop/slide-*, default 6 (rise/drop) or 10 (slide). */
  distance?: Length;
  /** text/counter only. */
  stagger?: { by: StaggerUnit; each: number };
}

export interface Keyframe {
  /** Seconds relative to the layer's `start`. */
  t: number;
  /** Length for x/y/width/height/radius, number otherwise. */
  v: Length | BindableNumber;
  /** Ease of the segment that ENDS at this keyframe. Default linear. */
  ease?: Ease;
}

export const ANIMATABLE_COMMON = ['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY', 'opacity'] as const;
export type AnimProp = (typeof ANIMATABLE_COMMON)[number] | 'width' | 'height' | 'radius' | 'progress';

export interface Ambient {
  prop: AnimProp;
  /** Length for x/y/width/height/radius (number = vmin %), degrees for rotation, plain number otherwise. */
  amplitude: number | string;
  /** Seconds per cycle (> 0). */
  period: number;
  /** Fraction of a cycle (0..1), default 0. */
  phase?: number;
}

// ------------------------------------------------------------------ layers

/** `{ "param": "showLogo" }` / `{ "param": "logoUrl", "not": true }`. */
export interface VisibleIf {
  param: string;
  not?: boolean;
}

export interface LayerBase {
  id: string;
  start?: TimeRef;
  end?: TimeRef;
  x?: Length;
  y?: Length;
  anchor?: [number, number];
  /** Degrees, clockwise. */
  rotation?: BindableNumber;
  scale?: BindableNumber;
  scaleX?: BindableNumber;
  scaleY?: BindableNumber;
  opacity?: BindableNumber;
  /** Boolean param (or image param: visible when an image is set); `not: true` inverts the gate. */
  visibleIf?: VisibleIf;
  enter?: Motion;
  exit?: Motion;
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>;
  ambient?: Ambient[];
}

export interface FontDef {
  family: string;
  /** 100..900, default 400. */
  weight?: number;
  size: Length;
  /** Line height multiplier, default 1.1. */
  lineHeight?: number;
  /** In em, default 0. */
  letterSpacing?: number;
  italic?: boolean;
}

export interface TextBackground {
  fill: Fill;
  /** Length, or [horizontal, vertical]. */
  padding?: Length | [Length, Length];
  radius?: Length;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayer extends LayerBase {
  type: 'text';
  text: TextValue;
  font: FontDef;
  color: Color;
  align?: TextAlign;
  maxWidth?: Length;
  maxLines?: number;
  autoFit?: { minSize: Length };
  background?: TextBackground;
  /** 0..1 fraction of characters drawn (default 1); animatable as `progress`. */
  progress?: BindableNumber;
}

export interface Stroke {
  color: Color;
  width: Length;
  dash?: [Length, Length];
}

export interface RectLayer extends LayerBase {
  type: 'rect';
  width: Length;
  height: Length;
  radius?: Length;
  fill?: Fill;
  stroke?: Stroke;
}

export interface EllipseLayer extends LayerBase {
  type: 'ellipse';
  width: Length;
  height: Length;
  fill?: Fill;
  stroke?: Stroke;
}

export interface PolygonLayer extends LayerBase {
  type: 'polygon';
  sides: number;
  radius: Length;
  innerRadius?: Length;
  fill?: Fill;
  stroke?: Stroke;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  src: ParamBinding;
  width: Length;
  height: Length;
  fit?: 'contain' | 'cover';
  radius?: Length;
}

export interface CounterLayer extends LayerBase {
  type: 'counter';
  from: BindableNumber;
  to: BindableNumber;
  decimals?: number;
  /** > 0: the displayed value moves from `from` toward `to` in whole steps (never past the true value). */
  step?: number;
  prefix?: TextValue;
  suffix?: TextValue;
  separator?: string;
  count?: { duration: number; delay?: number; ease?: Ease };
  font: FontDef;
  color: Color;
  align?: TextAlign;
}

export const GROUP_TIMINGS = ['absolute', 'relative'] as const;
export type GroupTiming = (typeof GROUP_TIMINGS)[number];

export interface GroupLayer extends LayerBase {
  type: 'group';
  /**
   * How numeric child `start`/`end` are read: `absolute` (scene time) or `relative` (seconds after this
   * group's start). Default: inherited from the enclosing group, `absolute` at the top level.
   */
  timing?: GroupTiming;
  layers: Layer[];
}

export type Layer = TextLayer | RectLayer | EllipseLayer | PolygonLayer | ImageLayer | CounterLayer | GroupLayer;
export type LayerType = Layer['type'];
export const LAYER_TYPES = ['text', 'rect', 'ellipse', 'polygon', 'image', 'counter', 'group'] as const;

// ------------------------------------------------------------------ scene

export interface Scene {
  format: typeof SCENE_FORMAT;
  id: string;
  name: string;
  description: string;
  category: SceneCategory;
  defaultSettings: RenderSettings;
  fonts: string[];
  params: ParamDef[];
  background?: Fill | null;
  layers: Layer[];
}

export interface SceneError {
  /** JSON pointer into the scene document, e.g. `/layers/3/enter/preset`. */
  path: string;
  message: string;
}

export type SceneValidationResult = { ok: true; scene: Scene } | { ok: false; errors: SceneError[] };
