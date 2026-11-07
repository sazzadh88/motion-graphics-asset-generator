import type { AssetValues } from '../types';
import type { Ctx2D } from '../types';
import { clamp01, easeInCubic, easeOutCubic, type Easing } from '../math';
import { setFont, type FontSpec, type LaidOutWord, type TextLayout } from '../text';

export const str = (v: AssetValues, k: string): string => String(v[k] ?? '');
export const num = (v: AssetValues, k: string): number => Number(v[k] ?? 0);
export const bool = (v: AssetValues, k: string): boolean => v[k] === true;

/** 0..1 eased progress of a [start, start+dur] window (seconds). */
export const at = (time: number, start: number, dur: number, ease: Easing = easeOutCubic): number =>
  ease(clamp01((time - start) / Math.max(1e-6, dur)));

export interface Timing {
  /** Total duration in seconds. */
  total: number;
  /** Eased 0..1 exit progress (0 until exitStart; 1 on the final frames). */
  exit: number;
  exitStart: number;
  exitDur: number;
  /** Multiplier (<=1) applied to entrance delays so short clips still finish their intro. */
  scale: number;
  /** Raw 0..1 position within the clip. */
  t01: number;
}

/** Shared intro/exit timeline: exit finishes 3 frames before the end so the last frame is clean. */
export function timing(time: number, fps: number, durationFrames: number): Timing {
  const total = durationFrames / fps;
  const exitEnd = Math.max(0.1, total - 3 / fps);
  const exitDur = Math.min(0.55, total * 0.22);
  const exitStart = Math.max(0, exitEnd - exitDur);
  return {
    total,
    exitStart,
    exitDur,
    exit: easeInCubic(clamp01((time - exitStart) / exitDur)),
    scale: Math.max(0.35, Math.min(1, exitStart / 2.2)),
    t01: clamp01(time / total),
  };
}

export interface RevealOptions {
  font: FontSpec;
  color: (w: LaidOutWord) => string;
  /** 0..1 enter progress per line index. */
  enter: (line: number) => number;
  /** 0..1 exit progress per line index. */
  exit?: (line: number) => number;
  alpha?: number;
}

/**
 * Draws laid-out text line by line with a masked "rise" reveal (each line slides up from behind
 * an invisible baseline mask). (ox, oy) = block origin (x per layout.align, y = block top).
 */
export function drawRevealLines(ctx: Ctx2D, layout: TextLayout, ox: number, oy: number, o: RevealOptions): void {
  const size = layout.size;
  ctx.save();
  setFont(ctx, o.font);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  layout.lines.forEach((line, li) => {
    const tin = o.enter(li);
    const tout = o.exit ? o.exit(li) : 0;
    if (tin <= 0 || tout >= 1) return;
    const base = oy + line.baseline;
    const dy = (1 - tin) * size * 1.25 - tout * size * 1.25;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox - layout.width * 2 - size, base - size * 1.02, layout.width * 4 + size * 2, size * 1.3);
    ctx.clip();
    ctx.globalAlpha *= (o.alpha ?? 1) * Math.min(1, tin * 4) * (1 - tout * tout);
    for (const w of line.words) {
      ctx.fillStyle = o.color(w);
      for (const c of w.chars) ctx.fillText(c.ch, ox + c.x, base + dy);
    }
    ctx.restore();
  });
  ctx.restore();
}
