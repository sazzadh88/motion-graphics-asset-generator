import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { defaultValues, getTemplate, loadSceneTemplates, templateFromScene, validateScene } from '../src';
import type { AssetValues, Ctx2D, LoadedAssets, Scene, TemplateDefinition } from '../src';
import {
  clearSceneLayoutCache,
  counterValue,
  enterTau,
  exitTau,
  formatCounter,
  IDENTITY,
  interpolateText,
  motionSpan,
  presetEffect,
  resolveColor,
  resolveLength,
  resolveNumber,
  resolveTime,
  sampleKeyframes,
  staggerEach,
} from '../src/scene';
import type { CounterLayer, Keyframe, Motion, PresetName } from '../src/scene';
import { BUNDLED_SCENES } from '../src/scenes';

// ------------------------------------------------------------------ helpers

function scene(layers: unknown[], extra: Record<string, unknown> = {}): Scene {
  const doc = {
    format: 'mg-scene@1',
    id: 'unit_scene',
    name: 'Unit',
    description: '',
    category: 'promo',
    defaultSettings: { width: 200, height: 100, fps: 25, durationFrames: 101, transparent: true },
    fonts: ['Inter Variable'],
    params: [
      { key: 'headline', label: 'Headline', type: 'text', default: 'Hello World' },
      { key: 'accent', label: 'Accent', type: 'color', default: '#336699' },
      { key: 'amount', label: 'Amount', type: 'number', default: 25, min: -100, max: 100 },
      { key: 'show', label: 'Show', type: 'boolean', default: true },
      { key: 'logo', label: 'Logo', type: 'image', default: null },
    ],
    background: null,
    layers,
    ...extra,
  };
  const r = validateScene(doc);
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 1));
  // Test clock: 10 fps x 41 frames, so frame n = n / 10 s and "end" = 4 s (fps 10 is not a
  // valid export rate, so it is set after validation; the interpreter accepts any fps).
  r.scene.defaultSettings.fps = 10;
  r.scene.defaultSettings.durationFrames = 41;
  return r.scene;
}

interface Size {
  width: number;
  height: number;
}

function render(
  t: TemplateDefinition,
  frame: number,
  opts: { size?: Size; values?: AssetValues; transparent?: boolean; loaded?: LoadedAssets } = {},
): Uint8ClampedArray {
  const { width, height } = opts.size ?? t.defaultSettings;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  const s = t.defaultSettings;
  t.render(
    {
      ctx: ctx as unknown as Ctx2D,
      frame,
      fps: s.fps,
      time: frame / s.fps,
      durationFrames: s.durationFrames,
      progress: frame / (s.durationFrames - 1),
      width,
      height,
      transparent: opts.transparent ?? s.transparent,
    },
    opts.values ?? defaultValues(t),
    opts.loaded ?? { images: {} },
  );
  return new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data);
}

const alphaSum = (px: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 3; i < px.length; i += 4) s += px[i] as number;
  return s;
};

/** Alpha-weighted centroid of drawn pixels. */
function centroid(px: Uint8ClampedArray, w: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let sa = 0;
  for (let i = 0; i < px.length / 4; i++) {
    const a = px[i * 4 + 3] as number;
    sx += (i % w) * a;
    sy += Math.floor(i / w) * a;
    sa += a;
  }
  return { x: sx / sa, y: sy / sa };
}

function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const env = { w: 1920, h: 1080 };

// ------------------------------------------------------------------ values

