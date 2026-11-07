import puppeteer from 'puppeteer';
import type { Browser, BrowserContext, Page } from 'puppeteer';

const MAX_JOBS_PER_BROWSER = Number(process.env.MG_BROWSER_MAX_JOBS ?? 20);

interface Slot {
  browser: Browser;
  jobs: number;
  active: number;
  retired: boolean;
}

let current: Promise<Slot> | null = null;
const all = new Set<Slot>();

/**
 * Chromium flags for every render browser. `--disable-accelerated-2d-canvas` forces CPU
 * raster for 2D canvas: the GPU path (ANGLE/D3D11) is not deterministic run to run (the same
 * frame drawn in two fresh pages differed by 1-2 levels on a few dozen text-edge pixels), so
 * exports would not be bit-reproducible. See docs/perf.md and test/determinism.test.ts.
 */
export const LAUNCH_ARGS: readonly string[] = [
  '--hide-scrollbars',
  '--mute-audio',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-accelerated-2d-canvas',
];

/** LAUNCH_ARGS plus the sandbox opt-out when `MG_NO_SANDBOX=1` (containers without user namespaces). */
export function launchArgs(): string[] {
  const args = [...LAUNCH_ARGS];
  if (process.env.MG_NO_SANDBOX === '1') args.push('--no-sandbox', '--disable-setuid-sandbox');
  return args;
}

async function launch(): Promise<Slot> {
  const browser = await puppeteer.launch({ headless: true, args: launchArgs() });
  const slot: Slot = { browser, jobs: 0, active: 0, retired: false };
  browser.on('disconnected', () => {
    slot.retired = true;
    all.delete(slot);
  });
  all.add(slot);
  return slot;
}

async function acquireSlot(): Promise<Slot> {
  for (;;) {
    current ??= launch().catch((e) => {
      current = null;
      throw e;
    });
    const promise = current;
    const slot = await promise;
    const dropCurrent = () => {
      if (current === promise) current = null;
    };
    if (!slot.browser.connected) {
      // Browser died (crash / killed): relaunch.
      slot.retired = true;
      all.delete(slot);
      dropCurrent();
      continue;
    }
    if (slot.jobs >= MAX_JOBS_PER_BROWSER) {
      // Retire: new jobs go to a fresh browser, this one closes when idle.
      slot.retired = true;
      dropCurrent();
      if (slot.active === 0) void closeSlot(slot);
      continue;
    }
    slot.jobs++;
    slot.active++;
    return slot;
  }
}

async function closeSlot(slot: Slot): Promise<void> {
  all.delete(slot);
  await slot.browser.close().catch(() => undefined);
}

export interface JobPage {
  page: Page;
  /** Always call in `finally`: closes the page (and retired browsers once idle). */
  release(): Promise<void>;
}

/** New page for one job on the shared browser; viewport = output size, DPR 1. */
export async function acquirePage(width: number, height: number): Promise<JobPage> {
  const slot = await acquireSlot();
  // One browser context per job: closing it tears its renderer down immediately. A bare
  // page.close() leaves the renderer process alive for ~30 s, so back-to-back jobs piled
  // up one extra Chromium process each (see docs/perf.md). Also isolates storage/cache.
  let context: BrowserContext | undefined;
  let page: Page;
  try {
    context = await slot.browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
  } catch (e) {
    await context?.close().catch(() => undefined);
    slot.active--;
    throw e;
  }
  const ctx = context;
  let released = false;
  return {
    page,
    async release() {
      if (released) return;
      released = true;
      await page.close().catch(() => undefined);
      await ctx.close().catch(() => undefined);
      slot.active--;
      if (slot.retired && slot.active === 0) await closeSlot(slot);
    },
  };
}

export async function closeBrowser(): Promise<void> {
  // A launch may still be in flight: wait for it so its browser (added to `all` only once
  // the launch resolves) is closed too instead of outliving shutdown.
  const pending = current;
  current = null;
  await pending?.catch(() => undefined);
  await Promise.all([...all].map(closeSlot));
}
