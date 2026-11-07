// Self-check for the delivered audio: format/length, clipping, DC, loudness, cue alignment, pictures.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR, N, S, readWav, svf } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '.build');
const OUT = join(HERE, '..', 'reel', 'public', 'audio');
const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;

const files = Object.fromEntries(['music', 'sfx', 'mix'].map((k) => [k, readWav(join(OUT, `${k}.wav`))]));
for (const [k, w] of Object.entries(files)) {
  let clip = 0, pk = 0; const dc = [];
  for (const c of w.ch) { let s = 0; for (const v of c) { s += v; const a = Math.abs(v); if (a >= 0.999) clip++; if (a > pk) pk = a; } dc.push(s / c.length); }
  console.log(`${k}.wav: ${w.sr} Hz, ${w.ch.length} ch, ${w.n} samples (${(w.n / w.sr).toFixed(6)} s) exact=${w.n === N}, sample peak ${(20 * Math.log10(pk)).toFixed(2)} dBFS, clipped samples ${clip}, DC L ${dc[0].toExponential(2)} R ${dc[1].toExponential(2)}`);
}

// loudness (ebur128 with true peak)
const e = ff(['-i', join(OUT, 'mix.wav'), '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
console.log('ebur128 summary:\n' + e.slice(e.lastIndexOf('Summary:')).trim());

// global alignment: mastered mix vs unmastered pre-mix (cross-correlation, +-10 ms)
{
  const a = readWav(join(BUILD, 'mix_pre.wav')).ch[0], b = files.mix.ch[0];
  let best = 0, bl = 0;
  for (let lag = -480; lag <= 480; lag++) {
    let s = 0; for (let i = S(0.2); i < S(26); i += 3) s += a[i] * b[i + lag];
    if (s > best) { best = s; bl = lag; }
  }
  console.log(`master chain lag vs pre-mix: ${bl} samples (${(bl / SR * 1000).toFixed(3)} ms)`);
}

const absEnv = (x) => x.map(Math.abs);
function onset(x, t, { win = 0.02, pre = [0.045, 0.025] } = {}) {
  const a = Math.max(0, S(t - win)), b = S(t + 0.06);
  let lp = 0; for (let i = a; i < b; i++) lp = Math.max(lp, x[i]);
  let floor = 0; for (let i = Math.max(0, S(t - pre[0])); i < Math.max(0, S(t - pre[1])); i++) floor = Math.max(floor, x[i]);
  const thr = Math.max(floor * 2.5, lp * 0.12);
  for (let i = a; i < b; i++) if (x[i] > thr) return (i / SR - t) * 1000;
  return NaN;
}
function rmsEnv(x, w) { const o = new Float32Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i] * x[i]; if (i >= w) s -= x[i - w] * x[i - w]; o[i] = Math.sqrt(Math.max(0, s) / w); } return o; }
function peakTime(env, t, half, w) { let bi = 0, bv = -1; for (let i = S(t - half); i < S(t + half); i++) if (env[i] > bv) { bv = env[i]; bi = i; } return ((bi - w / 2) / SR - t) * 1000; }
function stopTime(env, t) { // where the 2 ms RMS falls >20 dB below its level 30 ms earlier
  const ref = env[S(t - 0.03)];
  for (let i = S(t - 0.03); i < S(t + 0.03); i++) if (env[i] < ref * 0.1) return (i / SR - t) * 1000;
  return NaN;
}

const cues = JSON.parse(readFileSync(join(BUILD, 'cues.json'), 'utf8'));
const sfxM = files.sfx.ch[0].map((v, i) => v + files.sfx.ch[1][i]);
const mixM = files.mix.ch[0].map((v, i) => v + files.mix.ch[1][i]);
const sfxAbs = absEnv(sfxM);
const mixHP = absEnv(svf(svf(mixM, 'hp', 1500, 0.7), 'hp', 1500, 0.7));
const mixAbs = absEnv(mixM);
const W = S(0.02), sfxR = rmsEnv(sfxM, W), sfxR2 = rmsEnv(sfxM, S(0.002));
// tick times
const all = [...cues];
for (let k = 1; k < 18; k++) all.push([+(4.2 + k * 0.1).toFixed(1), 'Key tick', 'onset']);
all.sort((a, b) => a[0] - b[0]);
console.log('\ncue      kind   sfx.wav offset   mix.wav offset   label');
let worst = 0;
for (const [t, label, kind] of all) {
  let o1, o2;
  if (kind === 'onset') { o1 = onset(sfxAbs, t); o2 = onset(t === 8 || t === 24 ? mixAbs : mixHP, t); }
  else if (kind === 'peak') { o1 = peakTime(sfxR, t, 0.15, W); o2 = NaN; }
  else { o1 = stopTime(sfxR2, t); o2 = NaN; }
  if (Number.isFinite(o1)) worst = Math.max(worst, Math.abs(o1));
  const f = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)} ms` : '   -   ').padStart(10);
  console.log(`${t.toFixed(3).padStart(6)}  ${kind.padEnd(5)}  ${f(o1)}       ${f(o2)}       ${label}`);
}
console.log(`worst sfx cue offset: ${worst.toFixed(2)} ms`);

// music grid: kick onsets (low band) and clap onsets
{
  const mm = files.music.ch[0].map((v, i) => v + files.music.ch[1][i]);
  const low = absEnv(mm); let w = 0;
  const ts = []; for (let b = 0; b < 32; b++) ts.push(8 + b * 0.5); ts.push(24);
  for (const t of ts) { const o = onset(low, t, { win: 0.003, pre: [0.0035, 0.0005] }); if (Number.isFinite(o)) w = Math.max(w, Math.abs(o)); }
  console.log(`music kick onsets 8.0..24.0 (33 kicks): worst offset ${w.toFixed(2)} ms`);
  // section levels
  const seg = (a, b) => { let s = 0; for (let i = S(a); i < S(b); i++) s += mm[i] * mm[i]; return (10 * Math.log10(s / (S(b) - S(a)) + 1e-20)).toFixed(1); };
  console.log(`music RMS dB: intro 0-4 ${seg(0, 4)}, 4-7.8 ${seg(4, 7.8)}, gap 7.876-7.999 ${seg(7.876, 7.999)}, drop 8-20 ${seg(8, 20)}, 20-24 ${seg(20, 24)}, 24-25.5 ${seg(24, 25.5)}, 26.5-27.4 ${seg(26.5, 27.4)}, 27.5-28 ${seg(27.5, 28)}`);
  const xs = files.mix.ch[0].map((v, i) => v + files.mix.ch[1][i]);
  let s = 0; for (let i = S(27.5); i < N; i++) s = Math.max(s, Math.abs(xs[i]));
  console.log(`mix max abs 27.5-28.0: ${s.toExponential(2)}`);
}

// pictures
ff(['-i', join(OUT, 'mix.wav'), '-filter_complex', 'showwavespic=s=1680x360:split_channels=1:colors=0x3D7BFF|0xFF3D9A', '-frames:v', '1', join(BUILD, 'mix_wave.png')]);
ff(['-i', join(OUT, 'mix.wav'), '-lavfi', 'showspectrumpic=s=1400x500:legend=1:scale=log:fscale=log', join(BUILD, 'mix_spec.png')]);
console.log('pictures:', join(BUILD, 'mix_wave.png'), join(BUILD, 'mix_spec.png'));
