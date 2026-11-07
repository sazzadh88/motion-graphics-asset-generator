import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultPayload } from '@mg/engine';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { acquirePage, closeBrowser } from '../src/browser';
import { renderVideo, shutdown } from '../src/index';
import { probe } from './helpers';

const dir = mkdtempSync(path.join(tmpdir(), 'mg-browser-'));
afterAll(async () => {
  await shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function payload(frames: number) {
  const p = defaultPayload('kinetic_text_v1');
  p.settings = { ...p.settings, width: 360, height: 640, fps: 30, durationFrames: frames, transparent: false };
  return p;
}

async function browserPid(): Promise<number> {
  const jp = await acquirePage(16, 16);
  const pid = jp.page.browser().process()?.pid;
  await jp.release();
  if (!pid) throw new Error('no browser pid');
  return pid;
}

function killTree(pid: number) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
  else process.kill(pid, 'SIGKILL');
}

/** Number of processes in the Chromium tree rooted at `pid` (including the root). */
function treeSize(pid: number): number {
  const out =
    process.platform === 'win32'
      ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { encoding: 'utf8', windowsHide: true })
      : execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  const kids = new Map<number, number[]>();
  for (const line of out.split(/\r?\n/)) {
    const [c, p] = line.trim().split(/\s+/).map(Number);
    if (c && p !== undefined) kids.set(p, [...(kids.get(p) ?? []), c]);
  }
  let n = 0;
  const stack = [pid];
  while (stack.length) {
    n++;
    stack.push(...(kids.get(stack.pop()!) ?? []));
  }
  return n;
}

describe('browser manager', () => {
  it('closeBrowser() also closes a browser whose launch is still in flight', async () => {
    await closeBrowser(); // start from no browser
    const realLaunch = puppeteer.launch.bind(puppeteer);
    const launched: Browser[] = [];
    const spy = vi.spyOn(puppeteer, 'launch').mockImplementation(async (opts) => {
      const b = await realLaunch(opts);
      launched.push(b);
      return b;
    });
    try {
      // Starts a launch; closeBrowser() runs before it resolves.
      const acquiring = acquirePage(16, 16).then(
        (jp) => jp.release(),
        () => undefined,
      );
      await closeBrowser();
      // Before the fix closeBrowser() returned at once and this browser stayed open.
      expect(launched.length).toBe(1);
      expect(launched[0]!.connected).toBe(false);
      await acquiring;
    } finally {
      spy.mockRestore();
      await closeBrowser();
    }
  }, 60_000);

  it('does not accumulate Chromium processes across sequential jobs', async () => {
    const pid = await browserPid();
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      await renderVideo(payload(5), { format: 'mp4', outPath: path.join(dir, `seq${i}.mp4`) });
      counts.push(treeSize(pid));
    }
    expect(await browserPid()).toBe(pid);
    // Before the fix each closed page left its renderer alive (~30 s): counts grew by ~1 per job.
    expect(counts[3]).toBeLessThanOrEqual(counts[0]!);
  }, 180_000);

  it('rejects with a clear error when Chromium dies mid-render, leaves no .part, and relaunches', async () => {
    const pid = await browserPid();
    const out = path.join(dir, 'victim.mp4');
    let killed = false;
    const job = renderVideo(payload(600), {
      format: 'mp4',
      outPath: out,
      onProgress: (p) => {
        if (!killed && p.frame >= 20) {
          killed = true;
          killTree(pid);
        }
      },
    });
    await expect(job).rejects.toThrow(/Chromium exited during render/);
    expect(killed).toBe(true);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith('.part'))).toEqual([]);

    const next = path.join(dir, 'next.mp4');
    await renderVideo(payload(15), { format: 'mp4', outPath: next });
    expect(probe(next).nb_read_frames).toBe('15');
    expect(await browserPid()).not.toBe(pid);
  }, 180_000);
});
