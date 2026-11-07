/**
 * applyPalette: maps a palette onto every color param of a template while keeping the template's
 * design relationships. Pure function of (template params, palette, variant); no Math.random/Date.
 *
 * Mapping rules (see also `colorRole`):
 *  1. Roles from `colorRole`. The first background param is the primary background (bg0).
 *  2. bg0 = a background option picked by the variant: [dominant, darkest, lightest, deep dominant,
 *     pale dominant] minus near-duplicates, index variant mod min(3, options). Variant 0 = dominant.
 *     The template "flips" (light design <-> dark design) when bg0's darkness differs from the
 *     default background's. bg0's lightness is then kept inside its band (dark designs: WCAG Y <=
 *     max(ref, 0.045); light designs: Y >= min(ref, 0.62)) so text and accents have room.
 *     Further background params take the heaviest remaining palette colors that are distinct from bg0
 *     (or a hue-shifted / lightness-shifted bg0 when none is left).
 *  3. Foregrounds: the palette color with the highest contrast against the surface they sit on
 *     (bg0, or the background/accent param they contrast most with by default).
 *  4. Accents: remaining palette colors (not used as background/foreground, OKLab-distinct from bg0)
 *     ranked by chroma * sqrt(weight), rotated by the variant, assigned in param order; extra accents
 *     are derived deterministically by rotating hue / shifting lightness.
 *  5. Constraints, all from the DEFAULT colors (u = ln(Y + 0.05), so contrast is a difference in u):
 *     - every pair with default contrast c >= 3 needs >= min(4.5, c)            (pair preservation)
 *     - foregrounds that sit on bg0 (default contrast >= 3) need >= 4.5 vs bg0   (WCAG text)
 *     - accents need >= min(2, c) vs bg0                                         (accent visibility)
 *     - scene templates: literal text colors in the scene (e.g. white text on the background) are
 *       fixed "anchor" colors, constrained like params; templates with such anchors never flip.
 *       Code templates list theirs in CODE_TEMPLATE_INKS (promo_card_v1: highlight on a white card).
 *     Which side of each pair is lighter follows the default design (or its mirror when flipped).
 *     Solver: push the lower-priority param's lightness (accent < foreground < second background <
 *     bg0 < anchor), several passes; if that does not converge, blend toward the default lightness
 *     levels (always feasible). OKLCH hue and chroma are kept; chroma is reduced only to stay in gamut.
 *     The result is verified on the final hex values; a template-default fallback guarantees validity.
 */
import type { TemplateDefinition } from '../types';
import { BUNDLED_SCENES } from '../scenes';
import { contrastRatio, hashString } from '../math';
import type { Palette } from './types';
import { colorRole } from './roles';
import {
  type Lab,
  type Lch,
  hexToLab,
  hexToRgb8,
  labDistance,
  labToLch,
  lchLuminance,
  lchToHex,
  lchToLab,
  lightnessForLuminance,
  linearLuminance,
  srgb8ToLinear,
} from './color';

const UMIN = Math.log(0.05);
const UMAX = Math.log(1.05);
/** WCAG luminance where contrast vs black equals contrast vs white. */
const MID_Y = Math.sqrt(1.05 * 0.05) - 0.05;
const MARGIN = Math.log(1.012);
const PRIO = { accent: 1, foreground: 2, background2: 2.5, background: 3, anchor: Infinity } as const;
const NEUTRAL_HEX = '#808080';
/** Soft contrast goal for foregrounds against their surface (the hard floor is 4.5). */
const FG_TARGET = 7;

interface Col {
  lab: Lab;
  lch: Lch;
  w: number;
  hex: string;
}

interface Node {
  /** Default color (template default, or the anchor color). */
  def: string;
  defU: number;
  prio: number;
  anchor: boolean;
}

