import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEncoder } from '../src/encoder';
import { makePngs, probe } from './helpers';

describe('encoder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mg-enc-'));

  it('encodes PNG frames to mp4 and webm', async () => {
    const pngs = makePngs(12, 320, 240);
    expect(pngs).toHaveLength(12);
    for (const format of ['mp4', 'webm'] as const) {
      const out = path.join(dir, `a.${format}`);
      const enc = createEncoder({ format, fps: 24, outPath: out });
      for (const p of pngs) await enc.write(p);
      await enc.finish();
      expect(existsSync(`${out}.part`)).toBe(false);
      const s = probe(out);
      expect(s.nb_read_frames).toBe('12');
      expect([s.width, s.height]).toEqual([320, 240]);
      expect(s.avg_frame_rate).toBe('24/1');
      expect(s.codec_name).toBe(format === 'mp4' ? 'h264' : 'vp9');
    }
  }, 60_000);

  it('rejects with ffmpeg stderr on bad input and leaves no output', async () => {
    const out = path.join(dir, 'bad.mp4');
    const enc = createEncoder({ format: 'mp4', fps: 24, outPath: out });
    await enc.write(Buffer.from('definitely not a png'));
    await expect(enc.finish()).rejects.toThrow(/ffmpeg exited/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part`)).toBe(false);
  }, 30_000);

  it('abort removes the temp file', async () => {
    const out = path.join(dir, 'abort.mp4');
    const enc = createEncoder({ format: 'mp4', fps: 24, outPath: out });
    for (const p of makePngs(3, 128, 128)) await enc.write(p);
    await enc.abort();
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part`)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
