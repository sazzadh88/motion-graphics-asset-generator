// Renders the dry music + SFX stems (and their reverb sends) for the 28 s Motion Studio reel.
// 120 BPM, A minor / C major, Am - F - C - G. Every cue is placed at round(t * 48000).
// Output: promo/audio-src/.build/{music_main,music_send,sfx_main,sfx_send,ir}.wav (32-bit float)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SR, N, S, TAU, mtof, db, stereo, addMono, addStereo, createRng, noise, saw, square, sine,
  adsr, perc, mul, scale, mix, svf, writeWav,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '.build');
mkdirSync(BUILD, { recursive: true });

// =====================================================================================
// Harmony
// =====================================================================================
const CH = { Am: [52, 57, 60, 64], F: [53, 57, 60, 64], C: [52, 55, 60, 64], G: [50, 55, 59, 62] };
const ROOT = { Am: 33, F: 29, C: 36, G: 31 }; // A1 F1 C2 G1
const PROG = ['Am', 'F', 'C', 'G'];
const chordOfBar = (bar) => PROG[bar % 4];

const GAP0 = 7.875, DROP = 8.0, END = 24.0;

// Sidechain-style pump on the beat grid. A 4 ms pre-duck ramp keeps it click free.
function pump(t, depth) {
  const ph = (t + 0.004) % 0.5;
  if (ph < 0.004) return 1 - depth * (ph / 0.004);
  const x = (ph - 0.004) / 0.24;
  if (x >= 1) return 1;
  const s = x * x * (3 - 2 * x);
  return 1 - depth * (1 - s);
}

// =====================================================================================
// Music buses
// =====================================================================================
const padBus = stereo();      // filtered pad (intro + drop)
const endBus = stereo();      // final chord
const musicMain = stereo();
const musicSend = stereo();
const rng = createRng(1207);

/** Supersaw note into a stereo bus. Voices spread across the field (detune + pan). */
function supersaw(bus, midi, t0, _dur, { voices = 5, cents = 14, spread = 0.8, gain = 0.04, env }) {
  const n = env.length; const at = S(t0);
  for (let v = 0; v < voices; v++) {
    const pos = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
    const f = mtof(midi) * Math.pow(2, (pos * cents) / 1200);
    const o = saw(n, f, rng());
    mul(o, env);
    addMono(bus, o, at, gain, pos * spread);
  }
}

// ---- pad: bars 0-11 ----
for (let bar = 0; bar < 12; bar++) {
  const c = CH[chordOfBar(bar)];
  const t0 = bar === 0 ? 0 : bar * 2 - 0.06;
  const hold = bar === 0 ? 2.0 : 2.06;
  const env = adsr(S(hold + 0.4), bar === 0 ? 1.2 : 0.12, 0.3, 0.9, 0.4, hold);
  for (const m of c) supersaw(padBus, m, t0, hold, { voices: 5, cents: 13, spread: 0.85, gain: 0.034, env });
  // a soft octave-up layer for air
  for (const m of c.slice(1)) supersaw(padBus, m + 12, t0, hold, { voices: 3, cents: 9, spread: 0.9, gain: 0.012, env });
}
function padCutoff(t) {
  if (t < DROP) return 480 * Math.pow(1900 / 480, Math.min(1, t / 7.6));     // filtered intro, slowly opening
  if (t < 20) return 2600;
  if (t < 23.5) return 2600 * Math.pow(9000 / 2600, (t - 20) / 3.5);           // bars 10-11: upward sweep
  return 9000;
}
for (let c = 0; c < 2; c++) {
  let x = svf(padBus[c], 'lp', (i) => padCutoff(i / SR), 0.9);
  x = svf(x, 'hp', 170, 0.7);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const lvl = t < DROP ? 2.1 : 0.5;
    x[i] *= lvl * pump(t, t < DROP ? 0.35 : 0.6);
  }
  padBus[c] = x;
}
addStereo(musicMain, padBus, 0, 1);
addStereo(musicSend, padBus, 0, 0.35);

