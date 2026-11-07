import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { defaultPayload, listTemplates, renderFrame } from '../src';
import type { Ctx2D, LoadedAssets, RenderJobPayload } from '../src';

function logoImage(): CanvasImageSource {
  const c = createCanvas(240, 80);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 240, 80);
  g.fillStyle = '#2255ee';
  g.fillRect(10, 10, 60, 60);
  return c as unknown as CanvasImageSource;
}

function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function draw(payload: RenderJobPayload, frame: number, loaded: LoadedAssets): Uint8ClampedArray {
  const { width, height } = payload.settings;
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  renderFrame(g as unknown as Ctx2D, frame, payload, loaded);
  return new Uint8ClampedArray(g.getImageData(0, 0, width, height).data);
}

const sizes: [number, number][] = [
  [1080, 1920],
  [1080, 1080],
  [1080, 1350],
  [1920, 1080],
  [1500, 500],
];

describe('determinism', () => {
  for (const t of listTemplates()) {
    it(`${t.id}: same frame renders identical pixels (with and without logo)`, () => {
      const base = defaultPayload(t.id);
      const last = base.settings.durationFrames - 1;
      const frames = [0, 7, Math.floor(last * 0.3), Math.floor(last * 0.6), last - 4, last];
      for (const withLogo of [false, true]) {
        const loaded: LoadedAssets = { images: { logoUrl: withLogo ? logoImage() : null } };
        for (const f of frames) {
          const a = draw(base, f, loaded);
          const b = draw(base, f, loaded);
          expect(same(a, b), `${t.id} frame ${f} logo=${withLogo}`).toBe(true);
        }
      }
    });

    it(`${t.id}: renders at every aspect ratio and out-of-order frames match`, () => {
      const loaded: LoadedAssets = { images: { logoUrl: logoImage() } };
      for (const [width, height] of sizes) {
        const p: RenderJobPayload = {
          ...defaultPayload(t.id),
          settings: { ...defaultPayload(t.id).settings, width, height },
        };
        const mid = Math.floor(p.settings.durationFrames / 2);
        const first = draw(p, mid, loaded);
        draw(p, 3, loaded);
        expect(same(draw(p, mid, loaded), first), `${t.id} ${width}x${height}`).toBe(true);
      }
    });

    it(`${t.id}: transparent mode paints no opaque background and ends clean`, () => {
      const p = defaultPayload(t.id);
      p.settings.transparent = true;
      const empty: LoadedAssets = { images: { logoUrl: null } };
      const lastBuf = draw(p, p.settings.durationFrames - 1, empty);
      let opaque = 0;
      for (let i = 3; i < lastBuf.length; i += 4) if ((lastBuf[i] as number) > 0) opaque++;
      expect(opaque).toBe(0);
      const mid = draw(p, Math.floor(p.settings.durationFrames * 0.6), empty);
      let midOpaque = 0;
      for (let i = 3; i < mid.length; i += 4) if ((mid[i] as number) > 0) midOpaque++;
      expect(midOpaque).toBeGreaterThan(0);
    });
  }
});
