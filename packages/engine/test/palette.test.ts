import { describe, expect, it } from 'vitest';
import {
  applyPalette,
  colorRole,
  contrastRatio,
  defaultPayload,
  extractPalette,
  getTemplate,
  listTemplates,
  paletteSignature,
  validatePayload,
} from '../src';
import type { Palette } from '../src';

const HEX = /^#[0-9A-F]{6}$/;

function image(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  return d;
}

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const near = (hex: string, rgb: [number, number, number], tol = 12): boolean =>
  hexRgb(hex).every((v, i) => Math.abs(v - (rgb[i] as number)) <= tol);
const sumW = (p: Palette): number => p.colors.reduce((s, c) => s + c.weight, 0);

describe('extractPalette', () => {
  it('solid image -> one color', () => {
    const p = extractPalette(image(64, 64, () => [30, 120, 200, 255]), 64, 64);
    expect(p.colors).toHaveLength(1);
    expect(near(p.colors[0]!.hex, [30, 120, 200], 2)).toBe(true);
    expect(p.colors[0]!.weight).toBeCloseTo(1, 3);
  });

  it('two-color split keeps both with proportional weights', () => {
    const p = extractPalette(image(100, 100, (x) => (x < 70 ? [240, 240, 235, 255] : [20, 30, 90, 255])), 100, 100);
    expect(p.colors).toHaveLength(2);
    expect(near(p.colors[0]!.hex, [240, 240, 235])).toBe(true);
    expect(p.colors[0]!.weight).toBeCloseTo(0.7, 1);
    expect(near(p.colors[1]!.hex, [20, 30, 90])).toBe(true);
    expect(p.colors[1]!.weight).toBeCloseTo(0.3, 1);
  });

  it('a small vivid patch on a grey photo survives', () => {
    // grey gradient "photo" with a 20x20 red logo (4% of 100x100)
    const img = image(100, 100, (x, y) =>
      x >= 70 && x < 90 && y >= 10 && y < 30 ? [220, 20, 30, 255] : [90 + x, 90 + x, 95 + x, 255],
    );
    const p = extractPalette(img, 100, 100);
    const red = p.colors.find((c) => {
      const [r, g, b] = hexRgb(c.hex);
      return r > 170 && g < 80 && b < 80;
    });
    expect(red, JSON.stringify(p)).toBeDefined();
    expect(red!.weight).toBeGreaterThan(0.02);
    expect(red!.weight).toBeLessThan(0.08);
  });

  it('fully transparent image -> a single neutral color', () => {
    const p = extractPalette(image(32, 32, () => [255, 0, 0, 0]), 32, 32);
    expect(p.colors).toHaveLength(1);
    expect(p.colors[0]!.weight).toBe(1);
    expect(HEX.test(p.colors[0]!.hex)).toBe(true);
  });

  it('ignores semi-transparent pixels (alpha < 128)', () => {
    const p = extractPalette(image(50, 50, (x) => (x < 25 ? [0, 200, 0, 100] : [10, 10, 200, 255])), 50, 50);
    expect(p.colors).toHaveLength(1);
    expect(near(p.colors[0]!.hex, [10, 10, 200], 2)).toBe(true);
  });

  const rainbow = image(300, 200, (x, y) => {
    const band = Math.floor(x / 30);
    const hues: [number, number, number][] = [
      [230, 30, 40], [250, 140, 20], [250, 220, 30], [40, 180, 70], [20, 160, 200],
      [40, 70, 210], [130, 50, 200], [240, 90, 170], [30, 30, 30], [245, 245, 245],
    ];
    const [r, g, b] = hues[band] as [number, number, number];
    const n = (x * 7 + y * 13) % 9; // small deterministic texture
    return [r + n, g + n, b - n, 255];
  });

  it('is deterministic and respects maxColors; weights sum to ~1, sorted desc', () => {
    for (const maxColors of [undefined, 1, 3, 8, 20]) {
      const a = extractPalette(rainbow, 300, 200, { maxColors });
      const b = extractPalette(rainbow, 300, 200, { maxColors });
      expect(a).toEqual(b);
      const cap = Math.min(8, maxColors ?? 6);
      expect(a.colors.length).toBeLessThanOrEqual(cap);
      expect(a.colors.length).toBeGreaterThanOrEqual(1);
      expect(sumW(a)).toBeCloseTo(1, 2);
      for (const c of a.colors) expect(HEX.test(c.hex)).toBe(true);
      for (let i = 1; i < a.colors.length; i++) expect(a.colors[i - 1]!.weight).toBeGreaterThanOrEqual(a.colors[i]!.weight);
    }
    expect(extractPalette(rainbow, 300, 200, { maxColors: 8 }).colors.length).toBe(8);
  });

  it('subsamples large images (stays fast, same result twice)', () => {
    const w = 1600;
    const h = 1000;
    const big = image(w, h, (x, y) => (y < h / 2 ? [12, 20, 40, 255] : x < w / 2 ? [250, 200, 60, 255] : [200, 40, 80, 255]));
    const a = extractPalette(big, w, h);
    expect(a).toEqual(extractPalette(big, w, h));
    expect(a.colors).toHaveLength(3);
    expect(a.colors[0]!.weight).toBeCloseTo(0.5, 1);
  });
});