// ---- ending chord: 24.0 Fmaj9 (impact) -> 25.0 C(add9) resolve ----
{
  const e1 = adsr(S(1.4), 0.004, 0.5, 0.75, 0.35, 1.0);
  for (const m of [53, 57, 60, 64, 67]) supersaw(endBus, m, END, 1.0, { voices: 7, cents: 18, spread: 1, gain: 0.03, env: e1 });
  for (const m of [65, 69, 72]) supersaw(endBus, m, END, 1.0, { voices: 5, cents: 12, spread: 1, gain: 0.014, env: e1 });
  const e2 = adsr(S(3.0), 0.06, 0.6, 0.8, 0.4, 2.55);
  for (const m of [48, 55, 60, 62, 64, 67]) supersaw(endBus, m, 24.97, 2.55, { voices: 7, cents: 16, spread: 1, gain: 0.028, env: e2 });
  for (const m of [72, 76, 79]) supersaw(endBus, m, 24.97, 2.55, { voices: 5, cents: 10, spread: 1, gain: 0.012, env: e2 });
  for (let c = 0; c < 2; c++) {
    let x = svf(endBus[c], 'lp', (i) => {
      const t = i / SR; if (t < END) return 8000;
      return 1500 + 6500 * Math.exp(-(t - END) / 1.4);
    }, 0.8);
    endBus[c] = svf(x, 'hp', 160, 0.7);
  }
  addStereo(musicMain, endBus, 0, 1);
  addStereo(musicSend, endBus, 0, 0.6);
}

// ---- intro pulse: soft 8th-note square pluck, pumped (bars 0-3) ----
{
  const pulseRoot = { Am: 45, F: 41, C: 48, G: 43 };
  for (let e = 0; e < 15; e++) { // 8ths from 0.0 to 7.5 (stop before the gap)
    const t = e * 0.5;
    for (const off of [0, 0.25]) {
      const tt = t + off; if (tt >= 7.5) continue;
      const bar = Math.floor(tt / 2); const m = pulseRoot[chordOfBar(bar)];
      const n = S(0.24);
      const o = mix(square(n, mtof(m)), scale(square(n, mtof(m + 12)), 0.35));
      const filt = svf(o, 'lp', (i) => 500 + 1400 * Math.exp(-i / (SR * 0.05)), 0.9);
      const lvl = (0.35 + 0.65 * Math.min(1, tt / 6)) * (off ? 0.7 : 1);
      mul(filt, perc(n, 0.003, 0.07));
      for (let i = 0; i < n; i++) filt[i] *= pump(tt + i / SR, 0.5);
      addMono(musicMain, filt, S(tt), 0.11 * lvl, 0);
    }
  }
}

// ---- drum one-shots ----
function makeKick() {
  const n = S(0.5); const body = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const f = 50 + 120 * Math.exp(-t / 0.032) + 40 * Math.exp(-t / 0.006);
    ph += f / SR; body[i] = Math.sin(TAU * ph);
  }
  mul(body, perc(n, 0.0006, 0.2));
  for (let i = 0; i < n; i++) body[i] = Math.tanh(body[i] * 1.6) / Math.tanh(1.6);
  const clickN = S(0.012);
  const click = svf(noise(clickN, 77), 'hp', 2500, 0.7); mul(click, perc(clickN, 0.0003, 0.0025));
  for (let i = 0; i < clickN; i++) body[i] += click[i] * 0.35;
  return body;
}
function makeClap(seed) {
  const n = S(0.32); const out = new Float32Array(n);
  const nz = noise(n, seed);
  const a = svf(nz, 'bp', 1250, 1.1), b = svf(noise(n, seed + 9), 'bp', 2400, 1.4);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let e = 0;
    for (const o of [0, 0.0095, 0.0195]) if (t >= o) e = Math.max(e, (t - o < 0.0004 ? (t - o) / 0.0004 : 1) * Math.exp(-(t - o) / 0.006));
    if (t >= 0.028) e = Math.max(e, 0.75 * Math.exp(-(t - 0.028) / 0.075));
    else if (t >= 0.0275) e = Math.max(e, 0.75 * (t - 0.0275) / 0.0005);
    env[i] = e;
  }
  for (let i = 0; i < n; i++) out[i] = (a[i] * 2.2 + b[i] * 1.2) * env[i];
  const bodyN = S(0.08); const body = sine(bodyN, (i) => 230 - 60 * i / bodyN); mul(body, perc(bodyN, 0.0005, 0.025));
  for (let i = 0; i < bodyN; i++) out[i] += body[i] * 0.35;
  const tail = 200; for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
  return out;
}
function makeHat(len, tau, seed) {
  const n = S(len);
  const metal = mix(...[205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => square(n, f * 1.7)));
  const nz = noise(n, seed);
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = metal[i] * 0.12 + nz[i] * 0.6;
  let h = svf(src, 'hp', 7000, 0.8);
  h = svf(h, 'lp', 15000, 0.7);
  return mul(h, perc(n, 0.0005, tau));
}
const KICK = makeKick(), CLAP = makeClap(31), CLAP2 = makeClap(91);
const CHAT = makeHat(0.07, 0.014, 5), OHAT = makeHat(0.4, 0.09, 6);

