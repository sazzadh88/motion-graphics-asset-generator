import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  defaultPayload,
  getTemplate,
  listTemplates,
  registerScene,
  renderFrame,
  unregisterTemplate,
  validatePayload,
  GENERATED_ID_PATTERN,
} from '../src';
import type { Ctx2D } from '../src';
import quoteCard from '../src/scenes/quote_card_v1.json';

function scene(id: string, name = 'Generated'): Record<string, unknown> {
  return { ...structuredClone(quoteCard), id, name };
}

const registered: string[] = [];
function reg(json: unknown) {
  const t = registerScene(json);
  registered.push(t.id);
  return t;
}

afterEach(() => {
  for (const id of registered.splice(0)) unregisterTemplate(id);
});

describe('runtime scene registry', () => {
  it('registers a generated scene after the bundled templates', () => {
    const before = listTemplates();
    const t = reg(scene('gen_abc123xyz0'));
    expect(t.origin).toBe('generated');
    expect(t.id).toBe('gen_abc123xyz0');
    const after = listTemplates();
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe(t);
    expect(getTemplate('gen_abc123xyz0')).toBe(t);
    expect(getTemplate('quote_card_v1')?.origin).toBeUndefined();
    const v = validatePayload(defaultPayload('gen_abc123xyz0'));
    expect(v.ok).toBe(true);
  });

  it('renders a registered scene identically to the bundled one it copies', () => {
    reg(scene('gen_copyofquote'));
    const draw = (id: string) => {
      const c = createCanvas(216, 270);
      const p = defaultPayload(id);
      p.settings = { ...p.settings, width: 216, height: 270 };
      renderFrame(c.getContext('2d') as unknown as Ctx2D, 60, p, { images: {} });
      return c.toBuffer('image/png');
    };
    expect(draw('gen_copyofquote').equals(draw('quote_card_v1'))).toBe(true);
  });

  it('replaces a scene registered again under the same id (keeping its position)', () => {
    reg(scene('gen_aaaaaa1'));
    reg(scene('gen_bbbbbb2'));
    const t2 = reg(scene('gen_aaaaaa1', 'Renamed'));
    const gen = listTemplates().filter((t) => t.origin === 'generated');
    expect(gen.map((t) => t.id)).toEqual(['gen_aaaaaa1', 'gen_bbbbbb2']);
    expect(gen[0]).toBe(t2);
    expect(getTemplate('gen_aaaaaa1')?.name).toBe('Renamed');
  });

  it('rejects invalid scenes with formatted errors', () => {
    const bad = scene('gen_badscene1');
    delete bad.layers;
    expect(() => registerScene(bad)).toThrow(/Invalid scene:[\s\S]*\/layers/);
    expect(() => registerScene(42)).toThrow(/Invalid scene/);
    expect(getTemplate('gen_badscene1')).toBeUndefined();
  });

  it('only accepts gen_ ids', () => {
    expect(() => registerScene(scene('my_scene_v1'))).toThrow(/gen_/);
    expect(() => registerScene(scene('quote_card_v1'))).toThrow(/gen_/);
    expect(() => registerScene(scene('gen_abc'))).toThrow(/gen_/); // too short
    expect(() => registerScene(scene('gen_ABCdef123'))).toThrow(/\/id/); // scene ids are lowercase
    expect(GENERATED_ID_PATTERN.test('gen_0123456789ab')).toBe(true);
  });

  it('unregisters generated templates only', () => {
    reg(scene('gen_todelete1'));
    expect(unregisterTemplate('gen_todelete1')).toBe(true);
    expect(getTemplate('gen_todelete1')).toBeUndefined();
    expect(unregisterTemplate('gen_todelete1')).toBe(false);
    expect(unregisterTemplate('quote_card_v1')).toBe(false);
    expect(getTemplate('quote_card_v1')).toBeDefined();
    expect(listTemplates().some((t) => t.origin === 'generated')).toBe(false);
  });
});
