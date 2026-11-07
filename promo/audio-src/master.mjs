// Reverb (ffmpeg afir), stem finishing, ducking, glue compression, true-peak limiting and
// two-pass loudnorm. Writes promo/reel/public/audio/{music,sfx,mix}.wav (48 kHz, 24-bit, 28.000 s).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR, N, S, db, readWav, writeWav, svf, onepoleHP } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '.build');
const OUT = join(HERE, '..', 'reel', 'public', 'audio');
mkdirSync(OUT, { recursive: true });

function ff(args, { quiet = true } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr); throw new Error('ffmpeg failed: ' + args.join(' ')); }
  if (!quiet) console.log(r.stderr);
  return r.stderr;
}
const exact = `atrim=end_sample=${N},apad=whole_len=${N}`;

// ---- 1. reverb via ffmpeg convolution (afir outputs the wet signal only, zero latency) ----
for (const s of ['music', 'sfx']) {
  ff(['-i', join(BUILD, `${s}_send.wav`), '-i', join(BUILD, 'ir.wav'), '-filter_complex',
    `[0:a][1:a]afir=gtype=none:irnorm=-1:maxp=8192:minp=256,${exact}[o]`, '-map', '[o]', '-c:a', 'pcm_f32le', join(BUILD, `${s}_wet.wav`)]);
}

const rms = (ch, a = 0, b = N) => { let s = 0; for (const c of ch) for (let i = a; i < b; i++) s += c[i] * c[i]; return Math.sqrt(s / (ch.length * (b - a))); };
const peak = (ch) => { let m = 0; for (const c of ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return m; };

function finish(name, wetRatio) {
  const main = readWav(join(BUILD, `${name}_main.wav`)).ch;
  const send = readWav(join(BUILD, `${name}_send.wav`)).ch;
  const wet = readWav(join(BUILD, `${name}_wet.wav`)).ch;
  const g = wetRatio * rms(send) / Math.max(1e-9, rms(wet));
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = main[0][i] + wet[0][i] * g; R[i] = main[1][i] + wet[1][i] * g; }
  // keep the low end mono: high-pass the side channel at 140 Hz
  const M = new Float32Array(N), Sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { M[i] = (L[i] + R[i]) / 2; Sd[i] = (L[i] - R[i]) / 2; }
  const S2 = svf(svf(Sd, 'hp', 140, 0.707), 'hp', 140, 0.707);
  // DC / infrasonic cleanup on mid (gentle 1-pole at 18 Hz)
  const M2 = onepoleHP(M, 18);
  for (let i = 0; i < N; i++) { L[i] = M2[i] + S2[i]; R[i] = M2[i] - S2[i]; }
  // gap 7.875-8.0 (also cuts reverb tails) + final fade (silent from 27.5)
  const a = S(7.875), b = S(8.0), f = S(0.004);
  const fs = S(name === 'music' ? 25.4 : 25.8), fe = S(27.45);
  for (let i = 0; i < N; i++) {
    let gg = 1;
    if (i >= a - f && i < b) gg = i < a ? (a - i) / f : 0;
    if (i >= fs) gg *= i >= fe ? 0 : Math.pow(Math.cos(((i - fs) / (fe - fs)) * Math.PI / 2), 2);
    L[i] *= gg; R[i] *= gg;
  }
  return [L, R];
}

const music = finish('music', 0.9);
const sfx = finish('sfx', 0.8);

// ---- 2. gain staging: music drop RMS -> -17 dBFS; SFX set relative to it ----
const gM = db(-17) / rms(music, S(8), S(24));
const gS = gM * db(1.5);
for (const c of music) for (let i = 0; i < N; i++) c[i] *= gM;
for (const c of sfx) for (let i = 0; i < N; i++) c[i] *= gS;
console.log('stem peaks dBFS: music', (20 * Math.log10(peak(music))).toFixed(2), 'sfx', (20 * Math.log10(peak(sfx))).toFixed(2));