// intro hats (bar 2 -> gap)
for (let k = 0; k < 32; k++) {
  const t = 4.0 + k * 0.125; if (t >= GAP0) break;
  const is8 = k % 2 === 0; const off = k % 4 === 2;
  if (t < 6.0 && !is8) continue; // 16ths only from bar 3
  const lvl = off ? 0.55 : is8 ? 0.32 : 0.2;
  addMono(musicMain, CHAT, S(t), 1.3 * lvl * (0.7 + 0.3 * (t - 4) / 4), k % 2 ? 0.15 : -0.1);
}
// build: clap/snare roll 6.0 -> 7.875
{
  const hits = [];
  for (let t = 6.0; t < 7.0 - 1e-9; t += 0.25) hits.push(t);
  for (let t = 7.0; t < GAP0 - 1e-9; t += 0.125) hits.push(t);
  hits.forEach((t, i) => addMono(musicMain, CLAP2, S(t), 0.12 + 0.28 * (i / hits.length) ** 1.5, 0));
}
// intro noise riser 4.0 -> 7.875
{
  const t0 = 4.0, t1 = GAP0; const n = S(t1 - t0);
  const nzL = noise(n, 401), nzR = noise(n, 402);
  const cut = (i) => 400 * Math.pow(9000 / 400, i / n);
  const L = svf(nzL, 'bp', cut, 1.6), R = svf(nzR, 'bp', cut, 1.6);
  for (let i = 0; i < n; i++) { const g = Math.pow(i / n, 2.2) * 0.22; L[i] *= g; R[i] *= g; }
  for (let i = 0; i < 192; i++) { L[n - 1 - i] *= i / 192; R[n - 1 - i] *= i / 192; }
  addStereo(musicMain, [L, R], S(t0), 1);
}

// ---- DROP beat: bars 4-11 (8.0 - 24.0) ----
for (let b = 0; b < 32; b++) {
  const t = DROP + b * 0.5;
  addMono(musicMain, KICK, S(t), 0.85, 0);
  if (b % 2 === 1) { addMono(musicMain, CLAP, S(t), 0.42, -0.08); addMono(musicMain, CLAP2, S(t), 0.25, 0.08); addMono(musicSend, CLAP, S(t), 0.18, 0); }
  addMono(musicMain, OHAT, S(t + 0.25), 0.28, 0.2);
  for (const q of [0.125, 0.375]) addMono(musicMain, CHAT, S(t + q), 0.16, -0.25);
}
addMono(musicMain, KICK, S(END), 0.95, 0); // final kick under the impact

// ---- bass: sub sine + reese, sidechained (drop + ending) ----
{
  const sub = new Float32Array(N), reese = new Float32Array(N);
  const segs = [];
  for (let bar = 4; bar < 12; bar++) segs.push([bar * 2, bar * 2 + 2, ROOT[chordOfBar(bar)], true]);
  segs.push([END, 25.0, 29, false], [25.0, 27.5, 36, false]);
  for (const [t0, t1, m, roll] of segs) {
    const n = S(t1 - t0); const at = S(t0);
    const env = adsr(n, 0.004, 0.05, 1, 0.02, (t1 - t0) - 0.025);
    const s = sine(n, mtof(m)); const r = mix(saw(n, mtof(m + 12) * 1.004, rng()), saw(n, mtof(m + 12) * 0.996, rng()));
    const rf = svf(r, 'lp', (i) => {
      if (!roll) return 300;
      const x = ((t0 + i / SR) % 0.125) / 0.125; return 260 + 700 * (1 - x) ** 2;
    }, 1.0);
    for (let i = 0; i < n; i++) { sub[at + i] += s[i] * env[i]; reese[at + i] += rf[i] * env[i]; }
  }
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const p = t >= DROP && t < END ? pump(t, 0.8) : 1;
    const v = (sub[i] * 0.3 + Math.tanh(reese[i] * 1.5) * 0.16) * p;
    musicMain[0][i] += v; musicMain[1][i] += v;
  }
}

