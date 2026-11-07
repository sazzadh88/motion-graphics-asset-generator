// v3 (50 s) Motion Studio reel: dry music + SFX stems and reverb sends.
// 120 BPM, A minor / C major: Am9 - Fmaj7(9) - C - G/B. Calm, warm, "keynote film" restraint.
// Every cue is placed at round(t * 48000). Picture/sound timing: promo/STORYBOARD-v3.md.
// Output: promo/audio-src/.build3/{music_main,music_sendA,music_sendB,sfx_main,sfx_sendA,sfx_sendB,ir}.wav
//         + cues.json. "A" = content before the 15.875-16.0 gap (its reverb is cut at the gap), "B" = from 16.0.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SR, S, TAU, mtof, db, stereo, addMono, addStereo, createRng, noise, saw, square, sine,
  adsr, perc, mul, scale, mix, svf, writeWav,
} from './lib.mjs';

export const DUR3 = 50.0;
const N = Math.round(SR * DUR3); // 2,400,000
const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '.build3');
mkdirSync(BUILD, { recursive: true });

const GAP0 = 15.875, DROP = 16.0, BRK = 30.0, RET = 36.0, END = 44.0;
const rng = createRng(3303);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const rc = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x)); // raised-cosine 0..1
/** piecewise-linear automation through [t, v] points, eased (raised cosine) between points */
const auto = (pts) => (t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) if (t < pts[k][0]) {
    const [t0, v0] = pts[k - 1], [t1, v1] = pts[k];
    return v0 + (v1 - v0) * rc((t - t0) / (t1 - t0));
  }
  return pts[pts.length - 1][1];
};

// =====================================================================================
// Harmony (bar = 2 s). 22 bars of progression + the ending chord at 44.0
// =====================================================================================
const VOICE = {
  Am9: { pad: [57, 60, 64, 67, 71], root: 33 }, // A3 C4 E4 G4 B4 / A1
  F: { pad: [53, 57, 60, 64, 67], root: 29 },   // F3 A3 C4 E4 G4 (Fmaj9 colour) / F1
  C: { pad: [52, 55, 60, 64, 67], root: 36 },   // E3 G3 C4 E4 G4 / C2
  GB: { pad: [50, 55, 59, 62, 67], root: 35 },  // D3 G3 B3 D4 G4 / B1
};
const BARS = [
  'Am9', 'F', 'C', 'GB', 'Am9', 'F', 'C', 'GB', // 0-16 intro
  'Am9', 'F', 'C', 'GB', 'Am9', 'F', 'C',       // 16-30 drop + palette
  'F', 'C', 'GB',                               // 30-36 breakdown
  'Am9', 'F', 'C', 'GB',                        // 36-44 groove returns
];
const isGroove = (t) => (t >= DROP && t < BRK) || (t >= RET && t < 43.0);

/** Sidechain-style pump on the beat grid (4 ms pre-duck ramp keeps it click free). */
function pump(t, depth) {
  const ph = (t + 0.004) % 0.5;
  if (ph < 0.004) return 1 - depth * (ph / 0.004);
  const x = (ph - 0.004) / 0.26;
  if (x >= 1) return 1;
  return 1 - depth * (1 - x * x * (3 - 2 * x));
}

// =====================================================================================
// Music buses: A = before the gap, B = from the drop on
// =====================================================================================
const musA = stereo(N), musB = stereo(N), mSendA = stereo(N), mSendB = stereo(N);
const mbus = (t) => (t < DROP ? [musA, mSendA] : [musB, mSendB]);

// ---- warm pad (3 detuned saws + sine per note), filtered, generous reverb ----
{
  const padA = stereo(N), padB = stereo(N);
  for (let bar = 0; bar < 22; bar++) {
    const v = VOICE[BARS[bar]];
    const t0 = bar === 0 ? 0 : bar === 8 ? DROP : bar * 2 - 0.06;
    const tEnd = bar === 7 ? GAP0 : bar * 2 + 2 + (bar === 21 ? 0.02 : 0.06);
    const hold = tEnd - t0;
    const att = bar === 0 ? 2.2 : bar === 8 ? 0.03 : 0.3;
    const rel = bar === 7 ? 0.004 : 0.5;
    const n = S(hold + rel);
    const env = adsr(n, att, 0.5, 0.85, rel, hold);
    const bus = bar < 8 ? padA : padB;
    v.pad.forEach((m, k) => {
      const side = k % 2 ? 1 : -1;
      for (let d = 0; d < 3; d++) {
        const o = saw(n, mtof(m) * Math.pow(2, ((d - 1) * 7) / 1200), rng());
        mul(o, env);
        addMono(bus, o, S(t0), 0.03, side * 0.25 + (d - 1) * 0.5);
      }
      const s = sine(n, mtof(m), rng()); mul(s, env);
      addMono(bus, s, S(t0), 0.022, (k / (v.pad.length - 1)) * 1.2 - 0.6);
    });
  }
  const cut = auto([[0, 650], [15.8, 3200], [16, 4000], [29.6, 4400], [30.6, 6000], [35.4, 6000], [36.2, 4500], [43.5, 5500]]);
  const lvl = auto([[0, 2.6], [8, 2.9], [15.8, 3.2], [16, 0.5], [29.7, 0.5], [30.3, 0.85], [35.7, 0.85], [36.1, 0.5], [44, 0.5]]);
  for (const [bus, isB] of [[padA, false], [padB, true]]) {
    for (let c = 0; c < 2; c++) {
      let x = svf(bus[c], 'lp', (i) => cut(i / SR), 0.75);
      x = svf(svf(x, 'hp', 150, 0.7), 'hp', 150, 0.7);
      for (let i = 0; i < N; i++) {
        const t = i / SR;
        const dep = !isB ? (t >= 8 ? 0.12 : 0) : t >= BRK && t < RET ? 0.2 : 0.32;
        x[i] *= lvl(t) * pump(t, dep);
      }
      bus[c] = x;
    }
    addStereo(isB ? musB : musA, bus, 0, 1);
    addStereo(isB ? mSendB : mSendA, bus, 0, 0.6);
  }
}