// ---- 3. duck the music ~3 dB under the bigger SFX (deterministic, pre-ramped so transients stay clean) ----
const duckEvents = [
  ...[0, 0.5, 1.0, 2.0, 2.5, 3.0].map((t) => [t, 0.012, 0.14, 0.25, 3]),
  [8.0, 0.012, 0.35, 0.4, 3], [24.0, 0.012, 0.45, 0.5, 3],
  ...[12.5, 13.0, 13.5, 14.0].map((t) => [t, 0.01, 0.1, 0.2, 2]),
  [14.5, 0.25, 0.15, 0.3, 3], ...[17, 18, 19].map((t) => [t, 0.15, 0.1, 0.25, 3]),
  [23.0, 0.012, 0.35, 0.4, 3], [7.5, 0.01, 0.15, 0.2, 1.5], [6.5, 0.005, 0.05, 0.1, 1.5],
];
const duckDb = new Float32Array(N);
for (const [t, pre, hold, rel, depth] of duckEvents) {
  const s0 = S(t - pre), s1 = S(t), s2 = S(t + hold), s3 = S(t + hold + rel);
  for (let i = Math.max(0, s0); i < Math.min(N, s3); i++) {
    let d;
    if (i < s1) d = 0.5 - 0.5 * Math.cos(Math.PI * (i - s0) / (s1 - s0));
    else if (i < s2) d = 1;
    else d = 0.5 + 0.5 * Math.cos(Math.PI * (i - s2) / (s3 - s2));
    duckDb[i] = Math.max(duckDb[i], d * depth);
  }
}
const mixPre = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) mixPre[c][i] = music[c][i] * db(-duckDb[i]) + sfx[c][i];

// stems for delivery: same relative gain as the mix, scaled together so neither clips (-1 dBFS peak max)
const stemTrim = Math.min(1, db(-1) / Math.max(peak(music), peak(sfx)));
writeWav(join(BUILD, 'mix_pre.wav'), mixPre);
writeWav(join(BUILD, 'music_f.wav'), music.map((c) => c.map((v) => v * stemTrim)));
writeWav(join(BUILD, 'sfx_f.wav'), sfx.map((c) => c.map((v) => v * stemTrim)));
for (const s of ['music', 'sfx']) ff(['-i', join(BUILD, `${s}_f.wav`), '-af', exact, '-c:a', 'pcm_s24le', join(OUT, `${s}.wav`)]);
console.log('stem trim', (20 * Math.log10(stemTrim)).toFixed(2), 'dB');

// ---- 4. master: glue compression + gentle EQ, then gain + oversampled lookahead limiter ----
const GLUE = 'acompressor=threshold=-20dB:ratio=2:attack=25:release=180:knee=6:detection=rms:makeup=1,' +
  'highpass=f=22:poles=2,equalizer=f=45:t=q:w=1:g=-1.5,equalizer=f=4200:t=q:w=1.2:g=1';
function loudnormMeasure(file, extra = '') {
  const err = ff(['-i', file, '-af', `${extra}loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json`, '-f', 'null', '-']);
  return JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
}
ff(['-i', join(BUILD, 'mix_pre.wav'), '-af', `${GLUE},${exact}`, '-c:a', 'pcm_f32le', join(BUILD, 'mix_glue.wav')]);
const m0 = loudnormMeasure(join(BUILD, 'mix_glue.wav'));
console.log('after glue:', m0.input_i, 'LUFS, TP', m0.input_tp);

let gain = -14 - parseFloat(m0.input_i) + 0.4; // limiter will shave a little loudness
let final;
for (let pass = 0; pass < 4; pass++) {
  // limiter runs at 192 kHz so its ceiling approximates true peak; latency=1 keeps it sample-aligned
  ff(['-i', join(BUILD, 'mix_glue.wav'), '-af',
    `volume=${gain.toFixed(3)}dB,aresample=192000:resampler=soxr,alimiter=limit=${db(-1.6).toFixed(4)}:attack=1.5:release=80:level=disabled:latency=1,aresample=48000:resampler=soxr,${exact}`,
    '-c:a', 'pcm_f32le', join(BUILD, 'mix_lim.wav')]);
  const m1 = loudnormMeasure(join(BUILD, 'mix_lim.wav'));
  // loudnorm second pass, linear (pure gain) using the measured values
  const ln = `loudnorm=I=-14.1:TP=-1.2:LRA=20:measured_I=${m1.input_i}:measured_TP=${m1.input_tp}:measured_LRA=${m1.input_lra}:measured_thresh=${m1.input_thresh}:offset=${m1.target_offset}:linear=true:print_format=json`;
  const err = ff(['-i', join(BUILD, 'mix_lim.wav'), '-af', `${ln},aresample=48000:resampler=soxr,${exact}`, '-c:a', 'pcm_s24le', join(OUT, 'mix.wav')]);
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  final = loudnormMeasure(join(OUT, 'mix.wav'));
  console.log(`pass ${pass}: pre-limit gain ${gain.toFixed(2)} dB, lim ${m1.input_i} LUFS / ${m1.input_tp} dBTP, loudnorm type=${j.normalization_type}, final ${final.input_i} LUFS / ${final.input_tp} dBTP`);
  const I = parseFloat(final.input_i), TP = parseFloat(final.input_tp);
  if (j.normalization_type === 'linear' && Math.abs(I + 14.1) <= 0.2 && TP <= -1.0) break;
  gain += (-14 - parseFloat(m1.input_i)) * 0.9 + 0.2;
}
console.log(JSON.stringify(final, null, 1));