// ---- chord stabs (bright supersaw), drop ----
function sweepAmt(t) { return t < 20 ? 0 : Math.min(1, (t - 20) / 3.5); }
for (let bar = 4; bar < 12; bar++) {
  const c = CH[chordOfBar(bar)].map((m) => m + 12);
  const pos = bar % 4 === 3 ? [2, 6, 10, 13, 14] : [2, 6, 10, 14];
  for (const p of pos) {
    const t = bar * 2 + p * 0.125; const n = S(0.32);
    const env = adsr(n, 0.002, 0.12, 0.3, 0.08, 0.16);
    const tmp = stereo(n);
    for (const m of c) for (let v = 0; v < 7; v++) {
      const pos7 = v / 3 - 1; const o = saw(n, mtof(m) * Math.pow(2, pos7 * 17 / 1200), rng());
      mul(o, env); addMono(tmp, o, 0, 0.026, pos7 * 0.55);
    }
    const sw = sweepAmt(t);
    for (let ch = 0; ch < 2; ch++) {
      let x = svf(tmp[ch], 'lp', (i) => 900 + (3000 + 6000 * sw) * Math.exp(-i / (SR * 0.07)) + 3000 * sw, 0.9);
      tmp[ch] = svf(x, 'hp', 220, 0.7);
    }
    addStereo(musicMain, tmp, S(t), 1);
    addStereo(musicSend, tmp, S(t), 0.5);
  }
}

// ---- sparkling arp (16ths) with ping-pong delay, drop ----
{
  const arp = stereo();
  const pat = [0, 2, 1, 3, 4, 6, 5, 7, 6, 4, 5, 3, 2, 0, 1, 3];
  for (let bar = 4; bar < 12; bar++) {
    const c = CH[chordOfBar(bar)]; const tones = [...c.map((m) => m + 12), ...c.map((m) => m + 24)];
    for (let k = 0; k < 16; k++) {
      const t = bar * 2 + k * 0.125; const m = tones[pat[k]]; const n = S(0.3);
      const o = mix(sine(n, mtof(m)), scale(sine(n, mtof(m) * 2), 0.25), scale(sine(n, mtof(m) * 3), 0.08));
      mul(o, perc(n, 0.002, 0.065));
      const lvl = (k % 4 === 0 ? 1 : 0.7) * (0.8 + 0.4 * sweepAmt(t));
      addMono(arp, o, S(t), 0.05 * lvl, k % 2 ? 0.35 : -0.35);
    }
  }
  // ping-pong delay, dotted 8th (0.375 s)
  const d = S(0.375); const fb = 0.38;
  const L = Float32Array.from(arp[0]), R = Float32Array.from(arp[1]);
  for (let i = d; i < N; i++) { L[i] += R[i - d] * fb * 0.9; R[i] += L[i - d] * fb; }
  const wetL = svf(L, 'lp', 6000, 0.7), wetR = svf(R, 'lp', 6000, 0.7);
  const arpOut = [svf(wetL, 'hp', 300, 0.7), svf(wetR, 'hp', 300, 0.7)];
  addStereo(musicMain, arpOut, 0, 1);
  addStereo(musicSend, arpOut, 0, 0.4);
}

// ---- bars 10-11 upward filtered-noise sweep (20.0 -> 23.9) ----
{
  const t0 = 20.0, t1 = 23.98; const n = S(t1 - t0);
  const cut = (i) => 300 * Math.pow(11000 / 300, i / n);
  const L = svf(noise(n, 501), 'bp', cut, 2.2), R = svf(noise(n, 502), 'bp', cut, 2.2);
  for (let i = 0; i < n; i++) { const g = 0.02 + 0.16 * Math.pow(i / n, 2); L[i] *= g; R[i] *= g; }
  const fi = S(0.3); for (let i = 0; i < fi; i++) { L[i] *= i / fi; R[i] *= i / fi; }
  for (let i = 0; i < 192; i++) { L[n - 1 - i] *= i / 192; R[n - 1 - i] *= i / 192; }
  addStereo(musicMain, [L, R], S(t0), 1);
}

