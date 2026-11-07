/**
 * Format additions to mg-scene@1: negated visibleIf, numeric binding transforms (map / ofMax), select
 * cases, counter step, group-relative timing, and the text-pop pivot fix.
 */
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { defaultValues, templateFromScene, validateScene } from '../src';
import type { AssetValues, Ctx2D, Scene, SceneError, TemplateDefinition } from '../src';
import { counterValue, layerWindow, resolveColor, resolveLength, resolveNumber, resolveTextValue, selectCase } from '../src/scene';
import type { CounterLayer, Layer } from '../src/scene';

// ------------------------------------------------------------------ helpers

const PARAMS = [
  { key: 'headline', label: 'Headline', type: 'text', default: 'Hello' },
  { key: 'accent', label: 'Accent', type: 'color', default: '#336699' },
  { key: 'v1', label: 'V1', type: 'number', default: 25, min: 0, max: 1000000 },
  { key: 'v2', label: 'V2', type: 'number', default: 50, min: 0, max: 1000000 },
  { key: 'v3', label: 'V3', type: 'number', default: 100, min: 0, max: 1000000 },
  { key: 'show', label: 'Show', type: 'boolean', default: true },
  { key: 'logo', label: 'Logo', type: 'image', default: null },
  {
    key: 'style',
    label: 'Style',
    type: 'select',
    default: 'bold',
    options: [
      { value: 'bold', label: 'Bold' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'retro', label: 'Retro' },
    ],
  },
];

function doc(layers: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'mg-scene@1',
    id: 'feature_scene',
    name: 'Features',
    description: '',
    category: 'promo',
    defaultSettings: { width: 200, height: 100, fps: 25, durationFrames: 101, transparent: true },
    fonts: ['Inter Variable'],
    params: PARAMS,
    background: null,
    layers,
    ...extra,
  };
}

function errorsOf(layers: unknown[]): SceneError[] {
  const r = validateScene(doc(layers));
  return r.ok ? [] : r.errors;
}

function expectOk(layers: unknown[]): void {
  expect(errorsOf(layers)).toEqual([]);
}

function expectError(layers: unknown[], path: string, message: RegExp): void {
  const errs = errorsOf(layers);
  const hit = errs.find((e) => e.path === path && message.test(e.message));
  expect(hit, `expected ${path} ~ ${message}; got ${JSON.stringify(errs, null, 1)}`).toBeTruthy();
}

/** Valid scene with a 10 fps / 41 frame clock (frame n = n / 10 s, "end" = 4 s). */
function scene(layers: unknown[], size = { width: 200, height: 100 }): Scene {
  const r = validateScene(doc(layers, { defaultSettings: { ...size, fps: 25, durationFrames: 101, transparent: true } }));
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 1));
  r.scene.defaultSettings.fps = 10;
  r.scene.defaultSettings.durationFrames = 41;
  return r.scene;
}

function render(t: TemplateDefinition, frame: number, values?: AssetValues): Uint8ClampedArray {
  const { width, height, fps, durationFrames } = t.defaultSettings;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  t.render(
    {
      ctx: ctx as unknown as Ctx2D,
      frame,
      fps,
      time: frame / fps,
      durationFrames,
      progress: frame / (durationFrames - 1),
      width,
      height,
      transparent: true,
    },
    { ...defaultValues(t), ...values },
    { images: {} },
  );
  return new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data);
}

const alphaSum = (px: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 3; i < px.length; i += 4) s += px[i] as number;
  return s;
};

