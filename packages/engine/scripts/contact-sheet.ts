/// <reference types="node" />
/**
 * Contact sheet: renders a template at 4 aspect ratios x 6 frames into one PNG, with the real
 * bundled fonts, so template authors can check layout and motion at a glance.
 *
 * Usage (from packages/engine):
 *   npx tsx scripts/contact-sheet.ts <templateId | --scenes | --all> [--logo] [--transparent | --opaque] [--frames 10,40,90] [--cell 360]
 *
 *   <templateId>     one template, e.g. lower_third_v1
 *   --scenes         every bundled scene (src/scenes/*.json)
 *   --all            every registered template
 *   --logo           fill image params with a built-in sample logo
 *   --transparent    force settings.transparent = true (cells drawn on a checkerboard)
 *   --opaque         force settings.transparent = false
 *   --frames a,b,c   explicit frame indices (default: 6 evenly spaced frames inside the clip)
 *   --cell <px>      max cell width/height in px (default 360; larger = more detail)
 *   --set key=value  override a param value (repeatable; numbers/booleans are parsed), e.g. --set startAt=10
 *   --palette "#hex,#hex:0.5,..."  apply a palette to the color params via applyPalette (weights: given
 *                    ones are used, the rest share what is left equally); --set still wins
 *   --variant <n>    applyPalette variant (any integer, default 0; needs --palette)
 *
 * Output: packages/engine/output/<templateId>[-logo][-transparent|-opaque][-pal-<sig>-v<n>][-key=value...].png (gitignored)
 */
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPalette, defaultPayload, getTemplate, listTemplates, paletteSignature, renderFrame } from '../src';
import type { Ctx2D, LoadedAssets, Palette, RenderJobPayload } from '../src';
import { BUNDLED_SCENES } from '../src/scenes';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, '..');
const outDir = path.join(engineDir, 'output');

const ASPECTS: { label: string; width: number; height: number }[] = [
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '16:9', width: 1920, height: 1080 },
  { label: '3:1', width: 1500, height: 500 },
];
const COLUMNS = 6;
const GAP = 16;
const LABEL_W = 120;
const HEADER_H = 64;

// ---------------------------------------------------------------- fonts

const FONT_FILES: [family: string, pkg: string, file: string][] = [
  ['Inter Variable', '@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'],
  ['Montserrat Variable', '@fontsource-variable/montserrat', 'montserrat-latin-wght-normal.woff2'],
  ['Anton', '@fontsource/anton', 'anton-latin-400-normal.woff2'],
];

