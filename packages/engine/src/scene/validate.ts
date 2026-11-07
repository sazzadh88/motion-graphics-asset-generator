/**
 * Strict validator for `mg-scene@1` documents (docs/SCENE_FORMAT.md → "Validation and errors").
 * Pure, never throws, reports every problem it can find with a JSON-pointer path and an
 * actionable message (they are meant to be fed back to an AI model for self-repair).
 */
import { LIMITS } from '../limits';
import { FONT_WEIGHTS } from '../fontFamilies';
import type { ParamDef } from '../types';
import {
  ANIMATABLE_COMMON,
  EASE_NAMES,
  GROUP_TIMINGS,
  LAYER_TYPES,
  PRESETS,
  SCENE_CATEGORIES,
  SCENE_FORMAT,
  STAGGER_UNITS,
  type LayerType,
  type Scene,
  type SceneError,
  type SceneValidationResult,
} from './types';

export const SCENE_LIMITS = {
  maxBytes: 64 * 1024,
  maxLayers: 64,
  maxDepth: 4,
  maxKeyframes: 32,
  maxParams: 40,
  maxAmbient: 8,
  maxStops: 8,
  maxTextChars: 500,
  maxErrors: 200,
  /** Params listed in one `ofMax`. */
  maxOfMax: 16,
} as const;

export const SCENE_ID_PATTERN = /^[a-z][a-z0-9_]{2,47}$/;
export const LAYER_ID_PATTERN = /^[a-z][a-zA-Z0-9_-]{0,39}$/;
export const PARAM_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
export const LENGTH_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%w|%h|vmin)$/;
export const TIME_PATTERN = /^end(?:-(\d+(?:\.\d+)?))?$/;
const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** `{{ name }}` / `{{ name | filter }}` */
const INTERP = /\{\{([^{}]*)\}\}/g;

export const BUNDLED_FONTS = Object.keys(FONT_WEIGHTS);

type ParamType = ParamDef['type'];
type Obj = Record<string, unknown>;

const LENGTH_PROPS = new Set(['x', 'y', 'width', 'height', 'radius']);
const PARAM_TYPES: ParamType[] = ['text', 'color', 'number', 'image', 'boolean', 'select'];

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Obj, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const get = (o: Obj, k: string): unknown => (has(o, k) ? o[k] : undefined);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const esc = (k: string | number): string => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const at = (base: string, ...keys: (string | number)[]): string => base + keys.map((k) => `/${esc(k)}`).join('');
const list = (xs: readonly string[]): string => xs.join(', ');

function show(v: unknown): string {
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `'${v.length > 40 ? `${v.slice(0, 37)}...` : v}'`;
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return `${typeof v} ${String(v)}`;
}

/** Animatable props per layer type (keyframes / ambient). */
export function animatableProps(type: LayerType): string[] {
  const extra: Record<LayerType, string[]> = {
    text: ['progress'],
    counter: ['progress'],
    rect: ['width', 'height', 'radius'],
    ellipse: ['width', 'height'],
    image: ['width', 'height', 'radius'],
    polygon: ['radius'],
    group: [],
  };
  return [...ANIMATABLE_COMMON, ...extra[type]];
}

const COMMON_KEYS = [
  'id',
  'type',
  'start',
  'end',
  'x',
  'y',
  'anchor',
  'rotation',
  'scale',
  'scaleX',
  'scaleY',
  'opacity',
  'visibleIf',
  'enter',
  'exit',
  'keyframes',
  'ambient',
];
const TEXT_FONT_KEYS = ['font', 'color', 'align'];
const TYPE_KEYS: Record<LayerType, string[]> = {
  text: ['text', ...TEXT_FONT_KEYS, 'maxWidth', 'maxLines', 'autoFit', 'background', 'progress'],
  rect: ['width', 'height', 'radius', 'fill', 'stroke'],
  ellipse: ['width', 'height', 'fill', 'stroke'],
  polygon: ['sides', 'radius', 'innerRadius', 'fill', 'stroke'],
  image: ['src', 'width', 'height', 'fit', 'radius'],
  counter: ['from', 'to', 'decimals', 'step', 'prefix', 'suffix', 'separator', 'count', ...TEXT_FONT_KEYS],
  group: ['timing', 'layers'],
};

interface NumOpts {
  min?: number;
  max?: number;
  int?: boolean;
  /** min is exclusive */
  gt?: boolean;
}

class Checker {
  errors: SceneError[] = [];
  params = new Map<string, ParamType>();
  /** Option values of each select param. */
  selects = new Map<string, string[]>();
  fonts = new Set<string>();
  layerIds = new Map<string, string>();
  layerCount = 0;
  maxSeconds = LIMITS.maxDurationSeconds;

  err(path: string, message: string): void {
    if (this.errors.length < SCENE_LIMITS.maxErrors) this.errors.push({ path, message });
  }

