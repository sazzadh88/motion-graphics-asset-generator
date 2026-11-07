// v3 master: reverb (ffmpeg afir), stem finishing (mono lows, gap, final fade), gentle ducking,
// glue, oversampled true-peak limiting, two-pass loudnorm to -14 LUFS / <= -1 dBTP.
// Writes promo/reel/public/audio/{music3,sfx3,mix3}.wav (48 kHz stereo 24-bit, exactly 50.000 s).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR, S, db, readWav, writeWav, svf, onepoleHP } from './lib.mjs';

const N = Math.round(SR * 50.0);
const GAP0 = 15.875, DROP = 16.0, SILENT = 49.5;
const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '.build3');
const OUT = join(HERE, '..', 'reel', 'public', 'audio');
mkdirSync(OUT, { recursive: true });

function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr); throw new Error('ffmpeg failed: ' + args.join(' ')); }
  return r.stderr;
}
const exact = `atrim=end_sample=${N},apad=whole_len=${N}`;
const rc = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

// ---- 1. reverb: convolve each send separately (A = pre-gap, B = from the drop) ----
for (const s of ['music_sendA', 'music_sendB', 'sfx_sendA', 'sfx_sendB']) {
  ff(['-i', join(BUILD, `${s}.wav`), '-i', join(BUILD, 'ir.wav'), '-filter_complex',
    `[0:a][1:a]afir=gtype=none:irnorm=-1:maxp=8192:minp=256,${exact}[o]`, '-map', '[o]', '-c:a', 'pcm_f32le', join(BUILD, `${s}_wet.wav`)]);
}
const rms = (ch, a = 0, b = N) => { let s = 0; for (const c of ch) for (let i = a; i < b; i++) s += c[i] * c[i]; return Math.sqrt(s / (ch.length * (b - a))); };
const peak = (ch) => { let m = 0; for (const c of ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return m; };

function finish(name, wetRatio, fadeStart) {
  const main = readWav(join(BUILD, `${name}_main.wav`)).ch;
  const sA = readWav(join(BUILD, `${name}_sendA.wav`)).ch, sB = readWav(join(BUILD, `${name}_sendB.wav`)).ch;
  const wA = readWav(join(BUILD, `${name}_sendA_wet.wav`)).ch, wB = readWav(join(BUILD, `${name}_sendB_wet.wav`)).ch;
  const send = sA.map((c, k) => c.map((v, i) => v + sB[k][i]));
  const wet = wA.map((c, k) => c.map((v, i) => v + wB[k][i]));
  const g = wetRatio * rms(send) / Math.max(1e-9, rms(wet));
  // pre-gap reverb tails are cut at the gap (4 ms fade) and never come back
  const a = S(GAP0), f = S(0.004);
  for (const c of wA) for (let i = a - f; i < N; i++) c[i] *= i < a ? rc((a - i) / f) : 0;
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    L[i] = main[0][i] + (wA[0][i] + wB[0][i]) * g;
    R[i] = main[1][i] + (wA[1][i] + wB[1][i]) * g;
  }
  // mono low end: high-pass the side channel at 140 Hz (24 dB/oct); 18 Hz DC cleanup on the mid
  const M = new Float32Array(N), Sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { M[i] = (L[i] + R[i]) / 2; Sd[i] = (L[i] - R[i]) / 2; }
  const S2 = svf(svf(Sd, 'hp', 140, 0.707), 'hp', 140, 0.707);
  const M2 = onepoleHP(M, 18);
  // hard silence in the gap 15.875-16.0 (the 1-pole/side filters can leave tiny residue) + final fade to 49.45
  const fs = S(fadeStart), fe = S(SILENT - 0.05);
  for (let i = 0; i < N; i++) {
    let gg = i >= a && i < S(DROP) ? 0 : 1;
    if (i >= fs) gg *= i >= fe ? 0 : Math.pow(Math.cos(((i - fs) / (fe - fs)) * Math.PI / 2), 2);
    L[i] = (M2[i] + S2[i]) * gg; R[i] = (M2[i] - S2[i]) * gg;
  }
  return [L, R];
}
const music = finish('music', 1.0, 46.6);
const sfx = finish('sfx', 0.8, 47.4);

