import { applyPalette, defaultPayload, getTemplate, preloadAssets, renderFrame } from '@mg/engine';
import type { RenderSettings } from '@mg/engine';
import { thumbPaletteKey } from './state/referencePalette';
import type { ReferencePalette } from './state/referencePalette';

/**
 * Template thumbnails for the library rail.
 *
 * Each thumbnail is the template's *default* payload rendered at 60% of its duration,
 * drawn at full output size on a scratch canvas and downscaled (in halving steps, for
 * quality) to the letterboxed box size × devicePixelRatio. Renders run strictly one at a
 * time with a yield to the main thread before and after the expensive draw, so typing
 * and scrubbing stay responsive. Results are cached per template id + DPR + reference
 * palette key (signature + variant, or 'none') for the session.
 */

/** Inner size (CSS px) of the 72×72 thumbnail box, i.e. minus its 1px border. */
export const THUMB_INNER = 70;

export interface ThumbSize {
  /** CSS pixels. */
  w: number;
  h: number;
}

/** Letterboxed CSS size of the thumbnail image inside the box. */
export function thumbSize(settings: Pick<RenderSettings, 'width' | 'height'>): ThumbSize {
  const { width, height } = settings;
  if (width >= height) {
    return { w: THUMB_INNER, h: Math.max(1, Math.round((THUMB_INNER * height) / width)) };
  }
  return { w: Math.max(1, Math.round((THUMB_INNER * width) / height)), h: THUMB_INNER };
}

export function thumbDpr(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

type Listener = { resolve: (b: ImageBitmap) => void; reject: (e: unknown) => void };

interface Pending {
  id: string;
  dpr: number;
  ref: ReferencePalette | null;
  listeners: Set<Listener>;
  started: boolean;
}

const cache = new Map<string, ImageBitmap>();
const failed = new Set<string>();
const pending = new Map<string, Pending>();
const queue: string[] = [];
let running = false;

const keyOf = (id: string, dpr: number, palKey: string) => `${id}@${dpr}#${palKey}`;

/** Only palettes that apply to every template recolor the library. */
const effectiveRef = (ref: ReferencePalette | null) => (ref && ref.applyAll ? ref : null);

export function cachedThumb(id: string, dpr: number, ref: ReferencePalette | null): ImageBitmap | undefined {
  return cache.get(keyOf(id, dpr, thumbPaletteKey(ref)));
}

/**
 * Queue a thumbnail render. Returns a cancel function; cancelling before the render
 * starts removes it from the queue (e.g. the item scrolled out of view or unmounted).
 */
export function requestThumb(
  id: string,
  dpr: number,
  reference: ReferencePalette | null,
  resolve: (b: ImageBitmap) => void,
  reject: (e: unknown) => void,
): () => void {
  const ref = effectiveRef(reference);
  const key = keyOf(id, dpr, thumbPaletteKey(ref));
  const hit = cache.get(key);
  if (hit) {
    resolve(hit);
    return () => {};
  }
  if (failed.has(key)) {
    reject(new Error('Thumbnail render failed'));
    return () => {};
  }
  const listener: Listener = { resolve, reject };
  let p = pending.get(key);
  if (!p) {
    p = { id, dpr, ref, listeners: new Set(), started: false };
    pending.set(key, p);
    queue.push(key);
  }
  p.listeners.add(listener);
  void pump();
  return () => {
    const cur = pending.get(key);
    if (!cur) return;
    cur.listeners.delete(listener);
    if (cur.listeners.size === 0 && !cur.started) {
      pending.delete(key);
      const i = queue.indexOf(key);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 250 });
    } else {
      window.setTimeout(resolve, 16);
    }
  });
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const key = queue.shift()!;
      const p = pending.get(key);
      if (!p) continue;
      p.started = true;
      try {
        const bitmap = await renderThumb(p.id, p.dpr, p.ref);
        cache.set(key, bitmap);
        pending.delete(key);
        for (const l of p.listeners) l.resolve(bitmap);
      } catch (e) {
        failed.add(key);
        pending.delete(key);
        for (const l of p.listeners) l.reject(e);
      }
    }
  } finally {
    running = false;
  }
}

let scratch: HTMLCanvasElement | null = null;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function renderThumb(id: string, dpr: number, ref: ReferencePalette | null): Promise<ImageBitmap> {
  let payload = defaultPayload(id);
  const template = getTemplate(id);
  if (ref && template) {
    const patch = applyPalette(template, ref.palette, { variant: ref.variant });
    payload = { ...payload, assets: { ...payload.assets, ...patch } };
  }
  const { width, height, durationFrames } = payload.settings;
  const loaded = await preloadAssets(payload);
  await yieldToMain();

  // Full-size frame on a reused scratch canvas.
  scratch ??= makeCanvas(width, height);
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const ctx = scratch.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const frame = Math.max(0, Math.min(durationFrames - 1, Math.round(0.6 * (durationFrames - 1))));
  renderFrame(ctx, frame, payload, loaded);
  await yieldToMain();

  // Downscale in halving steps to the target device-pixel size.
  const size = thumbSize(payload.settings);
  const tw = Math.max(1, Math.round(size.w * dpr));
  const th = Math.max(1, Math.round(size.h * dpr));
  let src: HTMLCanvasElement = scratch;
  let sw = width;
  let sh = height;
  while (sw / 2 >= tw && sh / 2 >= th) {
    const nw = Math.round(sw / 2);
    const nh = Math.round(sh / 2);
    const step = makeCanvas(nw, nh);
    const sctx = step.getContext('2d');
    if (!sctx) break;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, sw, sh, 0, 0, nw, nh);
    src = step;
    sw = nw;
    sh = nh;
  }
  const out = makeCanvas(tw, th);
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2D canvas unavailable');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, 0, 0, sw, sh, 0, 0, tw, th);
  return createImageBitmap(out);
}
