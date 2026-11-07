import type { Ctx2D } from './types';
import { withAlpha } from './math';

/** Adds a rounded-rect subpath (manual arcs: works in every canvas implementation). */
export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function fillCircle(ctx: Ctx2D, cx: number, cy: number, r: number, fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function fillPolygon(ctx: Ctx2D, pts: [number, number][], fill: string | CanvasGradient): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Starburst / scalloped outline path centered on (cx,cy). */
export function starPath(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  rotation = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

export function imageSize(img: CanvasImageSource): { w: number; h: number } {
  const a = img as unknown as Record<string, unknown>;
  const w = (a.naturalWidth as number) || (a.videoWidth as number) || (a.width as number) || 0;
  const h = (a.naturalHeight as number) || (a.videoHeight as number) || (a.height as number) || 0;
  return { w, h };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Draws img fully visible inside the box, centered. Returns the drawn rect (null if no usable image). */
export function drawImageContain(
  ctx: Ctx2D,
  img: CanvasImageSource | null | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): Rect | null {
  if (!img) return null;
  const s = imageSize(img);
  if (!s.w || !s.h) return null;
  const k = Math.min(w / s.w, h / s.h);
  const dw = s.w * k;
  const dh = s.h * k;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { x: dx, y: dy, w: dw, h: dh };
}

/** Draws img filling the box, cropping overflow (clipped to the rounded box). */
export function drawImageCover(
  ctx: Ctx2D,
  img: CanvasImageSource | null | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 0,
): boolean {
  if (!img) return false;
  const s = imageSize(img);
  if (!s.w || !s.h) return false;
  const k = Math.max(w / s.w, h / s.h);
  const dw = s.w * k;
  const dh = s.h * k;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
  return true;
}

/** Size an image would get when contained in a box; null if unavailable. */
export function containSize(
  img: CanvasImageSource | null | undefined,
  maxW: number,
  maxH: number,
): { w: number; h: number } | null {
  if (!img) return null;
  const s = imageSize(img);
  if (!s.w || !s.h) return null;
  const k = Math.min(maxW / s.w, maxH / s.h);
  return { w: s.w * k, h: s.h * k };
}

/** Opaque diagonal gradient background; does nothing when transparent. */
export function gradientBackground(
  ctx: Ctx2D,
  w: number,
  h: number,
  from: string,
  to: string,
  transparent: boolean,
  angle = 0.8,
): void {
  if (transparent) return;
  const cx = w / 2;
  const cy = h / 2;
  const len = (Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle))) / 2;
  const dx = Math.sin(angle) * len;
  const dy = Math.cos(angle) * len;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function radialGlow(ctx: Ctx2D, cx: number, cy: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(0.5, withAlpha(color, alpha * 0.35));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** Runs fn inside save/restore with translate + scale + rotate + alpha applied about pivot (px,py). */
export function withTransform(
  ctx: Ctx2D,
  t: {
    x?: number;
    y?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    rotate?: number;
    alpha?: number;
    px?: number;
    py?: number;
  },
  fn: () => void,
): void {
  ctx.save();
  ctx.globalAlpha *= t.alpha ?? 1;
  ctx.translate((t.x ?? 0) + (t.px ?? 0), (t.y ?? 0) + (t.py ?? 0));
  if (t.rotate) ctx.rotate(t.rotate);
  const s = t.scale ?? 1;
  ctx.scale((t.scaleX ?? 1) * s, (t.scaleY ?? 1) * s);
  ctx.translate(-(t.px ?? 0), -(t.py ?? 0));
  fn();
  ctx.restore();
}
