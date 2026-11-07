// Small pure-JS DSP toolkit for the Motion Studio reel soundtrack.
// Everything is deterministic: noise comes from a seeded PRNG.
import { readFileSync, writeFileSync } from 'node:fs';

export const SR = 48000;
export const DUR = 28.0;
export const N = Math.round(SR * DUR); // 1,344,000 samples
export const BEAT = 0.5;
export const BAR = 2.0;
export const TAU = Math.PI * 2;

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const db = (d) => Math.pow(10, d / 20);
export const S = (t) => Math.round(t * SR); // time -> sample index (exact cue placement)

// ---------- buffers ----------
export function stereo(n = N) {
  return [new Float32Array(n), new Float32Array(n)];
}
/** Add a mono Float32Array into a stereo bus at sample `at`, with gain and constant-power pan (-1..1). */
export function addMono(bus, sig, at, gain = 1, pan = 0) {
  const a = (pan + 1) * Math.PI / 4;
  const gl = Math.cos(a) * Math.SQRT2 * gain, gr = Math.sin(a) * Math.SQRT2 * gain;
  const [L, R] = bus;
  for (let i = 0; i < sig.length; i++) {
    const j = at + i;
    if (j < 0) continue;
    if (j >= L.length) break;
    L[j] += sig[i] * gl; R[j] += sig[i] * gr;
  }
}
export function addStereo(bus, sig, at, gain = 1) {
  const [L, R] = bus;
  for (let i = 0; i < sig[0].length; i++) {
    const j = at + i;
    if (j < 0) continue;
    if (j >= L.length) break;
    L[j] += sig[0][i] * gain; R[j] += sig[1][i] * gain;
  }
}

// ---------- rng / noise ----------
export function createRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export function noise(n, seed) {
  const r = createRng(seed); const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = r() * 2 - 1;
  return o;
}

