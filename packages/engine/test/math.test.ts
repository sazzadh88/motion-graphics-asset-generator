import { describe, expect, it } from 'vitest';
import {
  clamp,
  createRng,
  cubicBezier,
  easings,
  easeOutBack,
  easeOutElastic,
  hashString,
  interpolate,
  linear,
  mixColors,
  parseColor,
  readableOn,
  stagger,
} from '../src/math';

describe('easings', () => {
  it('all hit 0 and 1 at the endpoints and are finite', () => {
    for (const [name, fn] of Object.entries(easings)) {
      expect(fn(0), name).toBe(0);
      expect(fn(1), name).toBe(1);
      for (let i = 0; i <= 20; i++) expect(Number.isFinite(fn(i / 20)), name).toBe(true);
    }
  });
  it('inOut easings are symmetric around 0.5', () => {
    expect(easings.easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easings.easeInOutExpo(0.5)).toBeCloseTo(0.5, 10);
  });
  it('back overshoots, elastic overshoots then settles', () => {
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49)))).toBeGreaterThan(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeOutElastic(i / 49)))).toBeGreaterThan(1);
  });
  it('cubicBezier(0,0,1,1) is linear and ease matches CSS ease at midpoint', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    expect(lin(0.3)).toBeCloseTo(0.3, 4);
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });
});

describe('interpolate', () => {
  it('maps and clamps by default', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(50, [0, 10], [0, 100])).toBe(100);
  });
  it('extrapolates linearly when clamp=false', () => {
    expect(interpolate(20, [0, 10], [0, 100], { clamp: false })).toBe(200);
    expect(interpolate(-10, [0, 10], [0, 100], { clamp: false, easing: easings.easeInQuad })).toBe(-100);
  });
  it('handles multiple segments and per-segment easing', () => {
    expect(interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50);
    expect(interpolate(5, [0, 10, 20], [0, 100, 0], { easing: [easings.easeInQuad, linear] })).toBe(25);
  });
  it('supports descending output and zero-length segments', () => {
    expect(interpolate(5, [0, 10], [100, 0])).toBe(50);
    expect(interpolate(5, [5, 5, 10], [0, 1, 2])).toBe(1);
  });
  it('throws on bad ranges', () => {
    expect(() => interpolate(0, [0], [0])).toThrow();
    expect(() => interpolate(0, [0, 1], [0])).toThrow();
    expect(() => interpolate(0, [1, 0], [0, 1])).toThrow();
  });
});

describe('misc math', () => {
  it('clamp, stagger', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(stagger(3, 4)).toBe(12);
  });
  it('rng is deterministic and in [0,1)', () => {
    const a = createRng('seed');
    const b = createRng(hashString('seed'));
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
  it('colors', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('rgba(128,128,128,1)');
    expect(readableOn('#000000')).toBe('#FFFFFF');
    expect(readableOn('#ffffff')).toBe('#0B1020');
  });
});