// ---- airy layer: soft sines an octave up, slow shimmer (intro bars 4-7 and breakdown) ----
for (const [b0, b1, g] of [[4, 8, 0.6], [15, 18, 1]]) {
  for (let bar = b0; bar < b1; bar++) {
    const v = VOICE[BARS[bar]];
    const t0 = bar * 2 - (bar === b0 ? 0 : 0.1);
    const tEnd = bar === 7 ? GAP0 : bar * 2 + 2.1;
    const n = S(tEnd - t0 + (bar === 7 ? 0.004 : 0.6));
    const env = adsr(n, bar === b0 ? 1.2 : 0.4, 0.3, 1, bar === 7 ? 0.004 : 0.6, tEnd - t0);
    v.pad.slice(1).forEach((m, k) => {
      const o = sine(n, mtof(m + 12), rng());
      for (let i = 0; i < n; i++) o[i] *= env[i] * (0.75 + 0.25 * Math.sin(TAU * (0.23 + 0.07 * k) * i / SR + k));
      const [bus, send] = mbus(t0);
      addMono(bus, o, S(t0), 0.012 * g, k % 2 ? 0.7 : -0.7);
      addMono(send, o, S(t0), 0.02 * g, k % 2 ? 0.7 : -0.7);
    });
  }
}

// ---- intro light pulse: soft rounded 8th plucks on the root (0 - 15.5) ----
for (let k = 0; k < 32; k++) {
  for (const off of [0, 0.25]) {
    const tt = k * 0.5 + off; if (tt > 15.5) continue;
    const v = VOICE[BARS[Math.floor(tt / 2)]];
    const m = v.root + 24 + (off ? 12 : 0);
    const n = S(0.3);
    const o = mix(square(n, mtof(m)), scale(sine(n, mtof(m)), 0.8));
    const f = svf(o, 'lp', (i) => 380 + 900 * Math.exp(-i / (SR * 0.04)), 0.7);
    mul(f, perc(n, 0.004, 0.08));
    const lvl = (0.35 + 0.65 * clamp01(tt / 10)) * (off ? 0.55 : 1);
    addMono(musA, f, S(tt), 0.13 * lvl, off ? 0.2 : -0.1);
    addMono(mSendA, f, S(tt), 0.012 * lvl, 0);
  }
}

// ---- drum one-shots: round and soft ----
function makeKick() {
  const n = S(0.45); const body = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const f = 48 + 85 * Math.exp(-t / 0.03) + 25 * Math.exp(-t / 0.005);
    ph += f / SR; body[i] = Math.sin(TAU * ph);
  }
  mul(body, perc(n, 0.0012, 0.17));
  for (let i = 0; i < n; i++) body[i] = Math.tanh(body[i] * 1.25) / Math.tanh(1.25);
  const cn = S(0.015);
  const click = svf(svf(noise(cn, 77), 'bp', 1400, 0.8), 'lp', 3500, 0.7); mul(click, perc(cn, 0.0006, 0.003));
  for (let i = 0; i < cn; i++) body[i] += click[i] * 0.18;
  return body;
}
function makeClap(seed) {
  const n = S(0.35); const out = new Float32Array(n);
  const a = svf(noise(n, seed), 'bp', 1100, 0.9), b = svf(noise(n, seed + 9), 'bp', 2000, 1.1);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let e = 0;
    for (const o of [0, 0.011, 0.022]) if (t >= o) e = Math.max(e, clamp01((t - o) / 0.0012) * Math.exp(-(t - o) / 0.007));
    if (t >= 0.03) e = Math.max(e, 0.6 * clamp01((t - 0.03) / 0.002) * Math.exp(-(t - 0.03) / 0.085));
    out[i] = (a[i] * 1.8 + b[i] * 0.8) * e;
  }
  const lp = svf(out, 'lp', 7000, 0.7);
  const tail = 300; for (let i = 0; i < tail; i++) lp[n - 1 - i] *= i / tail;
  return lp;
}
function makeHat(len, tau, seed, lp = 10500) {
  const n = S(len);
  const metal = mix(...[205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => square(n, f * 1.7)));
  const nz = noise(n, seed); const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = metal[i] * 0.08 + nz[i] * 0.6;
  let h = svf(src, 'hp', 6500, 0.7); h = svf(h, 'lp', lp, 0.7);
  return mul(h, perc(n, 0.0012, tau));
}
const KICK = makeKick(), CLAP = makeClap(31);
const CHAT = makeHat(0.08, 0.016, 5), SHAK = makeHat(0.06, 0.01, 8, 9000), OHAT = makeHat(0.2, 0.045, 6);

