import type { TemplateDefinition } from '../types';
import {
  clamp,
  clamp01,
  easeInOutQuad,
  easeOutBack,
  easeOutExpo,
  easeOutQuart,
  lerp,
  mixColors,
  readableOn,
  withAlpha,
} from '../math';
import { fitFontSize, fitTextBlock, layoutText, measureText, setFont } from '../text';
import {
  containSize,
  drawImageContain,
  fillCircle,
  fillPolygon,
  fillRoundRect,
  gradientBackground,
  radialGlow,
  roundRectPath,
  starPath,
} from '../draw';
import { at, bool, drawRevealLines, num, str, timing } from './shared';

const HEAD = 'Montserrat Variable';
const BODY = 'Inter Variable';

export const promoCard: TemplateDefinition = {
  id: 'promo_card_v1',
  name: 'Promo Card',
  description: 'Social promo card with layered shapes, a discount badge and a call-to-action pill.',
  category: 'promo',
  defaultSettings: { width: 1080, height: 1080, fps: 30, durationFrames: 150, transparent: false },
  fonts: [HEAD, BODY],
  params: [
    { key: 'headline', label: 'Headline', type: 'text', default: 'Weekend Flash Sale', maxLength: 50, group: 'Text' },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'text',
      default: 'Fresh styles. Limited time only.',
      maxLength: 90,
      group: 'Text',
    },
    { key: 'badgeText', label: 'Badge value', type: 'text', default: '50%', maxLength: 8, group: 'Text' },
    { key: 'badgeLabel', label: 'Badge label', type: 'text', default: 'OFF', maxLength: 12, group: 'Text' },
    { key: 'ctaText', label: 'Button text', type: 'text', default: 'Shop now', maxLength: 24, group: 'Text' },
    { key: 'primaryColor', label: 'Primary color', type: 'color', default: '#FF3D71', group: 'Colors' },
    { key: 'secondaryColor', label: 'Background color', type: 'color', default: '#14142B', group: 'Colors' },
    { key: 'accentColor', label: 'Badge color', type: 'color', default: '#FFC93C', group: 'Colors' },
    { key: 'logoUrl', label: 'Logo', type: 'image', default: null, group: 'Media' },
    {
      key: 'cornerRoundness',
      label: 'Corner roundness',
      type: 'number',
      default: 60,
      min: 0,
      max: 100,
      step: 5,
      unit: '%',
      group: 'Style',
    },
    { key: 'showDecor', label: 'Decorative shapes', type: 'boolean', default: true, group: 'Style' },
  ],

  render({ ctx, time, fps, durationFrames, width: w, height: h, transparent }, v, loaded) {
    const u = Math.min(w, h);
    const T = timing(time, fps, durationFrames);
    const S = T.scale;
    const ex = T.exit;
    const P = str(v, 'primaryColor');
    const BG = str(v, 'secondaryColor');
    const A = str(v, 'accentColor');
    const decor = bool(v, 'showDecor');
    const round = clamp(num(v, 'cornerRoundness'), 0, 100) / 100;

    const cardColor = mixColors('#FFFFFF', BG, 0.04);
    const ink = mixColors('#0B1020', BG, 0.18);
    const muted = mixColors(ink, '#FFFFFF', 0.4);

    // ---------------------------------------------------------------- layout
    const m = u * 0.055;
    const pad = u * 0.07;
    const cx0 = m;
    const cy0 = m;
    const cw = w - 2 * m;
    const ch = h - 2 * m;
    const rad = u * 0.12 * round;
    const side = w / h >= 0.95;
    const R = u * (side ? 0.15 : 0.14);
    const colX = cx0 + pad;
    const bx = side ? cx0 + cw - pad * 0.35 - R : cx0 + cw - pad - R;
    const by = side ? cy0 + ch / 2 : cy0 + pad + R * 0.9;
    const colW = side ? Math.min(cw * (w / h >= 1.3 ? 0.55 : 0.6) - pad, u * 1.1) : cw - 2 * pad;

    const logo = loaded.images.logoUrl;
    const lbox = containSize(logo, u * 0.3, u * 0.075);
    const logoBlock = lbox ? lbox.h + u * 0.03 : 0;

    const cta = str(v, 'ctaText').trim();
    const ctaH = u * 0.085;
    const ctaY = cy0 + ch - pad - ctaH;
    const regionTop = cy0 + pad + (side ? logoBlock : Math.max(logoBlock, R * 1.75 + u * 0.02));
    const regionBot = cta ? ctaY - u * 0.04 : cy0 + ch - pad;
    const regionH = Math.max(u * 0.2, regionBot - regionTop);

    const hb = fitTextBlock(ctx, str(v, 'headline').trim() || ' ', {
      family: HEAD,
      weight: 900,
      maxWidth: colW,
      maxHeight: regionH * 0.72,
      maxSize: u * (side ? 0.115 : 0.125),
      minSize: u * 0.04,
      lineHeight: 1.05,
      letterSpacingEm: -0.02,
      maxLines: 4,
    });
    const hFont = { family: HEAD, weight: 900, size: hb.size };
    const hl = layoutText(ctx, hb.lines, hb.size, {
      lineHeightPx: hb.lineHeightPx,
      letterSpacing: hb.letterSpacing,
      align: 'left',
      capHeightEm: 0.7,
    });
    const sub = str(v, 'subheading').trim();
    const sb = sub
      ? fitTextBlock(ctx, sub, {
          family: BODY,
          weight: 500,
          maxWidth: colW,
          maxHeight: regionH * 0.28,
          maxSize: u * 0.036,
          minSize: u * 0.02,
          lineHeight: 1.3,
          maxLines: 3,
        })
      : null;
    const sFont = sb ? { family: BODY, weight: 500, size: sb.size } : null;
    const sl = sb ? layoutText(ctx, sb.lines, sb.size, { lineHeightPx: sb.lineHeightPx, align: 'left' }) : null;
    const gapHS = u * 0.025;
    const blockH = hl.height + (sl ? gapHS + sl.height : 0);
    const blockTop = regionTop + Math.max(0, (regionH - blockH) / 2);

    // ---------------------------------------------------------------- scene transform (exit)
    ctx.save();
    ctx.globalAlpha = 1 - ex * ex;
    ctx.translate(w / 2, h / 2);
    ctx.scale(1 - 0.05 * ex, 1 - 0.05 * ex);
    ctx.translate(-w / 2, -h / 2 - ex * u * 0.03);

    // ---------------------------------------------------------------- background + outside shapes
    gradientBackground(ctx, w, h, BG, mixColors(BG, '#000000', 0.4), transparent, 0.6);
    if (!transparent) radialGlow(ctx, w * 0.9, h * 0.05, u * 0.9, P, 0.3 * at(time, 0, 1, easeOutQuart));

    if (decor) {
      const s1 = at(time, 0, 0.8 * S, easeOutExpo);
      ctx.save();
      ctx.translate(cx0 + u * 0.01, cy0 + u * 0.01);
      ctx.rotate(0.31 + (1 - s1) * 0.8);
      ctx.scale(s1, s1);
      fillRoundRect(ctx, -u * 0.19, -u * 0.19, u * 0.38, u * 0.38, u * 0.07 * (0.3 + round), P);
      ctx.restore();

      const s2 = at(time, 0.1 * S, 0.8 * S, easeOutExpo);
      fillCircle(ctx, w - m * 0.3, h - m * 0.3, u * 0.17 * s2, A);
      ctx.save();
      ctx.strokeStyle = withAlpha(P, 0.55 * s2);
      ctx.lineWidth = Math.max(1, u * 0.006);
      ctx.beginPath();
      ctx.arc(w - m * 0.3, h - m * 0.3, u * 0.23 * s2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ---------------------------------------------------------------- card
    const cT = at(time, 0.15 * S, 0.85 * S, easeOutQuart);
    ctx.save();
    ctx.globalAlpha *= clamp01(cT * 2.5);
    ctx.translate(w / 2, h / 2 + (1 - cT) * h * 0.12);
    ctx.scale(lerp(0.94, 1, cT), lerp(0.94, 1, cT));
    ctx.translate(-w / 2, -h / 2);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = u * 0.06;
    ctx.shadowOffsetY = u * 0.022;
    fillRoundRect(ctx, cx0, cy0, cw, ch, rad, cardColor);
    ctx.restore();

    // clipped decoration inside the card
    ctx.save();
    roundRectPath(ctx, cx0, cy0, cw, ch, rad);
    ctx.clip();
    if (decor) {
      const radii = [1.95, 2.8, 3.8];
      const tints = [0.12, 0.07, 0.04];
      for (let k = radii.length - 1; k >= 0; k--) {
        const t = at(time, (0.45 + k * 0.12) * S, 0.9 * S, easeOutExpo);
        fillCircle(ctx, bx, by, R * (radii[k] as number) * t, mixColors(cardColor, P, tints[k] as number));
      }
      const band = at(time, 0.4 * S, 0.9 * S, easeOutExpo);
      fillPolygon(
        ctx,
        [
          [cx0 - u * 0.1, cy0 + ch * 0.78 + (1 - band) * u * 0.4],
          [cx0 + cw * 0.5, cy0 + ch * 1.02 + (1 - band) * u * 0.4],
          [cx0 - u * 0.1, cy0 + ch * 1.15 + (1 - band) * u * 0.4],
        ],
        withAlpha(P, 0.08),
      );
      const dots = at(time, 0.9 * S, 0.8 * S, easeOutQuart);
      const gap = u * 0.03;
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 4; j++) {
          const x = cx0 + cw - pad - i * gap;
          const y = cy0 + ch - pad * 0.7 - j * gap;
          fillCircle(ctx, x, y, u * 0.0042 * dots, withAlpha(P, 0.4));
        }
    }
    ctx.restore();

    // logo
    if (logo && lbox) {
      const t = at(time, 0.6 * S, 0.7 * S, easeOutQuart);
      ctx.save();
      ctx.globalAlpha *= t;
      drawImageContain(ctx, logo, colX, cy0 + pad + (1 - t) * u * 0.02, lbox.w, lbox.h);
      ctx.restore();
    }

    // headline + subheading
    drawRevealLines(ctx, hl, colX, blockTop, {
      font: hFont,
      color: (word) => (word.index === hl.words.length - 1 && hl.words.length > 1 ? P : ink),
      enter: (li) => at(time, (0.7 + li * 0.1) * S, 0.8 * S, easeOutExpo),
    });
    if (sl && sFont) {
      drawRevealLines(ctx, sl, colX, blockTop + hl.height + gapHS, {
        font: sFont,
        color: () => muted,
        enter: (li) => at(time, (1.1 + li * 0.08) * S, 0.7 * S, easeOutQuart),
      });
    }

    // CTA pill
    if (cta) {
      const t = at(time, 1.5 * S, 0.7 * S, easeOutBack);
      const label = cta.toUpperCase();
      const fs = ctaH * 0.36;
      setFont(ctx, { family: BODY, weight: 800, size: fs });
      const ls = fs * 0.08;
      const tw = measureText(ctx, label, ls);
      const padX = ctaH * 0.55;
      const arrow = ctaH * 0.3;
      const pw = tw + arrow + padX * 2 + ctaH * 0.2;
      const onP = readableOn(P);
      if (t > 0.001) {
        ctx.save();
        ctx.globalAlpha *= clamp01(t * 3);
        ctx.translate(colX, ctaY + ctaH / 2);
        ctx.scale(Math.max(0.001, t), Math.max(0.001, t));
        ctx.translate(0, -ctaH / 2);
        fillRoundRect(ctx, 0, 0, pw, ctaH, ctaH / 2, P);
        // text
        ctx.fillStyle = onP;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const chars = Array.from(label);
        for (let i = 0; i < chars.length; i++) {
          const prefix = chars.slice(0, i).join('');
          ctx.fillText(chars[i] as string, padX + ctx.measureText(prefix).width + ls * i, ctaH / 2 + fs * 0.36);
        }
        // arrow
        const ax = padX + tw + ctaH * 0.2;
        const ay = ctaH / 2;
        ctx.strokeStyle = onP;
        ctx.lineWidth = ctaH * 0.07;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + arrow, ay);
        ctx.moveTo(ax + arrow * 0.62, ay - arrow * 0.38);
        ctx.lineTo(ax + arrow, ay);
        ctx.lineTo(ax + arrow * 0.62, ay + arrow * 0.38);
        ctx.stroke();
        // shine sweep
        const sh = clamp01((time - 2.3 * S) / 0.8);
        if (sh > 0 && sh < 1) {
          ctx.save();
          roundRectPath(ctx, 0, 0, pw, ctaH, ctaH / 2);
          ctx.clip();
          const x = lerp(-ctaH * 1.5, pw + ctaH * 0.5, easeInOutQuad(sh));
          const g = ctx.createLinearGradient(x - ctaH, 0, x + ctaH, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - ctaH, 0, ctaH * 2, ctaH);
          ctx.restore();
        }
        ctx.restore();
      }
    }
    ctx.restore(); // card transform

    // ---------------------------------------------------------------- badge (above the card)
    const badgeValue = str(v, 'badgeText').trim();
    const badgeLabel = str(v, 'badgeLabel').trim().toUpperCase();
    if (badgeValue || badgeLabel) {
      const raw = clamp01((time - 1.2 * S) / (0.9 * S));
      if (raw > 0) {
        const te = easeOutBack(raw);
        const pulse = 1 + 0.025 * Math.sin(time * Math.PI * 2 * 0.9) * clamp01((raw - 0.9) * 10);
        const onA = readableOn(A);
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(-0.14 + (1 - te) * -1.4);
        const sc = Math.max(0.001, te * pulse);
        ctx.scale(sc, sc);
        ctx.globalAlpha *= clamp01(raw * 4);
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = u * 0.035;
        ctx.shadowOffsetY = u * 0.014;
        starPath(ctx, 0, 0, R, R * 0.9, 18, time * 0.2);
        ctx.fillStyle = A;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = withAlpha(onA, 0.28);
        ctx.lineWidth = Math.max(1, u * 0.004);
        ctx.setLineDash([u * 0.012, u * 0.012]);
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = onA;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const hasLabel = badgeLabel.length > 0;
        if (badgeValue) {
          const size = fitFontSize(ctx, badgeValue, R * 1.22, R * 0.72, R * 0.2, HEAD, 900, -0.02);
          setFont(ctx, { family: HEAD, weight: 900, size });
          ctx.fillText(badgeValue, 0, (hasLabel ? -R * 0.1 : 0) + size * 0.35);
        }
        if (hasLabel) {
          const size = fitFontSize(ctx, badgeLabel, R * 1.0, R * 0.26, R * 0.12, HEAD, 800, 0.1);
          setFont(ctx, { family: HEAD, weight: 800, size });
          const ls = size * 0.1;
          const lw = measureText(ctx, badgeLabel, ls);
          ctx.textAlign = 'left';
          const chars = Array.from(badgeLabel);
          for (let i = 0; i < chars.length; i++) {
            const prefix = chars.slice(0, i).join('');
            ctx.fillText(chars[i] as string, -lw / 2 + ctx.measureText(prefix).width + ls * i, (badgeValue ? R * 0.5 : size * 0.35));
          }
        }
        ctx.restore();
      }
    }
    ctx.restore(); // scene transform
  },
};
