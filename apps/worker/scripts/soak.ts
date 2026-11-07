/**
 * Soak / recycling / crash-recovery checks for the render worker.
 *
 *   npx tsx scripts/soak.ts                 # all checks, each in its own child process
 *   npx tsx scripts/soak.ts --check long    # one check: long | recycle | concurrency | crash | throughput
 *   options: --long-frames N (default 3600)  --keep (keep rendered files)
 *
 * Chromium memory/PIDs are measured over the process tree rooted at THIS Node process
 * (Windows: Get-CimInstance Win32_Process), so other Chrome instances on the machine are ignored.
 */
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { renderVideo, shutdown } from '../src/index';
import type { RenderResult } from '../src/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(HERE, '..', 'samples');
const RESULT_TAG = '@@SOAK_RESULT ';
const CHECKS = ['throughput', 'long', 'recycle', 'concurrency', 'crash'] as const;
type Check = (typeof CHECKS)[number];

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const KEEP = argv.includes('--keep');
const LONG_FRAMES = Number(opt('--long-frames') ?? 3600);

function sample(name: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(SAMPLES, `${name}.json`), 'utf8'));
}
function withSettings(p: Record<string, any>, s: Record<string, unknown>): Record<string, any> {
  return { ...p, settings: { ...p.settings, ...s } };
}

// ---------------------------------------------------------------- process tree

interface Proc {
  pid: number;
  ppid: number;
  name: string;
  ws: number;
}
function listProcs(): Promise<Proc[]> {
  const ps =
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize),$($_.Name)" }';
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, maxBuffer: 1 << 24 }, (err, out) => {
      if (err) return reject(err);
      resolve(
        out
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => {
            const [pid, ppid, ws, ...name] = l.split(',');
            return { pid: Number(pid), ppid: Number(ppid), ws: Number(ws), name: name.join(',').toLowerCase() };
          }),
      );
    });
  });
}
function descendants(all: Proc[], root: number): Proc[] {
  const kids = new Map<number, Proc[]>();
  for (const p of all) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)!).push(p);
  const out: Proc[] = [];
  const stack = [root];
  const seen = new Set<number>([root]);
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      out.push(c);
      stack.push(c.pid);
    }
  }
  return out;
}
/** Chromium trees launched by this process: root PIDs, total process count, total working set (MB). */
async function chromium() {
  const all = await listProcs();
  const mine = descendants(all, process.pid).filter((p) => p.name === 'chrome.exe');
  const roots = mine.filter((p) => p.ppid === process.pid).map((p) => p.pid);
  const wsMb = mine.reduce((a, p) => a + p.ws, 0) / 1048576;
  const ffmpeg = descendants(all, process.pid).filter((p) => p.name === 'ffmpeg.exe').map((p) => p.pid);
  return { roots, count: mine.length, wsMb, ffmpeg };
}
function killTree(pid: number) {
  spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
}

// ---------------------------------------------------------------- verification

function probeFrames(file: string): { frames: number; width: number; height: number; fps: string } {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_frames', '-of', 'json', file],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`);
  const s = JSON.parse(r.stdout).streams[0];
  return { frames: Number(s.nb_read_frames), width: s.width, height: s.height, fps: s.avg_frame_rate };
}
function valid(file: string, p: Record<string, any>): boolean {
  const s = probeFrames(file);
  return (
    s.frames === p.settings.durationFrames && s.width === p.settings.width && s.height === p.settings.height && s.fps === `${p.settings.fps}/1`
  );
}
function partFiles(dir: string) {
  return readdirSync(dir).filter((f) => f.endsWith('.part'));
}

// ---------------------------------------------------------------- stats helpers

const r1 = (n: number) => Math.round(n * 10) / 10;
function slopePerMin(xsSec: number[], ys: number[]): number {
  const n = xsSec.length;
  if (n < 2) return 0;
  const mx = xsSec.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xsSec[i]! - mx) * (ys[i]! - my);
    den += (xsSec[i]! - mx) ** 2;
  }
  return den ? (num / den) * 60 : 0;
}
function series(name: string, t: number[], v: number[]) {
  const half = Math.floor(v.length / 2);
  return {
    metric: name,
    start: r1(v[0] ?? 0),
    peak: r1(Math.max(...v)),
    end: r1(v[v.length - 1] ?? 0),
    slopeSecondHalfMbPerMin: r1(slopePerMin(t.slice(half), v.slice(half))),
  };
}

// ---------------------------------------------------------------- checks