// intro hats from 8.0 (soft 8ths, 16th shaker from 12.0)
for (let k = 0; k < 32; k++) {
  const t = 8.0 + k * 0.25; if (t > 15.75) break;
  const off = k % 2 === 1; const grow = 0.7 + 0.3 * (t - 8) / 8;
  addMono(musA, CHAT, S(t), (off ? 0.36 : 0.19) * grow, off ? 0.18 : -0.12);
  if (t >= 12.0 && t + 0.125 < 15.8) addMono(musA, SHAK, S(t + 0.125), 0.08 * grow, -0.3);
}

// groove drums
for (let t = DROP; t < 43.0 - 1e-9; t += 0.5) {
  const brk = t >= BRK && t < RET;
  addMono(musB, KICK, S(t), brk ? 0.45 : 0.78, 0);
  if (!isGroove(t)) continue;
  const beat = Math.round((t % 2) / 0.5);
  if (beat === 1 || beat === 3) { addMono(musB, CLAP, S(t), 0.2, 0); addMono(mSendB, CLAP, S(t), 0.12, 0); }
  addMono(musB, OHAT, S(t + 0.25), 0.27, 0.2);
  for (const q of [0.125, 0.375]) addMono(musB, SHAK, S(t + q), 0.12, -0.28);
}
addMono(musB, KICK, S(END), 0.8, 0); // final kick under the 44.0 impact

// ---- bass: sub sine + warm filtered saw, gently pumped ----
{
  const bass = new Float32Array(N);
  const segs = [];
  for (let bar = 8; bar < 22; bar++) segs.push([bar * 2, bar === 21 ? END : bar * 2 + 2, VOICE[BARS[bar]].root]);
  segs.push([END, 46.0, 29], [46.0, 49.5, 36]);
  for (const [t0, t1, m] of segs) {
    const n = S(t1 - t0); const at = S(t0);
    const env = adsr(n, 0.006, 0.08, 0.92, 0.025, (t1 - t0) - 0.03);
    const s = sine(n, mtof(m));
    const r = mix(saw(n, mtof(m + 12) * 1.003, rng()), saw(n, mtof(m + 12) * 0.997, rng()));
    const rf = svf(svf(r, 'lp', 340, 0.7), 'lp', 520, 0.7);
    const bk = t0 >= 30 && t0 < 36 ? 0.7 : 1; // lighter in the breakdown
    for (let i = 0; i < n; i++) bass[at + i] += (s[i] * 0.3 + Math.tanh(rf[i] * 1.2) * 0.1) * env[i] * bk;
  }
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const p = t >= DROP && t < 43.0 ? pump(t, t >= BRK && t < RET ? 0.45 : 0.6) : 1;
    musB[0][i] += bass[i] * p; musB[1][i] += bass[i] * p;
  }
}

// ---- warm chord stabs on the "and" of 2 and 4 (none 22-26, none in the breakdown) ----
for (let bar = 8; bar < 22; bar++) {
  if (bar === 11 || bar === 12 || (bar >= 15 && bar <= 17)) continue;
  const c = VOICE[BARS[bar]].pad.slice(1).map((m) => m + 12);
  for (const p of [0.75, 1.75]) {
    const t = bar * 2 + p; if (t >= 43.0) continue;
    const n = S(0.5); const env = adsr(n, 0.004, 0.18, 0.25, 0.12, 0.2);
    const tmp = stereo(n);
    c.forEach((m, k) => {
      for (let v = 0; v < 3; v++) {
        const pos = v - 1; const o = saw(n, mtof(m) * Math.pow(2, pos * 9 / 1200), rng());
        mul(o, env); addMono(tmp, o, 0, 0.022, pos * 0.5 + (k % 2 ? 0.15 : -0.15));
      }
    });
    for (let ch = 0; ch < 2; ch++) {
      const x = svf(tmp[ch], 'lp', (i) => 1300 + 2500 * Math.exp(-i / (SR * 0.06)), 0.7);
      tmp[ch] = svf(x, 'hp', 220, 0.7);
    }
    addStereo(musB, tmp, S(t), 1);
    addStereo(mSendB, tmp, S(t), 0.5);
  }
}