// ---------- oscillators (band-limited) ----------
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
/** PolyBLEP saw. freq may be a number or a function of sample index. */
export function saw(n, freq, phase0 = 0) {
  const o = new Float32Array(n); let ph = phase0 % 1;
  const f = typeof freq === 'function' ? freq : () => freq;
  for (let i = 0; i < n; i++) {
    const dt = f(i) / SR;
    o[i] = 2 * ph - 1 - polyblep(ph, dt);
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return o;
}
export function square(n, freq, phase0 = 0) {
  const o = new Float32Array(n); let ph = phase0 % 1;
  const f = typeof freq === 'function' ? freq : () => freq;
  for (let i = 0; i < n; i++) {
    const dt = f(i) / SR;
    let v = ph < 0.5 ? 1 : -1;
    v += polyblep(ph, dt);
    let p2 = ph + 0.5; if (p2 >= 1) p2 -= 1;
    v -= polyblep(p2, dt);
    o[i] = v; ph += dt; if (ph >= 1) ph -= 1;
  }
  return o;
}
export function sine(n, freq, phase0 = 0) {
  const o = new Float32Array(n); let ph = phase0;
  const f = typeof freq === 'function' ? freq : () => freq;
  for (let i = 0; i < n; i++) { o[i] = Math.sin(TAU * ph); ph += f(i) / SR; }
  return o;
}

// ---------- envelopes ----------
/** Linear-attack / exponential-ish decay envelope, always click free. Times in seconds. */
export function adsr(n, a, d, s, r, holdSec) {
  const o = new Float32Array(n);
  const A = Math.max(1, S(a)), D = Math.max(1, S(d)), H = holdSec == null ? n : S(holdSec), R = Math.max(1, S(r));
  let last = 0;
  for (let i = 0; i < n; i++) {
    let v;
    if (i < A) v = i / A;
    else if (i < A + D) { const x = (i - A) / D; v = 1 + (s - 1) * (1 - Math.pow(1 - x, 3)); }
    else v = s;
    if (i < H) last = v;
    else { const x = (i - H) / R; v = x >= 1 ? 0 : last * Math.pow(1 - x, 2); }
    o[i] = v;
  }
  // guarantee the last samples reach zero
  const tail = Math.min(n, 96);
  for (let i = 0; i < tail; i++) o[n - 1 - i] *= i / tail;
  return o;
}
/** Percussive envelope: attack seconds, then exp decay with time constant tau. */
export function perc(n, a, tau) {
  const o = new Float32Array(n); const A = Math.max(1, S(a)); const k = Math.exp(-1 / (tau * SR));
  let v = 1;
  for (let i = 0; i < n; i++) {
    if (i < A) o[i] = (i / A); else { v *= k; o[i] = v; }
  }
  const tail = Math.min(n, 96);
  for (let i = 0; i < tail; i++) o[n - 1 - i] *= i / tail;
  return o;
}
export function mul(a, b) { for (let i = 0; i < a.length; i++) a[i] *= b[i]; return a; }
export function scale(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
export function mix(...sigs) {
  const n = Math.max(...sigs.map((s) => s.length)); const o = new Float32Array(n);
  for (const s of sigs) for (let i = 0; i < s.length; i++) o[i] += s[i];
  return o;
}

// ---------- filters ----------
/** Cytomic TPT state-variable filter. cutoff (Hz) may be a function of sample index. mode lp|bp|hp. In place on a copy. */
export function svf(x, mode, cutoff, q = 0.707) {
  const o = new Float32Array(x.length);
  const fc = typeof cutoff === 'function' ? cutoff : () => cutoff;
  let ic1 = 0, ic2 = 0; const k = 1 / q;
  let lastF = -1, a1 = 0, a2 = 0, a3 = 0, g = 0;
  for (let i = 0; i < x.length; i++) {
    const f = Math.min(Math.max(fc(i), 10), SR * 0.45);
    if (f !== lastF) {
      g = Math.tan(Math.PI * f / SR); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; lastF = f;
    }
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    o[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 : v0 - k * v1 - v2;
  }
  return o;
}
export function onepoleHP(x, f) {
  const o = new Float32Array(x.length); const a = Math.exp(-TAU * f / SR);
  let lp = 0;
  for (let i = 0; i < x.length; i++) { lp = (1 - a) * x[i] + a * lp; o[i] = x[i] - lp; }
  return o;
}

// ---------- WAV IO ----------
export function writeWav(path, chans, bits = 32) {
  const n = chans[0].length, nc = chans.length;
  const bps = bits / 8, dataLen = n * nc * bps;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(bits === 32 ? 3 : 1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * nc * bps, 28);
  buf.writeUInt16LE(nc * bps, 32); buf.writeUInt16LE(bits, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  let off = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const v = chans[c][i];
    if (bits === 32) buf.writeFloatLE(v, off);
    else { const s = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607))); buf.writeIntLE(s, off, 3); }
    off += bps;
  }
  writeFileSync(path, buf);
}
export function readWav(path) {
  const b = readFileSync(path);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4); const len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), nc: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') { data = [p + 8, Math.min(len, b.length - p - 8)]; break; }
    p += 8 + len + (len & 1);
  }
  let tag = fmt.tag;
  if (tag === 0xfffe) tag = fmt.bits === 32 ? 3 : 1; // extensible: assume float for 32-bit (we only ask ffmpeg for f32/s24)
  const bps = fmt.bits / 8, n = Math.floor(data[1] / (bps * fmt.nc));
  const ch = Array.from({ length: fmt.nc }, () => new Float32Array(n));
  let off = data[0];
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.nc; c++) {
    let v;
    if (tag === 3) v = b.readFloatLE(off);
    else if (fmt.bits === 24) v = b.readIntLE(off, 3) / 8388608;
    else if (fmt.bits === 16) v = b.readInt16LE(off) / 32768;
    else v = b.readInt32LE(off) / 2147483648;
    ch[c][i] = v; off += bps;
  }
  return { sr: fmt.sr, ch, n };
}
