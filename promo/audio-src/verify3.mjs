// v3 self-check: format/length, clipping, DC, loudness, gap/tail silence, mono lows,
// cue alignment in sfx3.wav (onset / peak / end), kick grid, waveform + spectrogram pictures.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR, S, readWav, svf } from './lib.mjs';

const N = Math.round(SR * 50.0);
const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '.build3');
const OUT = join(HERE, '..', 'reel', 'public', 'audio');
const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;
const dB = (v) => 20 * Math.log10(Math.max(v, 1e-12));

const files = Object.fromEntries(['music3', 'sfx3', 'mix3'].map((k) => [k, readWav(join(OUT, `${k}.wav`))]));
for (const [k, w] of Object.entries(files)) {
  const bits = readFileSync(join(OUT, `${k}.wav`)).readUInt16LE(34);
  let clip = 0, pk = 0; const dc = [];
  for (const c of w.ch) { let s = 0; for (const v of c) { s += v; const a = Math.abs(v); if (a >= 0.999) clip++; if (a > pk) pk = a; } dc.push(s / c.length); }
  console.log(`${k}.wav: ${w.sr} Hz, ${w.ch.length} ch, ${bits}-bit, ${w.n} samples (${(w.n / w.sr).toFixed(6)} s) exact=${w.n === N}, sample peak ${dB(pk).toFixed(2)} dBFS, clipped ${clip}, DC L ${dc[0].toExponential(2)} R ${dc[1].toExponential(2)}`);
}