interface Constraint {
  a: number;
  b: number;
  /** Required contrast ratio. */
  r: number;
  /** Index (a or b) of the side that is lighter in the default design. */
  hiDefault: number;
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;
const yOfHex = (hex: string): number => {
  const [r, g, b] = hexToRgb8(hex);
  return linearLuminance(srgb8ToLinear(r), srgb8ToLinear(g), srgb8ToLinear(b));
};
const uOfY = (y: number): number => Math.log(y + 0.05);
const yOfU = (u: number): number => Math.exp(u) - 0.05;
const mirrorU = (u: number): number => UMIN + UMAX - u;
const colOf = (hex: string, w: number): Col => {
  const lab = hexToLab(hex);
  return { lab, lch: labToLch(lab), w, hex };
};

// ---------------------------------------------------------------- scene text anchors

let inkCache: Map<string, string[]> | null = null;

/**
 * Code templates can't be scanned, so their fixed colors that a color param is drawn on are listed
 * here: promo_card_v1 draws primaryColor (headline highlight) on a near-white card.
 */
const CODE_TEMPLATE_INKS: Record<string, string[]> = { promo_card_v1: ['#FFFFFF'] };

/** Fixed colors a template draws against its params: scene text/counter literals + CODE_TEMPLATE_INKS. */
function sceneInks(templateId: string): string[] {
  if (CODE_TEMPLATE_INKS[templateId]) return CODE_TEMPLATE_INKS[templateId] as string[];
  if (!inkCache) {
    inkCache = new Map();
    for (const src of BUNDLED_SCENES) {
      const json = src.json as { id?: unknown };
      if (typeof json.id !== 'string') continue;
      const found = new Set<string>();
      const walk = (o: unknown): void => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') {
          const rec = o as Record<string, unknown>;
          if ((rec.type === 'text' || rec.type === 'counter') && typeof rec.color === 'string') {
            const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(rec.color);
            if (m && (m[2] === undefined || parseInt(m[2], 16) >= 128)) found.add(`#${(m[1] as string).toUpperCase()}`);
          }
          Object.values(rec).forEach(walk);
        }
      };
      walk(json);
      inkCache.set(json.id, [...found].sort());
    }
  }
  return inkCache.get(templateId) ?? [];
}

// ---------------------------------------------------------------- palette normalisation

function normalise(palette: Palette): Col[] {
  const out: Col[] = [];
  for (const c of palette?.colors ?? []) {
    if (!c || typeof c.hex !== 'string') continue;
    const h = c.hex.trim().replace(/^#/, '');
    if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) continue;
    const full = (h.length === 3 ? h.replace(/./g, (x) => x + x) : h).toUpperCase();
    const w = Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0;
    const prev = out.find((o) => o.hex === `#${full}`);
    if (prev) prev.w += w;
    else out.push(colOf(`#${full}`, w));
  }
  if (!out.length) return [colOf(NEUTRAL_HEX, 1)];
  const sum = out.reduce((s, c) => s + c.w, 0);
  for (const c of out) c.w = sum > 0 ? c.w / sum : 1 / out.length;
  return out.sort((p, q) => q.w - p.w || (p.hex < q.hex ? -1 : p.hex > q.hex ? 1 : 0));
}

// ---------------------------------------------------------------- color helpers

/** Same hue family, lightness moved to reach WCAG luminance y. */
function withY(lch: Lch, y: number): Lch {
  return { L: lightnessForLuminance(y, lch.C, lch.h), C: lch.C, h: lch.h };
}

/**
 * Soft text target: moves `lch` (same hue) toward black/white until its contrast with a surface
 * of luminance ySurface reaches `ratio` (or the best achievable), on the side it is already on
 * unless the other side does clearly better.
 */
function towardContrast(lch: Lch, ySurface: number, ratio: number): Lch {
  const y = lchLuminance(lch);
  const cr = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (cr(y, ySurface) >= ratio) return lch;
  const upMax = cr(1, ySurface);
  const downMax = cr(0, ySurface);
  const up = y >= ySurface ? upMax >= ratio || upMax >= downMax : !(downMax >= ratio || downMax >= upMax);
  return withY(lch, up ? Math.min(1, ratio * (ySurface + 0.05) - 0.05) : Math.max(0, (ySurface + 0.05) / ratio - 0.05));
}

function derive(base: Lch, n: number): Lch {
  // n = 1, 2, 3...: alternate hue +/- 32deg steps and lightness +/- shifts; neutrals only shift lightness.
  const round = Math.ceil(n / 2);
  const sign = n % 2 ? 1 : -1;
  if (base.C < 0.03) {
    const L = base.L > 0.55 ? base.L - 0.3 * round : base.L + 0.3 * round;
    return { L: Math.min(0.92, Math.max(0.2, L)), C: base.C, h: base.h };
  }
  const L = base.L + sign * 0.08 * round;
  return { L: Math.min(0.9, Math.max(0.3, L)), C: Math.max(base.C, 0.08), h: base.h + sign * round * 0.56 };
}

// ---------------------------------------------------------------- main