describe('lengths', () => {
  it('resolves every unit against the frame size', () => {
    expect(resolveLength(10, env)).toBeCloseTo(108); // % of vmin
    expect(resolveLength('50%w', env)).toBe(960);
    expect(resolveLength('40%h', env)).toBe(432);
    expect(resolveLength('12vmin', env)).toBeCloseTo(129.6);
    expect(resolveLength('24px', env)).toBe(24);
    expect(resolveLength('-5%w', env)).toBe(-96);
    expect(resolveLength('.5px', env)).toBe(0.5);
  });

  it('is responsive across aspect ratios', () => {
    for (const [w, h] of [
      [1080, 1920],
      [1080, 1080],
      [1920, 1080],
      [1500, 500],
    ] as const) {
      const e = { w, h };
      expect(resolveLength(10, e)).toBeCloseTo(Math.min(w, h) * 0.1);
      expect(resolveLength('10vmin', e)).toBeCloseTo(Math.min(w, h) * 0.1);
      expect(resolveLength('25%w', e)).toBeCloseTo(w / 4);
      expect(resolveLength('25%h', e)).toBeCloseTo(h / 4);
      expect(resolveLength('7px', e)).toBe(7);
    }
  });

  it('resolves against a box when given one (fills)', () => {
    expect(resolveLength('50%w', env, 0, { w: 200, h: 100 })).toBe(100);
    expect(resolveLength(50, env, 0, { w: 200, h: 100 })).toBe(50);
  });

  it('binds number params as percent of vmin', () => {
    const params = new Map([['amount', { key: 'amount', label: 'A', type: 'number' as const, default: 10, min: 0, max: 100 }]]);
    expect(resolveLength({ param: 'amount' }, { ...env, params, values: { amount: 20 } })).toBeCloseTo(216);
    expect(resolveLength({ param: 'amount' }, { ...env, params, values: {} })).toBeCloseTo(108); // falls back to default
  });
});

describe('time references', () => {
  it('handles numbers, "end" and "end-x"', () => {
    expect(resolveTime(1.5, 6, 0)).toBe(1.5);
    expect(resolveTime('end', 6, 0)).toBe(6);
    expect(resolveTime('end-0.5', 6, 0)).toBe(5.5);
    expect(resolveTime(undefined, 6, 2)).toBe(2);
  });
});

describe('bindings and interpolation', () => {
  const params = new Map<string, any>([
    ['headline', { key: 'headline', type: 'text', default: 'Hello' }],
    ['mode', { key: 'mode', type: 'select', default: 'Big' }],
    ['count', { key: 'count', type: 'number', default: 3 }],
    ['accent', { key: 'accent', type: 'color', default: '#FF0000' }],
  ]);
  const e = { ...env, params, values: { headline: 'Summer Sale', count: 12 } };

  it('interpolates with upper/lower filters and defaults', () => {
    expect(interpolateText('{{headline}}!', e)).toBe('Summer Sale!');
    expect(interpolateText('{{ headline | upper }}', e)).toBe('SUMMER SALE');
    expect(interpolateText('{{headline|lower}} / {{mode}} / {{count}}', e)).toBe('summer sale / Big / 12');
    expect(interpolateText('no params', e)).toBe('no params');
  });

  it('resolves colors, alpha and mixes', () => {
    expect(resolveColor('#00FF0080', e)).toBe('rgba(0,255,0,0.502)');
    expect(resolveColor({ param: 'accent' }, e)).toBe('rgba(255,0,0,1)');
    expect(resolveColor({ param: 'accent', alpha: 0.25 }, e)).toBe('rgba(255,0,0,0.25)');
    expect(resolveColor({ mix: [{ param: 'accent' }, '#0000FF'], t: 0.5 }, e)).toBe('rgba(128,0,128,1)');
  });

  it('resolves bound numbers', () => {
    expect(resolveNumber({ param: 'count' }, e, 0)).toBe(12);
    expect(resolveNumber(4, e, 0)).toBe(4);
    expect(resolveNumber(undefined, e, 7)).toBe(7);
  });
});

