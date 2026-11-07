import { describe, expect, it } from 'vitest';
import { defaultPayload, getTemplate, listTemplates, validatePayload } from '../src';

const spec = {
  templateId: 'kinetic_text_v1',
  settings: { width: 1080, height: 1920, fps: 60, durationFrames: 180 },
  assets: {
    headline: 'SUMMER SALE',
    subheading: 'Up to 50% off everything',
    primaryColor: '#FF2A5F',
    secondaryColor: '#0F172A',
    logoUrl: null,
  },
};

describe('registry', () => {
  it('registers the code templates, then the bundled scenes, with unique ids and valid defaults', () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids.slice(0, 5)).toEqual(['kinetic_text_v1', 'promo_card_v1', 'banner_v1', 'lower_third_v1', 'stat_counter_v1']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of listTemplates()) {
      expect(t.fonts.length).toBeGreaterThan(0);
      expect(t.fonts).not.toContain('sans-serif');
      expect(validatePayload(defaultPayload(t.id)).ok, t.id).toBe(true);
      const keys = t.params.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(getTemplate('nope')).toBeUndefined();
  });
});

describe('validatePayload', () => {
  it('accepts the spec example', () => {
    const r = validatePayload(spec);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.settings.transparent).toBe(false);
  });
  it('fills missing assets with defaults', () => {
    expect(validatePayload({ templateId: 'banner_v1' }).ok).toBe(true);
  });
  it('rejects odd sizes', () => {
    expect(validatePayload({ ...spec, settings: { ...spec.settings, width: 1081 } }).ok).toBe(false);
  });
  it('rejects bad colors', () => {
    expect(validatePayload({ ...spec, assets: { ...spec.assets, primaryColor: 'red' } }).ok).toBe(false);
    expect(validatePayload({ ...spec, assets: { ...spec.assets, secondaryColor: '#12' } }).ok).toBe(false);
  });
  it('rejects unknown template', () => {
    expect(validatePayload({ ...spec, templateId: 'nope' }).ok).toBe(false);
    expect(validatePayload(null).ok).toBe(false);
  });
  it('rejects out-of-range fps and duration', () => {
    expect(validatePayload({ ...spec, settings: { ...spec.settings, fps: 45 } }).ok).toBe(false);
    expect(validatePayload({ ...spec, settings: { ...spec.settings, durationFrames: 0 } }).ok).toBe(false);
    expect(validatePayload({ ...spec, settings: { ...spec.settings, durationFrames: 60 * 60 + 1 } }).ok).toBe(false);
  });
  it('rejects over-long text', () => {
    expect(validatePayload({ ...spec, assets: { ...spec.assets, headline: 'x'.repeat(61) } }).ok).toBe(false);
  });
});