// ---- soft bell arp (8ths) with dotted-8th ping-pong delay, groove sections ----
{
  const arp = stereo(N);
  const pat = [0, 2, 4, 1, 3, 2, 4, 3];
  for (let t = DROP; t < 43.0 - 1e-9; t += 0.25) {
    if (!isGroove(t)) continue;
    const v = VOICE[BARS[Math.floor(t / 2)]];
    const tones = v.pad.map((m) => m + 12).sort((a, b) => a - b);
    const k = Math.round((t % 2) / 0.25);
    const m = tones[pat[k]] + 12 * (k === 6 ? 1 : 0);
    const n = S(0.35);
    const o = mix(sine(n, mtof(m)), scale(sine(n, mtof(m) * 2), 0.16), scale(sine(n, mtof(m) * 3), 0.05), scale(sine(n, mtof(m) * 4), 0.02));
    mul(o, perc(n, 0.003, 0.08));
    addMono(arp, o, S(t), 0.026 * (k % 2 ? 0.7 : 1), k % 2 ? 0.35 : -0.35);
  }
  const d = S(0.375); const fb = 0.3;
  const L = Float32Array.from(arp[0]), R = Float32Array.from(arp[1]);
  for (let i = d; i < N; i++) { L[i] += R[i - d] * fb * 0.9; R[i] += L[i - d] * fb; }
  const out = [svf(svf(L, 'lp', 6500, 0.7), 'hp', 350, 0.7), svf(svf(R, 'lp', 6500, 0.7), 'hp', 350, 0.7)];
  addStereo(musB, out, 0, 1);
  addStereo(mSendB, out, 0, 0.45);
}

// ---- ending: 44.0 wide Fmaj9, 46.0 resolves to C(add9); faded to silence by 49.5 in master ----
{
  const endBus = stereo(N);
  const wide = (m, t0, env, g, voices = 5) => {
    for (let v = 0; v < voices; v++) {
      const pos = (v / (voices - 1)) * 2 - 1;
      const o = saw(env.length, mtof(m) * Math.pow(2, pos * 12 / 1200), rng());
      mul(o, env); addMono(endBus, o, S(t0), g, pos);
    }
    const s = sine(env.length, mtof(m), rng()); mul(s, env); addMono(endBus, s, S(t0), g * 1.2, 0);
  };
  const e1 = adsr(S(2.4), 0.006, 0.6, 0.7, 0.35, 2.0);
  for (const m of [53, 57, 60, 64, 67]) wide(m, END, e1, 0.026);
  for (const m of [69, 72, 76]) wide(m, END, e1, 0.01);
  const e2 = adsr(S(3.6), 0.25, 0.8, 0.85, 0.05, 3.5);
  for (const m of [48, 55, 60, 62, 64, 67]) wide(m, 45.98, e2, 0.022);
  for (const m of [72, 74, 79]) wide(m, 45.98, e2, 0.009);
  for (let c = 0; c < 2; c++) {
    const x = svf(endBus[c], 'lp', (i) => { const t = i / SR; return t < END ? 3000 : 1300 + 2400 * Math.exp(-(t - END) / 1.6); }, 0.7);
    endBus[c] = svf(x, 'hp', 150, 0.7);
  }
  addStereo(musB, endBus, 0, 1);
  addStereo(mSendB, endBus, 0, 0.7);
}

// =====================================================================================
// SFX: every event is peak-normalised to a level relative to the loudest (0 dB = 0.5 FS here)
// =====================================================================================
const sfxA = stereo(N), sfxB = stereo(N), sSendA = stereo(N), sSendB = stereo(N);
const CUES = []; // [time, label, kind] kind: onset | peak | end
const EVENTS = []; // dry, gain-scaled events (mono L+R) for matched-filter verification
function panMono(sig, pan) {
  const a = (pan + 1) * Math.PI / 4;
  return [scale(Float32Array.from(sig), Math.cos(a) * Math.SQRT2), scale(Float32Array.from(sig), Math.sin(a) * Math.SQRT2)];
}
function place(st, t, relDb, send = 0.2) {
  let pk = 0; for (const c of st) for (const v of c) pk = Math.max(pk, Math.abs(v));
  const g = 0.5 * db(relDb) / pk;
  addStereo(t < DROP ? sfxA : sfxB, st, S(t), g);
  addStereo(t < DROP ? sSendA : sSendB, st, S(t), g * send);
  const m = new Float32Array(st[0].length); for (let i = 0; i < m.length; i++) m[i] = (st[0][i] + st[1][i]) * g;
  EVENTS.push({ t, m });
}
function bell(n, f, { ratio = 2, index = 1.0, tau = 0.5, itau = 0.12, att = 0.0015 } = {}) {
  const o = new Float32Array(n); let pc = 0, pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const I = index * Math.exp(-t / itau);
    o[i] = Math.sin(TAU * pc + I * Math.sin(TAU * pm)) * Math.exp(-t / tau);
    pc += f / SR; pm += (f * ratio) / SR;
  }
  const a = S(att); for (let i = 0; i < a; i++) o[i] *= rc(i / a);
  const tail = Math.min(n, 300); for (let i = 0; i < tail; i++) o[n - 1 - i] *= i / tail;
  return o;
}
/** Envelope for span sounds: soft 2 ms start at startLvl, swell to 1 at peakAt (0..1), fall to endLvl, short fade. */
function spanEnv(n, { startLvl = 0.3, peakAt = 0.7, endLvl = 0.3, up = 2, down = 1.5, att = 0.002, fade = 0.005 }) {
  const o = new Float32Array(n); const A = S(att), F = S(fade), P = Math.max(1, Math.round(peakAt * n));
  for (let i = 0; i < n; i++) {
    let v = i < P ? startLvl + (1 - startLvl) * Math.pow(i / P, up) : endLvl + (1 - endLvl) * Math.pow(1 - (i - P) / (n - P), down);
    if (i < A) v *= rc(i / A);
    if (i >= n - F) v *= rc((n - i) / F);
    o[i] = v;
  }
  return o;
}
/** Airy noise swish/whoosh from t0 to t1: band-passed noise sweep, softened, moving across the field. */
function swish(t0, t1, { f0, f1, rel, dir = 1, seed, env, q = 0.8, lp = 6500, send = 0.1, tone = null, bump = null }) {
  const n = S(t1 - t0);
  const cut = (i) => f0 * Math.pow(f1 / f0, i / n);
  const e = spanEnv(n, env);
  const out = [];
  for (let c = 0; c < 2; c++) {
    let x = svf(noise(n, seed + c), 'bp', cut, q);
    x = svf(svf(x, 'lp', lp, 0.7), 'hp', 250, 0.7);
    if (tone) {
      const tn = sine(n, (i) => tone[0] * Math.pow(tone[1] / tone[0], i / n), 0.25 * c);
      for (let i = 0; i < n; i++) x[i] += tn[i] * tone[2];
    }
    if (bump) { // [hz, centre (s from t0), sigma (s), amp] - added after the span envelope
      const [hz, tc, sg, amp] = bump; const b = mix(sine(n, hz), scale(sine(n, hz * 2), 0.25));
      for (let i = 0; i < n; i++) { const d = (i / SR - tc) / sg; b[i] *= amp * Math.exp(-0.5 * d * d); }
      bump.sig = b;
    }
    for (let i = 0; i < n; i++) {
      const pos = dir * ((i / n) * 1.4 - 0.7); const a = (pos + 1) * Math.PI / 4;
      x[i] = (x[i] * e[i] + (bump ? bump.sig[i] : 0)) * (c === 0 ? Math.cos(a) : Math.sin(a)) * Math.SQRT2;
    }
    out.push(x);
  }
  place(out, t0, rel, send);
}

