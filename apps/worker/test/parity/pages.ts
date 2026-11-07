import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import type { RenderJobPayload } from '@mg/engine';
import { acquirePage, launchArgs } from '../../src/browser';
import type { JobPage } from '../../src/browser';
import { startStaticServer } from '../../src/server';

/** Collects console errors / page errors so failures can show them. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e instanceof Error ? e.message : String(e)}`));
  return errors;
}

/** Where pages come from: the worker's shared production browser by default. */
export type PageSource = (width: number, height: number) => Promise<JobPage>;

export interface TestBrowser {
  newPage: PageSource;
  close(): Promise<void>;
}

/**
 * A separate browser with the worker's launch flags (src/browser.ts `launchArgs()`, which
 * include --disable-accelerated-2d-canvas: GPU canvas raster is not deterministic, so exact
 * pixel equality is only meaningful on CPU raster).
 */
export async function launchCpuRasterBrowser(): Promise<TestBrowser> {
  const browser = await puppeteer.launch({
    headless: true,
    args: launchArgs(),
  });
  return {
    async newPage(width, height) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      return { page, release: () => page.close().catch(() => undefined) };
    },
    close: () => browser.close(),
  };
}

interface MgWindow {
  __mg: {
    init(input: unknown): Promise<void>;
    capture(frame: number): Promise<string>;
    captureBatch(start: number, count: number): Promise<string[]>;
  };
}

/** The headless render page used by renderVideo (same bundle, same browser flags). */
export class RenderPage {
  private constructor(
    private readonly job: JobPage,
    readonly errors: string[],
  ) {}

  static async open(payload: RenderJobPayload, source: PageSource = acquirePage): Promise<RenderPage> {
    const { origin } = await startStaticServer();
    const job = await source(payload.settings.width, payload.settings.height);
    const errors = watchErrors(job.page);
    const rp = new RenderPage(job, errors);
    try {
      await job.page.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await job.page.waitForFunction(() => typeof (window as unknown as { __mg?: unknown }).__mg !== 'undefined');
      await job.page.evaluate((p) => (window as unknown as MgWindow).__mg.init(p), payload as unknown);
    } catch (e) {
      await job.release();
      throw new Error(`render page init failed: ${String(e)}\n${errors.join('\n')}`);
    }
    return rp;
  }

  /** PNG bytes of one frame, exactly as fed to ffmpeg by renderVideo. */
  async capture(frame: number): Promise<Buffer> {
    const b64 = await this.job.page.evaluate((f) => (window as unknown as MgWindow).__mg.capture(f), frame);
    return Buffer.from(b64, 'base64');
  }

  /** PNGs for frames [start, start+count) using the same batched path as renderVideo. */
  async captureRange(start: number, count: number, batch = 4): Promise<Buffer[]> {
    const out: Buffer[] = [];
    for (let i = start; i < start + count; i += batch) {
      const n = Math.min(batch, start + count - i);
      const b64s = await this.job.page.evaluate((s, c) => (window as unknown as MgWindow).__mg.captureBatch(s, c), i, n);
      for (const b of b64s) out.push(Buffer.from(b, 'base64'));
    }
    return out;
  }

  close(): Promise<void> {
    return this.job.release();
  }
}

interface StudioWindow {
  __studio?: { setPayload(p: unknown): void; setFrame(n: number): void; ready(): Promise<void> };
}

/** The production studio build, driven through its `?mgtest=1` hook. */
export class StudioPage {
  private constructor(
    private readonly job: JobPage,
    readonly errors: string[],
  ) {}

  static async open(origin: string, source: PageSource = acquirePage): Promise<StudioPage> {
    const job = await source(1600, 1000);
    const errors = watchErrors(job.page);
    const sp = new StudioPage(job, errors);
    try {
      await job.page.goto(`${origin}/?mgtest=1`, { waitUntil: 'load' });
      await job.page.waitForFunction(() => typeof (window as unknown as StudioWindow).__studio !== 'undefined', {
        timeout: 30_000,
      });
    } catch (e) {
      await job.release();
      throw new Error(`studio did not expose window.__studio: ${String(e)}\n${errors.join('\n')}`);
    }
    return sp;
  }

  async setPayload(payload: RenderJobPayload): Promise<void> {
    await this.job.page.evaluate(async (p) => {
      const s = (window as unknown as StudioWindow).__studio!;
      s.setPayload(p);
      await s.ready();
    }, payload as unknown);
  }

  /** Moves the playhead and returns the studio canvas's RGBA pixels (getImageData) once drawn. */
  async pixelsAt(frame: number): Promise<{ width: number; height: number; data: Buffer }> {
    const r = await this.job.page.evaluate(async (f) => {
      const s = (window as unknown as StudioWindow).__studio!;
      s.setFrame(f);
      await s.ready();
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Animation preview"]');
      if (!canvas) throw new Error('studio canvas not found');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('studio canvas has no 2d context');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bytes = new Uint8Array(img.data.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
      return { width: canvas.width, height: canvas.height, b64: btoa(bin) };
    }, frame);
    return { width: r.width, height: r.height, data: Buffer.from(r.b64, 'base64') };
  }

  close(): Promise<void> {
    return this.job.release();
  }
}