function findPackageFile(pkg: string, file: string): string | null {
  let dir = engineDir;
  for (;;) {
    const p = path.join(dir, 'node_modules', pkg, 'files', file);
    if (existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function registerFonts(): void {
  for (const [family, pkg, file] of FONT_FILES) {
    const p = findPackageFile(pkg, file);
    if (!p) throw new Error(`Font file not found: ${pkg}/files/${file} (run npm install)`);
    GlobalFonts.registerFromPath(p, family);
  }
}

// ---------------------------------------------------------------- helpers

function sampleLogo(): CanvasImageSource {
  const c = createCanvas(480, 160);
  const g = c.getContext('2d');
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(80, 80, 64, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0F1A2E';
  g.beginPath();
  g.moveTo(52, 112);
  g.lineTo(80, 44);
  g.lineTo(108, 112);
  g.closePath();
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.font = '800 72px "Montserrat Variable"';
  g.textBaseline = 'middle';
  g.fillText('ACME', 168, 84);
  return c as unknown as CanvasImageSource;
}

function checkerboard(g: SKRSContext2D, x: number, y: number, w: number, h: number): void {
  const s = 12;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#E6E6E6';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#C8C8C8';
  for (let yy = 0; yy * s < h; yy++)
    for (let xx = 0; xx * s < w; xx++) if ((xx + yy) % 2) g.fillRect(x + xx * s, y + yy * s, s, s);
  g.restore();
}

function framesFor(durationFrames: number, explicit: number[] | null): number[] {
  if (explicit) return explicit.map((f) => Math.max(0, Math.min(durationFrames - 1, f)));
  const last = durationFrames - 1;
  return Array.from({ length: COLUMNS }, (_, i) => Math.round(((i + 1) * last) / (COLUMNS + 1)));
}

interface Options {
  logo: boolean;
  transparent: boolean | null;
  frames: number[] | null;
  cell: number;
  /** Param overrides from --set. */
  set: Record<string, string>;
  /** --palette, applied with applyPalette before --set. */
  palette: Palette | null;
  variant: number;
}

function parsePalette(spec: string): Palette {
  const items = spec.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [hex, w] = s.split(':');
    if (!/^#?[0-9a-f]{6}$/i.test(hex ?? '')) throw new Error(`--palette: bad color '${s}'`);
    const weight = w === undefined ? null : Number(w);
    if (weight !== null && !(weight > 0)) throw new Error(`--palette: bad weight '${s}'`);
    return { hex: `#${(hex as string).replace('#', '').toUpperCase()}`, weight };
  });
  if (!items.length) throw new Error('--palette: no colors');
  const given = items.reduce((t, c) => t + (c.weight ?? 0), 0);
  const free = items.filter((c) => c.weight === null).length;
  const share = free ? Math.max(0, 1 - given) / free || 1 / items.length : 0;
  const colors = items.map((c) => ({ hex: c.hex, weight: c.weight ?? share }));
  const sum = colors.reduce((t, c) => t + c.weight, 0);
  return { colors: colors.map((c) => ({ ...c, weight: c.weight / sum })).sort((a, b) => b.weight - a.weight) };
}

function renderSheet(templateId: string, o: Options): string {
  const t = getTemplate(templateId);
  if (!t) throw new Error(`Unknown template '${templateId}'. Known: ${listTemplates().map((x) => x.id).join(', ')}`);
  const base = defaultPayload(templateId);
  const transparent = o.transparent ?? base.settings.transparent;
  const frames = framesFor(base.settings.durationFrames, o.frames);
  const images: LoadedAssets['images'] = {};
  const logo = o.logo ? sampleLogo() : null;
  for (const p of t.params) {
    if (p.type !== 'image') continue;
    images[p.key] = logo;
    if (logo) base.assets[p.key] = 'sample://logo';
  }
  const loaded: LoadedAssets = { images };
  if (o.palette) Object.assign(base.assets, applyPalette(t, o.palette, { variant: o.variant }));
  for (const [key, raw] of Object.entries(o.set)) {
    const p = t.params.find((x) => x.key === key);
    if (!p) throw new Error(`--set ${key}: '${templateId}' has no param '${key}'`);
    base.assets[key] = p.type === 'number' ? Number(raw) : p.type === 'boolean' ? raw === 'true' : raw;
  }

  // Each cell fits inside a cell x (cell * 5/6) box, keeping the aspect ratio.
  const boxW = o.cell;
  const boxH = Math.round((o.cell * 5) / 6);
  const rows = ASPECTS.map((a) => {
    const k = Math.min(boxW / a.width, boxH / a.height);
    return { ...a, cellW: Math.round(a.width * k), cellH: Math.round(a.height * k) };
  });
  // with --palette, leave room for the swatches next to the title
  const sheetW = Math.max(LABEL_W + frames.length * (boxW + GAP) + GAP, o.palette ? 1100 : 0);
  const rowTop = (ri: number) => HEADER_H + rows.slice(0, ri).reduce((s, r) => s + r.cellH + GAP, 0);
  const sheetH = rowTop(rows.length) + GAP;
  const sheet = createCanvas(sheetW, sheetH);
  const g = sheet.getContext('2d');
  g.fillStyle = '#16181D';
  g.fillRect(0, 0, sheetW, sheetH);
  g.fillStyle = '#FFFFFF';
  g.font = '700 22px "Inter Variable"';
  g.textBaseline = 'middle';
  const fps = base.settings.fps;
  g.fillText(
    `${t.id} — ${t.name}${transparent ? ' (transparent)' : ''}${o.logo ? ' + sample logo' : ''}`,
    GAP,
    HEADER_H / 2 - 8,
  );
  if (o.palette) {
    // input palette swatches (width ~ weight), then the resulting color params
    let x = sheetW - GAP - 360;
    for (const c of o.palette.colors) {
      const cw = Math.max(6, Math.round(c.weight * 180));
      g.fillStyle = c.hex;
      g.fillRect(x, 10, cw, 20);
      x += cw;
    }
    x = sheetW - GAP - 360;
    for (const p of t.params) {
      if (p.type !== 'color') continue;
      g.fillStyle = String(base.assets[p.key]);
      g.fillRect(x, 36, 34, 20);
      x += 38;
    }
    g.fillStyle = '#FFFFFF';
  }
  g.font = '500 15px "Inter Variable"';
  g.fillStyle = '#9AA3B2';
  g.fillText(
    `frames ${frames.map((f) => `${f} (${(f / fps).toFixed(2)}s)`).join('  ·  ')}   of ${base.settings.durationFrames} @ ${fps} fps`,
    GAP,
    HEADER_H / 2 + 16,
  );

  rows.forEach((row, ri) => {
    const y = rowTop(ri);
    const CELL_H = row.cellH;
    g.fillStyle = '#C9CFDA';
    g.font = '700 18px "Inter Variable"';
    g.fillText(row.label, GAP, y + CELL_H / 2 - 10);
    g.font = '500 13px "Inter Variable"';
    g.fillStyle = '#8A93A3';
    g.fillText(`${row.width}×${row.height}`, GAP, y + CELL_H / 2 + 12);
    const payload: RenderJobPayload = {
      ...base,
      settings: { ...base.settings, width: row.width, height: row.height, transparent },
    };
    const canvas = createCanvas(row.width, row.height);
    const ctx = canvas.getContext('2d');
    frames.forEach((f, ci) => {
      const x = LABEL_W + ci * (boxW + GAP) + Math.round((boxW - row.cellW) / 2);
      renderFrame(ctx as unknown as Ctx2D, f, payload, loaded);
      if (transparent) checkerboard(g, x, y, row.cellW, CELL_H);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(canvas, x, y, row.cellW, CELL_H);
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, row.cellW - 1, CELL_H - 1);
    });
  });

  mkdirSync(outDir, { recursive: true });
  const sets = Object.entries(o.set).map(([k, v]) => `-${k}=${v.replace(/[^a-zA-Z0-9.#_-]/g, '_').slice(0, 24)}`);
  const pal = o.palette ? `-pal-${paletteSignature(o.palette)}-v${o.variant}` : '';
  const suffix = `${o.logo ? '-logo' : ''}${o.transparent === null ? '' : o.transparent ? '-transparent' : '-opaque'}${pal}${sets.join('')}`;
  const file = path.join(outDir, `${templateId}${suffix}.png`);
  writeFileSync(file, sheet.toBuffer('image/png'));
  return file;
}

// ---------------------------------------------------------------- CLI

function usage(): never {
  console.error(
    'Usage (from packages/engine): npx tsx scripts/contact-sheet.ts <templateId | --scenes | --all> [--logo] [--transparent | --opaque] [--frames 10,40,90] [--cell 360] [--set key=value ...] [--palette "#hex,#hex:0.5,..."] [--variant n]',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const opts: Options = { logo: false, transparent: null, frames: null, cell: 360, set: {}, palette: null, variant: 0 };
const ids: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (a === '--logo') opts.logo = true;
  else if (a === '--transparent') opts.transparent = true;
  else if (a === '--opaque') opts.transparent = false;
  else if (a === '--frames') {
    const v = args[++i];
    if (!v) usage();
    const frames = v.split(',').map((s) => Number(s.trim()));
    if (frames.some((n) => !Number.isInteger(n))) usage();
    opts.frames = frames;
  } else if (a === '--cell') {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 100 || n > 2000) usage();
    opts.cell = n;
  } else if (a === '--set') {
    const v = args[++i];
    const eq = v ? v.indexOf('=') : -1;
    if (!v || eq < 1) usage();
    opts.set[v.slice(0, eq)] = v.slice(eq + 1);
  } else if (a === '--palette') {
    const v = args[++i];
    if (!v) usage();
    opts.palette = parsePalette(v);
  } else if (a === '--variant') {
    const n = Number(args[++i]);
    if (!Number.isInteger(n)) usage();
    opts.variant = n;
  } else if (a === '--scenes') ids.push(...BUNDLED_SCENES.map((s) => (s.json as { id: string }).id));
  else if (a === '--all') ids.push(...listTemplates().map((t) => t.id));
  else if (a.startsWith('--') || a === '-h') usage();
  else ids.push(a);
}
if (!ids.length) usage();

registerFonts();
for (const id of ids) console.log(renderSheet(id, opts));