describe('colorRole', () => {
  const role = (id: string, key: string) => {
    const p = getTemplate(id)!.params.find((x) => x.key === key)!;
    return colorRole(p as { key: string; label: string; default: string });
  };
  it('classifies known params', () => {
    expect(role('quote_card_v1', 'bgColor')).toBe('background');
    expect(role('event_announcement_v1', 'bgColor')).toBe('background'); // "Paper"
    expect(role('milestone_v1', 'bgColor2')).toBe('background');
    expect(role('kinetic_text_v1', 'secondaryColor')).toBe('background'); // "Background color"
    expect(role('quote_card_v1', 'textColor')).toBe('foreground');
    expect(role('event_announcement_v1', 'inkColor')).toBe('foreground');
    expect(role('title_sequence_v1', 'textColor')).toBe('foreground'); // "Title"
    expect(role('sale_burst_v1', 'burstTextColor')).toBe('foreground');
    expect(role('breaking_news_v1', 'darkColor')).toBe('foreground'); // "Dark band / headline text"
    expect(role('lower_third_v1', 'lightColor')).toBe('foreground'); // "Name text / title bar"
    expect(role('breaking_news_v1', 'bandColor')).toBe('background'); // neutral white surface
    expect(role('lower_third_v1', 'barColor')).toBe('background'); // near-black neutral surface
    expect(role('promo_card_v1', 'accentColor')).toBe('accent'); // "Badge color"
    expect(role('banner_v1', 'primaryColor')).toBe('accent'); // "Panel color"
    expect(role('sale_burst_v1', 'burstColor')).toBe('accent');
    expect(role('bar_chart_v1', 'barColor')).toBe('accent');
    expect(role('milestone_v1', 'confetti2')).toBe('accent');
  });
  it('falls back on the default color when no keyword matches', () => {
    expect(colorRole({ key: 'fooColor', label: 'Foo', default: '#FAFAFA' })).toBe('background');
    expect(colorRole({ key: 'fooColor', label: 'Foo', default: '#FF0044' })).toBe('accent');
    expect(colorRole({ key: 'fooColor', label: 'Foo', default: '#808080' })).toBe('accent');
  });
});

const pal = (...specs: string[]): Palette => {
  const cols = specs.map((s) => {
    const [hex, w] = s.split(':');
    return { hex: hex as string, weight: w ? Number(w) : 1 / specs.length };
  });
  return { colors: cols.sort((a, b) => b.weight - a.weight) };
};

const PALETTES: Record<string, Palette> = {
  lightPastel: pal('#F6EFE6:0.45', '#F2C4CE:0.2', '#BFD8D2:0.15', '#C9C3E6:0.12', '#FBE3A1:0.08'),
  darkMoody: pal('#14161F:0.5', '#2B2F3F:0.2', '#5A3E5D:0.15', '#9C6B4E:0.1', '#C9B79C:0.05'),
  single: pal('#1E88E5'),
  blackWhite: pal('#000000:0.6', '#FFFFFF:0.4'),
  vividRainbow: pal('#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA'),
  midGrey: pal('#7F7F7F:0.7', '#9A9A9A:0.3'),
  photo: pal('#6E7B85:0.5', '#C8C2B8:0.3', '#2E3438:0.16', '#D81E2C:0.04'),
};