describe('keyframes', () => {
  const num = (v: Keyframe['v']) => v as number;
  const kfs: Keyframe[] = [
    { t: 1, v: 10 },
    { t: 2, v: 20 },
    { t: 4, v: 0, ease: 'inQuad' },
  ];

  it('holds the first value before and the last value after', () => {
    expect(sampleKeyframes(kfs, 0, num)).toBe(10);
    expect(sampleKeyframes(kfs, 1, num)).toBe(10);
    expect(sampleKeyframes(kfs, 4, num)).toBe(0);
    expect(sampleKeyframes(kfs, 99, num)).toBe(0);
  });

  it('hits keyframe values exactly and interpolates linearly by default', () => {
    expect(sampleKeyframes(kfs, 2, num)).toBe(20);
    expect(sampleKeyframes(kfs, 1.5, num)).toBe(15);
  });

  it("uses the destination keyframe's ease", () => {
    // segment 2 -> 4 eases inQuad: at the midpoint u = 0.5, eased 0.25 -> 20 + (0 - 20) * 0.25
    expect(sampleKeyframes(kfs, 3, num)).toBeCloseTo(15);
  });

  it('supports a single keyframe and cubic-bezier eases', () => {
    expect(sampleKeyframes([{ t: 0.5, v: 3 }], 10, num)).toBe(3);
    const lin = sampleKeyframes([{ t: 0, v: 0 }, { t: 1, v: 1, ease: { cubicBezier: [0, 0, 1, 1] } }], 0.3, num);
    expect(lin).toBeCloseTo(0.3, 3);
  });

  it('drives layer props when rendered (x keyframes move the box)', () => {
    const t = templateFromScene(
      scene([
        {
          id: 'box',
          type: 'rect',
          width: '10px',
          height: '10px',
          y: '50px',
          fill: '#FFFFFF',
          keyframes: { x: [{ t: 0, v: '20px' }, { t: 2, v: '180px' }] },
        },
      ]),
    );
    expect(centroid(render(t, 0), 200).x).toBeCloseTo(19.5, 0);
    expect(centroid(render(t, 10), 200).x).toBeCloseTo(99.5, 0);
    expect(centroid(render(t, 30), 200).x).toBeCloseTo(179.5, 0);
  });
});

// ------------------------------------------------------------------ presets

const PRESET_LIST: PresetName[] = [
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
];