// ---- Scene 1: text hits (soft mallet "tock" on E, rounded thump), airy swish ----
function textHit(t, accent) {
  const n = S(accent ? 0.9 : 0.6);
  const thump = sine(n, (i) => 88 + 90 * Math.exp(-i / (SR * 0.02))); mul(thump, perc(n, 0.0016, accent ? 0.11 : 0.075));
  const tock = mix(sine(n, mtof(76)), scale(sine(n, mtof(76) * 2), 0.16), scale(sine(n, mtof(76) * 3.01), 0.04));
  mul(tock, perc(n, 0.0014, accent ? 0.17 : 0.09));
  const air = svf(svf(noise(n, 600 + Math.round(t * 10)), 'hp', 1800, 0.7), 'lp', 6000, 0.7); mul(air, perc(n, 0.0012, 0.01));
  const o = mix(thump, scale(tock, 0.55), scale(air, 0.2));
  if (accent) { const b = bell(n, mtof(88), { ratio: 2, index: 0.5, tau: 0.4, itau: 0.08 }); for (let i = 0; i < n; i++) o[i] += b[i] * 0.16; }
  place(panMono(o, 0), t, accent ? -7 : -12.5, accent ? 0.35 : 0.22);
  CUES.push([t, `Text hit${accent ? ' (accent, strongest)' : ''}: soft E5 mallet tock + rounded thump`, 'onset']);
}
[[0.0, false], [0.5, false], [1.0, false], [3.0, false], [3.5, false], [4.0, true]].forEach(([t, a]) => textHit(t, a));
swish(5.5, 6.0, { f0: 900, f1: 4200, rel: -17, dir: 1, seed: 1100, send: 0.04, env: { startLvl: 0.45, peakAt: 0.72, endLvl: 0.4, up: 1.6, down: 1.2 } });
CUES.push([5.5, 'Airy swish (playhead wipe) start', 'onset'], [6.0, 'Airy swish end (wipe complete)', 'end']);

// ---- Scene 2: camera push whoosh, typing, click, processing shimmer, bloom, riser ----
swish(7.0, 8.0, { f0: 260, f1: 2200, rel: -15, dir: -1, seed: 1200, q: 0.7, lp: 4500, send: 0.04, env: { startLvl: 0.3, peakAt: 0.6, endLvl: 0.06, up: 1.8, down: 2.0, fade: 0.008 } });
CUES.push([7.0, 'Soft whoosh (camera push) start', 'onset'], [8.0, 'Soft whoosh end (lands into key tick 1)', 'end']);

function keyTick(t, k) {
  const r = createRng(900 + k * 7); const n = S(0.03);
  const p = 1 + (r() - 0.5) * 0.16; // +-8 % pitch
  const tk = sine(n, 1750 * p, r()); mul(tk, perc(n, 0.0005, 0.0035));
  const body = sine(n, 620 * p, r()); mul(body, perc(n, 0.0006, 0.006));
  const nz = svf(svf(noise(n, 1000 + k), 'bp', 3200 * p, 1.1), 'lp', 7000, 0.7); mul(nz, perc(n, 0.0004, 0.0018));
  const o = mix(tk, scale(body, 0.6), scale(nz, 0.5));
  place(panMono(o, (r() - 0.5) * 0.3), t, -25.5 + (r() - 0.5) * 3, 0.1);
}
for (let i = 0; i < 33; i++) { const t = 8.0 + i * 0.0909; keyTick(t, i); CUES.push([+t.toFixed(4), `Key tick ${i + 1}/33`, 'onset']); }