const e = ff(['-i', join(OUT, 'mix3.wav'), '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
console.log('ebur128 (mix3):\n' + e.slice(e.lastIndexOf('Summary:')).trim());

// master chain alignment vs the un-mastered pre-mix
{
  const a = readWav(join(BUILD, 'mix_pre.wav')).ch[0], b = files.mix3.ch[0];
  let best = -Infinity, bl = 0;
  for (let lag = -480; lag <= 480; lag++) { let s = 0; for (let i = S(0.5); i < S(48); i += 5) s += a[i] * b[i + lag]; if (s > best) { best = s; bl = lag; } }
  console.log(`master chain lag vs pre-mix: ${bl} samples (${(bl / SR * 1000).toFixed(3)} ms)`);
}

// silence checks + mono lows + sample-to-sample jump scan (click detector on the mix)
{
  for (const [k, w] of Object.entries(files)) {
    const mx = (a, b) => { let m = 0; for (const c of w.ch) for (let i = S(a); i < Math.min(N, S(b)); i++) m = Math.max(m, Math.abs(c[i])); return m; };
    console.log(`${k}: max |x| in gap 15.875-16.0 = ${mx(15.875, 16.0).toExponential(2)}, after 49.5 = ${mx(49.5, 50).toExponential(2)}`);
  }
  const [L, R] = files.mix3.ch; const M = new Float32Array(N), Sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { M[i] = (L[i] + R[i]) / 2; Sd[i] = (L[i] - R[i]) / 2; }
  const lp = (x) => svf(svf(x, 'lp', 100, 0.707), 'lp', 100, 0.707);
  const r = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  console.log(`mono lows (mix3, < 100 Hz): side/mid RMS = ${(dB(r(lp(Sd))) - dB(r(lp(M)))).toFixed(1)} dB`);
  // 2nd-difference spikes relative to local level -> click candidates
  const hp = svf(svf(M, 'hp', 12000, 0.7), 'hp', 12000, 0.7); let worst = 0, wt = 0;
  for (let i = S(0.01); i < N - 10; i += 1) { const v = Math.abs(hp[i]); if (v > worst) { worst = v; wt = i / SR; } }
  console.log(`highest >12 kHz sample in mix3: ${dB(worst).toFixed(1)} dBFS at ${wt.toFixed(3)} s`);
}

// ---- cue alignment in sfx3.wav ----
const absEnv = (x) => x.map(Math.abs);
function onset(x, t, { win = 0.02, pre = [0.045, 0.025] } = {}) {
  const a = Math.max(0, S(t - win)), b = S(t + 0.06);
  let lp = 0; for (let i = a; i < b; i++) lp = Math.max(lp, x[i]);
  let floor = 0; for (let i = Math.max(0, S(t - pre[0])); i < Math.max(0, S(t - pre[1])); i++) floor = Math.max(floor, x[i]);
  const thr = Math.max(floor * 2.5, lp * 0.12);
  for (let i = a; i < b; i++) if (x[i] > thr) return (i / SR - t) * 1000;
  return NaN;
}
function rmsEnv(x, w, centered = false) {
  const o = new Float32Array(x.length); let s = 0; const h = centered ? Math.floor(w / 2) : 0;
  for (let i = 0; i < x.length; i++) { s += x[i] * x[i]; if (i >= w) s -= x[i - w] * x[i - w]; const j = i - h; if (j >= 0) o[j] = Math.sqrt(Math.max(0, s) / w); }
  return o;
}
function peakTime(env, t, half) { let bi = 0, bv = -1; for (let i = S(t - half); i < S(t + half); i++) if (env[i] > bv) { bv = env[i]; bi = i; } return (bi / SR - t) * 1000; }
/** end of a sound in the stem: last point where the 2 ms RMS is above 30 % of its mean level 40-10 ms earlier */
function stopTime(env, t) {
  let ref = 0; for (let i = S(t - 0.04); i < S(t - 0.01); i++) ref += env[i]; ref /= S(0.03);
  let last = NaN; for (let i = S(t - 0.03); i < S(t + 0.03); i++) if (env[i] > ref * 0.3) last = i;
  return Number.isFinite(last) && last < S(t + 0.03) - 1 ? (last / SR - t) * 1000 : NaN;
}
const cues = JSON.parse(readFileSync(join(BUILD, 'cues.json'), 'utf8'));
const evIdx = JSON.parse(readFileSync(join(BUILD, 'events.json'), 'utf8'));
const evBuf = readFileSync(join(BUILD, 'events.f32'));
const evAll = new Float32Array(evBuf.buffer.slice(evBuf.byteOffset, evBuf.byteOffset + evBuf.byteLength));
const sx = files.sfx3.ch[0].map((v, i) => v + files.sfx3.ch[1][i]);
const sxAbs = absEnv(sx), sxR2 = rmsEnv(sx, S(0.002), true), sxRc = rmsEnv(sx, S(0.02), true);

/** matched filter: best lag (samples, +-10 ms) of segment seg (placed at sample pos) inside x */
function xlag(x, seg, pos) {
  let best = -Infinity, bl = 0;
  for (let lag = -480; lag <= 480; lag++) { let s2 = 0; const p = pos + lag; for (let i = 0; i < seg.length; i++) s2 += seg[i] * x[p + i]; if (s2 > best) { best = s2; bl = lag; } }
  return bl;
}
function measure(t, kind) {
  // pick the dry event this cue belongs to
  let ev;
  if (kind === 'onset') ev = evIdx.reduce((a, e) => (Math.abs(e.t - t) < Math.abs(a.t - t) ? e : a));
  else if (kind === 'end') ev = evIdx.reduce((a, e) => (Math.abs(e.t + e.len / SR - t) < Math.abs(a.t + a.len / SR - t) ? e : a));
  else ev = evIdx.filter((e) => e.t <= t && t < e.t + e.len / SR).sort((a, b) => b.t - a.t)[0];
  const m = evAll.subarray(ev.off, ev.off + ev.len);
  let pk = 0; for (const v of m) pk = Math.max(pk, Math.abs(v));
  let feat, a, b;
  if (kind === 'onset') {
    let lp = 0; for (let i = 0; i < Math.min(m.length, S(0.06)); i++) lp = Math.max(lp, Math.abs(m[i]));
    feat = 0; while (Math.abs(m[feat]) <= lp * 0.12) feat++;
    a = 0; b = Math.min(m.length, S(0.3));
  } else if (kind === 'end') {
    feat = m.length - 1; while (feat > 0 && Math.abs(m[feat]) < pk * Math.pow(10, -50 / 20)) feat--;
    a = Math.max(0, m.length - S(0.3)); b = m.length;
  } else {
    const env = rmsEnv(m, S(0.02), true); feat = 0; for (let i = 0; i < m.length; i++) if (env[i] > env[feat]) feat = i;
    a = Math.max(0, feat - S(0.15)); b = Math.min(m.length, feat + S(0.15));
  }
  const lag = xlag(sx, m.subarray(a, b), S(ev.t) + a);
  const mf = ((S(ev.t) + feat + lag) / SR - t) * 1000;
  const direct = kind === 'onset' ? onset(sxAbs, t) : kind === 'peak' ? peakTime(sxRc, t, 0.15) : stopTime(sxR2, t);
  return { mf, lag, direct };
}
console.log('\nCue alignment in sfx3.wav. MF = matched filter (dry event located in the stem by cross-correlation, then its');
console.log('onset / peak / end read from the event); DIRECT = detector on the stem alone (n/a = masked by another sound).');
console.log('  cue (s)   kind        MF     DIRECT   label');
let worstMF = 0, worstD = 0, tickMF = 0, tickD = 0, tickN = 0; const fmt = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : 'n/a').padStart(7);
for (const [t, label, kind] of cues) {
  const { mf, direct } = measure(t, kind);
  worstMF = Math.max(worstMF, Math.abs(mf)); if (Number.isFinite(direct)) worstD = Math.max(worstD, Math.abs(direct));
  if (label.startsWith('Key tick')) { tickMF = Math.max(tickMF, Math.abs(mf)); if (Number.isFinite(direct)) { tickN++; tickD = Math.max(tickD, Math.abs(direct)); } }
  console.log(`${t.toFixed(4).padStart(9)}   ${kind.padEnd(5)}  ${fmt(mf)}  ${fmt(direct)}   ${label}`);
}
console.log(`key ticks: MF worst ${tickMF.toFixed(2)} ms; DIRECT detected ${tickN}/33, worst ${tickD.toFixed(2)} ms`);
console.log(`WORST |offset|: MF ${worstMF.toFixed(2)} ms, DIRECT ${worstD.toFixed(2)} ms -> ${Math.max(worstMF, worstD) <= 5 ? 'PASS' : 'FAIL'} (limit 5 ms)`);

// kick grid in music3 (16.0 .. 42.5 + 44.0), matched filter with the kick sample
{
  const mm = files.music3.ch[0].map((v, i) => v + files.music3.ch[1][i]);
  const kick = readWav(join(BUILD, 'kick.wav')).ch[0].subarray(0, S(0.12));
  const ts = []; for (let t = 16; t < 43 - 1e-9; t += 0.5) ts.push(t); ts.push(44);
  let w = 0; for (const t of ts) w = Math.max(w, Math.abs(xlag(mm, kick, S(t))));
  console.log(`music3 kicks: ${ts.length} on the grid, worst matched-filter lag ${(w / SR * 1000).toFixed(3)} ms`);
}

ff(['-i', join(OUT, 'mix3.wav'), '-filter_complex', 'showwavespic=s=2000x400:split_channels=1:colors=0x3D7BFF|0xFF3D9A', '-frames:v', '1', join(BUILD, 'mix3_wave.png')]);
ff(['-i', join(OUT, 'mix3.wav'), '-lavfi', 'showspectrumpic=s=1600x600:legend=1:scale=log:fscale=log', join(BUILD, 'mix3_spec.png')]);
ff(['-i', join(OUT, 'sfx3.wav'), '-filter_complex', 'showwavespic=s=2000x300:split_channels=0:colors=0x2BB673', '-frames:v', '1', join(BUILD, 'sfx3_wave.png')]);
console.log('pictures:', join(BUILD, 'mix3_wave.png'), join(BUILD, 'mix3_spec.png'), join(BUILD, 'sfx3_wave.png'));
