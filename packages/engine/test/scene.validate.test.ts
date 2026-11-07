import { describe, expect, it } from 'vitest';
import { createRng, validateScene, SCENE_CATEGORIES } from '../src';
import type { SceneError } from '../src';
import { BUNDLED_SCENES } from '../src/scenes';

/** A small valid scene; tests clone and break it. */
function base(): Record<string, any> {
  return {
    format: 'mg-scene@1',
    id: 'test_scene',
    name: 'Test',
    description: 'A test scene.',
    category: 'promo',
    defaultSettings: { width: 1080, height: 1080, fps: 30, durationFrames: 90, transparent: false },
    fonts: ['Inter Variable'],
    params: [
      { key: 'headline', label: 'Headline', type: 'text', default: 'Hello', maxLength: 40 },
      { key: 'accent', label: 'Accent', type: 'color', default: '#FF0000' },
      { key: 'amount', label: 'Amount', type: 'number', default: 5, min: 0, max: 100 },
      { key: 'logo', label: 'Logo', type: 'image', default: null },
      { key: 'show', label: 'Show', type: 'boolean', default: true },
      { key: 'mode', label: 'Mode', type: 'select', default: 'a', options: [{ value: 'a', label: 'A' }] },
    ],
    background: '#000000',
    layers: [
      {
        id: 'title',
        type: 'text',
        text: '{{headline|upper}}',
        font: { family: 'Inter Variable', weight: 700, size: 8 },
        color: { param: 'accent' },
        x: '50%w',
        y: '50%h',
        enter: { preset: 'rise', stagger: { by: 'word', each: 0.05 } },
      },
      { id: 'box', type: 'rect', width: 10, height: '5vmin', fill: '#FFFFFF', x: { param: 'amount' } },
      { id: 'logoImg', type: 'image', src: { param: 'logo' }, width: 10, height: 10 },
      {
        id: 'grp',
        type: 'group',
        visibleIf: { param: 'show' },
        layers: [{ id: 'dot', type: 'ellipse', width: 2, height: 2, fill: '#FFFFFF' }],
      },
    ],
  };
}

function errorsOf(scene: unknown): SceneError[] {
  const r = validateScene(scene);
  return r.ok ? [] : r.errors;
}

function expectError(scene: unknown, path: string, message: RegExp): void {
  const errs = errorsOf(scene);
  const hit = errs.find((e) => e.path === path && message.test(e.message));
  expect(hit, `expected ${path} ~ ${message}; got ${JSON.stringify(errs, null, 1)}`).toBeTruthy();
}

describe('validateScene: valid documents', () => {
  it('accepts the base fixture', () => {
    expect(errorsOf(base())).toEqual([]);
  });

  for (const s of BUNDLED_SCENES) {
    it(`accepts bundled ${s.file}`, () => {
      const r = validateScene(s.json);
      expect(r.ok ? [] : r.errors).toEqual([]);
      if (r.ok) expect(SCENE_CATEGORIES).toContain(r.scene.category);
    });
  }

  it('returns a deep copy, not the input object', () => {
    const input = base();
    const r = validateScene(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scene).toEqual(input);
      expect(r.scene).not.toBe(input);
    }
  });
});