function uiClick(t, label) {
  const part = (n, f0, f1) => { const o = sine(n, (i) => f1 + (f0 - f1) * Math.exp(-i / (SR * 0.005))); mul(o, perc(n, 0.0006, 0.009)); return o; };
  const n = S(0.12); const o = new Float32Array(n);
  const a = part(S(0.05), 1500, 980), b = part(S(0.035), 1900, 1300);
  for (let i = 0; i < a.length; i++) o[i] += a[i];
  for (let i = 0; i < b.length; i++) o[i + S(0.03)] += b[i] * 0.5;
  place(panMono(o, 0.05), t, -15, 0.15);
  CUES.push([t, label, 'onset']);
}
uiClick(12.5, 'UI click (Generate): rounded 2-part tock');

{ // processing shimmer 12.6 - 13.9: soft bell grains (C/G pentatonic) + faint air, stops at 13.9
  const t0 = 12.6, t1 = 13.9, n = S(t1 - t0); const st = stereo(n); const r = createRng(4242);
  const notes = [84, 86, 88, 91, 93, 96, 98, 100];
  for (let k = 0; k * 0.0625 < t1 - t0 - 0.05; k++) {
    const at = S(k * 0.0625); const m = k === 0 ? 91 : notes[Math.floor(r() * notes.length)];
    const len = n - at; const x = Math.min(1, k * 0.0625 / (t1 - t0));
    const b = bell(len, mtof(m), { ratio: 3.01, index: 0.6, tau: 0.12, itau: 0.04 });
    const g = k === 0 ? 1 : (0.3 + 0.4 * Math.sin(Math.PI * Math.min(1, x * 1.1))) * (0.8 + 0.2 * r());
    const pan = (r() - 0.5) * 1.2;
    const a = (pan + 1) * Math.PI / 4;
    for (let i = 0; i < len; i++) { st[0][at + i] += b[i] * g * Math.cos(a); st[1][at + i] += b[i] * g * Math.sin(a); }
  }
  for (let c = 0; c < 2; c++) {
    const air = svf(svf(noise(n, 4300 + c), 'hp', 6000, 0.7), 'lp', 11000, 0.7);
    for (let i = 0; i < n; i++) st[c][i] += air[i] * 0.05 * Math.sin(Math.PI * i / n);
    const e = spanEnv(n, { startLvl: 1, peakAt: 0.001, endLvl: 1, down: 1, att: 0.002, fade: 0.008 });
    for (let i = 0; i < n; i++) st[c][i] *= e[i];
  }
  place(st, t0, -18, 0.12);
  CUES.push([t0, 'Processing shimmer start (bell grains)', 'onset'], [t1, 'Processing shimmer end', 'end']);
}
{ // bloom 14.5: strummed bell chord on G/B (D6 G6 B6 D7) + soft swell
  const n = S(1.2); const st = stereo(n);
  [86, 91, 95, 98].forEach((m, k) => {
    const at = S(k * 0.028); const b = bell(n - at, mtof(m), { ratio: 2, index: 0.7, tau: 0.16, itau: 0.05 });
    const a = ((-0.45 + 0.3 * k) + 1) * Math.PI / 4;
    for (let i = 0; i < b.length; i++) { st[0][at + i] += b[i] * Math.cos(a); st[1][at + i] += b[i] * Math.sin(a); }
  });
  for (let c = 0; c < 2; c++) {
    const sw = svf(svf(noise(n, 4500 + c), 'bp', 3000, 0.6), 'lp', 7000, 0.7);
    for (let i = 0; i < n; i++) { const t = i / SR; st[c][i] += sw[i] * 0.25 * (t < 0.08 ? rc(t / 0.08) : Math.exp(-(t - 0.08) / 0.09)); }
  }
  place(st, 14.5, -11, 0.4);
  CUES.push([14.5, 'Bloom: strummed bell chord D6-G6-B6-D7 + soft air', 'onset']);
}
// riser 15.0 - 15.875: soft tonal glide A3->A4 + air, cut at the gap
swish(15.0, GAP0, { f0: 500, f1: 6000, rel: -12.5, dir: 1, seed: 1500, q: 0.9, lp: 7500, send: 0.05, tone: [mtof(57), mtof(69), 0.1], env: { startLvl: 0.42, peakAt: 0.97, endLvl: 1, up: 1.8, att: 0.002, fade: 0.004 } });
CUES.push([15.0, 'Riser start (tonal glide A3->A4 + air)', 'onset'], [GAP0, 'Riser cut; silence 15.875-16.0', 'end']);

