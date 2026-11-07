import { useSyncExternalStore } from 'react';
import { applyPalette, extractPalette, getTemplate, paletteSignature } from '@mg/engine';
import type { Palette, RenderJobPayload } from '@mg/engine';

/**
 * Reference palette: a tiny subscribe store shared by the Inspector (UI), App (apply on
 * template switch) and the library thumbnails. Persisted to localStorage; the image itself
 * never leaves the device (only a small thumbnail data URL is stored).
 */

export interface ReferencePalette {
  palette: Palette;
  variant: number;
  applyAll: boolean;
  thumbDataUrl: string;
}

const STORAGE_KEY = 'mg.referencePalette';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SAMPLE_LONG_SIDE = 160;
const THUMB_LONG_SIDE = 96;

function isPalette(v: unknown): v is Palette {
  if (!v || typeof v !== 'object') return false;
  const colors = (v as { colors?: unknown }).colors;
  return (
    Array.isArray(colors) &&
    colors.length > 0 &&
    colors.length <= 8 &&
    colors.every(
      (c) =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as { hex?: unknown }).hex === 'string' &&
        /^#[0-9a-fA-F]{6}$/.test((c as { hex: string }).hex) &&
        typeof (c as { weight?: unknown }).weight === 'number' &&
        Number.isFinite((c as { weight: number }).weight),
    )
  );
}

function load(): ReferencePalette | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ReferencePalette>;
    if (
      !v ||
      !isPalette(v.palette) ||
      typeof v.variant !== 'number' ||
      !Number.isInteger(v.variant) ||
      typeof v.applyAll !== 'boolean' ||
      typeof v.thumbDataUrl !== 'string' ||
      !v.thumbDataUrl.startsWith('data:image/')
    ) {
      return null;
    }
    return { palette: v.palette, variant: v.variant, applyAll: v.applyAll, thumbDataUrl: v.thumbDataUrl };
  } catch {
    return null;
  }
}

function save(ref: ReferencePalette | null): void {
  try {
    if (ref) localStorage.setItem(STORAGE_KEY, JSON.stringify(ref));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort persistence */
  }
}

let current: ReferencePalette | null = load();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getReference(): ReferencePalette | null {
  return current;
}

export function setReference(next: ReferencePalette | null): void {
  current = next;
  save(next);
  for (const l of listeners) l();
}

export function updateReference(patch: Partial<ReferencePalette>): void {
  if (current) setReference({ ...current, ...patch });
}

export function useReferencePalette(): ReferencePalette | null {
  return useSyncExternalStore(subscribe, getReference, getReference);
}

/** Thumbnail cache key part: changes whenever the applied colors would change. */
export function thumbPaletteKey(ref: ReferencePalette | null): string {
  if (!ref || !ref.applyAll) return 'none';
  return `${paletteSignature(ref.palette)}~${ref.variant}`;
}

// ---------------------------------------------------------------- originals (Remove)

/** templateId → its color values right before the palette was first applied this session. */
const originals = new Map<string, Record<string, string>>();

function colorValues(payload: RenderJobPayload): Record<string, string> {
  const t = getTemplate(payload.templateId);
  const out: Record<string, string> = {};
  if (!t) return out;
  for (const p of t.params) {
    const v = payload.assets[p.key];
    if (p.type === 'color' && typeof v === 'string') out[p.key] = v;
  }
  return out;
}

/** Color patch for `payload` from the reference; records originals the first time per template. */
export function palettePatch(payload: RenderJobPayload, ref: ReferencePalette): Record<string, string> {
  const t = getTemplate(payload.templateId);
  if (!t) return {};
  if (!originals.has(t.id)) originals.set(t.id, colorValues(payload));
  return applyPalette(t, ref.palette, { variant: ref.variant });
}

/** Payload with the reference applied (when set and "apply to every template" is on). */
export function withReference(payload: RenderJobPayload): RenderJobPayload {
  const ref = current;
  if (!ref || !ref.applyAll) return payload;
  const patch = palettePatch(payload, ref);
  return { ...payload, assets: { ...payload.assets, ...patch } };
}

/** Original colors for a template (if the palette was applied to it this session). */
export function originalColors(templateId: string): Record<string, string> | undefined {
  return originals.get(templateId);
}

export function clearOriginals(): void {
  originals.clear();
}

// ---------------------------------------------------------------- image decoding

export class ImageReadError extends Error {
  constructor(readonly reason: 'decode' | 'size') {
    super(reason === 'size' ? 'Image too large' : 'Image could not be decoded');
  }
}

function scaled(w: number, h: number, longSide: number): { w: number; h: number } {
  const s = Math.min(1, longSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Decode a file locally, extract its palette and make a small thumbnail data URL. */
export async function readReferenceImage(file: File): Promise<{ palette: Palette; thumbDataUrl: string }> {
  if (file.size > MAX_IMAGE_BYTES) throw new ImageReadError('size');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageReadError('decode');
  }
  try {
    if (!bitmap.width || !bitmap.height) throw new ImageReadError('decode');
    const sample = scaled(bitmap.width, bitmap.height, SAMPLE_LONG_SIDE);
    const c = document.createElement('canvas');
    c.width = sample.w;
    c.height = sample.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new ImageReadError('decode');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, sample.w, sample.h);
    const data = ctx.getImageData(0, 0, sample.w, sample.h).data;
    const palette = extractPalette(data, sample.w, sample.h);
    if (!palette.colors.length) throw new ImageReadError('decode');

    const tsize = scaled(bitmap.width, bitmap.height, THUMB_LONG_SIDE);
    const tc = document.createElement('canvas');
    tc.width = tsize.w;
    tc.height = tsize.h;
    const tctx = tc.getContext('2d');
    if (!tctx) throw new ImageReadError('decode');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(bitmap, 0, 0, tsize.w, tsize.h);
    const thumbDataUrl = file.type === 'image/png' || file.type === 'image/gif'
      ? tc.toDataURL('image/png')
      : tc.toDataURL('image/jpeg', 0.85);
    return { palette, thumbDataUrl };
  } finally {
    bitmap.close();
  }
}
