import type { Ctx2D } from './types';

export interface FontSpec {
  family: string;
  weight: number | string;
  size: number;
  style?: 'normal' | 'italic';
}

export function fontString(f: FontSpec): string {
  const fam = /^(sans-serif|serif|monospace)$/.test(f.family) ? f.family : `"${f.family}", sans-serif`;
  return `${f.style === 'italic' ? 'italic ' : ''}${f.weight} ${f.size}px ${fam}`;
}

export function setFont(ctx: Ctx2D, f: FontSpec): void {
  ctx.font = fontString(f);
}

/** Width of text with manual letter spacing (px between characters). Font must already be set. */
export function measureText(ctx: Ctx2D, text: string, letterSpacing = 0): number {
  const w = ctx.measureText(text).width;
  if (!letterSpacing) return w;
  return w + letterSpacing * Math.max(0, Array.from(text).length - 1);
}

/** Draws text with letter spacing. Sets textAlign/baseline. */
export function drawSpacedText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  letterSpacing = 0,
  align: 'left' | 'center' | 'right' = 'left',
): void {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const w = measureText(ctx, text, letterSpacing);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (!letterSpacing) {
    ctx.fillText(text, x0, y);
    return;
  }
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const prefix = chars.slice(0, i).join('');
    ctx.fillText(chars[i] as string, x0 + ctx.measureText(prefix).width + letterSpacing * i, y);
  }
}

export const splitWords = (text: string): string[] => text.split(/\s+/).filter(Boolean);
export const splitChars = (text: string): string[] => Array.from(text);

/** Greedy word wrap honoring "\n". Over-long words are broken by character. Font must be set. */
export function wrapText(ctx: Ctx2D, text: string, maxWidth: number, letterSpacing = 0): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = splitWords(para);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    const push = () => {
      if (line) out.push(line);
      line = '';
    };
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (measureText(ctx, trial, letterSpacing) <= maxWidth) {
        line = trial;
        continue;
      }
      push();
      if (measureText(ctx, word, letterSpacing) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = '';
      for (const ch of Array.from(word)) {
        if (chunk && measureText(ctx, chunk + ch, letterSpacing) > maxWidth) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    push();
  }
  return out;
}

/** Largest font size (<= maxSize, >= minSize) at which `text` fits on one line within maxWidth. */
export function fitFontSize(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  family: string,
  weight: number | string,
  letterSpacingEm = 0,
): number {
  let lo = minSize;
  let hi = maxSize;
  const fits = (s: number) => {
    setFont(ctx, { family, weight, size: s });
    return measureText(ctx, text, letterSpacingEm * s) <= maxWidth;
  };
  if (fits(hi)) return hi;
  if (!fits(lo)) return lo;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 2) / 2;
}

export interface FitBlockOptions {
  family: string;
  weight: number | string;
  maxWidth: number;
  maxHeight: number;
  maxSize: number;
  minSize: number;
  /** Line height multiplier. Default 1.1. */
  lineHeight?: number;
  /** Letter spacing as a fraction of font size. Default 0. */
  letterSpacingEm?: number;
  maxLines?: number;
}

export interface FittedBlock {
  size: number;
  lines: string[];
  lineHeightPx: number;
  letterSpacing: number;
}

/** Finds the largest font size at which wrapped text fits in a box (no word broken if avoidable). Leaves font set. */
export function fitTextBlock(ctx: Ctx2D, text: string, o: FitBlockOptions): FittedBlock {
  const lh = o.lineHeight ?? 1.1;
  const em = o.letterSpacingEm ?? 0;
  const maxLines = o.maxLines ?? 99;
  const words = splitWords(text);
  let size = o.maxSize;
  let lines: string[] = [];
  for (let i = 0; i < 80; i++) {
    setFont(ctx, { family: o.family, weight: o.weight, size });
    const ls = em * size;
    lines = wrapText(ctx, text, o.maxWidth, ls);
    const wordsFit = words.every((w) => measureText(ctx, w, ls) <= o.maxWidth);
    if (wordsFit && lines.length <= maxLines && lines.length * size * lh <= o.maxHeight) break;
    if (size <= o.minSize) break;
    size = Math.max(o.minSize, size * 0.96);
  }
  setFont(ctx, { family: o.family, weight: o.weight, size });
  return { size, lines, lineHeightPx: size * lh, letterSpacing: em * size };
}

// ------------------------------------------------------------- per-unit layout

export interface LaidOutChar {
  ch: string;
  /** Left edge relative to the block origin (see `align`). */
  x: number;
  w: number;
  /** Index across the whole block. */
  index: number;
  wordIndex: number;
  lineIndex: number;
}
export interface LaidOutWord {
  text: string;
  x: number;
  w: number;
  index: number;
  lineIndex: number;
  chars: LaidOutChar[];
}
export interface LaidOutLine {
  text: string;
  width: number;
  /** Alphabetic baseline y relative to block top. */
  baseline: number;
  words: LaidOutWord[];
}
export interface TextLayout {
  lines: LaidOutLine[];
  words: LaidOutWord[];
  chars: LaidOutChar[];
  width: number;
  height: number;
  size: number;
  lineHeightPx: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
}

/**
 * Measures pre-wrapped lines into per-word and per-character positions.
 * x origin: left edge for 'left', center for 'center', right edge for 'right'.
 * y origin: top of block. The font must already be set to `size`.
 */
export function layoutText(
  ctx: Ctx2D,
  lines: string[],
  size: number,
  opts: { lineHeightPx?: number; letterSpacing?: number; align?: 'left' | 'center' | 'right'; capHeightEm?: number } = {},
): TextLayout {
  const lhPx = opts.lineHeightPx ?? size * 1.1;
  const ls = opts.letterSpacing ?? 0;
  const align = opts.align ?? 'left';
  const cap = (opts.capHeightEm ?? 0.72) * size;
  const outLines: LaidOutLine[] = [];
  const allWords: LaidOutWord[] = [];
  const allChars: LaidOutChar[] = [];
  let maxW = 0;
  lines.forEach((text, li) => {
    const width = measureText(ctx, text, ls);
    maxW = Math.max(maxW, width);
    const left = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
    const lineChars = Array.from(text);
    const words: LaidOutWord[] = [];
    let ci = 0;
    for (const wText of text.split(' ')) {
      const wChars = Array.from(wText);
      if (!wChars.length) {
        ci += 1;
        continue;
      }
      const wordIndex = allWords.length + words.length;
      const chars: LaidOutChar[] = wChars.map((ch, k) => {
        const idx = ci + k;
        const prefix = lineChars.slice(0, idx).join('');
        const c: LaidOutChar = {
          ch,
          x: left + ctx.measureText(prefix).width + ls * idx,
          w: ctx.measureText(ch).width,
          index: allChars.length,
          wordIndex,
          lineIndex: li,
        };
        allChars.push(c);
        return c;
      });
      const first = chars[0] as LaidOutChar;
      const last = chars[chars.length - 1] as LaidOutChar;
      words.push({ text: wText, x: first.x, w: last.x + last.w - first.x, index: wordIndex, lineIndex: li, chars });
      ci += wChars.length + 1;
    }
    allWords.push(...words);
    outLines.push({ text, width, baseline: li * lhPx + (lhPx + cap) / 2, words });
  });
  return {
    lines: outLines,
    words: allWords,
    chars: allChars,
    width: maxW,
    height: lines.length * lhPx,
    size,
    lineHeightPx: lhPx,
    letterSpacing: ls,
    align,
  };
}
