import type { ColorRole } from './types';
import { hexToLch } from './color';

/**
 * Role of a color param, from its key, label and default color.
 *
 * Rules, first match wins (label beats key because labels name what is drawn):
 *  1. label has a text word (text, ink, title, type, font, copy, lettering) -> 'foreground'
 *     e.g. "Text", "Ink", "Title", "Burst text", "Name text / title bar", "Dark band / headline text"
 *  2. label has a surface word (background, backdrop, paper, canvas, bg)   -> 'background'
 *     e.g. "Background", "Background 2", "Background color", "Paper"
 *  3. key has a text word (textColor, inkColor, titleColor, fontColor)     -> 'foreground'
 *  4. key has a surface word (bgColor, bgColor2, backgroundColor, paper)   -> 'background'
 *  5. no keyword: look at the default color. A clear neutral (OKLCH chroma < 0.045 and lightness
 *     <= 0.32 or >= 0.85, i.e. near-black/near-white) is a surface something else sits on
 *     ('background', e.g. lower_third "Name bar" #0F1A2E, breaking_news "Headline band" #FFFFFF);
 *     anything else (colored or mid grey) is an 'accent' ("Accent", "Panel color", "Badge",
 *     "Burst", "Stage", "Bars", "Highlight", "Stars", "Confetti 2", "Tag / clock", ...).
 */
export function colorRole(def: { key: string; label: string; default: string }): ColorRole {
  const label = def.label.toLowerCase();
  const key = def.key;
  if (/\b(text|ink|title|type|font|copy|lettering)\b/.test(label)) return 'foreground';
  if (/\b(background|backdrop|paper|canvas|bg)\b/.test(label)) return 'background';
  if (/(text|ink|title|font)(colou?r)?\d*$/i.test(key) || /^(text|ink|title|font)/i.test(key)) return 'foreground';
  if (/^(bg|background|backdrop|paper|canvas)/i.test(key) || /(Bg|Background|Backdrop|Paper)(Colou?r)?\d*$/.test(key))
    return 'background';
  const { L, C } = hexToLch(def.default);
  if (C < 0.045 && (L <= 0.32 || L >= 0.85)) return 'background';
  return 'accent';
}