async function checkThroughput(dir: string) {
  const rows: Record<string, unknown>[] = [];
  // Warm the browser once so launch cost is excluded.
  await renderVideo(withSettings(sample('banner'), { durationFrames: 10 }), { format: 'mp4', outPath: path.join(dir, 'warm.mp4') });
  for (const name of ['banner', 'promo_card', 'kinetic_text', 'kinetic_transparent']) {
    const p = sample(name);
    const format = p.settings.transparent ? 'webm' : 'mp4';
    const out = path.join(dir, `tp_${name}.${format}`);
    const r = await renderVideo(p, { format, outPath: out });
    rows.push({
      sample: name,
      size: `${r.width}x${r.height}`,
      fps: r.fps,
      format,
      frames: r.frames,
      seconds: r1(r.elapsedMs / 1000),
      framesPerSec: r1(r.frames / (r.elapsedMs / 1000)),
      realtimeX: r1(r.frames / r.fps / (r.elapsedMs / 1000)),
      valid: valid(out, p),
    });
  }
  return { rows };
}

async function checkLong(dir: string) {
  const p = withSettings(sample('kinetic_text'), { width: 1080, height: 1920, fps: 60, durationFrames: LONG_FRAMES });
  const out = path.join(dir, 'long.mp4');
  const t: number[] = [];
  const nodeRss: number[] = [];
  const nodeHeap: number[] = [];
  const chrome: number[] = [];
  const chromeProcs: number[] = [];
  const fpsS: number[] = [];
  let frame = 0;
  let lastFrame = 0;
  let lastT = performance.now();
  const t0 = performance.now();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = performance.now();
      const c = await chromium();
      const m = process.memoryUsage();
      t.push((now - t0) / 1000);
      nodeRss.push(m.rss / 1048576);
      nodeHeap.push(m.heapUsed / 1048576);
      chrome.push(c.wsMb);
      chromeProcs.push(c.count);
      fpsS.push(((frame - lastFrame) * 1000) / (now - lastT));
      lastFrame = frame;
      lastT = now;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  let r: RenderResult;
  try {
    r = await renderVideo(p, { format: 'mp4', outPath: out, onProgress: (x) => (frame = x.frame) });
  } finally {
    clearInterval(timer);
  }
  const probed = probeFrames(out);
  // fps samples: drop warm-up (first) and the tail sample after capture ended.
  const fpsBody = fpsS.slice(1).filter((x) => x > 0);
  return {
    frames: r.frames,
    seconds: r1(r.elapsedMs / 1000),
    avgFps: r1(r.frames / (r.elapsedMs / 1000)),
    sampleFps: { min: r1(Math.min(...fpsBody)), max: r1(Math.max(...fpsBody)), firstHalf: r1(avg(fpsBody.slice(0, fpsBody.length / 2))), secondHalf: r1(avg(fpsBody.slice(fpsBody.length / 2))) },
    samples: t.length,
    memory: [series('Node RSS (MB)', t, nodeRss), series('Node heapUsed (MB)', t, nodeHeap), series('Chromium tree working set (MB)', t, chrome)],
    chromiumProcs: { min: Math.min(...chromeProcs), max: Math.max(...chromeProcs) },
    ffprobeFrames: probed.frames,
    framesExact: probed.frames === LONG_FRAMES,
    bytes: r.bytes,
  };
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function checkRecycle(dir: string) {
  const maxJobs = Number(process.env.MG_BROWSER_MAX_JOBS ?? 20);
  const p = withSettings(sample('banner'), { durationFrames: 60 });
  const before = await chromium();
  const jobs: { job: number; root: number[]; procsAfter: number; valid: boolean }[] = [];
  const rootsSeen: number[] = [];
  for (let i = 1; i <= 22; i++) {
    const out = path.join(dir, `recycle_${i}.mp4`);
    let during: number[] = [];
    const watcher = (async () => {
      // Sample the tree while the job runs (first sample is enough to identify the browser).
      await new Promise((r) => setTimeout(r, 300));
      during = (await chromium()).roots;
    })();
    await renderVideo(p, { format: 'mp4', outPath: out });
    await watcher;
    const after = await chromium();
    for (const r of [...during, ...after.roots]) if (!rootsSeen.includes(r)) rootsSeen.push(r);
    jobs.push({ job: i, root: after.roots, procsAfter: after.count, valid: valid(out, p) });
  }
  // Expected browser index for job i: floor((i-1)/maxJobs).
  const expectedLaunches = Math.ceil(22 / maxJobs);
  const groupsOk = jobs.every((j, idx) => j.root.length === 1 && j.root[0] === rootsSeen[Math.floor(idx / maxJobs)]);
  const procCounts = jobs.map((j) => j.procsAfter);
  await shutdown();
  const end = await chromium();
  return {
    maxJobs,
    launches: rootsSeen.length,
    expectedLaunches,
    rootPids: rootsSeen,
    switchesAtExpectedJobs: groupsOk,
    maxBrowsersAliveBetweenJobs: Math.max(...jobs.map((j) => j.root.length)),
    procsBetweenJobs: { min: Math.min(...procCounts), max: Math.max(...procCounts) },
    procCountsPerJob: procCounts.join(" "),
    procsBefore: before.count,
    procsAfterShutdown: end.count,
    allValid: jobs.every((j) => j.valid),
    jobs: jobs.length,
  };
}

async function checkConcurrency(dir: string) {
  const payloads = [
    withSettings(sample('banner'), { durationFrames: 90 }),
    withSettings(sample('promo_card'), { durationFrames: 75, width: 720, height: 720 }),
    withSettings(sample('kinetic_text'), { durationFrames: 120, width: 540, height: 960, fps: 30 }),
  ];
  let peakRoots = 0;
  let peakPages = 0;
  let running = true;
  const watcher = (async () => {
    while (running) {
      const c = await chromium();
      peakRoots = Math.max(peakRoots, c.roots.length);
      peakPages = Math.max(peakPages, c.count);
    }
  })();
  const t0 = performance.now();
  const results = await Promise.allSettled(
    payloads.map((p, i) => renderVideo(p, { format: 'mp4', outPath: path.join(dir, `conc_${i}.mp4`) })),
  );
  const wall = (performance.now() - t0) / 1000;
  running = false;
  await watcher;
  const rows = results.map((r, i) => {
    const p = payloads[i]!;
    if (r.status === 'rejected') return { job: i, template: p.templateId, ok: false, error: String(r.reason) };
    const s = probeFrames(r.value.outPath);
    return {
      job: i,
      template: p.templateId,
      expected: `${p.settings.width}x${p.settings.height} ${p.settings.durationFrames}f`,
      got: `${s.width}x${s.height} ${s.frames}f`,
      ok: valid(r.value.outPath, p),
    };
  });
  const totalFrames = payloads.reduce((a, p) => a + p.settings.durationFrames, 0);
  return { rows, allOk: rows.every((r) => r.ok), wallSeconds: r1(wall), aggregateFps: r1(totalFrames / wall), browsersAlive: peakRoots, peakChromiumProcs: peakPages };
}

async function checkCrash(dir: string) {
  const p = withSettings(sample('kinetic_text'), { durationFrames: 600, width: 540, height: 960, fps: 30 });
  const small = withSettings(sample('banner'), { durationFrames: 30 });
  const out: Record<string, unknown>[] = [];

  for (const victim of ['chromium', 'ffmpeg'] as const) {
    const sub = mkdtempSync(path.join(dir, `crash_${victim}_`));
    // Warm-up job so the browser exists, then start the long one and kill mid-render.
    await renderVideo(small, { format: 'mp4', outPath: path.join(sub, 'warm.mp4') });
    const before = await chromium();
    let frame = 0;
    let killedAt = -1;
    let killedPid = -1;
    let t0 = performance.now();
    const job = renderVideo(p, { format: 'mp4', outPath: path.join(sub, 'victim.mp4'), onProgress: (x) => (frame = x.frame) });
    const killer = (async () => {
      while (frame < 100) await new Promise((r) => setTimeout(r, 50));
      const c = await chromium();
      const pid = victim === 'chromium' ? c.roots[0] : c.ffmpeg[0];
      if (pid === undefined) throw new Error(`no ${victim} process found`);
      killedAt = frame;
      killedPid = pid;
      t0 = performance.now();
      killTree(pid);
    })();
    let error = '';
    let rejected = false;
    try {
      await job;
    } catch (e) {
      rejected = true;
      error = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    }
    const rejectMs = Math.round(performance.now() - t0);
    await killer;
    await new Promise((r) => setTimeout(r, 500));
    const parts = partFiles(sub);
    const victimExists = existsSync(path.join(sub, 'victim.mp4'));
    // Next job must succeed (relaunching the browser if it died).
    let nextOk = false;
    let nextError = '';
    try {
      const nx = path.join(sub, 'next.mp4');
      await renderVideo(small, { format: 'mp4', outPath: nx });
      nextOk = valid(nx, small);
    } catch (e) {
      nextError = e instanceof Error ? e.message : String(e);
    }
    const after = await chromium();
    out.push({
      victim,
      killedPid,
      killedAtFrame: killedAt,
      rejected,
      error,
      rejectMsAfterKill: rejectMs,
      partFiles: parts.length,
      outputLeft: victimExists,
      nextJobOk: nextOk,
      nextError,
      browserBefore: before.roots.join(','),
      browserAfter: after.roots.join(','),
      browserOk: victim === 'chromium' ? after.roots.length === 1 && after.roots[0] !== before.roots[0] : after.roots[0] === before.roots[0],
      strayFfmpeg: after.ffmpeg.length,
    });
  }
  await shutdown();
  const end = await chromium();
  return { rows: out, chromiumProcsAfterShutdown: end.count, ffmpegAfterShutdown: end.ffmpeg.length };
}

// ---------------------------------------------------------------- runners

async function runOne(check: Check) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `mg-soak-${check}-`));
  try {
    const fn = { throughput: checkThroughput, long: checkLong, recycle: checkRecycle, concurrency: checkConcurrency, crash: checkCrash }[check];
    const res = await fn(dir);
    await shutdown();
    const left = await chromium();
    process.stdout.write(RESULT_TAG + JSON.stringify({ check, ok: true, result: res, leftoverChromium: left.count, leftoverFfmpeg: left.ffmpeg.length }) + '\n');
  } catch (e) {
    await shutdown().catch(() => undefined);
    process.stdout.write(RESULT_TAG + JSON.stringify({ check, ok: false, error: e instanceof Error ? e.stack : String(e) }) + '\n');
    process.exitCode = 1;
  } finally {
    if (!KEEP) rmSync(dir, { recursive: true, force: true });
    else process.stderr.write(`kept outputs in ${dir}\n`);
  }
}