// =====================================================================================
// SFX
// =====================================================================================
const sfxMain = stereo(), sfxSend = stereo();
const CUES = []; // [time, label, kind] kind: onset | peak | end

function textHit(t, big) {
  const n = S(big ? 0.45 : 0.3);
  const thump = sine(n, (i) => 55 + 150 * Math.exp(-i / (SR * 0.022)));
  mul(thump, perc(n, 0.0005, big ? 0.11 : 0.075));
  for (let i = 0; i < n; i++) thump[i] = Math.tanh(thump[i] * 2) / Math.tanh(2);
  const snap = svf(noise(n, 600 + Math.round(t * 10)), 'hp', 4500, 0.7); mul(snap, perc(n, 0.0003, 0.012));
  const punch = svf(noise(n, 700 + Math.round(t * 10)), 'bp', 1600, 0.9); mul(punch, perc(n, 0.0004, 0.03));
  const tone = svf(square(n, mtof(57)), 'lp', (i) => 600 + 3000 * Math.exp(-i / (SR * 0.02)), 0.8);
  mul(tone, perc(n, 0.0008, big ? 0.07 : 0.045));
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = thump[i] * 0.75 + snap[i] * 0.45 + punch[i] * 0.55 + tone[i] * 0.16;
  const g = big ? 0.95 : 0.78;
  addMono(sfxMain, o, S(t), g, 0);
  addMono(sfxSend, svf(o, 'hp', 400, 0.7), S(t), 0.25, 0);
  CUES.push([t, `Text hit${big ? ' (accent)' : ''}: tuned thump (A) + snap + punch`, 'onset']);
}
/** Reverse cymbal ending exactly at t1 (hard stop with a 3 ms fade). */
function reverseCymbal(t0, t1, gain, seed) {
  const n = S(t1 - t0); const out = [];
  for (let c = 0; c < 2; c++) {
    const nz = noise(n, seed + c);
    const metal = mix(...[3150, 4210, 5320, 6870, 8010].map((f) => scale(square(n, f * (1 + c * 0.003)), 0.06)));
    const src = mix(nz, metal);
    let x = svf(src, 'hp', (i) => 1500 + 4500 * (i / n), 0.8);
    x = svf(x, 'lp', (i) => 5000 + 11000 * Math.pow(i / n, 2), 0.7);
    for (let i = 0; i < n; i++) x[i] *= Math.pow(i / n, 3.2) * gain;
    const f = S(0.003); for (let i = 0; i < f; i++) x[n - 1 - i] *= i / f;
    out.push(x);
  }
  addStereo(sfxMain, out, S(t0), 1);
}
function tonalRiser(t0, t1, m0, m1, gain) {
  const n = S(t1 - t0);
  const f = (i) => mtof(m0 + (m1 - m0) * Math.pow(i / n, 1.4));
  const out = [];
  for (let c = 0; c < 2; c++) {
    const o = mix(saw(n, (i) => f(i) * (c ? 1.006 : 0.994), 0.3 * c), scale(saw(n, (i) => f(i) * 2, 0.1), 0.3));
    const x = svf(o, 'lp', (i) => 800 + 7000 * Math.pow(i / n, 2), 1.2);
    for (let i = 0; i < n; i++) x[i] *= Math.pow(i / n, 2) * gain;
    const fo = S(0.004); for (let i = 0; i < fo; i++) x[n - 1 - i] *= i / fo;
    const fi = S(0.05); for (let i = 0; i < fi; i++) x[i] *= i / fi;
    out.push(x);
  }
  addStereo(sfxMain, out, S(t0), 1);
}
function keyTick(t, k) {
  const r = createRng(900 + k); const n = S(0.03);
  const nz = svf(noise(n, 1000 + k), 'bp', 3800 + 900 * r(), 2.5); mul(nz, perc(n, 0.0002, 0.0035));
  const tn = sine(n, 2500 + 300 * r()); mul(tn, perc(n, 0.0002, 0.005));
  const o = mix(scale(nz, 1.6), scale(tn, 0.35));
  addMono(sfxMain, o, S(t), 0.16 * (0.75 + 0.35 * r()), (r() - 0.5) * 0.3);
}
function uiClick(t) {
  const mk = (n, f0, f1, g) => { const o = sine(n, (i) => f1 + (f0 - f1) * Math.exp(-i / (SR * 0.006))); mul(o, perc(n, 0.0002, 0.012)); const c = svf(noise(n, 1300), 'hp', 3000, 0.7); mul(c, perc(n, 0.0002, 0.002)); return scale(mix(o, scale(c, 0.6)), g); };
  addMono(sfxMain, mk(S(0.06), 2200, 1320, 1), S(t), 0.42, 0);
  addMono(sfxMain, mk(S(0.05), 2600, 1760, 0.6), S(t + 0.055), 0.3, 0);
  CUES.push([t, 'UI click (Generate): 2-part blip 1.3-2.2 kHz', 'onset']);
}
function bell(n, f, { ratio = 2, index = 1.4, tau = 0.5, itau = 0.15 } = {}) {
  const o = new Float32Array(n); let pc = 0, pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const I = index * Math.exp(-t / itau);
    o[i] = Math.sin(TAU * pc + I * Math.sin(TAU * pm)) * Math.exp(-t / tau);
    pc += f / SR; pm += (f * ratio) / SR;
  }
  const a = S(0.0015); for (let i = 0; i < a; i++) o[i] *= i / a;
  const tail = 200; for (let i = 0; i < tail; i++) o[n - 1 - i] *= i / tail;
  return o;
}
function shimmer(t) {
  const notes = [81, 88, 93, 96, 100]; // A5 E6 A6 C7 E7
  notes.forEach((m, k) => {
    const n = S(GAP0 - t - k * 0.022); // ring until the gap, faded below
    const o = bell(n, mtof(m), { ratio: 3.01, index: 0.9, tau: 0.35, itau: 0.08 });
    for (let i = 0; i < n; i++) o[i] *= 0.85 + 0.15 * Math.sin(TAU * 11 * i / SR + k);
    const f = S(0.03); for (let i = 0; i < f; i++) o[n - 1 - i] *= i / f;
    const pan = -0.6 + 0.3 * k;
    addMono(sfxMain, o, S(t + k * 0.022), 0.1, pan);
    addMono(sfxSend, o, S(t + k * 0.022), 0.18, pan);
  });
  // airy sparkle noise
  const n = S(0.35); const sp = svf(noise(n, 1400), 'hp', 9000, 0.7); mul(sp, perc(n, 0.002, 0.08));
  addMono(sfxMain, sp, S(t), 0.08, 0.3);
  CUES.push([t, 'Shimmer: strummed FM bells A5-E6-A6-C7-E7 + air', 'onset']);
}
function impact(t, big, label) {
  // sub boom
  const n = S(big ? 2.4 : 1.8);
  const boom = sine(n, (i) => (big ? 43.65 : 55) + 75 * Math.exp(-i / (SR * 0.05)));
  mul(boom, perc(n, 0.0008, big ? 0.6 : 0.45));
  for (let i = 0; i < n; i++) boom[i] = Math.tanh(boom[i] * 2.2) / Math.tanh(2.2);
  addMono(sfxMain, boom, S(t), 0.6, 0);
  // crash (stereo, designed: noise + inharmonic metal partials)
  const cn = S(big ? 3.4 : 2.6); const crash = [];
  for (let c = 0; c < 2; c++) {
    const metal = mix(...[2730, 3390, 4420, 5170, 6640, 7930].map((f, k) => scale(square(cn, f * (1 + 0.004 * c)), 0.05 / (1 + k * 0.2))));
    const src = mix(noise(cn, 1500 + c + (big ? 10 : 0)), metal);
    let x = svf(src, 'hp', 2800, 0.7); x = svf(x, 'lp', (i) => 4000 + 12000 * Math.exp(-i / (SR * 0.4)), 0.7);
    mul(x, perc(cn, 0.0006, big ? 0.9 : 0.65));
    crash.push(scale(x, 0.5));
  }
  addStereo(sfxMain, crash, S(t), 1);
  addStereo(sfxSend, crash, S(t), 0.5);
  // transient snap
  const sn = S(0.06); const snap = svf(noise(sn, 1600), 'bp', 2200, 0.8); mul(snap, perc(sn, 0.0003, 0.012));
  addMono(sfxMain, snap, S(t), 0.6, 0);
  addMono(sfxSend, boom.subarray(0, S(0.4)), S(t), 0.05, 0);
  CUES.push([t, label, 'onset']);
}
function pluckPop(t, m, k) {
  const n = S(0.7); const f = mtof(m); const P = Math.round(SR / f);
  // Karplus-Strong pluck
  const buf = noise(P, 1700 + k); const ks = new Float32Array(n); let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = buf[idx], b = buf[(idx + 1) % P]; const v = 0.497 * (a + b) ;
    ks[i] = a; buf[idx] = v; idx = (idx + 1) % P;
  }
  const kf = svf(ks, 'lp', (i) => 1500 + 6000 * Math.exp(-i / (SR * 0.05)), 0.7);
  mul(kf, perc(n, 0.001, 0.22));
  const pop = sine(n, (i) => f + f * Math.exp(-i / (SR * 0.006))); mul(pop, perc(n, 0.0005, 0.03));
  const tone = sine(n, f); mul(tone, perc(n, 0.001, 0.15));
  const o = mix(scale(kf, 0.9), scale(pop, 0.6), scale(tone, 0.3));
  const pan = [-0.35, -0.12, 0.12, 0.35][k];
  addMono(sfxMain, o, S(t), 0.42, pan);
  addMono(sfxSend, o, S(t), 0.25, pan);
  CUES.push([t, `Pluck pop ${['A5', 'C6', 'E6', 'A6'][k]} (rising): Karplus-Strong + pitch-drop pop`, 'onset']);
}
/** Whoosh whose loudest point lands exactly on t. dir +1 = L->R. */
function whoosh(t, { pre, post, f0, fpk, f1, gain, dir, seed, label }) {
  const n = S(pre + post); const P = S(pre);
  const cut = (i) => (i < P ? f0 * Math.pow(fpk / f0, i / P) : fpk * Math.pow(f1 / fpk, (i - P) / (n - P)));
  const out = [];
  for (let c = 0; c < 2; c++) {
    let x = svf(noise(n, seed + c), 'bp', cut, 1.3);
    x = mix(x, scale(svf(noise(n, seed + 7 + c), 'lp', (i) => cut(i) * 0.5, 0.7), 0.4));
    for (let i = 0; i < n; i++) {
      const e = i < P ? Math.pow(i / P, 2.5) : Math.pow(1 - (i - P) / (n - P), 1.8);
      const pos = (i / n) * 2 - 1; const panp = (dir * pos + 1) * Math.PI / 4;
      x[i] *= e * gain * (c === 0 ? Math.cos(panp) : Math.sin(panp)) * Math.SQRT2;
    }
    out.push(x);
  }
  addStereo(sfxMain, out, S(t - pre), 1);
  addStereo(sfxSend, out, S(t - pre), 0.2);
  // air snap: a short bright transient exactly on the cue so the sync point is unambiguous
  const sn = S(0.08);
  const snap = mix(scale(svf(noise(sn, seed + 50), 'hp', 3000, 0.7), 1), scale(svf(noise(sn, seed + 51), 'bp', 1200, 1), 0.6));
  mul(snap, perc(sn, 0.0004, 0.014));
  addMono(sfxMain, snap, S(t), gain * 0.9, dir * 0.3);
  CUES.push([t, label, 'onset']);
}
function chime(t) {
  [84, 88, 91, 96].forEach((m, k) => {
    const n = S(1.4); const o = bell(n, mtof(m), { ratio: 2, index: 1.1, tau: 0.45, itau: 0.12 });
    const o2 = bell(n, mtof(m) * 2, { ratio: 3.5, index: 0.5, tau: 0.2, itau: 0.05 });
    const x = mix(o, scale(o2, 0.25)); const pan = -0.3 + 0.2 * k;
    addMono(sfxMain, x, S(t + k * 0.06), 0.17, pan);
    addMono(sfxSend, x, S(t + k * 0.06), 0.22, pan);
  });
  CUES.push([t, 'Success chime: FM bells C6-E6-G6-C7 (60 ms strum)', 'onset']);
}