describe('validateScene: targeted errors (path + message)', () => {
  const cases: [string, (s: Record<string, any>) => void, string, RegExp][] = [
    ['wrong format', (s) => (s.format = 'mg-scene@2'), '/format', /expected 'mg-scene@1'/],
    ['bad id', (s) => (s.id = 'Bad-Id'), '/id', /must match/],
    ['unknown category', (s) => (s.category = 'sports'), '/category', /unknown category 'sports'; expected one of social, promo/],
    ['odd width', (s) => (s.defaultSettings.width = 1081), '/defaultSettings/width', /must be even/],
    ['bad fps', (s) => (s.defaultSettings.fps = 45), '/defaultSettings/fps', /one of 24, 25, 30, 50, 60/],
    ['duration too long', (s) => (s.defaultSettings.durationFrames = 30 * 61), '/defaultSettings/durationFrames', /between 1 and 1800/],
    ['font not bundled', (s) => (s.fonts = ['Comic Sans']), '/fonts/0', /not bundled; available: Inter Variable, Montserrat Variable, Anton/],
    ['font used but not listed', (s) => (s.layers[0].font.family = 'Anton'), '/layers/0/font/family', /not listed in \/fonts/],
    ['Anton bold', (s) => { s.fonts.push('Anton'); s.layers[0].font.family = 'Anton'; }, '/layers/0/font/weight', /only ships weight 400/],
    ['duplicate layer id', (s) => (s.layers[1].id = 'title'), '/layers/1/id', /duplicate layer id 'title'/],
    ['duplicate nested id', (s) => (s.layers[3].layers[0].id = 'box'), '/layers/3/layers/0/id', /duplicate layer id 'box'/],
    ['unknown layer type', (s) => (s.layers[1].type = 'star'), '/layers/1/type', /unknown layer type 'star'; expected one of text, rect/],
    ['unknown preset', (s) => (s.layers[0].enter.preset = 'zoom'), '/layers/0/enter/preset', /unknown preset 'zoom'; expected one of fade, rise, drop/],
    ['blur-in not available', (s) => (s.layers[0].enter.preset = 'blur-in'), '/layers/0/enter/preset', /'blur-in' is not available/],
    ['typewriter on rect', (s) => (s.layers[1].enter = { preset: 'typewriter' }), '/layers/1/enter/preset', /only works on text and counter/],
    ['wipe on group', (s) => (s.layers[3].enter = { preset: 'wipe-right' }), '/layers/3/enter/preset', /not available on groups/],
    ['stagger on rect', (s) => (s.layers[1].enter = { preset: 'fade', stagger: { by: 'char', each: 0.1 } }), '/layers/1/enter/stagger', /only works on text and counter/],
    ['bad stagger unit', (s) => (s.layers[0].enter.stagger.by = 'letter'), '/layers/0/enter/stagger/by', /expected one of char, word, line/],
    ['bad length unit', (s) => (s.layers[0].x = '50%'), '/layers/0/x', /invalid length '50%'/],
    ['length as boolean', (s) => (s.layers[1].width = true), '/layers/1/width', /must be a length/],
    ['bad color', (s) => (s.layers[1].fill = 'red'), '/layers/1/fill', /invalid color 'red' for fill; expected "#RRGGBB"/],
    ['bad hex', (s) => (s.layers[1].fill = '#FFF'), '/layers/1/fill', /invalid color '#FFF'/],
    ['unknown param binding', (s) => (s.layers[0].color = { param: 'nope' }), '/layers/0/color/param', /unknown param 'nope'; declared params: headline, accent/],
    ['incompatible binding', (s) => (s.layers[0].color = { param: 'amount' }), '/layers/0/color/param', /'amount' is a number param; text color needs a color param/],
    ['length bound to text', (s) => (s.layers[1].x = { param: 'headline' }), '/layers/1/x/param', /needs a number param/],
    ['unknown interpolation', (s) => (s.layers[0].text = 'Hi {{name}}'), '/layers/0/text', /unknown param 'name'/],
    ['bad filter', (s) => (s.layers[0].text = '{{headline|title}}'), '/layers/0/text', /unknown filter 'title'.*upper, lower/],
    ['interpolating a color', (s) => (s.layers[0].text = '{{accent}}'), '/layers/0/text', /text can only interpolate text, select or number/],
    ['unclosed interpolation', (s) => (s.layers[0].text = '{{headline'), '/layers/0/text', /unclosed or malformed/],
    ['image src not image param', (s) => (s.layers[2].src = { param: 'headline' }), '/layers/2/src/param', /image src needs a image param/],
    ['image src literal', (s) => (s.layers[2].src = 'https://x/y.png'), '/layers/2/src', /must bind an image param/],
    ['visibleIf on text', (s) => (s.layers[3].visibleIf = { param: 'headline' }), '/layers/3/visibleIf/param', /needs a boolean or image param/],
    ['unknown property', (s) => (s.layers[1].colour = '#FFFFFF'), '/layers/1/colour', /unknown property 'colour'.*allowed: id, type/],
    ['shape draws nothing', (s) => delete s.layers[1].fill, '/layers/1', /draws nothing/],
    ['missing required', (s) => delete s.layers[1].height, '/layers/1/height', /missing required property 'height'/],
    ['not animatable', (s) => (s.layers[1].keyframes = { progress: [{ t: 0, v: 0 }] }), '/layers/1/keyframes/progress', /not animatable on rect layers/],
    ['keyframes out of order', (s) => (s.layers[1].keyframes = { x: [{ t: 1, v: 0 }, { t: 0.5, v: 10 }] }), '/layers/1/keyframes/x/1/t', /must increase/],
    ['too many keyframes', (s) => (s.layers[1].keyframes = { opacity: Array.from({ length: 33 }, (_, i) => ({ t: i, v: 1 })) }), '/layers/1/keyframes/opacity', /max 32/],
    ['unknown ease', (s) => (s.layers[0].enter.ease = 'bounce'), '/layers/0/enter/ease', /unknown ease 'bounce'; expected one of linear, inQuad/],
    ['bezier x out of range', (s) => (s.layers[0].enter.ease = { cubicBezier: [1.5, 0, 0.5, 1] }), '/layers/0/enter/ease/cubicBezier/0', /between 0 and 1/],
    ['bad time ref', (s) => (s.layers[1].end = 'finish'), '/layers/1/end', /"end" or "end-<seconds>"/],
    ['end before start', (s) => { s.layers[1].start = 2; s.layers[1].end = 1; }, '/layers/1/end', /must be after start/],
    ['opacity range', (s) => (s.layers[1].opacity = 1.5), '/layers/1/opacity', /between 0 and 1/],
    ['polygon sides', (s) => s.layers.push({ id: 'poly', type: 'polygon', sides: 13, radius: 5, fill: '#FFFFFF' }), '/layers/4/sides', /between 3 and 12/],
    ['autoFit without maxWidth', (s) => (s.layers[0].autoFit = { minSize: 3 }), '/layers/0/autoFit', /needs maxWidth/],
    ['param default out of range', (s) => (s.params[2].default = 500), '/params/2/default', /between 0 and 100/],
    ['duplicate param key', (s) => (s.params[1].key = 'headline'), '/params/1/key', /duplicate param key 'headline'/],
    ['select default not an option', (s) => (s.params[5].default = 'z'), '/params/5/default', /one of the option values \(a\)/],
    ['gradient stops decrease', (s) => (s.layers[1].fill = { linear: { angle: 90, stops: [[0.8, '#000000'], [0.2, '#FFFFFF']] } }), '/layers/1/fill/linear/stops/1/0', /must not decrease/],
    ['empty layers', (s) => (s.layers = []), '/layers', /at least one layer/],
  ];
  for (const [name, mutate, path, message] of cases) {
    it(name, () => {
      const s = base();
      mutate(s);
      expectError(s, path, message);
    });
  }

  it(`covers at least 20 distinct cases (has ${cases.length})`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it('enforces the nesting depth limit', () => {
    const s = base();
    let leaf: any = { id: 'leaf', type: 'rect', width: 1, height: 1, fill: '#FFFFFF' };
    for (let d = 5; d >= 1; d--) leaf = { id: `g${d}`, type: 'group', layers: [leaf] };
    s.layers = [leaf];
    expectError(s, '/layers/0/layers/0/layers/0/layers/0/layers', /max nesting depth is 4/);
  });

  it('enforces the total layer limit', () => {
    const s = base();
    s.layers = Array.from({ length: 65 }, (_, i) => ({ id: `r${i}`, type: 'rect', width: 1, height: 1, fill: '#FFFFFF' }));
    expectError(s, '/layers', /65 layers.*max 64/);
  });

  it('enforces the 64 KB size limit', () => {
    const s = base();
    s.description = 'x'.repeat(70_000);
    expectError(s, '', /bytes; max 65536/);
  });

  it('escapes JSON pointer segments', () => {
    const s = base();
    s.layers[1]['a/b~c'] = 1;
    expectError(s, '/layers/1/a~1b~0c', /unknown property/);
  });

  it('reports many errors at once', () => {
    const s = base();
    s.category = 'x';
    s.layers[0].enter.preset = 'zoom';
    s.layers[1].fill = 'red';
    expect(errorsOf(s).length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateScene: garbage never throws', () => {
  const garbage: unknown[] = [
    undefined,
    null,
    0,
    NaN,
    'scene',
    [],
    [1, 2],
    {},
    { format: 'mg-scene@1' },
    { format: 'mg-scene@1', layers: 'nope', params: {}, fonts: 'Inter' },
    { format: 'mg-scene@1', layers: [null, 1, 'x', [], { type: 'group', layers: [null] }] },
    { format: 'mg-scene@1', params: [null, { type: 'select', options: [null, 1] }], layers: [{ type: 'text', font: null }] },
    Object.create(null),
    { __proto__: { evil: true } },
    JSON.parse('{"__proto__": {"x": 1}, "layers": [{"__proto__": 1}]}'),
    { layers: [{ id: 'a', type: 'text', text: 1, keyframes: { x: 'no' }, ambient: {}, enter: [], color: { mix: 'x' } }] },
    { defaultSettings: { width: Infinity, height: -1, fps: '30' } },
    { background: { linear: null }, layers: [{ id: 'r', type: 'rect', fill: { radial: { stops: [[]] } } }] },
  ];
  const cyclic: Record<string, unknown> = { format: 'mg-scene@1' };
  cyclic.self = cyclic;
  garbage.push(cyclic);
  garbage.push({ big: 10n });

  garbage.forEach((g, i) => {
    it(`garbage #${i} → ok:false with errors`, () => {
      let r: ReturnType<typeof validateScene> | undefined;
      expect(() => (r = validateScene(g))).not.toThrow();
      expect(r?.ok).toBe(false);
      if (r && !r.ok) {
        expect(r.errors.length).toBeGreaterThan(0);
        for (const e of r.errors) {
          expect(typeof e.path).toBe('string');
          expect(e.message.length).toBeGreaterThan(5);
        }
      }
    });
  });

  it('random mutations of valid scenes never throw', () => {
    const rng = createRng('scene-fuzz');
    const junk = [null, -1, 1e9, 'x', '', [], {}, true, { param: 'nope' }, '12px', 'end', [0, 1]];
    const sources = [base(), ...BUNDLED_SCENES.map((s) => s.json)];
    for (let n = 0; n < 400; n++) {
      const doc = JSON.parse(JSON.stringify(sources[n % sources.length]));
      // walk to a random node and replace a random key
      for (let m = 0; m < 3; m++) {
        let node: any = doc;
        for (let depth = 0; depth < 6; depth++) {
          const keys = node && typeof node === 'object' ? Object.keys(node) : [];
          if (!keys.length) break;
          const k = keys[Math.floor(rng() * keys.length)] as string;
          if (rng() < 0.35 || typeof node[k] !== 'object' || node[k] === null) {
            node[k] = junk[Math.floor(rng() * junk.length)];
            break;
          }
          node = node[k];
        }
      }
      expect(() => validateScene(doc)).not.toThrow();
    }
  });
});