describe('preset states', () => {
  const vmin = { w: 1000, h: 500 };

  it('every preset is at rest after its duration', () => {
    for (const preset of PRESET_LIST) {
      const m: Motion = { preset, duration: 0.5 };
      expect(presetEffect(m, 0.5, vmin), preset).toEqual(preset === 'typewriter' ? { ...IDENTITY } : IDENTITY);
      expect(presetEffect(m, 5, vmin).alpha, preset).toBe(1);
    }
  });

  it('start states', () => {
    const at0 = (preset: PresetName, extra: Partial<Motion> = {}) => presetEffect({ preset, duration: 0.5, ...extra }, 0, vmin);
    expect(at0('fade').alpha).toBe(0);
    expect(at0('rise')).toMatchObject({ dy: 30, alpha: 0 }); // default distance 6 = 6% of 500
    expect(at0('drop')).toMatchObject({ dy: -30, alpha: 0 });
    expect(at0('slide-left')).toMatchObject({ dx: 50, alpha: 0 }); // default 10
    expect(at0('slide-right')).toMatchObject({ dx: -50, alpha: 0 });
    expect(at0('rise', { distance: '12px' }).dy).toBe(12);
    expect(at0('pop')).toMatchObject({ scale: 0, alpha: 0 });
    expect(at0('scale-in')).toMatchObject({ scale: 0.6, alpha: 0 });
    expect(at0('mask-up')).toMatchObject({ clip: 'mask', p: 0, alpha: 1 });
    expect(at0('wipe-right')).toMatchObject({ clip: 'wipe-right', p: 0 });
    expect(at0('wipe-left')).toMatchObject({ clip: 'wipe-left', p: 0 });
    expect(at0('typewriter').alpha).toBe(0);
  });

  it('pop overshoots (scale > 1 mid-way) by default', () => {
    const mid = [0.5, 0.6, 0.7, 0.8].map((tau) => presetEffect({ preset: 'pop', duration: 1 }, tau, vmin).scale);
    expect(Math.max(...mid)).toBeGreaterThan(1);
  });

  it('typewriter is a step, no movement', () => {
    const e = presetEffect({ preset: 'typewriter', duration: 1 }, 0.01, vmin);
    expect(e).toMatchObject({ alpha: 1, dx: 0, dy: 0, scale: 1 });
  });

  it('exit mirrors enter: tau counts down to the end', () => {
    const m: Motion = { preset: 'rise', duration: 1 };
    for (const tau of [0, 0.25, 0.5, 1]) {
      // exit at "untilEnd = tau" equals enter at "lt = tau"
      expect(presetEffect(m, exitTau(m, tau, 0, 0), vmin)).toEqual(presetEffect(m, enterTau(m, tau, 0, 0), vmin));
    }
  });

  const rectScene = (enter?: Motion, exit?: Motion) =>
    templateFromScene(
      scene([
        {
          id: 'box',
          type: 'rect',
          x: '100px',
          y: '50px',
          width: '40px',
          height: '20px',
          fill: '#FFFFFF',
          start: 1,
          ...(enter ? { enter } : {}),
          ...(exit ? { exit } : {}),
        },
      ]),
    );

  for (const preset of PRESET_LIST.filter((p) => p !== 'typewriter')) {
    it(`${preset}: invisible at start, identical to no-preset at rest, gone on the last frame`, () => {
      const plain = rectScene();
      const t = rectScene({ preset, duration: 0.5 }, { preset, duration: 0.5 });
      // frame 10 = t 1.0 = layer start
      expect(alphaSum(render(t, 10))).toBe(0);
      // frame 20 = t 2.0: enter done, exit (ends at t 4.0) not started
      expect(same(render(t, 20), render(plain, 20))).toBe(true);
      // last frame (t 4.0 = "end"): exit finished
      expect(alphaSum(render(t, 40))).toBe(0);
      // mid-enter: partially visible
      const mid = alphaSum(render(t, 12));
      expect(mid).toBeGreaterThan(0);
    });
  }

  it('move presets move in the documented direction', () => {
    const cx = (preset: PresetName) => centroid(render(rectScene({ preset, duration: 1, ease: 'linear', distance: '40px' }), 15), 200);
    const rest = centroid(render(rectScene(), 15), 200);
    expect(cx('rise').y).toBeGreaterThan(rest.y + 5);
    expect(cx('drop').y).toBeLessThan(rest.y - 5);
    expect(cx('slide-left').x).toBeGreaterThan(rest.x + 5);
    expect(cx('slide-right').x).toBeLessThan(rest.x - 5);
  });

  it('wipe-right reveals from the left, wipe-left from the right', () => {
    const rest = centroid(render(rectScene(), 15), 200);
    const r = centroid(render(rectScene({ preset: 'wipe-right', duration: 1, ease: 'linear' }), 15), 200);
    const l = centroid(render(rectScene({ preset: 'wipe-left', duration: 1, ease: 'linear' }), 15), 200);
    expect(r.x).toBeLessThan(rest.x - 5);
    expect(l.x).toBeGreaterThan(rest.x + 5);
  });
});