function runChild(check: Check, env: NodeJS.ProcessEnv): Promise<any> {
  return new Promise((resolve) => {
    const args = ['--import', 'tsx', fileURLToPath(import.meta.url), '--check', check, '--long-frames', String(LONG_FRAMES)];
    if (KEEP) args.push('--keep');
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    let buf = '';
    let result: any = { check, ok: false, error: 'no result' };
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith(RESULT_TAG)) result = JSON.parse(line.slice(RESULT_TAG.length));
        else process.stdout.write(line + '\n');
      }
    });
    child.on('close', () => resolve(result));
  });
}

function table(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => '| ' + vals.map((v, i) => v.padEnd(w[i]!)).join(' | ') + ' |';
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join('\n');
}

function summarize(results: any[]) {
  const o = (s: string) => process.stdout.write(s + '\n');
  o(`\n=== Soak summary  (${os.cpus()[0]?.model.trim()} x${os.cpus().length}, ${r1(os.totalmem() / 2 ** 30)} GB RAM, ${os.platform()} ${os.release()}, node ${process.version})`);
  for (const r of results) {
    o(`\n## ${r.check}: ${r.ok ? 'completed' : 'FAILED'}`);
    if (!r.ok) {
      o(r.error);
      continue;
    }
    const x = r.result;
    if (r.check === 'throughput' || r.check === 'concurrency' || r.check === 'crash') o(table(x.rows));
    if (r.check === 'long') {
      o(table(x.memory));
      const { memory: _m, ...rest } = x;
      o(table([rest]));
    }
    if (r.check === 'recycle') o(table([x]));
    if (r.check === 'concurrency') o(`wall ${x.wallSeconds}s, aggregate ${x.aggregateFps} frames/s, browsers alive ${x.browsersAlive}, peak chromium procs ${x.peakChromiumProcs}`);
    if (r.check === 'crash') o(`chromium procs after shutdown ${x.chromiumProcsAfterShutdown}, ffmpeg ${x.ffmpegAfterShutdown}`);
    o(`leftover after shutdown: chromium ${r.leftoverChromium}, ffmpeg ${r.leftoverFfmpeg}`);
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('process-tree sampling is implemented for Windows only');
  const only = opt('--check') as Check | undefined;
  if (only) {
    if (!CHECKS.includes(only)) throw new Error(`--check must be one of ${CHECKS.join(', ')}`);
    return runOne(only);
  }
  const results = [];
  for (const c of CHECKS) {
    process.stdout.write(`\n--- running ${c} ...\n`);
    results.push(await runChild(c, c === 'recycle' ? { MG_BROWSER_MAX_JOBS: '5' } : {}));
  }
  summarize(results);
  if (argv.includes('--json')) process.stdout.write('\n' + JSON.stringify(results, null, 2) + '\n');
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

void main();