// ---- place SFX ----
[[0.0, false], [0.5, false], [1.0, true], [2.0, false], [2.5, false], [3.0, true]].forEach(([t, b]) => textHit(t, b));
reverseCymbal(3.0, 4.0, 0.3, 300); CUES.push([4.0, 'Reverse cymbal (3.0 -> 4.0) hard-stops on 4.0', 'end']);
for (let k = 0; k <= 18; k++) keyTick(4.2 + k * 0.1, k);
CUES.push([4.2, 'Key ticks start (19 ticks, every 0.1 s, 4.2 -> 6.0)', 'onset']);
CUES.push([6.0, 'Last key tick', 'onset']);
uiClick(6.5);
shimmer(7.5);
tonalRiser(7.0, GAP0, 57, 81, 0.09); reverseCymbal(7.0, GAP0, 0.22, 310);
CUES.push([GAP0, 'Riser (7.0 -> 7.875: saw A3->A5 + reverse cymbal), gap 7.875-8.0', 'end']);
impact(8.0, false, 'DROP impact: sub boom (A1) + designed crash + snap; full beat starts');
[81, 84, 88, 93].forEach((m, k) => pluckPop(12.5 + k * 0.5, m, k));
whoosh(14.5, { pre: 0.28, post: 0.4, f0: 300, fpk: 2600, f1: 600, gain: 0.55, dir: 1, seed: 1800, label: 'Whoosh: band-passed noise sweep L->R, peak + air snap on cue' });
[17.0, 18.0, 19.0].forEach((t, k) => whoosh(t, { pre: 0.16, post: 0.26, f0: 700, fpk: 4200 - k * 500, f1: 900, gain: 0.45, dir: k % 2 ? -1 : 1, seed: 1900 + 10 * k, label: `Swoosh ${k + 1}: short noise sweep ${k % 2 ? 'R->L' : 'L->R'}, peak + air snap on cue` }));
chime(23.0);
reverseCymbal(23.0, END, 0.3, 320); tonalRiser(23.0, END, 55, 79, 0.07);
CUES.push([END, 'Riser 23.0 -> 24.0 (reverse cymbal + saw G3->G5) ends on 24.0', 'end']);
impact(END, true, 'FINAL impact: sub boom (F1) + long crash; Fmaj9 chord -> C(add9) at 25.0');
CUES.push([25.0, 'Chord resolves to C(add9) (music)', 'onset']);

