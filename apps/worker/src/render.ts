import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validatePayload } from '@mg/engine';
import type { Page } from 'puppeteer';
import { acquirePage } from './browser';
import { createEncoder } from './encoder';
import type { VideoFormat } from './encoder';
import { checkPayloadImages } from './security';
import { startStaticServer } from './server';

/** The page API exposed by render-page/main.ts (typed locally so consumers need not compile the page). */
interface MgWindow {
  __mg: { init(input: Record<string, unknown>): Promise<void>; captureBatch(start: number, count: number): Promise<string[]> };
}

export type RenderPhase = 'preparing' | 'rendering' | 'encoding' | 'done';

export interface RenderProgress {
  phase: RenderPhase;
  /** Frames captured so far (within the rendered range). */
  frame: number;
  totalFrames: number;
  percent: number;
  /** Capture throughput so far (frames/second). */
  fps: number;
}

export interface RenderOptions {
  format: VideoFormat;
  outPath: string;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
  /** Optional frame range [start, end) of the payload timeline (default: all frames). */
  frames?: { start: number; end: number };
  onWarning?: (message: string) => void;
}

export interface RenderResult {
  outPath: string;
  frames: number;
  width: number;
  height: number;
  fps: number;
  format: VideoFormat;
  elapsedMs: number;
  bytes: number;
}

const PROGRESS_INTERVAL_MS = 250;
const BATCH = 4;

function abortError(): Error {
  const e = new Error('Render cancelled');
  e.name = 'AbortError';
  return e;
}

/** Locks the page's network down (see security.ts for the policy). */
async function lockdown(page: Page, origin: string, allowedUrls: Set<string>, blocked: string[]) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isInterceptResolutionHandled()) return;
    const url = req.url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || allowedUrls.has(url)) {
      void req.continue();
    } else {
      blocked.push(url.slice(0, 200));
      void req.abort('blockedbyclient');
    }
  });
}

export async function renderVideo(payload: unknown, opts: RenderOptions): Promise<RenderResult> {
  const started = performance.now();
  const { signal } = opts;
  if (signal?.aborted) throw abortError();

  const v = validatePayload(payload);
  if (!v.ok) throw new Error(`Invalid payload:\n  - ${v.errors.join('\n  - ')}`);
  const p = v.payload;
  const { width, height, fps, durationFrames, transparent } = p.settings;

  const start = opts.frames?.start ?? 0;
  const end = opts.frames?.end ?? durationFrames;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > durationFrames || start >= end)
    throw new Error(`Invalid frame range ${start}:${end} (timeline has ${durationFrames} frames)`);
  const total = end - start;

  if (transparent && opts.format === 'mp4')
    opts.onWarning?.('mp4 does not support transparency: alpha will be dropped (use webm for alpha).');

  let lastEmit = 0;
  let captured = 0;
  let renderStart = performance.now();
  const emit = (phase: RenderPhase, force = false) => {
    if (!opts.onProgress) return;
    const now = performance.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    const secs = (now - renderStart) / 1000;
    opts.onProgress({
      phase,
      frame: captured,
      totalFrames: total,
      percent: phase === 'done' ? 100 : phase === 'preparing' ? 0 : Math.min(99, Math.floor((captured / total) * 100)),
      fps: secs > 0 && captured > 0 ? captured / secs : 0,
    });
  };

  emit('preparing', true);
  const allowedUrls = await checkPayloadImages(p);
  await mkdir(path.dirname(path.resolve(opts.outPath)), { recursive: true });
  const { origin } = await startStaticServer();

  const outPath = path.resolve(opts.outPath);
  const encoder = createEncoder({ format: opts.format, fps, outPath });
  const jobPage = await acquirePage(width, height).catch(async (e) => {
    await encoder.abort();
    throw e;
  });
  const { page } = jobPage;

  const pageErrors: string[] = [];
  const blocked: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e instanceof Error ? e.message : String(e)}`));

  const onAbort = () => {
    void encoder.abort();
    void jobPage.release();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await lockdown(page, origin, allowedUrls, blocked);
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { __mg?: unknown }).__mg !== 'undefined');
    await page.evaluate((input) => (window as unknown as MgWindow).__mg.init(input), p as unknown as Record<string, unknown>);
    if (blocked.length) opts.onWarning?.(`blocked ${blocked.length} disallowed request(s): ${blocked.join(', ')}`);
    if (signal?.aborted) throw abortError();

    renderStart = performance.now();
    emit('rendering', true);
    // Frames are captured in small batches (PNG encoding of a batch overlaps across
    // cores inside Chromium) and batch k+1 is captured while batch k is written to ffmpeg.
    const grab = (i: number) => {
      const n = Math.min(BATCH, end - i);
      const pr = page.evaluate((s, c) => (window as unknown as MgWindow).__mg.captureBatch(s, c), i, n);
      pr.catch(() => undefined); // no unhandled rejection if we bail out early
      return pr;
    };
    let pending = grab(start);
    for (let i = start; i < end; i += BATCH) {
      const batch = await pending;
      if (signal?.aborted) throw abortError();
      if (i + BATCH < end) pending = grab(i + BATCH);
      for (const b64 of batch) {
        await encoder.write(Buffer.from(b64, 'base64'));
        captured++;
        emit('rendering');
      }
    }

    emit('encoding', true);
    await encoder.finish();
    if (signal?.aborted) throw abortError();
    const { size } = await stat(outPath);
    emit('done', true);
    return {
      outPath,
      frames: total,
      width,
      height,
      fps,
      format: opts.format,
      elapsedMs: Math.round(performance.now() - started),
      bytes: size,
    };
  } catch (e) {
    await encoder.abort().catch(() => undefined);
    if (signal?.aborted) throw abortError();
    let base = e instanceof Error ? e.message : String(e);
    // Raw puppeteer errors ("Target closed") don't say the browser itself went away.
    if (!page.browser().connected) base = `Chromium exited during render (crashed or killed): ${base}`;
    const extra = pageErrors.length ? `\nBrowser errors:\n${pageErrors.slice(0, 10).join('\n')}` : '';
    const err = new Error(base + extra);
    if (e instanceof Error && e.stack) err.stack = e.stack;
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await jobPage.release();
  }
}