export function applyPalette(
  template: TemplateDefinition,
  palette: Palette,
  opts: { variant?: number } = {},
): Record<string, string> {
  const params = template.params.filter((p) => p.type === 'color') as { key: string; label: string; default: string }[];
  if (!params.length) return {};
  const variant = Number.isFinite(opts.variant) ? Math.trunc(opts.variant as number) : 0;
  const cols = normalise(palette);
  const roles = params.map((p) => colorRole(p));
  const n = params.length;
  const bg0 = roles.indexOf('background');

  // ---- nodes (params + scene text anchors) and default-derived constraints
  const anchors = sceneInks(template.id);
  const nodes: Node[] = [
    ...params.map((p, i) => {
      const role = roles[i] as keyof typeof PRIO;
      const prio = role === 'background' && i !== bg0 ? PRIO.background2 : PRIO[role];
      return { def: p.default, defU: uOfY(yOfHex(p.default)), prio, anchor: false };
    }),
    ...anchors.map((hex) => ({ def: hex, defU: uOfY(yOfHex(hex)), prio: PRIO.anchor, anchor: true })),
  ];
  const constraints: Constraint[] = [];
  for (let a = 0; a < nodes.length; a++)
    for (let b = a + 1; b < nodes.length; b++) {
      const na = nodes[a] as Node;
      const nb = nodes[b] as Node;
      if (na.anchor && nb.anchor) continue;
      const c = contrastRatio(na.def, nb.def);
      let r = c >= 3 ? Math.min(4.5, c) : 0;
      const withBg0 = a === bg0 || b === bg0;
      const other = a === bg0 ? b : a;
      if (withBg0 && other < n) {
        if (roles[other] === 'foreground' && c >= 3) r = Math.max(r, 4.5);
        if (roles[other] === 'accent' && c > 1.05) r = Math.max(r, Math.min(2, c));
      }
      if (r > 1) constraints.push({ a, b, r, hiDefault: na.defU >= nb.defU ? a : b });
    }
  const anchored = constraints.some((c) => (nodes[c.a] as Node).anchor || (nodes[c.b] as Node).anchor);

  // ---- background options + variant
  const dominant = cols[0] as Col;
  const big = cols.filter((c) => c.w >= 0.08);
  const pool = big.length ? big : cols;
  const darkest = pool.reduce((m, c) => (c.lch.L < m.lch.L ? c : m), pool[0] as Col);
  const lightest = pool.reduce((m, c) => (c.lch.L > m.lch.L ? c : m), pool[0] as Col);
  const options: { lch: Lch; src: Col | null }[] = [];
  const addOption = (lch: Lch, src: Col | null): void => {
    const lab = lchToLab(lch);
    if (options.every((o) => labDistance(lchToLab(o.lch), lab) >= 0.08)) options.push({ lch, src });
  };
  addOption(dominant.lch, dominant);
  addOption(darkest.lch, darkest);
  addOption(lightest.lch, lightest);
  addOption({ L: 0.24, C: Math.min(dominant.lch.C, 0.09), h: dominant.lch.h }, null);
  addOption({ L: 0.95, C: Math.min(dominant.lch.C, 0.03), h: dominant.lch.h }, null);
  const bgPick = options[mod(variant, Math.min(3, options.length))] as { lch: Lch; src: Col | null };

  const flip =
    !anchored && bg0 >= 0 && yOfHex((params[bg0] as { default: string }).default) < MID_Y !== lchLuminance(bgPick.lch) < MID_Y;
  const refU = (i: number): number => (flip ? mirrorU((nodes[i] as Node).defU) : (nodes[i] as Node).defU);

  // ---- initial assignment
  const init: (Lch | null)[] = params.map(() => null);
  const used = new Set<Col>();
  if (bg0 >= 0) {
    let lch = bgPick.lch;
    const yRef = yOfU(refU(bg0));
    const y = lchLuminance(lch);
    if (yRef < MID_Y) {
      const cap = Math.max(yRef, 0.045);
      if (y > cap) lch = withY(lch, cap);
    } else {
      const floor = Math.min(yRef, 0.62);
      if (y < floor) lch = withY(lch, floor);
    }
    init[bg0] = lch;
    if (bgPick.src) used.add(bgPick.src);
  }
  const bgLab = bg0 >= 0 ? lchToLab(init[bg0] as Lch) : null;
  const distinctFromBg = (c: Col): boolean => !bgLab || labDistance(c.lab, bgLab) >= 0.1;

  // further backgrounds
  let extraBg = 0;
  roles.forEach((role, i) => {
    if (role !== 'background' || i === bg0) return;
    const pick = cols.find((c) => !used.has(c) && distinctFromBg(c));
    if (pick) {
      used.add(pick);
      init[i] = pick.lch;
    } else {
      const base = init[bg0] as Lch;
      extraBg++;
      init[i] =
        base.C < 0.03
          ? { L: Math.min(0.95, Math.max(0.12, base.L + (base.L > 0.5 ? -0.08 : 0.08) * extraBg)), C: base.C, h: base.h }
          : { L: base.L, C: base.C, h: base.h + 0.6 * extraBg };
    }
  });

  // home surface of a foreground: bg0 if it sits on it, else the bg/accent param it contrasts most with
  const homeOf = (i: number): number => {
    if (bg0 >= 0 && contrastRatio(params[i]!.default, params[bg0]!.default) >= 3) return bg0;
    let best = bg0;
    let bc = 0;
    params.forEach((p, j) => {
      if (j === i || roles[j] === 'foreground') return;
      const c = contrastRatio(params[i]!.default, p.default);
      if (c > bc) {
        bc = c;
        best = j;
      }
    });
    return best;
  };
  const fgSources = new Set<Col>();
  const assignFg = (i: number): void => {
    const home = homeOf(i);
    const surface = home >= 0 && init[home] ? lchToHex(init[home] as Lch) : null;
    let best = cols[0] as Col;
    let bc = -1;
    for (const c of cols) {
      const cr = surface ? contrastRatio(c.hex, surface) : c.lch.L;
      if (cr > bc) {
        bc = cr;
        best = c;
      }
    }
    fgSources.add(best);
    init[i] = surface ? towardContrast(best.lch, yOfHex(surface), FG_TARGET) : best.lch;
  };
  const lateFg: number[] = [];
  roles.forEach((role, i) => {
    if (role !== 'foreground') return;
    const home = homeOf(i);
    if (home < 0 || roles[home] === 'background') assignFg(i);
    else lateFg.push(i);
  });

  // accents
  const rank = (c: Col): number => c.lch.C * Math.sqrt(c.w);
  const byRank = (p: Col, q: Col): number => rank(q) - rank(p) || q.w - p.w || (p.hex < q.hex ? -1 : 1);
  let accPool = cols.filter((c) => !used.has(c) && !fgSources.has(c) && distinctFromBg(c)).sort(byRank);
  if (!accPool.length) accPool = cols.filter((c) => !used.has(c) && distinctFromBg(c)).sort(byRank);
  if (!accPool.length) accPool = cols.filter(distinctFromBg).sort(byRank);
  if (accPool.length > 1) {
    const s = mod(variant, accPool.length);
    accPool = [...accPool.slice(s), ...accPool.slice(0, s)];
  }
  const accentIdx = roles.map((r, i) => (r === 'accent' ? i : -1)).filter((i) => i >= 0);
  const derivedBase: Lch[] = accPool.length
    ? accPool.map((c) => c.lch)
    : [([...cols].sort((p, q) => q.lch.C - p.lch.C || q.w - p.w)[0] as Col).lch];
  accentIdx.forEach((i, k) => {
    if (k < accPool.length) init[i] = (accPool[k] as Col).lch;
    else {
      const e = k - accPool.length;
      const nb = derivedBase.length;
      init[i] = derive(derivedBase[e % nb] as Lch, Math.floor(e / nb) + 1);
    }
  });
  for (const i of lateFg) assignFg(i);
  // anything still unset (no bg0 etc.)
  init.forEach((v, i) => {
    if (!v) init[i] = dominant.lch;
  });

  const start = init as Lch[];
  const attempt = (flipped: boolean): Record<string, string> | null => solve(params, nodes, constraints, start, flipped);
  return attempt(flip) ?? (flip ? attempt(false) : null) ?? Object.fromEntries(params.map((p) => [p.key, p.default.toUpperCase()]));
}