// ---- Scene 3: DROP ----
function impact(t, rootHz, rel, len, label) {
  const n = S(len);
  const boom = sine(n, (i) => rootHz + 70 * Math.exp(-i / (SR * 0.045))); mul(boom, perc(n, 0.002, len * 0.22));
  for (let i = 0; i < n; i++) boom[i] = Math.tanh(boom[i] * 1.3) / Math.tanh(1.3);
  const body = sine(n, (i) => 95 + 60 * Math.exp(-i / (SR * 0.01))); mul(body, perc(n, 0.0015, 0.06));
  const st = [];
  for (let c = 0; c < 2; c++) {
    let x = svf(noise(n, 5000 + c + Math.round(t)), 'hp', 2200, 0.7);
    x = svf(x, 'lp', (i) => 2800 + 5200 * Math.exp(-i / (SR * 0.35)), 0.7);
    mul(x, perc(n, 0.004, Math.min(0.75, len * 0.3)));
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = boom[i] * 0.85 + body[i] * 0.3 + x[i] * 0.28;
    st.push(o);
  }
  place(st, t, rel, 0.3);
  CUES.push([t, label, 'onset']);
}
impact(DROP, 55, -1.5, 2.6, 'DROP impact: rounded sub (A1) + soft crash; full groove starts');

// ---- Scene 4: palette ----
{ // soft drop thud 23.5
  const n = S(0.4);
  const th = sine(n, (i) => 70 + 70 * Math.exp(-i / (SR * 0.015))); mul(th, perc(n, 0.0015, 0.07));
  const fl = svf(noise(n, 5200), 'lp', 900, 0.7); mul(fl, perc(n, 0.0012, 0.018));
  place(panMono(mix(th, scale(fl, 0.5)), -0.05), 23.5, -11, 0.2);
  CUES.push([23.5, 'Soft drop thud (photo lands)', 'onset']);
}
function pluck(t, m, k) {
  const n = S(0.8); const f = mtof(m); const P = Math.round(SR / f);
  const buf = svf(noise(P, 1700 + k), 'lp', 3000, 0.7); const ks = new Float32Array(n); let idx = 0;
  for (let i = 0; i < n; i++) { const a = buf[idx], b = buf[(idx + 1) % P]; ks[i] = a; buf[idx] = 0.4985 * (a + b); idx = (idx + 1) % P; }
  const kf = svf(ks, 'lp', (i) => 1400 + 3500 * Math.exp(-i / (SR * 0.04)), 0.7); mul(kf, perc(n, 0.0015, 0.25));
  const tone = sine(n, f); mul(tone, perc(n, 0.0015, 0.2));
  place(panMono(mix(kf, scale(tone, 0.35)), [-0.3, -0.1, 0.1, 0.3][k]), t, -12.5 + k * 0.5, 0.3);
  CUES.push([t, `Pluck ${['E5', 'A5', 'C6', 'E6'][k]} (rising palette fill)`, 'onset']);
}
[76, 81, 84, 88].forEach((m, k) => pluck(24.0 + k * 0.5, m, k));
swish(26.5, 27.5, { f0: 350, f1: 1800, rel: -13.5, dir: 1, seed: 1600, q: 0.75, lp: 5000, send: 0.06, bump: [220, 0.5, 0.025, 0.3], env: { startLvl: 0.3, peakAt: 0.5, endLvl: 0.0, up: 3, down: 2.2, fade: 0.01 } });
CUES.push([26.5, 'Whoosh (camera pan) start', 'onset'], [27.0, 'Whoosh peak', 'peak']);
swish(28.0, 28.8, { f0: 600, f1: 5500, rel: -15.5, dir: -1, seed: 1700, q: 0.9, lp: 7000, send: 0.04, tone: [mtof(64), mtof(76), 0.06], env: { startLvl: 0.45, peakAt: 0.85, endLvl: 0.5, up: 1.5, down: 1, fade: 0.005 } });
CUES.push([28.0, 'Recolour sweep start', 'onset'], [28.8, 'Recolour sweep end', 'end']);
swish(29.5, 30.0, { f0: 900, f1: 4200, rel: -17, dir: 1, seed: 1800, send: 0.04, env: { startLvl: 0.45, peakAt: 0.72, endLvl: 0.4, up: 1.6, down: 1.2 } });
CUES.push([29.5, 'Swish (playhead wipe) start', 'onset'], [30.0, 'Swish end', 'end']);

// ---- Scene 5: formats ----
[[32.0, 1], [34.0, -1]].forEach(([t, d], k) => {
  swish(t, t + 0.5, { f0: 1600, f1: 500, rel: -14.5, dir: d, seed: 1900 + 10 * k, q: 0.7, lp: 5000, env: { startLvl: 0.4, peakAt: 0.3, endLvl: 0.0, up: 1.5, down: 2, fade: 0.02 } });
  CUES.push([t, `Swoosh (morph to ${k ? '16:9' : '1:1'})`, 'onset']);
});
swish(35.5, 36.0, { f0: 900, f1: 4200, rel: -17, dir: -1, seed: 2000, send: 0.04, env: { startLvl: 0.45, peakAt: 0.72, endLvl: 0.4, up: 1.6, down: 1.2 } });
CUES.push([35.5, 'Swish (playhead wipe) start', 'onset'], [36.0, 'Swish end; full groove returns', 'end']);

