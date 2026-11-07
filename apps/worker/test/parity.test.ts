/**
 * Preview-vs-export parity: what the studio shows for frame N is what the exported
 * video contains at frame N.
 *
 *  1. Studio canvas (production build of apps/web) ≡ render page capture, pixel for pixel.
 *  2. Render page PNGs -> encoder input stage -> lossless file -> decode: byte-identical,
 *     same count and order (no dropped / duplicated / reordered frames).
 *  3. Real renderVideo() output (lossy MP4 / transparent WebM) vs the captures: PSNR floor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultPayload, listTemplates } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import { renderVideo, shutdown } from '../src/index';
import { launchCpuRasterBrowser, RenderPage, StudioPage } from './parity/pages';
import type { TestBrowser } from './parity/pages';
import { decodePng } from './parity/png';
import { alphaQuality, colourQuality, describeDiff, diffRgba, fmtDb } from './parity/pixels';
import { buildStudio, serveDir } from './parity/studio';
import type { Served } from './parity/studio';
import { decodeFrames, encodeLossless } from './parity/video';

const MIN_PSNR = 38;
const WINDOW = 30;
/** swscale flags for the YUV->RGB decode used in the quality checks. */
const ACCURATE = 'bicubic+accurate_rnd+full_chroma_int';

const dir = mkdtempSync(path.join(tmpdir(), 'mg-parity-'));
afterAll(async () => {
  await shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const templateIds = listTemplates().map((t) => t.id);

function payloadFor(id: string, patch: Partial<RenderJobPayload['settings']> = {}): RenderJobPayload {
  const p = defaultPayload(id);
  p.settings = { ...p.settings, ...patch };
  return p;
}

/** Frames {0, 25%, 50%, 75%, last}. */
function checkpoints(durationFrames: number): number[] {
  const last = durationFrames - 1;
  return [...new Set([0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(last * k)))];
}

/** ~30-frame window starting at 15% of the timeline (inside the intro motion). */
function window30(durationFrames: number): { start: number; end: number } {
  const start = Math.min(Math.floor(durationFrames * 0.15), Math.max(0, durationFrames - WINDOW));
  return { start, end: Math.min(durationFrames, start + WINDOW) };
}

function label(p: RenderJobPayload): string {
  const s = p.settings;
  return `${p.templateId} ${s.width}x${s.height}${s.transparent ? ' transparent' : ''}`;
}

const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');

describe('preview-vs-export parity', () => {
  // Both pages run in one browser on CPU canvas raster: GPU raster is not deterministic
  // run-to-run (see launchCpuRasterBrowser), so exact equality is only meaningful there.
  describe('1. studio canvas is pixel-identical to the render page', () => {
    let served: Served | null = null;
    let browser: TestBrowser | null = null;
    let studio: StudioPage | null = null;

    beforeAll(async () => {
      const out = path.join(dir, 'studio');
      await buildStudio(out);
      served = await serveDir(out);
      browser = await launchCpuRasterBrowser();
      studio = await StudioPage.open(served.origin, browser.newPage);
    }, 180_000);

    afterAll(async () => {
      await studio?.close();
      await browser?.close();
      await served?.close();
    });

    const cases = [
      ...templateIds.map((id) => payloadFor(id)),
      payloadFor('promo_card_v1', { transparent: true }),
    ];

    for (const payload of cases) {
      it(`${label(payload)} at frames {0, 25%, 50%, 75%, last}`, async () => {
        const rp = await RenderPage.open(payload, browser!.newPage);
        try {
          await studio!.setPayload(payload);
          const { width, height, durationFrames } = payload.settings;
          const lines: string[] = [];
          const failures: string[] = [];
          for (const f of checkpoints(durationFrames)) {
            const ref = decodePng(await rp.capture(f));
            const got = await studio!.pixelsAt(f);
            expect([got.width, got.height], `${label(payload)} studio canvas size`).toEqual([width, height]);
            expect([ref.width, ref.height], `${label(payload)} capture size`).toEqual([width, height]);
            const d = diffRgba(ref.data, got.data, width);
            const line = describeDiff(`${label(payload)} frame ${f}`, d, width * height);
            lines.push(line);
            if (d.pixels) failures.push(line);
          }
          console.log(lines.join('\n'));
          const errs = [...rp.errors, ...studio!.errors];
          expect(failures, `studio != render page:\n${failures.join('\n')}\n${errs.join('\n')}`).toEqual([]);
        } finally {
          await rp.close();
        }
      }, 120_000);
    }
  });

  describe('2. encoder input stage is lossless and keeps every frame in order', () => {
    for (const transparent of [false, true]) {
      // 40-frame timeline, frames 5..34: skips the blank first/last frames so every frame is unique.
      const payload = payloadFor('kinetic_text_v1', { width: 360, height: 640, fps: 30, durationFrames: 40, transparent });
      const first = 5;

      it(`${label(payload)}: frames ${first}..${first + WINDOW - 1} round-trip byte-identical`, async () => {
        const { width, height, fps } = payload.settings;
        const rp = await RenderPage.open(payload);
        let pngs: Buffer[];
        try {
          pngs = await rp.captureRange(first, WINDOW);
        } finally {
          await rp.close();
        }
        const captures = pngs.map((b) => decodePng(b).data);
        // The order check is only meaningful if frames are distinguishable.
        const hashes = captures.map(sha);
        const dupes = hashes.flatMap((h, i) => (hashes.indexOf(h) < i ? [`${i}=${hashes.indexOf(h)}`] : []));
        expect(dupes, 'captured frames must be pairwise distinct for the order check').toEqual([]);

        const mkv = path.join(dir, `lossless-${transparent ? 'alpha' : 'opaque'}.mkv`);
        const args = await encodeLossless(pngs, fps, mkv);
        const decoded = decodeFrames(mkv, { width, height, pixFmt: 'rgba' });

        const problems: string[] = [];
        if (decoded.length !== captures.length) problems.push(`frame count ${decoded.length} != ${captures.length}`);
        for (let i = 0; i < Math.min(decoded.length, captures.length); i++) {
          if (decoded[i]!.equals(captures[i]!)) continue;
          const j = hashes.indexOf(sha(decoded[i]!));
          problems.push(
            j >= 0
              ? `decoded frame ${i} equals captured frame ${j} (reordered/duplicated)`
              : describeDiff(`decoded frame ${i}`, diffRgba(captures[i]!, decoded[i]!, width), width * height),
          );
        }
        console.log(
          `${label(payload)}: ${decoded.length}/${captures.length} frames byte-identical=${problems.length === 0} ` +
            `(ffmpeg ${args.join(' ')})`,
        );
        expect(problems, problems.join('\n')).toEqual([]);
      }, 120_000);
    }
  });

  describe(`3. delivered video quality (PSNR >= ${MIN_PSNR} dB per frame)`, () => {
    for (const id of templateIds) {
      const payload = payloadFor(id);

      it(`${label(payload)} mp4`, async () => {
        const { width, height, durationFrames } = payload.settings;
        const range = window30(durationFrames);
        const count = range.end - range.start;
        const out = path.join(dir, `${id}.mp4`);
        const r = await renderVideo(payload, { format: 'mp4', outPath: out, frames: range });
        expect(r.frames).toBe(count);

        const rp = await RenderPage.open(payload);
        let refs: Buffer[];
        try {
          refs = (await rp.captureRange(range.start, count)).map((b) => decodePng(b).data);
        } finally {
          await rp.close();
        }
        const decoded = decodeFrames(out, {
          width,
          height,
          pixFmt: 'rgb24',
          // Invert the encoder's BT.709 limited-range conversion; accurate rounding and
          // full chroma interpolation so swscale's fast path is not counted as codec loss.
          filter: `scale=in_color_matrix=bt709:in_range=tv:flags=${ACCURATE}`,
        });
        expect(decoded.length, `${label(payload)} decoded frame count`).toBe(count);

        const q = refs.map((ref, i) => colourQuality(ref, decoded[i]!, 3, 'rgb'));
        const ps = q.map((x) => x.psnr);
        const min = Math.min(...ps);
        const mean = ps.reduce((a, b) => a + Math.min(b, 99), 0) / ps.length;
        console.log(
          `${label(payload)} mp4 frames ${range.start}..${range.end - 1}: PSNR min ${fmtDb(min)}, mean ${fmtDb(mean)}, ` +
            `max channel delta ${Math.max(...q.map((x) => x.maxDelta))}`,
        );
        const bad = q
          .map((x, i) => ({ ...x, frame: range.start + i }))
          .filter((x) => x.psnr < MIN_PSNR)
          .map((x) => `frame ${x.frame}: PSNR ${fmtDb(x.psnr)}, max delta ${x.maxDelta}`);
        expect(bad, `${label(payload)} frames below ${MIN_PSNR} dB:\n${bad.join('\n')}`).toEqual([]);
      }, 180_000);
    }

    const tp = payloadFor('promo_card_v1', { transparent: true });
    it(`${label(tp)} webm (alpha)`, async () => {
      const { width, height, durationFrames } = tp.settings;
      const range = window30(durationFrames);
      const count = range.end - range.start;
      const out = path.join(dir, 'transparent.webm');
      await renderVideo(tp, { format: 'webm', outPath: out, frames: range });

      const rp = await RenderPage.open(tp);
      let refs: Buffer[];
      try {
        refs = (await rp.captureRange(range.start, count)).map((b) => decodePng(b).data);
      } finally {
        await rp.close();
      }
      // libvpx-vp9 decoder: the native VP9 decoder ignores the alpha side-channel.
      const decoded = decodeFrames(out, {
        width,
        height,
        pixFmt: 'rgba',
        inputArgs: ['-c:v', 'libvpx-vp9'],
        filter: `scale=flags=${ACCURATE}`,
      });
      expect(decoded.length, `${label(tp)} decoded frame count`).toBe(count);

      const alpha = refs.map((ref, i) => alphaQuality(ref, decoded[i]!));
      const colour = refs.map((ref, i) => colourQuality(ref, decoded[i]!, 4, 'premul'));
      const summary = (name: string, q: { psnr: number; maxDelta: number }[]) => {
        const ps = q.map((x) => x.psnr);
        const mean = ps.reduce((a, b) => a + Math.min(b, 99), 0) / ps.length;
        return `${name} PSNR min ${fmtDb(Math.min(...ps))}, mean ${fmtDb(mean)}, max delta ${Math.max(...q.map((x) => x.maxDelta))}`;
      };
      console.log(
        `${label(tp)} webm frames ${range.start}..${range.end - 1}: ${summary('alpha', alpha)}; ${summary('premultiplied RGB', colour)}`,
      );
      const bad = [
        ...alpha.map((x, i) => (x.psnr < MIN_PSNR ? `frame ${range.start + i}: alpha PSNR ${fmtDb(x.psnr)}, max delta ${x.maxDelta}` : '')),
        ...colour.map((x, i) =>
          x.psnr < MIN_PSNR ? `frame ${range.start + i}: premultiplied RGB PSNR ${fmtDb(x.psnr)}, max delta ${x.maxDelta}` : '',
        ),
      ].filter(Boolean);
      expect(bad, `${label(tp)} frames below ${MIN_PSNR} dB:\n${bad.join('\n')}`).toEqual([]);
    }, 180_000);
  });
});