describe('stagger', () => {
  it('offsets each unit by index * each; total = duration + (n-1) * each', () => {
    const m: Motion = { preset: 'fade', duration: 0.4, delay: 0.2, stagger: { by: 'word', each: 0.1 } };
    expect(staggerEach(m, 5)).toBe(0.1);
    expect(motionSpan(m, 5)).toBeCloseTo(0.8);
    expect(enterTau(m, 0.5, 0, 0.1)).toBeCloseTo(0.3);
    expect(enterTau(m, 0.5, 3, 0.1)).toBeCloseTo(0);
    const vmin = { w: 100, h: 100 };
    expect(presetEffect(m, enterTau(m, 0.5, 3, 0.1), vmin).alpha).toBe(0); // unit 3 just starting
    expect(presetEffect(m, enterTau(m, 0.61, 0, 0.1), vmin)).toBe(IDENTITY); // unit 0 done
  });

  it('typewriter without stagger spreads chars over the duration', () => {
    expect(staggerEach({ preset: 'typewriter', duration: 1 }, 20)).toBeCloseTo(0.05);
    expect(motionSpan({ preset: 'typewriter', duration: 1 }, 20)).toBeCloseTo(0.95);
  });

  it('renders units in order (by word: left word first)', () => {
    const t = templateFromScene(
      scene([
        {
          id: 'words',
          type: 'text',
          text: 'MMM MMM',
          font: { family: 'Inter Variable', weight: 700, size: '30px' },
          color: '#FFFFFF',
          x: '100px',
          y: '50px',
          enter: { preset: 'fade', duration: 0, stagger: { by: 'word', each: 1 } },
        },
      ]),
    );
    // t = 0.5 s: word 0 visible, word 1 not yet; t = 1.5 s: both
    const half = render(t, 5);
    const full = render(t, 15);
    const c = centroid(half, 200);
    expect(alphaSum(half)).toBeGreaterThan(0);
    expect(alphaSum(full)).toBeGreaterThan(alphaSum(half) * 1.8);
    expect(c.x).toBeLessThan(centroid(full, 200).x - 10);
  });
});

// ------------------------------------------------------------------ counter

