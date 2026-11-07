import type { TemplateDefinition, Ctx2D } from '../types';
import {
  clamp01,
  easeInCubic,
  easeOutBack,
  easeOutExpo,
  easeOutQuart,
  mixColors,
  readableOn,
  withAlpha,
} from '../math';
import { fitTextBlock, layoutText, measureText, setFont } from '../text';
import { containSize, drawImageContain, fillPolygon, fillRoundRect, radialGlow } from '../draw';
import { at, bool, drawRevealLines, str, timing } from './shared';

const HEAD = 'Anton';
const BODY = 'Inter Variable';

interface Pill {
  w: number;
  h: number;
  fs: number;
  ls: number;
  tw: number;
  padX: number;
  arrow: number;
  label: string;
}

function pillMetrics(ctx: Ctx2D, text: string, h: number): Pill {
  const label = text.toUpperCase();
  const fs = h * 0.38;
  setFont(ctx, { family: BODY, weight: 800, size: fs });
  const ls = fs * 0.08;
  const tw = measureText(ctx, label, ls);
  const padX = h * 0.55;
  const arrow = h * 0.3;
  return { w: tw + arrow + padX * 2 + h * 0.2, h, fs, ls, tw, padX, arrow, label };
}

/** Draws the pill with its top-left at the current origin. */
function drawPill(ctx: Ctx2D, p: Pill, fill: string, onFill: string): void {
  fillRoundRect(ctx, 0, 0, p.w, p.h, p.h / 2, fill);
  setFont(ctx, { family: BODY, weight: 800, size: p.fs });
  ctx.fillStyle = onFill;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const chars = Array.from(p.label);
  for (let i = 0; i < chars.length; i++) {
    const prefix = chars.slice(0, i).join('');
    ctx.fillText(chars[i] as string, p.padX + ctx.measureText(prefix).width + p.ls * i, p.h / 2 + p.fs * 0.36);
  }
  const ax = p.padX + p.tw + p.h * 0.2;
  const ay = p.h / 2;
  ctx.strokeStyle = onFill;
  ctx.lineWidth = p.h * 0.07;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + p.arrow, ay);
  ctx.moveTo(ax + p.arrow * 0.62, ay - p.arrow * 0.38);
  ctx.lineTo(ax + p.arrow, ay);
  ctx.lineTo(ax + p.arrow * 0.62, ay + p.arrow * 0.38);
  ctx.stroke();
}