// ---- Scene 6: export ----
uiClick(38.5, 'UI click (Render): rounded 2-part tock');
swish(38.6, 42.0, { f0: 300, f1: 7000, rel: -16.5, dir: 1, seed: 2100, q: 1.3, lp: 9000, send: 0.06, env: { startLvl: 0.42, peakAt: 0.93, endLvl: 0.08, up: 1.6, down: 1.5, att: 0.002, fade: 0.006 } });
CUES.push([38.6, 'Upward filter sweep start', 'onset'], [42.0, 'Upward filter sweep end (eases into the chime)', 'end']);
{ // success chime 42.0: G5 B5 D6 G6 strum
  const n = S(1.6); const st = stereo(n);
  [79, 83, 86, 91].forEach((m, k) => {
    const at = S(k * 0.05);
    const b = mix(bell(n - at, mtof(m), { ratio: 2, index: 0.8, tau: 0.45, itau: 0.1 }), scale(bell(n - at, mtof(m) * 2, { ratio: 3.5, index: 0.3, tau: 0.18, itau: 0.04 }), 0.15));
    const a = ((-0.3 + 0.2 * k) + 1) * Math.PI / 4;
    for (let i = 0; i < b.length; i++) { st[0][at + i] += b[i] * Math.cos(a); st[1][at + i] += b[i] * Math.sin(a); }
  });
  place(st, 42.0, -9.5, 0.35);
  CUES.push([42.0, 'Success chime: bells G5-B5-D6-G6 (50 ms strum)', 'onset']);
}
swish(43.0, END, { f0: 500, f1: 6500, rel: -12.5, dir: -1, seed: 2200, q: 0.9, lp: 8000, send: 0.05, tone: [mtof(60), mtof(72), 0.1], env: { startLvl: 0.42, peakAt: 0.97, endLvl: 1, up: 1.8, att: 0.002, fade: 0.004 } });
CUES.push([43.0, 'Riser start (tonal glide C4->C5 + air)', 'onset'], [END, 'Riser end (meets final impact)', 'end']);

// ---- Scene 7: end card ----
impact(END, 43.65, 0, 3.4, 'FINAL impact: rounded sub (F1) + long soft crash; wide Fmaj9 chord');
{ // soft tick 46.0
  const n = S(0.25); const tk = bell(n, 2637, { ratio: 2.76, index: 0.4, tau: 0.05, itau: 0.01, att: 0.0008 });
  const b = sine(n, 1318.5); mul(b, perc(n, 0.001, 0.03));
  place(panMono(mix(tk, scale(b, 0.5)), 0), 46.0, -14, 0.3);
  CUES.push([46.0, 'Soft tick ("Link in bio"); chord resolves to C(add9)', 'onset']);
}

// =====================================================================================
// Gap mask on the "A" buses (before the drop): fade over 4 ms into 15.875, silent afterwards.
// =====================================================================================
for (const bus of [musA, mSendA, sfxA, sSendA]) for (const ch of bus) {
  const a = S(GAP0), f = S(0.004);
  for (let i = a - f; i < N; i++) ch[i] *= i < a ? rc((a - i) / f) : 0;
}
const sum = (x, y) => x.map((c, k) => { const o = Float32Array.from(c); for (let i = 0; i < N; i++) o[i] += y[k][i]; return o; });

// Reverb IR: stereo, decorrelated, darkening tail, RT60 ~2.8 s, 24 ms predelay
const irN = S(3.4); const ir = [];
for (let c = 0; c < 2; c++) {
  const x = svf(noise(irN, 2600 + c), 'lp', (i) => 7000 * Math.exp(-i / (SR * 1.0)) + 1200, 0.7);
  const pre = S(0.024);
  for (let i = 0; i < irN; i++) x[i] = i < pre ? 0 : x[i] * Math.exp(-6.91 * (i / SR) / 2.8) * Math.min(1, (i - pre) / S(0.01));
  const tail = S(0.08); for (let i = 0; i < tail; i++) x[irN - 1 - i] *= i / tail;
  ir.push(svf(x, 'hp', 180, 0.7));
}

writeWav(join(BUILD, 'music_main.wav'), sum(musA, musB));
writeWav(join(BUILD, 'music_sendA.wav'), mSendA);
writeWav(join(BUILD, 'music_sendB.wav'), mSendB);
writeWav(join(BUILD, 'sfx_main.wav'), sum(sfxA, sfxB));
writeWav(join(BUILD, 'sfx_sendA.wav'), sSendA);
writeWav(join(BUILD, 'sfx_sendB.wav'), sSendB);
writeWav(join(BUILD, 'ir.wav'), ir);
writeWav(join(BUILD, 'kick.wav'), [KICK]);
{
  const idx = []; let off = 0; for (const e of EVENTS) { idx.push({ t: e.t, off, len: e.m.length }); off += e.m.length; }
  const all = new Float32Array(off); EVENTS.forEach((e, k) => all.set(e.m, idx[k].off));
  writeFileSync(join(BUILD, 'events.f32'), Buffer.from(all.buffer));
  writeFileSync(join(BUILD, 'events.json'), JSON.stringify(idx));
}
CUES.sort((a, b) => a[0] - b[0]);
writeFileSync(join(BUILD, 'cues.json'), JSON.stringify(CUES, null, 1));
const pk = (...bs) => Math.max(...bs.flatMap((b) => b.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))));
console.log(`rendered ${N} samples. peaks: music ${pk(musA, musB).toFixed(3)} sfx ${pk(sfxA, sfxB).toFixed(3)}; cues ${CUES.length}`);
