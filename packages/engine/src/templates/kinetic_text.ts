import type { TemplateDefinition } from '../types';
import {
  clamp,
  clamp01,
  contrastRatio,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  easeOutQuart,
  lerp,
  mixColors,
  readableOn,
  withAlpha,
} from '../math';
import { fitTextBlock, layoutText } from '../text';
import { containSize, drawImageContain, fillRoundRect, radialGlow } from '../draw';
import { at, bool, drawRevealLines, num, str, timing } from './shared';

const FONT_OPTIONS = {
  anton: { family: 'Anton', weight: 400, em: 0.012, lh: 1.02, cap: 0.74, sizeK: 0.21 },
  montserrat: { family: 'Montserrat Variable', weight: 900, em: -0.02, lh: 1.04, cap: 0.7, sizeK: 0.15 },
} as const;

export const kineticText: TemplateDefinition = {
  id: 'kinetic_text_v1',
  name: 'Kinetic Text',
  description: 'Bold headline that builds word by word with staggered, eased motion, then a subheading and a clean exit.',
  defaultSettings: { width: 1080, height: 1920, fps: 60, durationFrames: 180, transparent: false },
  fonts: ['Anton', 'Montserrat Variable', 'Inter Variable'],
  params: [
    { key: 'headline', label: 'Headline', type: 'text', default: 'SUMMER SALE', maxLength: 60, group: 'Text' },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'text',
      default: 'Up to 50% off everything',
      maxLength: 100,
      group: 'Text',
    },
    { key: 'primaryColor', label: 'Accent color', type: 'color', default: '#FF2A5F', group: 'Colors' },
    { key: 'secondaryColor', label: 'Background color', type: 'color', default: '#0F172A', group: 'Colors' },
    { key: 'logoUrl', label: 'Logo', type: 'image', default: null, group: 'Media' },
    {
      key: 'animationStyle',
      label: 'Animation style',
      type: 'select',
      default: 'rise',
      options: [
        { value: 'rise', label: 'Mask rise' },
        { value: 'pop', label: 'Pop' },
        { value: 'slide', label: 'Slide' },
      ],
      group: 'Style',
    },
    {
      key: 'headlineFont',
      label: 'Headline font',
      type: 'select',
      default: 'anton',
      options: [
        { value: 'anton', label: 'Condensed display' },
        { value: 'montserrat', label: 'Geometric black' },
      ],
      group: 'Style',
    },
    {
      key: 'textScale',
      label: 'Text size',
      type: 'number',
      default: 1,
      min: 0.6,
      max: 1.4,
      step: 0.05,
      unit: 'x',
      group: 'Style',
    },
    { key: 'showAccent', label: 'Accent bar & rings', type: 'boolean', default: true, group: 'Style' },
  ],

  render({ ctx, time, fps, durationFrames, width: w, height: h, transparent }, v, loaded) {
    const u = Math.min(w, h);
    const T = timing(time, fps, durationFrames);
    const S = T.scale;
    const primary = str(v, 'primaryColor');
    const bg = str(v, 'secondaryColor');
    const ink = readableOn(bg);
    const hi = contrastRatio(primary, bg) >= 2.2 ? primary : ink;
    const style = str(v, 'animationStyle');
    const scale = clamp(num(v, 'textScale') || 1, 0.6, 1.4);
    const accent = bool(v, 'showAccent');
    const fnt = FONT_OPTIONS[str(v, 'headlineFont') === 'montserrat' ? 'montserrat' : 'anton'];
    const ex = T.exit;

    // ---------------------------------------------------------------- background
    const bgIn = at(time, 0, 1.2, easeOutQuart);
    if (!transparent) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      radialGlow(ctx, w * 0.88 + Math.sin(time * 0.5) * u * 0.05, h * 0.1, u * 1.15, primary, 0.34 * bgIn);
      radialGlow(ctx, w * 0.05, h * 0.95 + Math.cos(time * 0.4) * u * 0.04, u * 0.95, mixColors(primary, ink, 0.25), 0.16 * bgIn);
    }
    if (accent) {
      ctx.save();
      ctx.lineWidth = Math.max(1, u * 0.004);
      for (let k = 0; k < 3; k++) {
        const r = u * (0.36 + k * 0.2) * (0.85 + 0.15 * bgIn);
        ctx.strokeStyle = withAlpha(primary, 0.2 * (1 - k * 0.25) * bgIn * (1 - ex));
        ctx.setLineDash(k === 1 ? [] : [u * 0.02, u * 0.03]);
        ctx.lineDashOffset = -time * u * 0.02 * (k % 2 ? -1 : 1);
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- layout
    const headline = (str(v, 'headline').trim() || ' ').toUpperCase();
    const hb = fitTextBlock(ctx, headline, {
      family: fnt.family,
      weight: fnt.weight,
      maxWidth: w * 0.86,
      maxHeight: Math.min(h * 0.7, h * 0.46 * scale),
      maxSize: u * fnt.sizeK * scale,
      minSize: u * 0.04,
      lineHeight: fnt.lh,
      letterSpacingEm: fnt.em,
      maxLines: 4,
    });
    const hFont = { family: fnt.family, weight: fnt.weight, size: hb.size };
    const hl = layoutText(ctx, hb.lines, hb.size, {
      lineHeightPx: hb.lineHeightPx,
      letterSpacing: hb.letterSpacing,
      align: 'center',
      capHeightEm: fnt.cap,
    });

    const sub = str(v, 'subheading').trim();
    const sScale = clamp(scale, 0.8, 1.25);
    const sb = sub
      ? fitTextBlock(ctx, sub, {
          family: 'Inter Variable',
          weight: 600,
          maxWidth: w * 0.78,
          maxHeight: h * 0.14,
          maxSize: u * 0.04 * sScale,
          minSize: u * 0.022,
          lineHeight: 1.3,
          maxLines: 3,
        })
      : null;
    const sFont = sb ? { family: 'Inter Variable', weight: 600, size: sb.size } : null;
    const sl = sb ? layoutText(ctx, sb.lines, sb.size, { lineHeightPx: sb.lineHeightPx, align: 'center', capHeightEm: 0.72 }) : null;

    const barH = u * 0.012;
    const gap = u * 0.035;
    const groupH = hl.height + (accent ? gap + barH : 0) + (sl ? gap + sl.height : 0);
    const top = (h - groupH) / 2 - h * 0.02;
    const cx = w / 2;
    const barY = top + hl.height + gap;
    const subY = top + hl.height + (accent ? gap + barH : 0) + gap;

    // ---------------------------------------------------------------- logo
    const logo = loaded.images.logoUrl;
    const lbox = containSize(logo, u * 0.34, u * 0.085);
    if (logo && lbox) {
      const t = at(time, 0.1, 0.8 * S, easeOutCubic);
      ctx.save();
      ctx.globalAlpha = t * (1 - ex);
      drawImageContain(ctx, logo, cx - lbox.w / 2, h * 0.06 + (1 - t) * u * 0.02 - ex * u * 0.03, lbox.w, lbox.h);
      ctx.restore();
    }

    // ---------------------------------------------------------------- text group (slow push-in)
    ctx.save();
    const push = 1 + 0.035 * T.t01;
    ctx.translate(cx, h / 2);
    ctx.scale(push, push);
    ctx.translate(-cx, -h / 2);

    // headline, per character
    const n = Math.max(1, hl.chars.length);
    const delay = Math.min(0.03, 0.65 / n) * S;
    const start0 = 0.25 * S;
    const dur = (style === 'pop' ? 0.6 : 0.8) * S;
    const lastWord = hl.words.length - 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${hFont.weight} ${hFont.size}px "${hFont.family}", sans-serif`;
    for (const line of hl.lines) {
      const base = top + line.baseline;
      ctx.save();
      if (style === 'rise') {
        ctx.beginPath();
        ctx.rect(0, base - hb.size * 1.02, w, hb.size * 1.3);
        ctx.clip();
      }
      const dir = line.words[0] && line.words[0].lineIndex % 2 === 0 ? -1 : 1;
      for (const word of line.words) {
        ctx.fillStyle = word.index === lastWord ? hi : ink;
        for (const c of word.chars) {
          const raw = clamp01((time - start0 - c.index * delay) / dur);
          const e = easeInCubic(clamp01((time - T.exitStart - c.lineIndex * 0.05) / (T.exitDur * 0.7)));
          if (raw <= 0 || e >= 1) continue;
          const pivotY = base - hb.size * 0.3;
          let dx = 0;
          let dy = 0;
          let sc = 1;
          let rot = 0;
          let alpha = 1;
          if (style === 'pop') {
            const t = easeOutBack(raw);
            sc = lerp(0.2, 1, t);
            rot = (1 - t) * (c.index % 2 ? 1 : -1) * 0.35;
            alpha = clamp01(raw * 4) * (1 - e);
            dy = -e * hb.size * 0.5;
          } else if (style === 'slide') {
            const t = easeOutQuart(raw);
            dx = dir * (1 - t) * u * 0.3 - dir * e * u * 0.25;
            alpha = clamp01(t * 2.5) * (1 - e);
          } else {
            const t = easeOutExpo(raw);
            dy = (1 - t) * hb.size * 1.2 - e * hb.size * 1.2;
          }
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(cx + c.x + c.w / 2 + dx, pivotY + dy);
          if (rot) ctx.rotate(rot);
          if (sc !== 1) ctx.scale(sc, sc);
          ctx.fillText(c.ch, -c.w / 2, hb.size * 0.3);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // accent bar
    if (accent) {
      const t = at(time, 0.95 * S, 0.7 * S, easeOutExpo) * (1 - easeInCubic(clamp01((time - T.exitStart) / (T.exitDur * 0.8))));
      const bw = u * 0.2 * t;
      if (bw > 0.5) fillRoundRect(ctx, cx - bw / 2, barY, bw, barH, barH / 2, primary);
    }

    // subheading
    if (sl && sFont) {
      drawRevealLines(ctx, sl, cx, subY, {
        font: sFont,
        color: () => mixColors(ink, bg, 0.28),
        enter: (li) => at(time, (1.15 + li * 0.1) * S, 0.8 * S, easeOutQuart),
        exit: (li) => easeInCubic(clamp01((time - T.exitStart - 0.06 - li * 0.05) / (T.exitDur * 0.7))),
      });
    }
    ctx.restore();
  },
};
