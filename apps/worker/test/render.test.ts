import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultPayload } from '@mg/engine';
import { renderVideo, shutdown } from '../src/index';
import { probe } from './helpers';

const dir = mkdtempSync(path.join(tmpdir(), 'mg-render-'));
afterAll(async () => {
  await shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function payload(transparent = false) {
  const p = defaultPayload('kinetic_text_v1');
  p.settings = { ...p.settings, width: 540, height: 960, fps: 30, durationFrames: 30, transparent };
  return p;
}

describe('renderVideo (headless Chromium + ffmpeg)', () => {
  it('renders mp4 with exact frame count and size', async () => {
    const out = path.join(dir, 'k.mp4');
    const phases = new Set<string>();
    const r = await renderVideo(payload(), { format: 'mp4', outPath: out, onProgress: (x) => phases.add(x.phase) });
    expect(r.frames).toBe(30);
    expect(phases.has('done')).toBe(true);
    const s = probe(out);
    expect(s.codec_name).toBe('h264');
    expect(s.pix_fmt).toBe('yuv420p');
    expect([s.width, s.height]).toEqual([540, 960]);
    expect(s.avg_frame_rate).toBe('30/1');
    expect(s.nb_read_frames).toBe('30');
  }, 180_000);

  it('renders opaque webm', async () => {
    const out = path.join(dir, 'k.webm');
    await renderVideo(payload(), { format: 'webm', outPath: out });
    const s = probe(out);
    expect(s.codec_name).toBe('vp9');
    expect([s.width, s.height]).toEqual([540, 960]);
    expect(s.avg_frame_rate).toBe('30/1');
    expect(s.nb_read_frames).toBe('30');
  }, 180_000);

  it('renders transparent webm with alpha_mode=1', async () => {
    const out = path.join(dir, 'kt.webm');
    await renderVideo(payload(true), { format: 'webm', outPath: out });
    const s = probe(out);
    expect(s.codec_name).toBe('vp9');
    expect(s.nb_read_frames).toBe('30');
    expect(s.tags?.alpha_mode ?? s.tags?.ALPHA_MODE).toBe('1');
  }, 180_000);

  it('rejects invalid payloads and blocked image URLs without leaving files', async () => {
    const out = path.join(dir, 'bad.mp4');
    await expect(renderVideo({ templateId: 'nope' }, { format: 'mp4', outPath: out })).rejects.toThrow(/unknown templateId/);
    for (const url of ['http://127.0.0.1/x.png', 'http://192.168.1.5/x.png', 'http://[::1]/x.png', 'blob:http://a/b', 'file:///etc/passwd']) {
      const p = payload();
      p.assets.logoUrl = url;
      await expect(renderVideo(p, { format: 'mp4', outPath: out })).rejects.toThrow(/logoUrl/);
    }
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('cancels via AbortSignal and cleans up', async () => {
    const out = path.join(dir, 'abort.mp4');
    const ac = new AbortController();
    const p = payload();
    p.settings.durationFrames = 300;
    const run = renderVideo(p, {
      format: 'mp4',
      outPath: out,
      signal: ac.signal,
      onProgress: (x) => {
        if (x.frame >= 4) ac.abort();
      },
    });
    await expect(run).rejects.toThrow(/cancel/i);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part`)).toBe(false);
  }, 120_000);
});