// ---- 2. gain staging: groove (16-30) RMS -> -18 dBFS; SFX: 0 dB-rel event peak (0.5 FS in render) -> -7 dBFS ----
const gM = db(-18) / rms(music, S(16), S(30));
const gS = db(-7) / 0.5;
for (const c of music) for (let i = 0; i < N; i++) c[i] *= gM;
for (const c of sfx) for (let i = 0; i < N; i++) c[i] *= gS;
const sec = (a, b) => (20 * Math.log10(rms(music, S(a), S(b)))).toFixed(1);
console.log(`music RMS dBFS: 0-8 ${sec(0, 8)}, 8-15.8 ${sec(8, 15.8)}, 16-22 ${sec(16, 22)}, 22-26 ${sec(22, 26)}, 26-30 ${sec(26, 30)}, 30-36 ${sec(30, 36)}, 36-43 ${sec(36, 43)}, 44-47 ${sec(44, 47)}`);
console.log('stem peaks dBFS: music', (20 * Math.log10(peak(music))).toFixed(2), 'sfx', (20 * Math.log10(peak(sfx))).toFixed(2));

// ---- 3. gentle ducking (2-3 dB) of the music under the bigger SFX; raised-cosine pre-ramps ----
// [time, pre, hold, release, depth dB]
const duckEvents = [
  ...[0, 0.5, 1.0, 3.0, 3.5].map((t) => [t, 0.012, 0.12, 0.25, 1.5]), [4.0, 0.012, 0.25, 0.4, 2.5],
  [7.45, 0.3, 0.25, 0.3, 1.5], [12.5, 0.008, 0.06, 0.15, 1.5], [14.5, 0.012, 0.3, 0.4, 2.5],
  [16.0, 0.0, 0.35, 0.5, 2.5], [23.5, 0.01, 0.15, 0.3, 2], ...[24, 24.5, 25, 25.5].map((t) => [t, 0.01, 0.1, 0.25, 1.5]),
  [27.0, 0.25, 0.08, 0.3, 2], [32.0, 0.01, 0.2, 0.3, 2], [34.0, 0.01, 0.2, 0.3, 2],
  [38.5, 0.008, 0.06, 0.15, 1.5], [42.0, 0.012, 0.6, 0.6, 2.5], [44.0, 0.012, 0.6, 0.9, 3],
];
const duckDb = new Float32Array(N);
for (const [t, pre, hold, rel, depth] of duckEvents) {
  const s0 = S(t - pre), s1 = S(t), s2 = S(t + hold), s3 = S(t + hold + rel);
  for (let i = Math.max(0, s0); i < Math.min(N, s3); i++) {
    const d = i < s1 ? rc((i - s0) / Math.max(1, s1 - s0)) : i < s2 ? 1 : 1 - rc((i - s2) / (s3 - s2));
    duckDb[i] = Math.max(duckDb[i], d * depth);
  }
}
const mixPre = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) mixPre[c][i] = music[c][i] * db(-duckDb[i]) + sfx[c][i];

// delivery stems: same relative gain as the mix, scaled together so neither exceeds -1 dBFS
const stemTrim = Math.min(1, db(-1) / Math.max(peak(music), peak(sfx)));
writeWav(join(BUILD, 'mix_pre.wav'), mixPre);
writeWav(join(BUILD, 'music_f.wav'), music.map((c) => c.map((v) => v * stemTrim)));
writeWav(join(BUILD, 'sfx_f.wav'), sfx.map((c) => c.map((v) => v * stemTrim)));
for (const s of ['music', 'sfx']) ff(['-i', join(BUILD, `${s}_f.wav`), '-af', exact, '-c:a', 'pcm_s24le', join(OUT, `${s}3.wav`)]);
console.log('stem trim', (20 * Math.log10(stemTrim)).toFixed(2), 'dB');