describe('counter', () => {
  it('formats with decimals, separators and signs', () => {
    expect(formatCounter(1234567)).toBe('1,234,567');
    expect(formatCounter(1234.5, 1)).toBe('1,234.5');
    expect(formatCounter(999.996, 2)).toBe('1,000.00');
    expect(formatCounter(12345, 0, '')).toBe('12345');
    expect(formatCounter(12345, 0, '.')).toBe('12.345');
    expect(formatCounter(1000000, 0, ' ')).toBe('1 000 000');
    expect(formatCounter(-4200)).toBe('-4,200');
    expect(formatCounter(-0.001, 2)).toBe('0.00');
    expect(formatCounter(0)).toBe('0');
    expect(formatCounter(42.4)).toBe('42');
  });

  it('counts from → to over count.duration after count.delay', () => {
    const layer = {
      id: 'n',
      type: 'counter',
      from: 0,
      to: { param: 'amount' },
      count: { duration: 2, delay: 1, ease: 'linear' },
      font: { family: 'Inter Variable', size: 10 },
      color: '#FFFFFF',
    } as unknown as CounterLayer;
    const params = new Map<string, any>([['amount', { key: 'amount', type: 'number', default: 100 }]]);
    const e = { w: 100, h: 100, params, values: {} };
    expect(counterValue(layer, 0, e)).toBe(0);
    expect(counterValue(layer, 1, e)).toBe(0);
    expect(counterValue(layer, 2, e)).toBe(50);
    expect(counterValue(layer, 3, e)).toBe(100);
    expect(counterValue(layer, 30, e)).toBe(100);
  });

  it('progress keyframes override count', () => {
    const layer = {
      from: 10,
      to: 20,
      keyframes: { progress: [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
    } as unknown as CounterLayer;
    expect(counterValue(layer, 0.5, { w: 1, h: 1 })).toBe(15);
  });

  it('renders prefix/suffix and draws more as the number grows', () => {
    const t = templateFromScene(
      scene([
        {
          id: 'n',
          type: 'counter',
          from: 0,
          to: 1000000,
          prefix: '$',
          suffix: '+',
          count: { duration: 3, ease: 'linear' },
          font: { family: 'Inter Variable', weight: 700, size: '16px' },
          color: '#FFFFFF',
          x: '100px',
          y: '50px',
        },
      ]),
    );
    expect(alphaSum(render(t, 30))).toBeGreaterThan(alphaSum(render(t, 0)) * 2);
  });
});

// ------------------------------------------------------------------ rendering behaviour

describe('rendering', () => {
  const bgScene = () =>
    templateFromScene(
      scene([{ id: 'box', type: 'rect', x: '100px', y: '50px', width: '20px', height: '20px', fill: '#FFFFFF', start: 2 }], {
        background: { linear: { angle: 90, stops: [[0, '#000000'], [1, { param: 'accent' }]] } },
      }),
    );

  it('transparent mode paints no background', () => {
    const t = bgScene();
    expect(alphaSum(render(t, 0, { transparent: true }))).toBe(0);
    const opaque = render(t, 0, { transparent: false });
    expect(alphaSum(opaque)).toBe(200 * 100 * 255);
  });

  it('visibleIf gates on boolean params and image params', () => {
    const t = templateFromScene(
      scene([
        { id: 'a', type: 'rect', width: '20px', height: '20px', x: '50px', y: '50px', fill: '#FFFFFF', visibleIf: { param: 'show' } },
      ]),
    );
    expect(alphaSum(render(t, 0, { values: { show: true } }))).toBeGreaterThan(0);
    expect(alphaSum(render(t, 0, { values: { show: false } }))).toBe(0);
    const u = templateFromScene(
      scene([
        { id: 'a', type: 'rect', width: '20px', height: '20px', x: '50px', y: '50px', fill: '#FFFFFF', visibleIf: { param: 'logo' } },
      ]),
    );
    expect(alphaSum(render(u, 0, { values: { logo: null } }))).toBe(0);
    expect(alphaSum(render(u, 0, { values: { logo: 'data:x' } }))).toBeGreaterThan(0);
  });

  it('groups apply transforms and opacity to children', () => {
    const t = templateFromScene(
      scene([
        {
          id: 'g',
          type: 'group',
          x: '100px',
          y: '50px',
          opacity: 0.5,
          layers: [{ id: 'c', type: 'rect', x: '20px', width: '10px', height: '10px', fill: '#FFFFFF' }],
        },
      ]),
    );
    const px = render(t, 0);
    const c = centroid(px, 200);
    expect(c.x).toBeCloseTo(119.5, 0);
    expect(c.y).toBeCloseTo(49.5, 0);
    let maxA = 0;
    for (let i = 3; i < px.length; i += 4) maxA = Math.max(maxA, px[i] as number);
    expect(maxA).toBeGreaterThan(120);
    expect(maxA).toBeLessThan(135);
  });

  it('draws images with contain/cover and skips them when the param is empty', () => {
    const img = createCanvas(40, 20);
    const g = img.getContext('2d');
    g.fillStyle = '#FF0000';
    g.fillRect(0, 0, 40, 20);
    const loaded: LoadedAssets = { images: { logo: img as unknown as CanvasImageSource } };
    const mk = (fit: 'contain' | 'cover') =>
      templateFromScene(
        scene([{ id: 'i', type: 'image', src: { param: 'logo' }, x: '100px', y: '50px', width: '40px', height: '40px', fit, radius: '4px' }]),
      );
    const contain = alphaSum(render(mk('contain'), 0, { values: { logo: 'data:x' }, loaded })) / 255;
    const cover = alphaSum(render(mk('cover'), 0, { values: { logo: 'data:x' }, loaded })) / 255;
    expect(contain).toBeGreaterThan(700); // ~40 x 20
    expect(contain).toBeLessThan(820);
    expect(cover).toBeGreaterThan(1500); // ~40 x 40 minus rounded corners
    expect(alphaSum(render(mk('cover'), 0, { values: { logo: null }, loaded }))).toBe(0);
  });

  it('shapes with gradient fills, strokes and dashes render deterministically', () => {
    const t = templateFromScene(
      scene([
        {
          id: 'e',
          type: 'ellipse',
          x: '60px',
          y: '50px',
          width: '60px',
          height: '40px',
          fill: { radial: { cx: '50%w', cy: '50%h', r: 50, stops: [[0, '#FFFFFF'], [1, '#FFFFFF00']] } },
          stroke: { color: { param: 'accent' }, width: '3px', dash: ['6px', '4px'] },
        },
        { id: 'star', type: 'polygon', sides: 5, radius: '20px', innerRadius: '8px', x: '150px', y: '50px', fill: '#FFCC00', rotation: 10 },
      ]),
    );
    const a = render(t, 3);
    expect(alphaSum(a)).toBeGreaterThan(0);
    expect(same(a, render(t, 3))).toBe(true);
  });

  it('text: wraps to maxWidth, honours maxLines with autoFit, draws a background', () => {
    const mk = (extra: Record<string, unknown>) =>
      templateFromScene(
        scene([
          {
            id: 't',
            type: 'text',
            text: 'one two three four five six seven',
            font: { family: 'Inter Variable', size: '20px' },
            color: '#FFFFFF',
            x: '100px',
            y: '50px',
            ...extra,
          },
        ]),
      );
    const wide = centroid(render(mk({}), 0), 200);
    expect(Number.isFinite(wide.x)).toBe(true);
    const bg = mk({ background: { fill: '#FF0000', padding: ['6px', '4px'], radius: '50px' }, maxWidth: '120px', maxLines: 2, autoFit: { minSize: '8px' } });
    const px = render(bg, 0);
    expect(alphaSum(px)).toBeGreaterThan(0);
    expect(same(px, render(bg, 0))).toBe(true);
  });
});

// ------------------------------------------------------------------ determinism (bundled scenes)

const SIZES: [number, number][] = [
  [1080, 1920],
  [1080, 1080],
  [1920, 1080],
  [1500, 500],
];

describe('scene determinism', () => {
  for (const src of BUNDLED_SCENES) {
    const id = (src.json as { id: string }).id;
    it(`${id}: identical pixels twice, out of order, all 4 aspect ratios (cache cleared in between)`, () => {
      const t = getTemplate(id) as TemplateDefinition;
      const last = t.defaultSettings.durationFrames - 1;
      const frames = [Math.floor(last * 0.6), 4, last, Math.floor(last * 0.2), 0, Math.floor(last * 0.9)];
      for (const [width, height] of SIZES) {
        const size = { width: width / 4, height: height / 4 };
        const first = frames.map((f) => render(t, f, { size }));
        clearSceneLayoutCache();
        const again = [...frames.keys()].reverse().map((i) => [i, render(t, frames[i] as number, { size })] as const);
        for (const [i, px] of again) expect(same(px, first[i] as Uint8ClampedArray), `${id} ${width}x${height} f${frames[i]}`).toBe(true);
      }
    });

    it(`${id}: transparent mode paints no background; the last frame is empty`, () => {
      const t = getTemplate(id) as TemplateDefinition;
      const size = { width: 270, height: 270 };
      expect(alphaSum(render(t, t.defaultSettings.durationFrames - 1, { size, transparent: true }))).toBe(0);
      expect(alphaSum(render(t, 0, { size, transparent: true }))).toBe(0);
      expect(alphaSum(render(t, 90, { size, transparent: true }))).toBeGreaterThan(0);
    });
  }
});

// ------------------------------------------------------------------ registration

describe('bundled scene registration', () => {
  it('registers bundled scenes with their category', () => {
    expect(getTemplate('lower_third_v1')?.category).toBe('broadcast');
    expect(getTemplate('stat_counter_v1')?.category).toBe('data');
    expect(getTemplate('kinetic_text_v1')?.category).toBe('typography');
  });

  it('an invalid bundled scene fails loudly with its errors', () => {
    const bad = JSON.parse(JSON.stringify(BUNDLED_SCENES[0]?.json)) as Record<string, any>;
    bad.layers[0].enter = { preset: 'zoom' };
    expect(() => loadSceneTemplates([{ file: 'broken.json', json: bad }])).toThrow(
      /broken\.json:\n\s+\/layers\/0\/enter\/preset: unknown preset 'zoom'/,
    );
  });

  it('a scene id that collides with another template fails loudly', () => {
    const dup = JSON.parse(JSON.stringify(BUNDLED_SCENES[0]?.json));
    expect(() => loadSceneTemplates([{ file: 'dup.json', json: dup }], ['lower_third_v1'])).toThrow(/already used/);
  });
});