// SFX gap 7.875-8.0 too
for (const bus of [sfxMain, sfxSend, musicMain, musicSend]) for (const ch of bus) {
  const a = S(GAP0), b = S(DROP), f = S(0.004);
  for (let i = a - f; i < b; i++) ch[i] *= i < a ? (a - i) / f : 0;
}

// =====================================================================================
// Reverb IR (stereo, decorrelated, darkening tail, RT60 ~2.1 s, 18 ms predelay)
// =====================================================================================
const irN = S(2.6); const ir = [];
for (let c = 0; c < 2; c++) {
  const x = svf(noise(irN, 2000 + c), 'lp', (i) => 9000 * Math.exp(-i / (SR * 0.9)) + 1500, 0.7);
  const pre = S(0.018);
  for (let i = 0; i < irN; i++) {
    const t = i / SR;
    x[i] = i < pre ? 0 : x[i] * Math.exp(-6.91 * t / 2.1) * Math.min(1, (i - pre) / S(0.006));
  }
  const tail = S(0.05); for (let i = 0; i < tail; i++) x[irN - 1 - i] *= i / tail;
  ir.push(x);
}

writeWav(join(BUILD, 'music_main.wav'), musicMain);
writeWav(join(BUILD, 'music_send.wav'), musicSend);
writeWav(join(BUILD, 'sfx_main.wav'), sfxMain);
writeWav(join(BUILD, 'sfx_send.wav'), sfxSend);
writeWav(join(BUILD, 'ir.wav'), ir);
CUES.sort((a, b) => a[0] - b[0]);
writeFileSync(join(BUILD, 'cues.json'), JSON.stringify(CUES, null, 1));
const pk = (b) => Math.max(...b.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
console.log('rendered. peaks: music', pk(musicMain).toFixed(3), 'sfx', pk(sfxMain).toFixed(3));
