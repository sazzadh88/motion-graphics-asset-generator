/**
 * Bit-reproducible exports: the same payload frame rendered in fresh jobs (a new browser
 * context, and a freshly launched browser) through the worker's own browser path
 * (acquirePage + the render page served by the static server, as renderVideo does) must give
 * byte-identical PNG captures. GPU-accelerated 2D canvas raster fails this on text edges;
 * src/browser.ts launches Chromium with --disable-accelerated-2d-canvas for that reason.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { defaultPayload } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import { closeBrowser } from '../src/browser';
import { shutdown } from '../src/index';
import { RenderPage } from './parity/pages';
import { decodePng } from './parity/png';

afterAll(async () => {
  await shutdown();
});

const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');

/** Frames {25%, 50%, 75%} of the timeline (mid-motion, text on screen). */
function frames(p: RenderJobPayload): number[] {
  const last = p.settings.durationFrames - 1;
  return [0.25, 0.5, 0.75].map((k) => Math.round(last * k));
}

async function captureJob(p: RenderJobPayload): Promise<Buffer[]> {
  const rp = await RenderPage.open(p);
  try {
    const out: Buffer[] = [];
    for (const f of frames(p)) out.push(await rp.capture(f));
    return out;
  } finally {
    await rp.close();
  }
}

function diffPixels(a: Buffer, b: Buffer): number {
  const x = decodePng(a);
  const y = decodePng(b);
  if (x.width !== y.width || x.height !== y.height) return -1;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4)
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3]) n++;
  return n;
}

describe('export determinism', () => {
  for (const id of ['kinetic_text_v1', 'promo_card_v1', 'banner_v1']) {
    it(`${id}: same frames are byte-identical across fresh jobs and a fresh browser`, async () => {
      const p = defaultPayload(id);
      await closeBrowser();
      const a = await captureJob(p); // fresh browser, first job
      const b = await captureJob(p); // same browser, fresh context + page
      await closeBrowser();
      const c = await captureJob(p); // freshly launched browser
      const fs = frames(p);
      const mismatches: string[] = [];
      fs.forEach((f, i) => {
        for (const [name, other] of [['job 2', b[i]!], ['new browser', c[i]!]] as const)
          if (sha(other) !== sha(a[i]!))
            mismatches.push(`frame ${f}: job 1 vs ${name}: ${diffPixels(a[i]!, other)} pixels differ`);
      });
      expect(mismatches, mismatches.join('\n')).toEqual([]);
    }, 120_000);
  }
});