  keys(o: Obj, path: string, allowed: readonly string[], what: string): void {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) this.err(at(path, k), `unknown property '${k}' on ${what}; allowed: ${list(allowed)}`);
    }
  }

  obj(v: unknown, path: string, what: string): v is Obj {
    if (isObj(v)) return true;
    this.err(path, `${what} must be an object, got ${show(v)}`);
    return false;
  }

  str(v: unknown, path: string, what: string, max = 500, min = 0): v is string {
    if (typeof v !== 'string') {
      this.err(path, `${what} must be a string, got ${show(v)}`);
      return false;
    }
    if (v.length < min) {
      this.err(path, min === 1 ? `${what} must not be empty` : `${what} must have at least ${min} characters`);
      return false;
    }
    if (v.length > max) {
      this.err(path, `${what} is ${v.length} characters; max ${max}`);
      return false;
    }
    return true;
  }

  num(v: unknown, path: string, what: string, o: NumOpts = {}): v is number {
    if (!isNum(v)) {
      this.err(path, `${what} must be a ${o.int ? 'whole ' : ''}number, got ${show(v)}`);
      return false;
    }
    if (o.int && !Number.isInteger(v)) {
      this.err(path, `${what} must be a whole number, got ${v}`);
      return false;
    }
    const lo = o.min;
    const hi = o.max;
    const below = lo !== undefined && (o.gt ? v <= lo : v < lo);
    if (below || (hi !== undefined && v > hi)) {
      const range =
        lo !== undefined && hi !== undefined
          ? `${o.gt ? 'greater than' : 'between'} ${lo}${o.gt ? ` and at most ${hi}` : ` and ${hi}`}`
          : lo !== undefined
            ? `${o.gt ? 'greater than' : 'at least'} ${lo}`
            : `at most ${hi}`;
      this.err(path, `${what} must be ${range}, got ${v}`);
      return false;
    }
    return true;
  }

  bool(v: unknown, path: string, what: string): boolean {
    if (typeof v === 'boolean') return true;
    this.err(path, `${what} must be true or false, got ${show(v)}`);
    return false;
  }

  oneOf<T extends string>(v: unknown, path: string, what: string, allowed: readonly T[]): v is T {
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return true;
    this.err(
      path,
      typeof v === 'string'
        ? `unknown ${what} '${v}'; expected one of ${list(allowed)}`
        : `${what} must be one of ${list(allowed)}, got ${show(v)}`,
    );
    return false;
  }

  // ---------------------------------------------------------------- bindings

  /** Checks a `{ "param": ... }` object (extra keys allowed by caller). */
  binding(o: Obj, path: string, accepts: readonly ParamType[], what: string, extraKeys: string[] = []): boolean {
    this.keys(o, path, ['param', ...extraKeys], `a param binding`);
    const name = get(o, 'param');
    if (typeof name !== 'string') {
      this.err(at(path, 'param'), `param binding needs a param key string, got ${show(name)}`);
      return false;
    }
    const type = this.params.get(name);
    if (!type) {
      const declared = [...this.params.keys()];
      this.err(
        at(path, 'param'),
        `unknown param '${name}'; declared params: ${declared.length ? list(declared) : '(none)'}`,
      );
      return false;
    }
    if (!accepts.includes(type)) {
      this.err(at(path, 'param'), `param '${name}' is a ${type} param; ${what} needs a ${accepts.join(' or ')} param`);
      return false;
    }
    return true;
  }

  /**
   * Select cases `{ "param": "<select>", "cases": { "<option>": value }, "default"?: value }`. Every case
   * key must be an option of the select; options without a case need a `default`. Values are checked
   * with `check` (which must reject nested cases).
   */
  cases(o: Obj, path: string, what: string, check: (v: unknown, p: string) => void): boolean {
    const ok = this.binding(o, path, ['select'], `select cases for ${what}`, ['cases', 'default']);
    const name = get(o, 'param');
    const options = ok && typeof name === 'string' ? this.selects.get(name) : undefined;
    const cs = get(o, 'cases');
    const cp = at(path, 'cases');
    if (!isObj(cs) || Object.keys(cs).length === 0) {
      this.err(cp, `cases must be a non-empty object mapping option values of the select to values, e.g. {"bold": ..., "minimal": ...}, got ${show(cs)}`);
    } else {
      for (const [k, v] of Object.entries(cs)) {
        if (options && !options.includes(k))
          this.err(at(cp, k), `'${k}' is not an option of select param '${String(name)}'; options: ${list(options)}`);
        check(v, at(cp, k));
      }
      if (options && !has(o, 'default')) {
        const missing = options.filter((x) => !has(cs, x));
        if (missing.length)
          this.err(
            cp,
            `cases for select param '${String(name)}' miss option(s) ${missing.map((x) => `'${x}'`).join(', ')}; add a case for each or a "default"`,
          );
      }
    }
    if (has(o, 'default')) check(o.default, at(path, 'default'));
    return ok;
  }

  /** Case values may not be cases themselves (one select per value). */
  noNestedCases(v: unknown, path: string): boolean {
    if (isObj(v) && has(v, 'cases')) {
      this.err(path, 'select cases cannot be nested; a case value must be a plain value or a param binding');
      return false;
    }
    return true;
  }

  /**
   * Number-param binding: `{param}`, `{param, map: {in, out}, clamp?}` or `{param, ofMax: [...], out, clamp?}`.
   * `out` values are checked with `out`.
   */
  numBinding(o: Obj, path: string, what: string, out: (v: unknown, p: string) => void): boolean {
    const hasMap = has(o, 'map');
    const hasOfMax = has(o, 'ofMax');
    if (hasMap && hasOfMax) {
      this.err(path, `a number binding for ${what} takes either "map" or "ofMax", not both`);
      return false;
    }
    const outPair = (v: unknown, p: string, where: string) => {
      if (!Array.isArray(v) || v.length !== 2) {
        this.err(p, `${where} must be [valueAtStart, valueAtEnd] (2 values in the unit of ${what}), got ${show(v)}`);
        return;
      }
      v.forEach((x, i) => out(x, at(p, i)));
    };
    if (!hasMap && !hasOfMax) {
      for (const k of Object.keys(o)) {
        if (k === 'param') continue;
        this.err(
          at(path, k),
          k === 'out' || k === 'clamp' || k === 'in'
            ? `'${k}' needs "map" or "ofMax": write {"param", "map": {"in": [a, b], "out": [c, d]}, "clamp"?} or {"param", "ofMax": ["p1", "p2"], "out": [c, d], "clamp"?}`
            : `unknown property '${k}' on a number binding for ${what}; use {"param"}, {"param", "map": {"in", "out"}, "clamp"?}, {"param", "ofMax": [...], "out", "clamp"?} or {"param", "cases", "default"?}`,
        );
      }
      return this.binding({ param: get(o, 'param') }, path, ['number'], what);
    }
    const ok = this.binding(o, path, ['number'], what, hasMap ? ['map', 'clamp'] : ['ofMax', 'out', 'clamp']);
    if (has(o, 'clamp')) this.bool(o.clamp, at(path, 'clamp'), 'clamp');
    if (hasMap) {
      const m = o.map;
      const mp = at(path, 'map');
      if (this.obj(m, mp, 'map')) {
        this.keys(m, mp, ['in', 'out'], 'map');
        const inp = get(m, 'in');
        if (!Array.isArray(inp) || inp.length !== 2 || !inp.every(isNum)) {
          this.err(at(mp, 'in'), `map.in must be [from, to]: the param values mapped onto out[0] and out[1], got ${show(inp)}`);
        } else if (inp[0] === inp[1]) {
          this.err(at(mp, 'in'), `map.in values must differ, got [${String(inp[0])}, ${String(inp[1])}]`);
        }
        if (!has(m, 'out')) this.err(at(mp, 'out'), `map is missing required property 'out' (2 values in the unit of ${what})`);
        else outPair(m.out, at(mp, 'out'), 'map.out');
      }
    } else {
      const lst = o.ofMax;
      const lp = at(path, 'ofMax');
      if (!Array.isArray(lst) || lst.length < 1 || lst.length > SCENE_LIMITS.maxOfMax) {
        this.err(lp, `ofMax must be an array of 1 to ${SCENE_LIMITS.maxOfMax} number param keys, got ${show(lst)}`);
      } else {
        const seen = new Set<string>();
        lst.forEach((k, i) => {
          const p = at(lp, i);
          if (typeof k !== 'string') this.err(p, `ofMax entries must be number param keys, got ${show(k)}`);
          else if (seen.has(k)) this.err(p, `'${k}' is listed twice in ofMax`);
          else {
            seen.add(k);
            const t = this.params.get(k);
            if (!t) {
              const declared = [...this.params.keys()];
              this.err(p, `unknown param '${k}' in ofMax; declared params: ${declared.length ? list(declared) : '(none)'}`);
            } else if (t !== 'number') this.err(p, `param '${k}' is a ${t} param; ofMax only lists number params`);
          }
        });
      }
      if (!has(o, 'out')) this.err(at(path, 'out'), `ofMax needs "out": [valueAtZero, valueAtMax] in the unit of ${what}`);
      else outPair(o.out, at(path, 'out'), 'out');
    }
    return ok;
  }

  lengthLiteral(v: unknown, path: string, what: string): boolean {
    if (isNum(v)) return true;
    if (typeof v === 'string') {
      if (LENGTH_PATTERN.test(v)) return true;
      this.err(
        path,
        `invalid length '${v}' for ${what}; use a number (percent of the short side) or a string like "50%w", "40%h", "12vmin", "24px"`,
      );
      return false;
    }
    this.err(path, `${what} must be a literal length here (number, "50%w", "40%h", "12vmin" or "24px"), got ${show(v)}`);
    return false;
  }

  length(v: unknown, path: string, what: string, allowCases = true): boolean {
    if (isNum(v) || typeof v === 'string') return this.lengthLiteral(v, path, what);
    if (isObj(v) && has(v, 'cases')) {
      if (!allowCases) return this.noNestedCases(v, path);
      return this.cases(v, path, what, (x, p) => this.length(x, p, what, false));
    }
    if (isObj(v) && has(v, 'param'))
      return this.numBinding(v, path, what, (x, p) => this.lengthLiteral(x, p, `${what} out value`));
    this.err(path, `${what} must be a length (number, "50%w", "40%h", "12vmin", "24px", {"param"} or select cases), got ${show(v)}`);
    return false;
  }

  bindNum(v: unknown, path: string, what: string, o: NumOpts = {}, allowCases = true): boolean {
    if (isObj(v) && has(v, 'cases')) {
      if (!allowCases) return this.noNestedCases(v, path);
      return this.cases(v, path, what, (x, p) => this.bindNum(x, p, what, o, false));
    }
    if (isObj(v) && has(v, 'param')) return this.numBinding(v, path, what, (x, p) => this.num(x, p, `${what} out value`, o));
    if (!isNum(v)) {
      this.err(path, `${what} must be a number, {"param": "<number param>"} or select cases, got ${show(v)}`);
      return false;
    }
    return this.num(v, path, what, o);
  }

  time(v: unknown, path: string, what: string): boolean {
    if (isNum(v)) return this.num(v, path, what, { min: 0, max: this.maxSeconds });
    if (typeof v === 'string' && TIME_PATTERN.test(v)) return true;
    this.err(path, `${what} must be seconds (number), "end" or "end-<seconds>" like "end-0.5", got ${show(v)}`);
    return false;
  }

  color(v: unknown, path: string, what: string, depth = 0, allowCases = true): boolean {
    if (isObj(v) && has(v, 'cases')) {
      if (!allowCases) return this.noNestedCases(v, path);
      return this.cases(v, path, what, (x, p) => this.color(x, p, what, depth, false));
    }
    if (typeof v === 'string') {
      if (HEX.test(v)) return true;
      this.err(path, `invalid color '${v}' for ${what}; expected "#RRGGBB" or "#RRGGBBAA"`);
      return false;
    }
    if (isObj(v) && has(v, 'param')) {
      const ok = this.binding(v, path, ['color'], what, ['alpha']);
      if (has(v, 'alpha')) this.num(v.alpha, at(path, 'alpha'), 'alpha', { min: 0, max: 1 });
      return ok;
    }
    if (isObj(v) && has(v, 'mix')) {
      this.keys(v, path, ['mix', 't'], 'a color mix');
      if (depth >= 3) {
        this.err(path, 'color mixes may nest at most 3 levels');
        return false;
      }
      const m = v.mix;
      if (!Array.isArray(m) || m.length !== 2) this.err(at(path, 'mix'), 'mix must be an array of exactly 2 colors');
      else m.forEach((c, i) => this.color(c, at(path, 'mix', i), what, depth + 1));
      this.num(get(v, 't'), at(path, 't'), 'mix t', { min: 0, max: 1 });
      return true;
    }
    this.err(path, `${what} must be "#RRGGBB", "#RRGGBBAA", {"param": "<color param>"}, {"mix": [a, b], "t": 0.5} or select cases, got ${show(v)}`);
    return false;
  }

  stops(v: unknown, path: string): void {
    if (!Array.isArray(v) || v.length < 2 || v.length > SCENE_LIMITS.maxStops) {
      this.err(path, `stops must be an array of 2 to ${SCENE_LIMITS.maxStops} [offset, color] pairs`);
      return;
    }
    let prev = -Infinity;
    v.forEach((s, i) => {
      const p = at(path, i);
      if (!Array.isArray(s) || s.length !== 2) {
        this.err(p, 'each stop must be [offset 0..1, color]');
        return;
      }
      if (this.num(s[0], at(p, 0), 'stop offset', { min: 0, max: 1 })) {
        if ((s[0] as number) < prev) this.err(at(p, 0), `stop offsets must not decrease (${s[0]} after ${prev})`);
        prev = s[0] as number;
      }
      this.color(s[1], at(p, 1), 'stop color');
    });
  }

  fill(v: unknown, path: string, what: string, allowCases = true): void {
    if (isObj(v) && has(v, 'cases')) {
      if (!allowCases) this.noNestedCases(v, path);
      else this.cases(v, path, what, (x, p) => this.fill(x, p, what, false));
      return;
    }
    if (isObj(v) && has(v, 'linear')) {
      this.keys(v, path, ['linear'], 'a linear fill');
      const g = v.linear;
      if (!this.obj(g, at(path, 'linear'), 'linear')) return;
      this.keys(g, at(path, 'linear'), ['angle', 'stops'], 'linear');
      this.num(get(g, 'angle'), at(path, 'linear', 'angle'), 'angle (degrees)', { min: -360, max: 360 });
      this.stops(get(g, 'stops'), at(path, 'linear', 'stops'));
      return;
    }
    if (isObj(v) && has(v, 'radial')) {
      this.keys(v, path, ['radial'], 'a radial fill');
      const g = v.radial;
      if (!this.obj(g, at(path, 'radial'), 'radial')) return;
      this.keys(g, at(path, 'radial'), ['cx', 'cy', 'r', 'stops'], 'radial');
      for (const k of ['cx', 'cy', 'r']) this.length(get(g, k), at(path, 'radial', k), `radial ${k}`);
      this.stops(get(g, 'stops'), at(path, 'radial', 'stops'));
      return;
    }
    if (typeof v === 'string' || (isObj(v) && (has(v, 'param') || has(v, 'mix')))) {
      this.color(v, path, what, 0, false);
      return;
    }
    this.err(path, `${what} must be a color, {"linear": {angle, stops}}, {"radial": {cx, cy, r, stops}} or select cases, got ${show(v)}`);
  }

  stroke(v: unknown, path: string): void {
    if (!this.obj(v, path, 'stroke')) return;
    this.keys(v, path, ['color', 'width', 'dash'], 'stroke');
    this.color(get(v, 'color'), at(path, 'color'), 'stroke color');
    this.length(get(v, 'width'), at(path, 'width'), 'stroke width');
    if (has(v, 'dash')) {
      const d = v.dash;
      if (!Array.isArray(d) || d.length !== 2) this.err(at(path, 'dash'), 'dash must be [dashLength, gapLength]');
      else d.forEach((x, i) => this.length(x, at(path, 'dash', i), i ? 'dash gap' : 'dash length'));
    }
  }

  ease(v: unknown, path: string): void {
    if (typeof v === 'string') {
      if (!(EASE_NAMES as readonly string[]).includes(v))
        this.err(path, `unknown ease '${v}'; expected one of ${list(EASE_NAMES)} or {"cubicBezier": [x1, y1, x2, y2]}`);
      return;
    }
    if (isObj(v) && has(v, 'cubicBezier')) {
      this.keys(v, path, ['cubicBezier'], 'ease');
      const b = v.cubicBezier;
      if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) {
        this.err(at(path, 'cubicBezier'), 'cubicBezier must be [x1, y1, x2, y2] numbers');
        return;
      }
      const x1 = b[0] as number;
      const x2 = b[2] as number;
      if (x1 < 0 || x1 > 1) this.err(at(path, 'cubicBezier', 0), `x1 must be between 0 and 1, got ${x1}`);
      if (x2 < 0 || x2 > 1) this.err(at(path, 'cubicBezier', 2), `x2 must be between 0 and 1, got ${x2}`);
      return;
    }
    this.err(path, `ease must be one of ${list(EASE_NAMES)} or {"cubicBezier": [x1, y1, x2, y2]}, got ${show(v)}`);
  }

  /** Text with `{{param}}` / `{{param|upper}}` interpolation. */
  template(v: unknown, path: string, what: string, max: number, allowCases = true): void {
    if (isObj(v) && has(v, 'cases')) {
      if (!allowCases) this.noNestedCases(v, path);
      else this.cases(v, path, what, (x, p) => this.template(x, p, what, max, false));
      return;
    }
    if (isObj(v)) {
      this.err(path, `${what} must be a string (with {{param}} placeholders) or select cases {"param": "<select>", "cases": {...}, "default"?}, got ${show(v)}`);
      return;
    }
    if (!this.str(v, path, what, max)) return;
    const stripped = v.replace(INTERP, '');
    if (stripped.includes('{{') || stripped.includes('}}')) {
      this.err(path, `${what} has an unclosed or malformed '{{...}}'; write {{paramKey}} or {{paramKey|upper}}`);
    }
    for (const m of v.matchAll(INTERP)) {
      const body = (m[1] ?? '').trim();
      const [rawName, ...filters] = body.split('|').map((s) => s.trim());
      const name = rawName ?? '';
      if (filters.length > 1) {
        this.err(path, `'{{${body}}}' has ${filters.length} filters; use at most one of upper, lower`);
      } else if (filters.length === 1 && filters[0] !== 'upper' && filters[0] !== 'lower') {
        this.err(path, `unknown filter '${filters[0]}' in '{{${body}}}'; expected one of upper, lower`);
      }
      const type = this.params.get(name);
      if (!type) {
        const declared = [...this.params.keys()];
        this.err(path, `'{{${body}}}' refers to unknown param '${name}'; declared params: ${declared.length ? list(declared) : '(none)'}`);
      } else if (type !== 'text' && type !== 'select' && type !== 'number') {
        this.err(path, `'{{${body}}}' refers to ${type} param '${name}'; text can only interpolate text, select or number params`);
      }
    }
  }

  // ---------------------------------------------------------------- params

  paramDefs(v: unknown, path: string): void {
    if (!Array.isArray(v)) {
      this.err(path, `params must be an array of param definitions, got ${show(v)}`);
      return;
    }
    if (v.length > SCENE_LIMITS.maxParams) this.err(path, `scene declares ${v.length} params; max ${SCENE_LIMITS.maxParams}`);
    v.forEach((p, i) => this.paramDef(p, at(path, i)));
  }

  paramDef(p: unknown, path: string): void {
    if (!this.obj(p, path, 'param definition')) return;
    const type = get(p, 'type');
    const key = get(p, 'key');
    const typeOk = this.oneOf(type, at(path, 'type'), 'param type', PARAM_TYPES);
    if (typeof key !== 'string' || !PARAM_KEY_PATTERN.test(key)) {
      this.err(at(path, 'key'), `param key must match ${PARAM_KEY_PATTERN} (letters, digits, _), got ${show(key)}`);
    } else if (this.params.has(key)) {
      this.err(at(path, 'key'), `duplicate param key '${key}'`);
    } else if (typeOk) {
      this.params.set(key, type);
    }
    this.str(get(p, 'label'), at(path, 'label'), 'param label', 60, 1);
    if (has(p, 'group')) this.str(p.group, at(path, 'group'), 'param group', 40);
    if (has(p, 'description')) this.str(p.description, at(path, 'description'), 'param description', 200);
    const base = ['key', 'label', 'group', 'description', 'type', 'default'];
    if (!typeOk) return;
    const d = get(p, 'default');
    const dp = at(path, 'default');
    switch (type) {
      case 'text': {
        this.keys(p, path, [...base, 'maxLength', 'multiline'], 'a text param');
        let max = 500;
        if (has(p, 'maxLength') && this.num(p.maxLength, at(path, 'maxLength'), 'maxLength', { int: true, min: 1, max: 500 }))
          max = p.maxLength as number;
        if (has(p, 'multiline')) this.bool(p.multiline, at(path, 'multiline'), 'multiline');
        this.str(d, dp, 'text default', max);
        break;
      }
      case 'color':
        this.keys(p, path, base, 'a color param');
        if (typeof d !== 'string' || !HEX.test(d)) this.err(dp, `color default must be "#RRGGBB" or "#RRGGBBAA", got ${show(d)}`);
        break;
      case 'number': {
        this.keys(p, path, [...base, 'min', 'max', 'step', 'unit'], 'a number param');
        const okMin = this.num(get(p, 'min'), at(path, 'min'), 'min');
        const okMax = this.num(get(p, 'max'), at(path, 'max'), 'max');
        if (okMin && okMax && (p.min as number) >= (p.max as number)) this.err(at(path, 'max'), `max (${String(p.max)}) must be greater than min (${String(p.min)})`);
        if (has(p, 'step')) this.num(p.step, at(path, 'step'), 'step', { min: 0, gt: true });
        if (has(p, 'unit')) this.str(p.unit, at(path, 'unit'), 'unit', 12);
        if (okMin && okMax) this.num(d, dp, 'number default', { min: p.min as number, max: p.max as number });
        else this.num(d, dp, 'number default');
        break;
      }
      case 'image':
        this.keys(p, path, base, 'an image param');
        if (d !== null && typeof d !== 'string') this.err(dp, `image default must be null or a URL string, got ${show(d)}`);
        break;
      case 'boolean':
        this.keys(p, path, base, 'a boolean param');
        this.bool(d, dp, 'boolean default');
        break;
      case 'select': {
        this.keys(p, path, [...base, 'options'], 'a select param');
        const opts = get(p, 'options');
        const values: string[] = [];
        if (!Array.isArray(opts) || opts.length < 1 || opts.length > 50) {
          this.err(at(path, 'options'), 'options must be an array of 1 to 50 {value, label} objects');
        } else {
          opts.forEach((o, i) => {
            const op = at(path, 'options', i);
            if (!this.obj(o, op, 'option')) return;
            this.keys(o, op, ['value', 'label'], 'an option');
            if (this.str(get(o, 'value'), at(op, 'value'), 'option value', 60)) {
              if (values.includes(o.value as string)) this.err(at(op, 'value'), `duplicate option value '${String(o.value)}'`);
              values.push(o.value as string);
            }
            this.str(get(o, 'label'), at(op, 'label'), 'option label', 60, 1);
          });
        }
        if (typeof d !== 'string' || (values.length && !values.includes(d)))
          this.err(dp, `select default must be one of the option values (${list(values)}), got ${show(d)}`);
        if (typeof key === 'string' && this.params.get(key) === 'select' && !this.selects.has(key)) this.selects.set(key, values);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- layers

  layers(v: unknown, path: string, depth: number): void {
    if (!Array.isArray(v)) {
      this.err(path, `layers must be an array of layers, got ${show(v)}`);
      return;
    }
    if (v.length === 0) this.err(path, depth === 1 ? 'a scene needs at least one layer' : 'a group needs at least one layer');
    if (depth > SCENE_LIMITS.maxDepth) {
      this.err(path, `groups nest too deep: layers at depth ${depth}; max nesting depth is ${SCENE_LIMITS.maxDepth}`);
      return;
    }
    v.forEach((l, i) => this.layer(l, at(path, i), depth));
  }

  layer(l: unknown, path: string, depth: number): void {
    this.layerCount++;
    if (!this.obj(l, path, 'layer')) return;
    const id = get(l, 'id');
    if (typeof id !== 'string' || !LAYER_ID_PATTERN.test(id)) {
      this.err(at(path, 'id'), `layer id must match ${LAYER_ID_PATTERN} (start with a lowercase letter), got ${show(id)}`);
    } else if (this.layerIds.has(id)) {
      this.err(at(path, 'id'), `duplicate layer id '${id}' (first used at ${this.layerIds.get(id)})`);
    } else this.layerIds.set(id, path);

    const type = get(l, 'type');
    if (!this.oneOf(type, at(path, 'type'), 'layer type', LAYER_TYPES)) return;
    const what = `${type} layer`;
    this.keys(l, path, [...COMMON_KEYS, ...TYPE_KEYS[type]], `a ${what}`);

    // common
    if (has(l, 'start')) this.time(l.start, at(path, 'start'), 'start');
    if (has(l, 'end')) this.time(l.end, at(path, 'end'), 'end');
    if (isNum(get(l, 'start')) && isNum(get(l, 'end')) && (l.end as number) <= (l.start as number))
      this.err(at(path, 'end'), `end (${String(l.end)}) must be after start (${String(l.start)})`);
    for (const k of ['x', 'y']) if (has(l, k)) this.length(l[k], at(path, k), k);
    if (has(l, 'anchor')) {
      const a = l.anchor;
      if (!Array.isArray(a) || a.length !== 2) this.err(at(path, 'anchor'), 'anchor must be [ax, ay] with values between 0 and 1');
      else a.forEach((x, i) => this.num(x, at(path, 'anchor', i), i ? 'anchor y' : 'anchor x', { min: 0, max: 1 }));
    }
    if (has(l, 'rotation')) this.bindNum(l.rotation, at(path, 'rotation'), 'rotation (degrees)', { min: -3600, max: 3600 });
    for (const k of ['scale', 'scaleX', 'scaleY']) if (has(l, k)) this.bindNum(l[k], at(path, k), k, { min: -100, max: 100 });
    if (has(l, 'opacity')) this.bindNum(l.opacity, at(path, 'opacity'), 'opacity', { min: 0, max: 1 });
    if (has(l, 'visibleIf')) {
      const g = l.visibleIf;
      if (isObj(g) && has(g, 'param')) {
        this.binding(g, at(path, 'visibleIf'), ['boolean', 'image'], 'visibleIf', ['not']);
        if (has(g, 'not')) this.bool(g.not, at(path, 'visibleIf', 'not'), 'visibleIf not');
      } else
        this.err(
          at(path, 'visibleIf'),
          `visibleIf must be {"param": "<boolean or image param>"} or {"param": "...", "not": true}, got ${show(g)}`,
        );
    }
    for (const k of ['enter', 'exit'] as const) if (has(l, k)) this.motion(l[k], at(path, k), type, k);
    if (has(l, 'keyframes')) this.keyframes(l.keyframes, at(path, 'keyframes'), type);
    if (has(l, 'ambient')) this.ambient(l.ambient, at(path, 'ambient'), type);

    // per type
    const req = (k: string): boolean => {
      if (has(l, k)) return true;
      this.err(at(path, k), `${what} is missing required property '${k}'`);
      return false;
    };
    const paint = () => {
      if (has(l, 'fill')) this.fill(l.fill, at(path, 'fill'), 'fill');
      if (has(l, 'stroke')) this.stroke(l.stroke, at(path, 'stroke'));
      if (!has(l, 'fill') && !has(l, 'stroke')) this.err(path, `${what} '${String(id)}' draws nothing: add a fill and/or a stroke`);
    };
    switch (type) {
      case 'text':
        if (req('text')) this.template(l.text, at(path, 'text'), 'text', SCENE_LIMITS.maxTextChars);
        this.fontFields(l, path);
        if (has(l, 'maxWidth')) this.length(l.maxWidth, at(path, 'maxWidth'), 'maxWidth');
        if (has(l, 'maxLines')) this.num(l.maxLines, at(path, 'maxLines'), 'maxLines', { int: true, min: 1, max: 20 });
        if (has(l, 'autoFit')) {
          const a = l.autoFit;
          if (this.obj(a, at(path, 'autoFit'), 'autoFit')) {
            this.keys(a, at(path, 'autoFit'), ['minSize'], 'autoFit');
            this.length(get(a, 'minSize'), at(path, 'autoFit', 'minSize'), 'autoFit minSize');
          }
          if (!has(l, 'maxWidth')) this.err(at(path, 'autoFit'), 'autoFit needs maxWidth (the box the text shrinks to fit)');
        }
        if (has(l, 'background')) {
          const b = l.background;
          const bp = at(path, 'background');
          if (this.obj(b, bp, 'background')) {
            this.keys(b, bp, ['fill', 'padding', 'radius'], 'text background');
            if (has(b, 'fill')) this.fill(b.fill, at(bp, 'fill'), 'background fill');
            else this.err(at(bp, 'fill'), "text background is missing required property 'fill'");
            if (has(b, 'padding')) {
              const p = b.padding;
              if (Array.isArray(p)) {
                if (p.length !== 2) this.err(at(bp, 'padding'), 'padding must be a length or [horizontal, vertical]');
                else p.forEach((x, i) => this.length(x, at(bp, 'padding', i), 'padding'));
              } else this.length(p, at(bp, 'padding'), 'padding');
            }
            if (has(b, 'radius')) this.length(b.radius, at(bp, 'radius'), 'radius');
          }
        }
        if (has(l, 'progress')) this.bindNum(l.progress, at(path, 'progress'), 'progress', { min: 0, max: 1 });
        break;
      case 'counter':
        if (req('from')) this.bindNum(l.from, at(path, 'from'), 'from', { min: -1e15, max: 1e15 });
        if (req('to')) this.bindNum(l.to, at(path, 'to'), 'to', { min: -1e15, max: 1e15 });
        if (has(l, 'decimals')) this.num(l.decimals, at(path, 'decimals'), 'decimals', { int: true, min: 0, max: 6 });
        if (has(l, 'step')) this.num(l.step, at(path, 'step'), 'step', { min: 0, gt: true, max: 1e15 });
        for (const k of ['prefix', 'suffix']) if (has(l, k)) this.template(l[k], at(path, k), k, 40);
        if (has(l, 'separator')) this.str(l.separator, at(path, 'separator'), 'separator', 3);
        if (has(l, 'count')) {
          const c = l.count;
          const cp = at(path, 'count');
          if (this.obj(c, cp, 'count')) {
            this.keys(c, cp, ['duration', 'delay', 'ease'], 'count');
            this.num(get(c, 'duration'), at(cp, 'duration'), 'count duration', { min: 0, gt: true, max: this.maxSeconds });
            if (has(c, 'delay')) this.num(c.delay, at(cp, 'delay'), 'count delay', { min: 0, max: this.maxSeconds });
            if (has(c, 'ease')) this.ease(c.ease, at(cp, 'ease'));
          }
        }
        this.fontFields(l, path);
        break;
      case 'rect':
        if (req('width')) this.length(l.width, at(path, 'width'), 'width');
        if (req('height')) this.length(l.height, at(path, 'height'), 'height');
        if (has(l, 'radius')) this.length(l.radius, at(path, 'radius'), 'radius');
        paint();
        break;
      case 'ellipse':
        if (req('width')) this.length(l.width, at(path, 'width'), 'width');
        if (req('height')) this.length(l.height, at(path, 'height'), 'height');
        paint();
        break;
      case 'polygon':
        if (req('sides')) this.num(l.sides, at(path, 'sides'), 'sides', { int: true, min: 3, max: 12 });
        if (req('radius')) this.length(l.radius, at(path, 'radius'), 'radius');
        if (has(l, 'innerRadius')) this.length(l.innerRadius, at(path, 'innerRadius'), 'innerRadius');
        paint();
        break;
      case 'image': {
        if (req('src')) {
          const s = l.src;
          if (isObj(s) && has(s, 'param')) this.binding(s, at(path, 'src'), ['image'], 'image src');
          else this.err(at(path, 'src'), `image src must bind an image param like {"param": "logoUrl"}, got ${show(s)}`);
        }
        if (req('width')) this.length(l.width, at(path, 'width'), 'width');
        if (req('height')) this.length(l.height, at(path, 'height'), 'height');
        if (has(l, 'fit')) this.oneOf(l.fit, at(path, 'fit'), 'fit', ['contain', 'cover'] as const);
        if (has(l, 'radius')) this.length(l.radius, at(path, 'radius'), 'radius');
        break;
      }
      case 'group':
        if (has(l, 'timing')) this.oneOf(l.timing, at(path, 'timing'), 'group timing', GROUP_TIMINGS);
        if (req('layers')) this.layers(l.layers, at(path, 'layers'), depth + 1);
        break;
    }
  }

  fontFields(l: Obj, path: string): void {
    const what = `${String(l.type)} layer`;
    if (!has(l, 'font')) this.err(at(path, 'font'), `${what} is missing required property 'font'`);
    else {
      const f = l.font;
      const fp = at(path, 'font');
      if (this.obj(f, fp, 'font')) {
        this.keys(f, fp, ['family', 'weight', 'size', 'lineHeight', 'letterSpacing', 'italic'], 'font');
        const fam = get(f, 'family');
        if (typeof fam !== 'string') this.err(at(fp, 'family'), `font family must be a string, got ${show(fam)}`);
        else if (!BUNDLED_FONTS.includes(fam)) this.err(at(fp, 'family'), `font '${fam}' is not bundled; available: ${list(BUNDLED_FONTS)}`);
        else if (!this.fonts.has(fam)) this.err(at(fp, 'family'), `font '${fam}' is used but not listed in /fonts; add it there so it is preloaded`);
        if (has(f, 'weight')) {
          const range = typeof fam === 'string' ? FONT_WEIGHTS[fam] : undefined;
          if (this.num(f.weight, at(fp, 'weight'), 'font weight', { int: true, min: 100, max: 900 }) && range) {
            const w = f.weight as number;
            if (w < range.min || w > range.max)
              this.err(at(fp, 'weight'), `'${String(fam)}' only ships weight ${range.min === range.max ? range.min : `${range.min}-${range.max}`}, got ${w}`);
          }
        }
        if (has(f, 'size')) this.length(f.size, at(fp, 'size'), 'font size');
        else this.err(at(fp, 'size'), "font is missing required property 'size'");
        if (has(f, 'lineHeight')) this.num(f.lineHeight, at(fp, 'lineHeight'), 'lineHeight', { min: 0.5, max: 3 });
        if (has(f, 'letterSpacing')) this.num(f.letterSpacing, at(fp, 'letterSpacing'), 'letterSpacing (em)', { min: -0.2, max: 1 });
        if (has(f, 'italic')) this.bool(f.italic, at(fp, 'italic'), 'italic');
      }
    }
    if (!has(l, 'color')) this.err(at(path, 'color'), `${what} is missing required property 'color'`);
    else this.color(l.color, at(path, 'color'), 'text color');
    if (has(l, 'align')) this.oneOf(l.align, at(path, 'align'), 'align', ['left', 'center', 'right'] as const);
  }

  motion(m: unknown, path: string, type: LayerType, kind: 'enter' | 'exit'): void {
    if (!this.obj(m, path, kind)) return;
    this.keys(m, path, ['preset', 'duration', 'delay', 'ease', 'distance', 'stagger'], `${kind} motion`);
    const preset = get(m, 'preset');
    if (has(m, 'preset')) {
      if (isObj(preset) && has(preset, 'cases'))
        this.cases(preset, at(path, 'preset'), 'preset', (x, p) => {
          if (this.noNestedCases(x, p)) this.presetName(x, p, type);
        });
      else this.presetName(preset, at(path, 'preset'), type);
    } else this.err(at(path, 'preset'), `${kind} motion is missing required property 'preset'; expected one of ${list(PRESETS)}`);
    if (has(m, 'duration')) this.num(m.duration, at(path, 'duration'), 'duration', { min: 0, max: 10 });
    if (has(m, 'delay')) this.num(m.delay, at(path, 'delay'), 'delay', { min: 0, max: this.maxSeconds });
    if (has(m, 'ease')) this.ease(m.ease, at(path, 'ease'));
    if (has(m, 'distance')) this.length(m.distance, at(path, 'distance'), 'distance');
    if (has(m, 'stagger')) {
      const s = m.stagger;
      const sp = at(path, 'stagger');
      if (type !== 'text' && type !== 'counter') this.err(sp, `stagger only works on text and counter layers, not ${type}`);
      else if (this.obj(s, sp, 'stagger')) {
        this.keys(s, sp, ['by', 'each'], 'stagger');
        this.oneOf(get(s, 'by'), at(sp, 'by'), 'stagger unit', STAGGER_UNITS);
        this.num(get(s, 'each'), at(sp, 'each'), 'stagger each (seconds)', { min: 0, max: 2 });
      }
    }
  }

  presetName(preset: unknown, path: string, type: LayerType): void {
    if (preset === 'blur-in') this.err(path, `preset 'blur-in' is not available in mg-scene@1; expected one of ${list(PRESETS)}`);
    else if (this.oneOf(preset, path, 'preset', PRESETS)) {
      const textual = type === 'text' || type === 'counter';
      if (preset === 'typewriter' && !textual) this.err(path, `preset 'typewriter' only works on text and counter layers, not ${type}`);
      else if (type === 'group' && (preset === 'mask-up' || preset === 'wipe-right' || preset === 'wipe-left'))
        this.err(path, `preset '${preset}' needs a layer box and is not available on groups; use one of fade, rise, drop, slide-left, slide-right, pop, scale-in`);
    }
  }

  keyframes(k: unknown, path: string, type: LayerType): void {
    if (!this.obj(k, path, 'keyframes')) return;
    const props = animatableProps(type);
    for (const prop of Object.keys(k)) {
      const pp = at(path, prop);
      if (!props.includes(prop)) {
        this.err(pp, `'${prop}' is not animatable on ${type} layers; animatable: ${list(props)}`);
        continue;
      }
      const arr = k[prop];
      if (!Array.isArray(arr) || arr.length === 0) {
        this.err(pp, `keyframes.${prop} must be a non-empty array of {t, v, ease?}`);
        continue;
      }
      if (arr.length > SCENE_LIMITS.maxKeyframes)
        this.err(pp, `${arr.length} keyframes for '${prop}'; max ${SCENE_LIMITS.maxKeyframes} per property`);
      let prev = -Infinity;
      arr.forEach((kf, i) => {
        const kp = at(pp, i);
        if (!this.obj(kf, kp, 'keyframe')) return;
        this.keys(kf, kp, ['t', 'v', 'ease'], 'a keyframe');
        const t = get(kf, 't');
        if (this.num(t, at(kp, 't'), 'keyframe t (seconds after layer start)', { min: 0, max: this.maxSeconds })) {
          if (t <= prev) this.err(at(kp, 't'), `keyframe times must increase: ${t} comes after ${prev}`);
          prev = t;
        }
        if (!has(kf, 'v')) this.err(at(kp, 'v'), "keyframe is missing required property 'v'");
        else if (LENGTH_PROPS.has(prop)) this.length(kf.v, at(kp, 'v'), prop);
        else if (prop === 'opacity' || prop === 'progress') this.bindNum(kf.v, at(kp, 'v'), prop, { min: 0, max: 1 });
        else this.bindNum(kf.v, at(kp, 'v'), prop, { min: -3600, max: 3600 });
        if (has(kf, 'ease')) this.ease(kf.ease, at(kp, 'ease'));
      });
    }
  }

  ambient(a: unknown, path: string, type: LayerType): void {
    if (!Array.isArray(a)) {
      this.err(path, `ambient must be an array of {prop, amplitude, period, phase?}, got ${show(a)}`);
      return;
    }
    if (a.length > SCENE_LIMITS.maxAmbient) this.err(path, `${a.length} ambient motions; max ${SCENE_LIMITS.maxAmbient}`);
    const props = animatableProps(type);
    a.forEach((m, i) => {
      const p = at(path, i);
      if (!this.obj(m, p, 'ambient motion')) return;
      this.keys(m, p, ['prop', 'amplitude', 'period', 'phase'], 'an ambient motion');
      const prop = get(m, 'prop');
      this.oneOf(prop, at(p, 'prop'), `ambient prop for ${type} layers`, props);
      const amp = get(m, 'amplitude');
      if (typeof prop === 'string' && LENGTH_PROPS.has(prop)) {
        if (isObj(amp)) this.err(at(p, 'amplitude'), 'ambient amplitude cannot be a param binding');
        else this.length(amp, at(p, 'amplitude'), 'amplitude');
      } else this.num(amp, at(p, 'amplitude'), 'amplitude', { min: -3600, max: 3600 });
      this.num(get(m, 'period'), at(p, 'period'), 'period (seconds)', { min: 0, gt: true, max: 600 });
      if (has(m, 'phase')) this.num(m.phase, at(p, 'phase'), 'phase (fraction of a cycle)', { min: -1, max: 1 });
    });
  }

  // ---------------------------------------------------------------- top level

  scene(s: Obj): void {
    this.keys(
      s,
      '',
      ['format', 'id', 'name', 'description', 'category', 'defaultSettings', 'fonts', 'params', 'background', 'layers'],
      'the scene',
    );
    const fmt = get(s, 'format');
    if (fmt !== SCENE_FORMAT) this.err('/format', `unsupported format ${show(fmt)}; expected '${SCENE_FORMAT}'`);
    const id = get(s, 'id');
    if (typeof id !== 'string' || !SCENE_ID_PATTERN.test(id))
      this.err('/id', `scene id must match ${SCENE_ID_PATTERN} (lowercase letters, digits, _; 3-48 chars), got ${show(id)}`);
    this.str(get(s, 'name'), '/name', 'name', 80, 1);
    this.str(get(s, 'description'), '/description', 'description', 300);
    this.oneOf(get(s, 'category'), '/category', 'category', SCENE_CATEGORIES);
    this.settings(get(s, 'defaultSettings'));

    const fonts = get(s, 'fonts');
    if (!Array.isArray(fonts) || fonts.length === 0) {
      this.err('/fonts', `fonts must be a non-empty array of bundled families (${list(BUNDLED_FONTS)}), got ${show(fonts)}`);
    } else {
      fonts.forEach((f, i) => {
        if (typeof f !== 'string' || !BUNDLED_FONTS.includes(f))
          this.err(at('/fonts', i), `font ${show(f)} is not bundled; available: ${list(BUNDLED_FONTS)}`);
        else if (this.fonts.has(f)) this.err(at('/fonts', i), `font '${f}' is listed twice`);
        else this.fonts.add(f);
      });
    }
    this.paramDefs(get(s, 'params'), '/params');
    if (has(s, 'background') && s.background !== null) this.fill(s.background, '/background', 'background');
    this.layers(get(s, 'layers'), '/layers', 1);
    if (this.layerCount > SCENE_LIMITS.maxLayers)
      this.err('/layers', `scene has ${this.layerCount} layers (including nested); max ${SCENE_LIMITS.maxLayers}`);
  }

  settings(v: unknown): void {
    const p = '/defaultSettings';
    if (!this.obj(v, p, 'defaultSettings')) return;
    this.keys(v, p, ['width', 'height', 'fps', 'durationFrames', 'transparent'], 'defaultSettings');
    for (const k of ['width', 'height']) {
      const x = get(v, k);
      if (this.num(x, at(p, k), k, { int: true, min: LIMITS.minSize, max: LIMITS.maxSize }) && x % 2)
        this.err(at(p, k), `${k} must be even (video encoding needs even sizes), got ${x}`);
    }
    const fps = get(v, 'fps');
    const fpsOk = isNum(fps) && (LIMITS.fps as readonly number[]).includes(fps);
    if (!fpsOk) this.err(at(p, 'fps'), `fps must be one of ${LIMITS.fps.join(', ')}, got ${show(fps)}`);
    const maxFrames = LIMITS.maxDurationSeconds * (fpsOk ? (fps as number) : 60);
    this.num(get(v, 'durationFrames'), at(p, 'durationFrames'), 'durationFrames', { int: true, min: 1, max: maxFrames });
    if (!has(v, 'transparent')) this.err(at(p, 'transparent'), "defaultSettings is missing required property 'transparent'");
    else this.bool(v.transparent, at(p, 'transparent'), 'transparent');
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Validates an untrusted scene document. Never throws. */
export function validateScene(input: unknown): SceneValidationResult {
  try {
    if (!isObj(input)) return { ok: false, errors: [{ path: '', message: `scene must be a JSON object, got ${show(input)}` }] };
    let json: string;
    try {
      json = JSON.stringify(input);
    } catch {
      return { ok: false, errors: [{ path: '', message: 'scene is not JSON-serializable (cycles or unsupported values)' }] };
    }
    const bytes = byteLength(json);
    if (bytes > SCENE_LIMITS.maxBytes)
      return { ok: false, errors: [{ path: '', message: `scene JSON is ${bytes} bytes; max ${SCENE_LIMITS.maxBytes} (64 KB)` }] };
    const c = new Checker();
    c.scene(input);
    if (c.errors.length) return { ok: false, errors: c.errors };
    return { ok: true, scene: JSON.parse(json) as Scene };
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `scene could not be validated: ${e instanceof Error ? e.message : String(e)}` }] };
  }
}

/** Human-readable multi-line rendering of validation errors. */
export function formatSceneErrors(errors: SceneError[]): string {
  return errors.map((e) => `  ${e.path || '/'}: ${e.message}`).join('\n');
}