describe('applyPalette', () => {
  const templates = listTemplates();
  const variants = [-3, -2, -1, 0, 1, 2, 3];

  it('produces a valid, contrast-safe color for every color param of every template', () => {
    let checked = 0;
    for (const t of templates) {
      const colorParams = t.params.filter((p) => p.type === 'color') as { key: string; label: string; default: string }[];
      const roles = colorParams.map((p) => colorRole(p));
      const bg0 = colorParams[roles.indexOf('background')];
      for (const [name, palette] of Object.entries(PALETTES))
        for (const variant of variants) {
          const ctx = `${t.id} / ${name} / variant ${variant}`;
          const out = applyPalette(t, palette, { variant });
          expect(Object.keys(out).sort(), ctx).toEqual(colorParams.map((p) => p.key).sort());
          for (const v of Object.values(out)) expect(v, ctx).toMatch(HEX);
          // rule 3: foregrounds that sit on the background are WCAG AA on it
          if (bg0)
            colorParams.forEach((p, i) => {
              if (roles[i] === 'foreground' && contrastRatio(p.default, bg0.default) >= 3)
                expect(contrastRatio(out[p.key]!, out[bg0.key]!), `${ctx} ${p.key} on ${bg0.key}`).toBeGreaterThanOrEqual(4.5);
            });
          // rule 5: pairs with default contrast >= 3 keep >= min(4.5, default)
          for (let i = 0; i < colorParams.length; i++)
            for (let j = i + 1; j < colorParams.length; j++) {
              const a = colorParams[i]!;
              const b = colorParams[j]!;
              const c = contrastRatio(a.default, b.default);
              if (c < 3) continue;
              expect(contrastRatio(out[a.key]!, out[b.key]!), `${ctx} ${a.key}/${b.key}`).toBeGreaterThanOrEqual(
                Math.min(4.5, c) - 1e-9,
              );
            }
          const payload = defaultPayload(t.id);
          Object.assign(payload.assets, out);
          expect(validatePayload(payload).ok, ctx).toBe(true);
          checked++;
        }
    }
    expect(checked).toBe(templates.length * Object.keys(PALETTES).length * variants.length);
  });

  it('is a pure function of (template, palette, variant)', () => {
    for (const t of templates)
      for (const variant of [0, 1, 5, -7]) {
        const a = applyPalette(t, PALETTES.vividRainbow!, { variant });
        expect(applyPalette(t, PALETTES.vividRainbow!, { variant })).toEqual(a);
      }
    const t = getTemplate('stat_counter_v1')!;
    expect(applyPalette(t, PALETTES.photo!)).toEqual(applyPalette(t, PALETTES.photo!, { variant: 0 }));
  });

  it('variants give different results', () => {
    for (const id of ['stat_counter_v1', 'quote_card_v1', 'sale_burst_v1', 'event_announcement_v1']) {
      const t = getTemplate(id)!;
      const seen = new Set([0, 1, 2].map((variant) => JSON.stringify(applyPalette(t, PALETTES.vividRainbow!, { variant }))));
      expect(seen.size, id).toBe(3);
    }
  });

  it('uses the palette: dominant color drives the background on variant 0', () => {
    const t = getTemplate('quote_card_v1')!;
    const out = applyPalette(t, PALETTES.lightPastel!);
    expect(near(out.bgColor!, hexRgb('#F6EFE6'), 6)).toBe(true);
    const dark = applyPalette(t, PALETTES.darkMoody!);
    expect(contrastRatio(dark.bgColor!, '#000000')).toBeLessThan(3); // flipped to a dark design
    expect(contrastRatio(dark.textColor!, dark.bgColor!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a vivid minority color as an accent', () => {
    const out = applyPalette(getTemplate('stat_counter_v1')!, PALETTES.photo!);
    const [r, g, b] = hexRgb(out.accentColor!);
    expect(r).toBeGreaterThan(g + 60);
    expect(r).toBeGreaterThan(b + 60);
  });

  it('keeps contrast with fixed colors the template draws against params', () => {
    // milestone_v1: literal white text on the backgrounds; breaking_news_v1: white text on tag/dark band;
    // promo_card_v1: primaryColor highlight on a white card (code template table)
    const cases: [string, string, number][] = [
      ['milestone_v1', 'bgColor', 4.5],
      ['milestone_v1', 'bgColor2', 4.5],
      ['breaking_news_v1', 'tagColor', 4.5],
      ['breaking_news_v1', 'darkColor', 4.5],
      ['promo_card_v1', 'primaryColor', contrastRatio('#FF3D71', '#FFFFFF')],
    ];
    for (const [id, key, min] of cases)
      for (const [name, palette] of Object.entries(PALETTES))
        for (const variant of [0, 1, 2]) {
          const out = applyPalette(getTemplate(id)!, palette, { variant });
          expect(contrastRatio(out[key]!, '#FFFFFF'), `${id} ${key} ${name} v${variant}`).toBeGreaterThanOrEqual(min - 1e-9);
        }
  });

  it('handles empty / odd palettes', () => {
    const t = getTemplate('sale_burst_v1')!;
    for (const p of [{ colors: [] }, { colors: [{ hex: 'nope', weight: 1 }] }, pal('#abc')]) {
      const out = applyPalette(t, p as Palette, { variant: Number.NaN });
      for (const v of Object.values(out)) expect(v).toMatch(HEX);
    }
  });
});

describe('paletteSignature', () => {
  it('is short, stable, and changes with the palette', () => {
    const a = paletteSignature(PALETTES.darkMoody!);
    expect(a).toBe(paletteSignature(JSON.parse(JSON.stringify(PALETTES.darkMoody))));
    expect(a.length).toBeLessThanOrEqual(12);
    expect(a).not.toBe(paletteSignature(PALETTES.lightPastel!));
  });
});