// ---- 4. master: soft glue + gentle EQ, then oversampled lookahead limiter, then linear loudnorm ----
const GLUE = 'acompressor=threshold=-22dB:ratio=1.8:attack=30:release=200:knee=8:detection=rms:makeup=1,' +
  'highpass=f=22:poles=2,equalizer=f=40:t=q:w=1:g=-1,equalizer=f=3500:t=q:w=1.4:g=0.6,highshelf=f=5000:g=3';
function loudnormMeasure(file) {
  const err = ff(['-i', file, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json', '-f', 'null', '-']);
  return JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
}
ff(['-i', join(BUILD, 'mix_pre.wav'), '-af', `${GLUE},${exact}`, '-c:a', 'pcm_f32le', join(BUILD, 'mix_glue.wav')]);
const m0 = loudnormMeasure(join(BUILD, 'mix_glue.wav'));
console.log('after glue:', m0.input_i, 'LUFS, TP', m0.input_tp);

let gain = -14 - parseFloat(m0.input_i) + 0.3;
let final;
for (let pass = 0; pass < 6; pass++) {
  ff(['-i', join(BUILD, 'mix_glue.wav'), '-af',
    `volume=${gain.toFixed(3)}dB,aresample=192000:resampler=soxr,alimiter=limit=${db(-1.7).toFixed(4)}:attack=2:release=90:level=disabled:latency=1,aresample=48000:resampler=soxr,${exact}`,
    '-c:a', 'pcm_f32le', join(BUILD, 'mix_lim.wav')]);
  const m1 = loudnormMeasure(join(BUILD, 'mix_lim.wav'));
  const ln = `loudnorm=I=-14.0:TP=-1.0:LRA=20:measured_I=${m1.input_i}:measured_TP=${m1.input_tp}:measured_LRA=${m1.input_lra}:measured_thresh=${m1.input_thresh}:offset=${m1.target_offset}:linear=true:print_format=json`;
  const err = ff(['-i', join(BUILD, 'mix_lim.wav'), '-af', `${ln},aresample=48000:resampler=soxr,${exact}`, '-c:a', 'pcm_s24le', join(OUT, 'mix3.wav')]);
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  final = loudnormMeasure(join(OUT, 'mix3.wav'));
  console.log(`pass ${pass}: pre-limit gain ${gain.toFixed(2)} dB, lim ${m1.input_i} LUFS / ${m1.input_tp} dBTP, loudnorm ${j.normalization_type}, final ${final.input_i} LUFS / ${final.input_tp} dBTP`);
  const I = parseFloat(final.input_i), TP = parseFloat(final.input_tp);
  if (j.normalization_type === 'linear' && Math.abs(I + 14) <= 0.1 && TP <= -1.0) break;
  gain += (-14 - parseFloat(m1.input_i)) * 0.9 + 0.15;
}
// filter/resampler residue (IIR tails, soxr pre-ring) is hard-muted in the gap and after 49.5; 24-bit rewrite
{
  const w = readWav(join(OUT, 'mix3.wav'));
  const a = S(GAP0), b = S(DROP), z = S(SILENT); let resid = 0;
  const r1 = S(0.001);
  for (const c of w.ch) for (let i = 0; i < N; i++) {
    if ((i >= a && i < b) || i >= z) { resid = Math.max(resid, Math.abs(c[i])); c[i] = 0; }
    else if (i >= a - r1 && i < a) c[i] *= rc((a - i) / r1); // 1 ms ease into the gap
  }
  writeWav(join(OUT, 'mix3.wav'), w.ch, 24);
  console.log('muted residue in gap/tail: max', resid.toExponential(2));
  final = loudnormMeasure(join(OUT, 'mix3.wav'));
}
console.log(JSON.stringify(final, null, 1));