// ---------------------------------------------------------------- constraint solver

function solve(
  params: { key: string; default: string }[],
  nodes: Node[],
  constraints: Constraint[],
  start: Lch[],
  flipped: boolean,
): Record<string, string> | null {
  const n = params.length;
  const hiOf = (c: Constraint): number => (flipped ? (c.hiDefault === c.a ? c.b : c.a) : c.hiDefault);
  const loOf = (c: Constraint): number => (hiOf(c) === c.a ? c.b : c.a);
  const u0 = nodes.map((nd, i) => (i < n ? uOfY(lchLuminance(start[i] as Lch)) : nd.defU));

  /**
   * Per-node feasible interval [lo, hi] = least and greatest solutions of the difference
   * constraints (u_hi - u_lo >= ln r + margin, UMIN <= u <= UMAX) with the `fixed` nodes pinned,
   * or null when infeasible. Polarities follow a DAG, so |nodes| relaxation passes are exact.
   */
  const bounds = (fixed: (number | null)[], margin: number): { lo: number[]; hi: number[] } | null => {
    const lo = fixed.map((f) => f ?? UMIN);
    const hi = fixed.map((f) => f ?? UMAX);
    for (let pass = 0; pass <= nodes.length; pass++) {
      let changed = false;
      for (const c of constraints) {
        const h = hiOf(c);
        const l = loOf(c);
        const w = Math.log(c.r) + margin;
        if ((lo[l] as number) + w > (lo[h] as number) + 1e-12) {
          if (fixed[h] != null) return null;
          lo[h] = (lo[l] as number) + w;
          changed = true;
        }
        if ((hi[h] as number) - w < (hi[l] as number) - 1e-12) {
          if (fixed[l] != null) return null;
          hi[l] = (hi[h] as number) - w;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return lo.every((v, i) => v <= (hi[i] as number) + 1e-12) ? { lo, hi } : null;
  };

  // Sequential fixing by priority (bg0, other backgrounds, foregrounds, accents; ties by param
  // order): each param keeps its desired lightness clamped into the interval that keeps the rest
  // solvable, then is pinned. Exact, terminates, and lower priorities absorb the adjustments.
  const fixed: (number | null)[] = nodes.map((nd) => (nd.anchor ? nd.defU : null));
  const margin = bounds(fixed, MARGIN) ? MARGIN : 0;
  if (!bounds(fixed, margin)) return null;
  const order = nodes
    .map((_, i) => i)
    .filter((i) => !(nodes[i] as Node).anchor)
    .sort((p, q) => (nodes[q] as Node).prio - (nodes[p] as Node).prio || p - q);
  for (const i of order) {
    const b = bounds(fixed, margin) as { lo: number[]; hi: number[] };
    fixed[i] = Math.min(b.hi[i] as number, Math.max(b.lo[i] as number, u0[i] as number));
  }
  const target = fixed as number[];

  // 3. lightness for each param, then hex
  const lch: Lch[] = start.map((s, i) =>
    Math.abs((target[i] as number) - (u0[i] as number)) < 1e-9 ? s : withY(s, yOfU(target[i] as number)),
  );
  const hexes = lch.map((c) => lchToHex(c));
  const hexOf = (i: number): string => (i < n ? (hexes[i] as string) : (nodes[i] as Node).def);
  const violated = (): Constraint | undefined =>
    constraints.find((c) => contrastRatio(hexOf(c.a), hexOf(c.b)) < c.r - 1e-9);

  // 4. polish 8-bit rounding misses with small lightness nudges
  for (let iter = 0; iter < 60; iter++) {
    const c = violated();
    if (!c) return Object.fromEntries(params.map((p, i) => [p.key, hexes[i] as string]));
    // push apart along the sides they are actually on
    const lighterA = yOfHex(hexOf(c.a)) >= yOfHex(hexOf(c.b));
    const hi = lighterA ? c.a : c.b;
    const lo = lighterA ? c.b : c.a;
    const ph = (nodes[hi] as Node).prio;
    const pl = (nodes[lo] as Node).prio;
    let mover = ph < pl || (ph === pl && hi > lo) ? hi : lo;
    const canMove = (i: number, dir: number): boolean =>
      i < n && !(nodes[i] as Node).anchor && (dir > 0 ? (lch[i] as Lch).L < 0.999 : (lch[i] as Lch).L > 0.001);
    let dir = mover === hi ? 1 : -1;
    if (!canMove(mover, dir)) {
      mover = mover === hi ? lo : hi;
      dir = -dir;
      if (!canMove(mover, dir)) return null;
    }
    const cur = lch[mover] as Lch;
    lch[mover] = { ...cur, L: Math.min(1, Math.max(0, cur.L + dir * 0.004)) };
    hexes[mover] = lchToHex(lch[mover] as Lch);
  }
  return violated() ? null : Object.fromEntries(params.map((p, i) => [p.key, hexes[i] as string]));
}

/** Short stable string for cache keys: color count + hash of hexes and rounded weights. */
export function paletteSignature(palette: Palette): string {
  const cols = normalise(palette);
  const canon = cols.map((c) => `${c.hex.slice(1)}:${Math.round(c.w * 100)}`).join(',');
  return `${cols.length}-${hashString(canon).toString(36)}`;
}
