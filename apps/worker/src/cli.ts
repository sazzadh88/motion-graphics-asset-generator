import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { renderVideo, shutdown } from './index';
import type { RenderProgress } from './index';

const USAGE = `Usage: npm run render -w @mg/worker -- <payload.json> [--format mp4|webm] [--out path] [--frames start:end] [--stats]
  The JSON is a render payload; for a generated (gen_…) template add its mg-scene@1 document as a top-level "scene" field.`;

function fail(msg: string): never {
  process.stderr.write(`\nError: ${msg}\n`);
  process.exit(1);
}

interface Args {
  file: string;
  format: 'mp4' | 'webm';
  out?: string;
  frames?: { start: number; end: number };
  stats: boolean;
}

function parseArgs(argv: string[]): Args {
  let file: string | undefined;
  let format: 'mp4' | 'webm' = 'mp4';
  let out: string | undefined;
  let frames: Args['frames'];
  let stats = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const val = () => argv[++i] ?? fail(`${a} needs a value\n${USAGE}`);
    if (a === '--format') {
      const f = val();
      if (f !== 'mp4' && f !== 'webm') fail(`--format must be mp4 or webm\n${USAGE}`);
      format = f;
    } else if (a === '--out') out = val();
    else if (a === '--frames') {
      const m = /^(\d+):(\d+)$/.exec(val());
      if (!m) fail(`--frames must look like start:end (end exclusive)\n${USAGE}`);
      frames = { start: Number(m[1]), end: Number(m[2]) };
    } else if (a === '--stats') stats = true;
    else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`);
    else file = a;
  }
  if (!file) fail(USAGE);
  return { file, format, out, frames, stats };
}


/** Sum of working-set memory (MB) of Chromium processes launched by puppeteer (Windows: by profile dir). */
function chromiumRssMb(): Promise<number | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const ps =
      "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*puppeteer_dev_chrome_profile*' } | Measure-Object -Property WorkingSetSize -Sum).Sum";
    execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, stdout) => {
      const n = Number(stdout.trim());
      resolve(err || !Number.isFinite(n) || n === 0 ? null : n / 1048576);
    });
  });
}

function startStats() {
  const nodeSamples: number[] = [];
  const chromeSamples: number[] = [];
  let busy = false;
  const sample = async () => {
    if (busy) return;
    busy = true;
    nodeSamples.push(process.memoryUsage().rss / 1048576);
    const c = await chromiumRssMb();
    if (c !== null) chromeSamples.push(c);
    busy = false;
  };
  void sample();
  const t = setInterval(() => void sample(), 1000);
  return async () => {
    clearInterval(t);
    await sample();
    const fmt = (s: number[]) =>
      s.length ? `start ${s[0]!.toFixed(0)} / peak ${Math.max(...s).toFixed(0)} / end ${s[s.length - 1]!.toFixed(0)} MB (${s.length} samples)` : 'n/a';
    process.stdout.write(`Memory  Node RSS: ${fmt(nodeSamples)}\n`);
    process.stdout.write(`        Chromium (all procs, working set): ${fmt(chromeSamples)}\n`);
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(args.file, 'utf8'));
  } catch (e) {
    fail(`cannot read payload ${args.file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Optional top-level `scene`: the mg-scene@1 document of a generated template.
  let scene: unknown;
  if (typeof payload === 'object' && payload !== null && 'scene' in payload) {
    const { scene: s, ...rest } = payload as Record<string, unknown>;
    scene = s;
    payload = rest;
  }
  const out = path.resolve(args.out ?? path.join('output', `${path.basename(args.file, '.json')}.${args.format}`));

  const tty = process.stdout.isTTY;
  let lastDecile = -1;
  const onProgress = (p: RenderProgress) => {
    const w = 24;
    const filled = Math.round((p.percent / 100) * w);
    const bar = '#'.repeat(filled) + '-'.repeat(w - filled);
    const line = `[${bar}] ${String(p.percent).padStart(3)}%  ${p.phase.padEnd(9)} ${p.frame}/${p.totalFrames}  ${p.fps.toFixed(1)} fps`;
    if (tty) process.stdout.write(`\r${line}\x1b[K`);
    else if (Math.floor(p.percent / 10) !== lastDecile || p.phase === 'done') {
      lastDecile = Math.floor(p.percent / 10);
      process.stdout.write(line + '\n');
    }
  };

  const stopStats = args.stats ? startStats() : null;
  const ac = new AbortController();
  process.once('SIGINT', () => ac.abort());
  try {
    const r = await renderVideo(payload, {
      scene,
      format: args.format,
      outPath: out,
      frames: args.frames,
      signal: ac.signal,
      onProgress,
      onWarning: (m) => process.stderr.write(`${tty ? '\r\x1b[K' : ''}warning: ${m}\n`),
    });
    if (tty) process.stdout.write('\n');
    const secs = r.elapsedMs / 1000;
    process.stdout.write(
      `Done: ${r.outPath}\n` +
        `  ${(r.bytes / 1048576).toFixed(2)} MB, ${r.frames} frames, ${r.width}x${r.height} @ ${r.fps}fps ${r.format}\n` +
        `  elapsed ${secs.toFixed(1)}s, render speed ${(r.frames / secs).toFixed(1)} frames/s\n`,
    );
    if (stopStats) await stopStats();
    await shutdown();
    process.exit(0);
  } catch (e) {
    await shutdown().catch(() => undefined);
    fail(e instanceof Error ? e.message : String(e));
  }
}

void main();