/** Bounding box of pixels with alpha > 128. */
function bbox(px: Uint8ClampedArray, w: number): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < px.length / 4; i++) {
    if ((px[i * 4 + 3] as number) <= 128) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

const pixel = (px: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

const paramMap = new Map(PARAMS.map((p) => [p.key, p as any]));
const env = (values: AssetValues = {}) => ({ w: 1000, h: 500, params: paramMap, values });
const rect = (extra: Record<string, unknown> = {}) => ({ id: 'r', type: 'rect', width: 10, height: 10, fill: '#FFFFFF', ...extra });

// ------------------------------------------------------------------ 1. negated visibleIf

describe('visibleIf not', () => {
  it('validates', () => {
    expectOk([rect({ visibleIf: { param: 'logo', not: true } })]);
    expectOk([rect({ visibleIf: { param: 'show', not: false } })]);
    expectError([rect({ visibleIf: { param: 'show', not: 'yes' } })], '/layers/0/visibleIf/not', /visibleIf not must be true or false/);
    expectError([rect({ visibleIf: { param: 'headline', not: true } })], '/layers/0/visibleIf/param', /text param; visibleIf needs a boolean or image param/);
    expectError([rect({ visibleIf: { param: 'show', invert: true } })], '/layers/0/visibleIf/invert', /allowed: param, not/);
  });

  it('inverts boolean and image gates', () => {
    const t = templateFromScene(
      scene([
        rect({ id: 'noLogo', x: '50px', y: '50px', width: '20px', height: '20px', visibleIf: { param: 'logo', not: true } }),
        rect({ id: 'hidden', x: '150px', y: '50px', width: '20px', height: '20px', visibleIf: { param: 'show', not: true } }),
      ]),
    );
    const noLogo = render(t, 0, { logo: null, show: true });
    expect(pixel(noLogo, 200, 50, 50)[3]).toBe(255);
    expect(pixel(noLogo, 200, 150, 50)[3]).toBe(0);
    const withLogo = render(t, 0, { logo: 'data:x', show: false });
    expect(pixel(withLogo, 200, 50, 50)[3]).toBe(0);
    expect(pixel(withLogo, 200, 150, 50)[3]).toBe(255);
  });
});

// ------------------------------------------------------------------ 2. map / ofMax

describe('numeric binding transforms', () => {
  it('map: linear, extrapolating, clamped, unit-aware outputs', () => {
    const e = env({ v1: 25 });
    expect(resolveNumber({ param: 'v1', map: { in: [0, 100], out: [0, 40] } }, e, 0)).toBeCloseTo(10);
    expect(resolveNumber({ param: 'v1', map: { in: [100, 0], out: [0, 1] } }, e, 0)).toBeCloseTo(0.75);
    const e2 = env({ v1: 150 });
    expect(resolveNumber({ param: 'v1', map: { in: [0, 100], out: [0, 40] } }, e2, 0)).toBeCloseTo(60);
    expect(resolveNumber({ param: 'v1', map: { in: [0, 100], out: [0, 40] }, clamp: true }, e2, 0)).toBeCloseTo(40);
    // Length outputs use the literal unit rules (numbers = % of vmin = 500 px here).
    expect(resolveLength({ param: 'v1', map: { in: [0, 100], out: ['0%h', '40%h'] } }, e)).toBeCloseTo(50);
    expect(resolveLength({ param: 'v1', map: { in: [0, 100], out: [0, 40] } }, e)).toBeCloseTo(50);
    expect(resolveLength({ param: 'v1', map: { in: [0, 100], out: ['100px', '20%w'] } }, e)).toBeCloseTo(125);
    // plain binding keeps its meaning (percent of vmin)
    expect(resolveLength({ param: 'v1' }, e)).toBeCloseTo(125);
  });

  it('ofMax: normalises against the largest listed param', () => {
    const list = ['v1', 'v2', 'v3'];
    const e = env({ v1: 250000, v2: 500000, v3: 1000000 });
    expect(resolveNumber({ param: 'v1', ofMax: list, out: [0, 40] }, e, 0)).toBeCloseTo(10);
    expect(resolveNumber({ param: 'v3', ofMax: list, out: [0, 40] }, e, 0)).toBeCloseTo(40);
    expect(resolveLength({ param: 'v2', ofMax: list, out: ['0%h', '80%h'] }, e)).toBeCloseTo(200);
    // all zero → the out start, never NaN
    const z = env({ v1: 0, v2: 0, v3: 0 });
    expect(resolveNumber({ param: 'v1', ofMax: list, out: [5, 40] }, z, 0)).toBe(5);
    // param outside the list can exceed 1 unless clamped
    const e3 = env({ v1: 200, v2: 100 });
    expect(resolveNumber({ param: 'v1', ofMax: ['v2'], out: [0, 1] }, e3, 0)).toBeCloseTo(2);
    expect(resolveNumber({ param: 'v1', ofMax: ['v2'], out: [0, 1], clamp: true }, e3, 0)).toBeCloseTo(1);
  });

  it('validates shapes, params and out values', () => {
    expectOk([rect({ height: { param: 'v1', map: { in: [0, 100], out: ['0%h', '40%h'] }, clamp: true } })]);
    expectOk([rect({ height: { param: 'v1', ofMax: ['v1', 'v2', 'v3'], out: [0, 40] } })]);
    expectOk([rect({ opacity: { param: 'v1', map: { in: [0, 100], out: [0, 1] } } })]);
    expectOk([rect({ keyframes: { y: [{ t: 0, v: 0 }, { t: 1, v: { param: 'v2', ofMax: ['v1', 'v2'], out: ['0%h', '-40%h'] } }] } })]);
    const h = '/layers/0/height';
    expectError([rect({ height: { param: 'v1', map: { in: [5, 5], out: [0, 1] } } })], `${h}/map/in`, /must differ/);
    expectError([rect({ height: { param: 'v1', map: { in: [0], out: [0, 1] } } })], `${h}/map/in`, /\[from, to\]/);
    expectError([rect({ height: { param: 'v1', map: { in: [0, 1] } } })], `${h}/map/out`, /missing required property 'out'/);
    expectError([rect({ height: { param: 'v1', map: { in: [0, 1], out: [0] } } })], `${h}/map/out`, /\[valueAtStart, valueAtEnd\]/);
    expectError([rect({ height: { param: 'v1', map: { in: [0, 1], out: [0, '9em'] } } })], `${h}/map/out/1`, /invalid length '9em'/);
    expectError([rect({ height: { param: 'v1', map: { in: [0, 1], out: [0, { param: 'v2' }] } } })], `${h}/map/out/1`, /literal length/);
    expectError([rect({ height: { param: 'v1', map: { in: [0, 1], out: [0, 1], scale: 2 } } })], `${h}/map/scale`, /unknown property 'scale' on map/);
    expectError([rect({ height: { param: 'headline', map: { in: [0, 1], out: [0, 1] } } })], `${h}/param`, /text param; height needs a number param/);
    expectError([rect({ height: { param: 'nope', map: { in: [0, 1], out: [0, 1] } } })], `${h}/param`, /unknown param 'nope'/);
    expectError([rect({ height: { param: 'v1', map: { in: [0, 1], out: [0, 1] }, clamp: 1 } })], `${h}/clamp`, /true or false/);
    expectError([rect({ height: { param: 'v1', out: [0, 1] } })], `${h}/out`, /needs "map" or "ofMax"/);
    expectError([rect({ height: { param: 'v1', ofMax: ['v1'], map: { in: [0, 1], out: [0, 1] }, out: [0, 1] } })], h, /either "map" or "ofMax"/);
    expectError([rect({ height: { param: 'v1', ofMax: [], out: [0, 1] } })], `${h}/ofMax`, /1 to 16 number param keys/);
    expectError([rect({ height: { param: 'v1', ofMax: ['v1', 'zz'], out: [0, 1] } })], `${h}/ofMax/1`, /unknown param 'zz' in ofMax/);
    expectError([rect({ height: { param: 'v1', ofMax: ['v1', 'show'], out: [0, 1] } })], `${h}/ofMax/1`, /boolean param; ofMax only lists number params/);
    expectError([rect({ height: { param: 'v1', ofMax: ['v1', 'v1'], out: [0, 1] } })], `${h}/ofMax/1`, /listed twice/);
    expectError([rect({ height: { param: 'v1', ofMax: ['v1'] } })], `${h}/out`, /ofMax needs "out"/);
    expectError([rect({ opacity: { param: 'v1', map: { in: [0, 1], out: [0, 2] } } })], '/layers/0/opacity/map/out/1', /between 0 and 1/);
  });

  it('drives a rendered bar height (auto-scale to the largest value)', () => {
    const bar = (id: string, param: string, x: string) =>
      rect({ id, x, y: '90px', anchor: [0.5, 1], width: '10px', height: { param, ofMax: ['v1', 'v2', 'v3'], out: ['0px', '80px'] } });
    const t = templateFromScene(scene([bar('a', 'v1', '40px'), bar('b', 'v2', '100px'), bar('c', 'v3', '160px')]));
    const px = render(t, 0, { v1: 200000, v2: 500000, v3: 1000000 });
    const height = (x: number) => {
      let n = 0;
      for (let y = 0; y < 100; y++) if ((pixel(px, 200, x, y)[3] as number) > 128) n++;
      return n;
    };
    expect(height(40)).toBe(16);
    expect(height(100)).toBe(40);
    expect(height(160)).toBe(80);
  });
});

// ------------------------------------------------------------------ 3. select cases

describe('select cases', () => {
  it('picks the case of the current option, then default, then the select default', () => {
    const c = { param: 'style', cases: { bold: 10, minimal: 2 }, default: 5 };
    expect(selectCase(c, env({ style: 'minimal' }))).toBe(2);
    expect(selectCase(c, env({ style: 'retro' }))).toBe(5);
    expect(selectCase({ param: 'style', cases: { bold: 1, minimal: 2, retro: 3 } }, env({ style: 'bogus' }))).toBe(1);
    expect(resolveNumber(c, env({ style: 'bold' }), 0)).toBe(10);
    expect(resolveLength({ param: 'style', cases: { bold: '20%w', minimal: { param: 'v1' } }, default: 0 }, env({ style: 'bold' }))).toBe(200);
    expect(resolveLength({ param: 'style', cases: { bold: '20%w', minimal: { param: 'v1' } }, default: 0 }, env({ style: 'minimal', v1: 10 }))).toBe(50);
    expect(resolveColor({ param: 'style', cases: { bold: { param: 'accent' } }, default: '#FF0000' }, env({ style: 'bold' }))).toBe('rgba(51,102,153,1)');
    expect(resolveColor({ param: 'style', cases: { bold: { param: 'accent' } }, default: '#FF0000' }, env({ style: 'retro' }))).toBe('rgba(255,0,0,1)');
    expect(resolveTextValue({ param: 'style', cases: { bold: '{{headline}}!' }, default: '' }, env({ style: 'bold' }))).toBe('{{headline}}!');
  });

  it('validates params, case keys against options, coverage and values', () => {
    const color = (v: unknown) => [rect({ fill: v })];
    expectOk(color({ param: 'style', cases: { bold: '#FF0000', minimal: { param: 'accent' }, retro: { mix: ['#000000', '#FFFFFF'], t: 0.5 } } }));
    expectOk(color({ param: 'style', cases: { bold: { linear: { angle: 90, stops: [[0, '#000000'], [1, '#FFFFFF']] } } }, default: '#FFFFFF' }));
    expectOk([rect({ scale: { param: 'style', cases: { bold: 1.2 }, default: { param: 'v1', map: { in: [0, 100], out: [0.5, 1] } } } })]);
    expectOk([rect({ enter: { preset: { param: 'style', cases: { bold: 'pop', minimal: 'fade' }, default: 'rise' } } })]);
    expectOk([
      {
        id: 't',
        type: 'text',
        text: { param: 'style', cases: { bold: '{{headline|upper}}' }, default: '{{headline}}' },
        font: { family: 'Inter Variable', size: 5 },
        color: { param: 'style', cases: { bold: '#FFFFFF' }, default: { param: 'accent', alpha: 0.5 } },
      },
    ]);
    const f = '/layers/0/fill';
    expectError(color({ param: 'style', cases: { bold: '#FF0000', loud: '#00FF00' }, default: '#000000' }), `${f}/cases/loud`, /'loud' is not an option of select param 'style'; options: bold, minimal, retro/);
    expectError(color({ param: 'style', cases: { bold: '#FF0000' } }), `${f}/cases`, /miss option\(s\) 'minimal', 'retro'; add a case for each or a "default"/);
    expectError(color({ param: 'style', cases: {} , default: '#000000'}), `${f}/cases`, /non-empty object/);
    expectError(color({ param: 'show', cases: { bold: '#FF0000' }, default: '#000000' }), `${f}/param`, /boolean param; select cases for fill needs a select param/);
    expectError(color({ param: 'style', cases: { bold: 'red' }, default: '#000000' }), `${f}/cases/bold`, /invalid color 'red'/);
    expectError(color({ param: 'style', cases: { bold: '#FF0000' }, default: 'blue' }), `${f}/default`, /invalid color 'blue'/);
    expectError(
      color({ param: 'style', cases: { bold: { param: 'style', cases: { bold: '#FFFFFF' }, default: '#000000' } }, default: '#000000' }),
      `${f}/cases/bold`,
      /cannot be nested/,
    );
    expectError(color({ param: 'style', cases: { bold: '#FF0000' }, fallback: '#000000' }), `${f}/fallback`, /allowed: param, cases, default/);
    expectError([rect({ enter: { preset: { param: 'style', cases: { bold: 'typewriter' }, default: 'fade' } } })], '/layers/0/enter/preset/cases/bold', /'typewriter' only works on text and counter/);
    expectError([rect({ enter: { preset: { param: 'style', cases: { bold: 'zoom' }, default: 'fade' } } })], '/layers/0/enter/preset/cases/bold', /unknown preset 'zoom'/);
    expectError([rect({ opacity: { param: 'style', cases: { bold: 3 }, default: 1 } })], '/layers/0/opacity/cases/bold', /between 0 and 1/);
    expectError(
      [{ id: 't', type: 'text', text: { param: 'style', cases: { bold: '{{nope}}' }, default: '' }, font: { family: 'Inter Variable', size: 5 }, color: '#FFFFFF' }],
      '/layers/0/text/cases/bold',
      /unknown param 'nope'/,
    );
  });

  it('renders select-driven colors and presets', () => {
    const t = templateFromScene(
      scene([
        rect({
          x: '100px',
          y: '50px',
          width: '40px',
          height: '40px',
          fill: { param: 'style', cases: { bold: '#FF0000', minimal: '#00FF00' }, default: '#0000FF' },
          enter: { preset: { param: 'style', cases: { bold: 'fade', minimal: 'wipe-right' }, default: 'pop' }, duration: 1 },
        }),
      ]),
    );
    expect(pixel(render(t, 20, { style: 'bold' }), 200, 100, 50)).toEqual([255, 0, 0, 255]);
    expect(pixel(render(t, 20, { style: 'minimal' }), 200, 100, 50)).toEqual([0, 255, 0, 255]);
    expect(pixel(render(t, 20, { style: 'retro' }), 200, 100, 50)).toEqual([0, 0, 255, 255]);
    // mid-enter: fade covers the whole box at half alpha, wipe-right only the left part
    const fade = bbox(render(t, 3, { style: 'bold' }), 200);
    const wipe = bbox(render(t, 3, { style: 'minimal' }), 200);
    expect(fade.x1 - fade.x0).toBeGreaterThan(wipe.x1 - wipe.x0 + 10);
  });
});

// ------------------------------------------------------------------ 4. counter step

describe('counter step', () => {
  const counter = (extra: Record<string, unknown>) =>
    ({ id: 'n', type: 'counter', font: { family: 'Inter Variable', size: 10 }, color: '#FFFFFF', ...extra }) as unknown as CounterLayer;

  it('advances in whole steps toward the target and ends exactly on it', () => {
    const e = env({ v1: 5 });
    const down = counter({ from: { param: 'v1' }, to: 0, step: 1, count: { duration: 5, ease: 'linear' } });
    expect(counterValue(down, 0, e)).toBe(5);
    expect(counterValue(down, 0.99, e)).toBe(5);
    expect(counterValue(down, 1, e)).toBe(4);
    expect(counterValue(down, 4.5, e)).toBe(1);
    expect(counterValue(down, 5, e)).toBe(0);
    const up = counter({ from: 0, to: 10, step: 2.5, count: { duration: 1, ease: 'linear' } });
    expect(counterValue(up, 0.24, e)).toBe(0);
    expect(counterValue(up, 0.5, e)).toBe(5);
    expect(counterValue(up, 0.74, e)).toBe(5);
    expect(counterValue(up, 1, e)).toBe(10);
    // without step: continuous (unchanged behaviour)
    expect(counterValue(counter({ from: 0, to: 10, count: { duration: 1, ease: 'linear' } }), 0.25, e)).toBe(2.5);
  });

  it('validates step', () => {
    const c = (step: unknown) => [{ ...counter({ from: 3, to: 0, step }) }];
    expectOk(c(1));
    expectError(c(0), '/layers/0/step', /greater than 0/);
    expectError(c('1'), '/layers/0/step', /must be a number/);
    expectError([counter({ from: { param: 'headline' }, to: 0 })], '/layers/0/from/param', /text param; from needs a number param/);
  });
});

// ------------------------------------------------------------------ 5. group-relative timing

describe('group timing', () => {
  it('validates', () => {
    const g = (timing: unknown) => [{ id: 'g', type: 'group', start: 1, timing, layers: [rect()] }];
    expectOk(g('relative'));
    expectOk(g('absolute'));
    expectError(g('local'), '/layers/0/timing', /unknown group timing 'local'; expected one of absolute, relative/);
    expectError([rect({ timing: 'relative' })], '/layers/0/timing', /unknown property 'timing' on a rect layer/);
  });

  it('offsets numeric child times by the group start; "end" stays the scene end', () => {
    const child = { id: 'c', type: 'rect', start: 0.5, end: 1, width: 1, height: 1, fill: '#FFFFFF' } as Layer;
    expect(layerWindow(child, 4)).toEqual([0.5, 1]);
    expect(layerWindow(child, 4, { relative: true, origin: 2 })).toEqual([2.5, 3]);
    const open = { id: 'o', type: 'rect', end: 'end-0.5', width: 1, height: 1, fill: '#FFFFFF' } as Layer;
    expect(layerWindow(open, 4, { relative: true, origin: 2 })).toEqual([2, 3.5]);
    expect(layerWindow(open, 4)).toEqual([0, 3.5]);
  });

  it('renders children relative to the group start, inherited by nested groups unless overridden', () => {
    const box = (id: string, x: string, extra: Record<string, unknown> = {}) =>
      rect({ id, x, y: '50px', width: '10px', height: '10px', start: 0.5, end: 1, ...extra });
    const t = templateFromScene(
      scene([
        {
          id: 'rel',
          type: 'group',
          start: 2,
          timing: 'relative',
          layers: [
            box('a', '20px'),
            { id: 'inner', type: 'group', start: 0.2, layers: [box('b', '60px', { start: 0.5, end: 1 })] },
            { id: 'abs', type: 'group', timing: 'absolute', layers: [box('c', '100px', { start: 2.5, end: 3 })] },
          ],
        },
        { id: 'plain', type: 'group', start: 2, layers: [box('d', '140px')] },
      ]),
    );
    const on = (px: Uint8ClampedArray, x: number) => (pixel(px, 200, x, 50)[3] as number) > 0;
    // a: 2 + 0.5 .. 2 + 1; b: (2 + 0.2) + 0.5 .. 2.2 + 1; c: absolute 2.5 .. 3; d: absolute 0.5 .. 1 (but group starts at 2 → never)
    const f = (s: number) => render(t, Math.round(s * 10));
    expect(on(f(2.4), 20)).toBe(false);
    expect(on(f(2.6), 20)).toBe(true);
    expect(on(f(3.1), 20)).toBe(false);
    expect(on(f(2.6), 60)).toBe(false);
    expect(on(f(2.8), 60)).toBe(true);
    expect(on(f(3.2), 60)).toBe(true);
    expect(on(f(2.6), 100)).toBe(true);
    for (const s of [0.6, 2.6]) expect(on(f(s), 140)).toBe(false);
  });

  it('keyframe times stay relative to the child start', () => {
    const t = templateFromScene(
      scene([
        {
          id: 'g',
          type: 'group',
          start: 1,
          timing: 'relative',
          layers: [rect({ x: '50px', y: '50px', width: '10px', height: '10px', start: 1, keyframes: { x: [{ t: 0, v: '50px' }, { t: 1, v: '150px' }] } })],
        },
      ]),
    );
    const cx = (px: Uint8ClampedArray) => {
      const b = bbox(px, 200);
      return (b.x0 + b.x1) / 2;
    };
    expect(cx(render(t, 20))).toBeCloseTo(49.5, 0);
    expect(cx(render(t, 25))).toBeCloseTo(99.5, 0);
    expect(cx(render(t, 30))).toBeCloseTo(149.5, 0);
  });
});

// ------------------------------------------------------------------ 6. pop pivot (text vs rect)

describe('pop: text and shapes share the pivot', () => {
  const size = { width: 400, height: 200 };
  const pop = { preset: 'pop', duration: 1 };
  const shapes = (anchor: [number, number]) => [
    rect({ id: 'plate', x: '150px', y: '100px', anchor, width: '120px', height: '40px', enter: pop }),
  ];
  const text = (anchor: [number, number], extra: Record<string, unknown> = {}) => [
    {
      id: 'word',
      type: 'text',
      text: 'WORDMARK',
      font: { family: 'Inter Variable', weight: 700, size: '24px' },
      color: '#FFFFFF',
      background: { fill: '#FFFFFF', padding: '0px' },
      x: '150px',
      y: '100px',
      anchor,
      enter: pop,
      ...extra,
    },
  ];

  for (const anchor of [
    [0, 0.5],
    [1, 0],
    [0.5, 0.5],
  ] as [number, number][]) {
    it(`anchor ${JSON.stringify(anchor)}: the anchor point stays fixed through the overshoot for both`, () => {
      const r = templateFromScene(scene(shapes(anchor), size));
      const t = templateFromScene(scene(text(anchor), size));
      const overshoot = 4; // 0.4 s into a 1 s outBack: scale > 1
      for (const tpl of [r, t]) {
        const rest = bbox(render(tpl, 20), 400);
        const mid = bbox(render(tpl, overshoot), 400);
        // grew…
        expect(mid.x1 - mid.x0).toBeGreaterThan(rest.x1 - rest.x0);
        // …around the anchor: the anchored edge does not move
        if (anchor[0] === 0) expect(mid.x0).toBe(rest.x0);
        if (anchor[0] === 1) expect(mid.x1).toBe(rest.x1);
        if (anchor[1] === 0) expect(mid.y0).toBe(rest.y0);
        if (anchor[0] === 0.5) expect(Math.abs(mid.x0 + mid.x1 - (rest.x0 + rest.x1))).toBeLessThanOrEqual(1);
      }
    });
  }

  it('a wordmark inside a plate with the same pop stays inside it (left-anchored)', () => {
    const t = templateFromScene(
      scene(
        [
          rect({ id: 'plate', x: '150px', y: '100px', anchor: [0, 0.5], width: '200px', height: '60px', fill: '#FF0000', enter: pop }),
          { ...text([0, 0.5])[0], x: '152px', background: undefined, color: '#00FF00' },
        ].map((l) => JSON.parse(JSON.stringify(l))),
        size,
      ),
    );
    for (const f of [3, 4, 5, 6, 7, 8]) {
      const px = render(t, f);
      let greenOutside = 0;
      for (let i = 0; i < px.length / 4; i++) {
        const [r, g, , a] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]] as number[];
        if ((a as number) > 0 && (g as number) > 128 && (r as number) < 64) {
          const x = i % 400;
          if (x < 150) greenOutside++;
        }
      }
      expect(greenOutside, `frame ${f}`).toBe(0);
    }
  });

  it('staggered units still pop around their own centres (documented per-unit behaviour)', () => {
    const word = text([0, 0.5], { text: 'WORD', x: '100px', font: { family: 'Inter Variable', weight: 700, size: '48px' } });
    const t = templateFromScene(scene([{ ...word[0], background: undefined, enter: { ...pop, stagger: { by: 'char', each: 0.05 } } }].map((l) => JSON.parse(JSON.stringify(l))), size));
    const rest = bbox(render(t, 20), 400);
    const mid = bbox(render(t, 6), 400);
    expect(mid.x0).toBeLessThan(rest.x0); // the first glyph grows around its own centre
  });
});