export const banner: TemplateDefinition = {
  id: 'banner_v1',
  name: 'Banner',
  description: 'Wide banner with sliding colour panels, a masked headline reveal, tagline, logo and button.',
  category: 'promo',
  defaultSettings: { width: 1500, height: 500, fps: 30, durationFrames: 120, transparent: false },
  fonts: [HEAD, BODY],
  params: [
    { key: 'headline', label: 'Headline', type: 'text', default: 'Big Savings Start Today', maxLength: 60, group: 'Text' },
    {
      key: 'tagline',
      label: 'Tagline',
      type: 'text',
      default: 'Up to 60% off selected styles. Limited time.',
      maxLength: 80,
      group: 'Text',
    },
    {
      key: 'ctaText',
      label: 'Button text (empty hides)',
      type: 'text',
      default: 'Shop now',
      maxLength: 24,
      group: 'Text',
    },
    { key: 'primaryColor', label: 'Panel color', type: 'color', default: '#FF5A36', group: 'Colors' },
    { key: 'secondaryColor', label: 'Background color', type: 'color', default: '#0E1324', group: 'Colors' },
    { key: 'accentColor', label: 'Accent color', type: 'color', default: '#FFD166', group: 'Colors' },
    { key: 'logoUrl', label: 'Logo', type: 'image', default: null, group: 'Media' },
    {
      key: 'panelStyle',
      label: 'Panel edge',
      type: 'select',
      default: 'diagonal',
      options: [
        { value: 'diagonal', label: 'Diagonal' },
        { value: 'straight', label: 'Straight' },
      ],
      group: 'Style',
    },
    { key: 'showPattern', label: 'Background pattern', type: 'boolean', default: true, group: 'Style' },
  ],

  render({ ctx, time, fps, durationFrames, width: w, height: h, transparent }, v, loaded) {
    const u = Math.min(w, h);
    const T = timing(time, fps, durationFrames);
    const S = T.scale;
    const ex = T.exit;
    const P = str(v, 'primaryColor');
    const BG = str(v, 'secondaryColor');
    const A = str(v, 'accentColor');
    const ink = readableOn(BG);
    const diagonal = str(v, 'panelStyle') !== 'straight';
    const horizontal = w / h >= 1.6;
    const logo = loaded.images.logoUrl;
    const hasLogo = !!containSize(logo, 10, 10);

    // ---------------------------------------------------------------- background
    if (!transparent) {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);
      radialGlow(ctx, horizontal ? w * 0.9 : w * 0.85, horizontal ? h * 0.1 : h * 0.95, u * 1.3, P, 0.2 * at(time, 0, 1.2));
      if (bool(v, 'showPattern')) {
        ctx.save();
        ctx.strokeStyle = withAlpha(ink, 0.05);
        ctx.lineWidth = Math.max(1, u * 0.004);
        const sp = u * 0.07;
        const off = (time * u * 0.025) % sp;
        ctx.beginPath();
        for (let x = -h - sp + off; x < w + sp; x += sp) {
          ctx.moveTo(x, h);
          ctx.lineTo(x + h, 0);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---------------------------------------------------------------- geometry
    const pT = at(time, 0, 0.75 * S, easeOutExpo);
    const sT = at(time, 0.1 * S, 0.75 * S, easeOutExpo);
    const exitSlide = easeInCubic(clamp01((time - T.exitStart) / T.exitDur));
    const stripe = (horizontal ? h : w) * (horizontal ? 0.045 : 0.02);

    let panelExtent: number; // size of the panel along the slide axis incl. skew + stripe
    let textLeft: number;
    let textRight: number;
    let textTop: number;
    let textBottom: number;
    const padR = (horizontal ? h : w) * (horizontal ? 0.12 : 0.08);

    let pw = 0;
    let sk = 0;
    let ph = 0;
    if (horizontal) {
      pw = hasLogo ? w * 0.24 : w * 0.05;
      sk = diagonal ? h * 0.2 : 0;
      panelExtent = pw + sk + stripe;
      textLeft = pw + sk / 2 + stripe + h * 0.14;
      textRight = w - padR;
      textTop = h * 0.08;
      textBottom = h * 0.92;
    } else {
      ph = hasLogo ? h * 0.22 : h * 0.05;
      sk = diagonal ? w * 0.06 : 0;
      panelExtent = ph + sk + stripe;
      textLeft = w * 0.08;
      textRight = w - w * 0.08;
      textTop = panelExtent + w * 0.06;
      textBottom = h - w * 0.07;
    }

    // ---------------------------------------------------------------- text metrics
    const cta = str(v, 'ctaText').trim();
    const ctaH = horizontal ? h * 0.2 : u * 0.1;
    const pill = cta ? pillMetrics(ctx, cta, ctaH) : null;
    const pillOnRight = horizontal && !!pill && pill.w < w * 0.3;
    if (pillOnRight && pill) textRight -= pill.w + h * 0.1;
    const textW = Math.max(u * 0.3, textRight - textLeft);
    const regionH = textBottom - textTop;

    const hb = fitTextBlock(ctx, (str(v, 'headline').trim() || ' ').toUpperCase(), {
      family: HEAD,
      weight: 400,
      maxWidth: textW,
      maxHeight: regionH * (horizontal ? 0.46 : 0.4),
      maxSize: u * (horizontal ? 0.3 : 0.16),
      minSize: u * 0.05,
      lineHeight: 1.02,
      letterSpacingEm: 0.015,
      maxLines: 3,
    });
    const hFont = { family: HEAD, weight: 400, size: hb.size };
    const hl = layoutText(ctx, hb.lines, hb.size, {
      lineHeightPx: hb.lineHeightPx,
      letterSpacing: hb.letterSpacing,
      align: 'left',
      capHeightEm: 0.74,
    });
    const tag = str(v, 'tagline').trim();
    const tb = tag
      ? fitTextBlock(ctx, tag, {
          family: BODY,
          weight: 600,
          maxWidth: textW,
          maxHeight: regionH * 0.24,
          maxSize: u * (horizontal ? 0.085 : 0.042),
          minSize: u * 0.03,
          lineHeight: 1.28,
          maxLines: 2,
        })
      : null;
    const tFont = tb ? { family: BODY, weight: 600, size: tb.size } : null;
    const tl = tb ? layoutText(ctx, tb.lines, tb.size, { lineHeightPx: tb.lineHeightPx, align: 'left' }) : null;

    const barH = u * 0.016;
    const barW = u * 0.14;
    const gBar = u * 0.045;
    const gTag = u * 0.04;
    const pillInGroup = !!pill && !pillOnRight;
    const groupH =
      barH + gBar + hl.height + (tl ? gTag + tl.height : 0) + (pillInGroup ? gTag * 1.2 + ctaH : 0);
    const gTop = textTop + Math.max(0, (regionH - groupH) / 2);
    const barY = gTop;
    const hY = barY + barH + gBar;
    const tY = hY + hl.height + gTag;
    const pillY = (tl ? tY + tl.height : hY + hl.height) + gTag * 1.2;

    // ---------------------------------------------------------------- panels
    const slideOut = exitSlide * panelExtent * 1.05;
    ctx.save();
    if (horizontal) {
      const dx = -(1 - pT) * (panelExtent + 20) - slideOut;
      const dx2 = -(1 - sT) * (panelExtent + 20) - slideOut;
      ctx.save();
      ctx.translate(dx2, 0);
      fillPolygon(ctx, [[pw + sk, 0], [pw + sk + stripe, 0], [pw + stripe, h], [pw, h]], A);
      ctx.restore();
      ctx.save();
      ctx.translate(dx, 0);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, P);
      g.addColorStop(1, mixColors(P, '#000000', 0.25));
      fillPolygon(ctx, [[-40, 0], [pw + sk, 0], [pw, h], [-40, h]], g);
      ctx.restore();
    } else {
      const dy = -(1 - pT) * (panelExtent + 20) - slideOut;
      const dy2 = -(1 - sT) * (panelExtent + 20) - slideOut;
      ctx.save();
      ctx.translate(0, dy2);
      fillPolygon(ctx, [[0, ph + sk], [w, ph], [w, ph + stripe], [0, ph + sk + stripe]], A);
      ctx.restore();
      ctx.save();
      ctx.translate(0, dy);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, mixColors(P, '#000000', 0.25));
      g.addColorStop(1, P);
      fillPolygon(ctx, [[0, -40], [w, -40], [w, ph], [0, ph + sk]], g);
      ctx.restore();
    }
    ctx.restore();

    // ---------------------------------------------------------------- logo
    const lbox = horizontal
      ? containSize(logo, pw * 0.68, h * 0.42)
      : containSize(logo, w * 0.34, ph * 0.46);
    if (logo && lbox) {
      const t = at(time, 0.45 * S, 0.7 * S, easeOutBack);
      const cx = horizontal ? (pw + sk * 0.5) / 2 : w / 2;
      const cy = horizontal ? h / 2 : (ph + sk / 2) / 2;
      ctx.save();
      ctx.globalAlpha = clamp01(t * 3) * (1 - exitSlide);
      ctx.translate(cx, cy);
      ctx.scale(0.85 + 0.15 * t, 0.85 + 0.15 * t);
      drawImageContain(ctx, logo, -lbox.w / 2, -lbox.h / 2, lbox.w, lbox.h);
      ctx.restore();
    }

    // ---------------------------------------------------------------- text
    const exitLine = (li: number, d = 0) =>
      easeInCubic(clamp01((time - T.exitStart - d - li * 0.05) / (T.exitDur * 0.7)));
    const barT = at(time, 0.5 * S, 0.6 * S, easeOutExpo) * (1 - exitLine(0, 0));
    if (barT > 0.001) fillRoundRect(ctx, textLeft, barY, barW * barT, barH, barH / 2, A);

    drawRevealLines(ctx, hl, textLeft, hY, {
      font: hFont,
      color: () => ink,
      enter: (li) => at(time, (0.45 + li * 0.1) * S, 0.8 * S, easeOutExpo),
      exit: (li) => exitLine(li, 0.03),
    });
    if (tl && tFont) {
      drawRevealLines(ctx, tl, textLeft, tY, {
        font: tFont,
        color: () => mixColors(ink, BG, 0.28),
        enter: (li) => at(time, (0.9 + li * 0.08) * S, 0.7 * S, easeOutQuart),
        exit: (li) => exitLine(li, 0.06),
      });
    }

    // ---------------------------------------------------------------- CTA
    if (pill) {
      const t = at(time, 1.2 * S, 0.6 * S, easeOutBack);
      const a = clamp01(t * 3) * (1 - exitSlide);
      if (t > 0.001 && a > 0) {
        const px = pillOnRight ? textRight + h * 0.1 : textLeft;
        const py = pillOnRight ? (h - ctaH) / 2 : pillY;
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.translate(px + pill.w / 2, py + ctaH / 2);
        ctx.scale(Math.max(0.001, t), Math.max(0.001, t));
        ctx.translate(-pill.w / 2, -ctaH / 2);
        drawPill(ctx, pill, A, readableOn(A));
        ctx.restore();
      }
    }
  },
};
