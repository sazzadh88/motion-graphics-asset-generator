import React from 'react';
import { AbsoluteFill, Easing, Freeze, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { loadVariableFont } from '@remotion/google-fonts/Archivo';

export const { fontFamily } = loadVariableFont('normal', { subsets: ['latin'] });

/** Tokens taken from the studio's own CSS (apps/web/src/styles.css). */
export const T = {
  ink: '#0E0F11',
  surface: '#16181B',
  line: '#2B2F35',
  paper: '#E6E8EB',
  text: '#E6E8EB',
  dim: '#9AA1AB',
  dimOnPaper: '#5B626C',
  accent: '#4C8DFF',
  ok: '#4CC38A',
};

export const BEAT = 15; // 120 BPM at 30 fps
export const W = 1080;
export const H = 1920;
export const MARGIN = 96;

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const expoOut = Easing.bezier(0.16, 1, 0.3, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);

export const ease = (f: number, a: number, b: number, from: number, to: number, e = expoOut) =>
  interpolate(f, [a, b], [from, to], { ...clamp, easing: e });

export const axes = (wdth: number, wght: number): React.CSSProperties => ({
  fontVariationSettings: `'wdth' ${wdth}, 'wght' ${wght}`,
});

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** A line (or word) that rises from behind a clip mask at frame `at`. */
export const Mask: React.FC<{
  at: number;
  dur?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  out?: number; // frame at which it drops away again
}> = ({ at, dur = 20, children, style, out }) => {
  const f = useCurrentFrame();
  let y = ease(f, at, at + dur, 105, 0);
  if (out !== undefined) y += ease(f, out, out + 14, 0, -105, inOut);
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', ...style }}>
      <span style={{ display: 'inline-block', transform: `translateY(${y}%)` }}>{children}</span>
    </span>
  );
};

/** Headline block: each line masked, staggered by `stagger` frames. */
export const Headline: React.FC<{
  lines: string[];
  at: number;
  size?: number;
  color?: string;
  stagger?: number;
  top: number;
  out?: number;
  wght?: number;
}> = ({ lines, at, size = 104, color = T.text, stagger = 3, top, out, wght = 760 }) => (
  <div
    style={{
      position: 'absolute',
      left: MARGIN,
      right: MARGIN,
      top,
      fontSize: size,
      lineHeight: 1.02,
      letterSpacing: '-0.03em',
      color,
      ...axes(100, wght),
    }}
  >
    {lines.map((l, i) => (
      <div key={l}>
        <Mask at={at + i * stagger} out={out !== undefined ? out + i * 2 : undefined}>
          {l}
        </Mask>
      </div>
    ))}
  </div>
);

export const Sub: React.FC<{ text: string; at: number; top: number; color?: string; out?: number }> = ({
  text,
  at,
  top,
  color = T.dim,
  out,
}) => (
  <div style={{ position: 'absolute', left: MARGIN, right: MARGIN, top, fontSize: 42, lineHeight: 1.3, color, ...axes(100, 450) }}>
    <Mask at={at} out={out}>
      {text}
    </Mask>
  </div>
);

/* ------------------------------------------------------------------ */
/* Finish                                                              */
/* ------------------------------------------------------------------ */

/** Fine film grain, deterministic per frame. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <svg width={W} height={H}>
        <filter id={`g${f % 6}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={f % 6} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${f % 6})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** Viewer chrome: crop marks, frame size and running timecode. */
export const ViewerChrome: React.FC<{ dark: boolean }> = ({ dark }) => {
  const f = useCurrentFrame();
  const c = dark ? 'rgba(230,232,235,0.55)' : 'rgba(14,15,17,0.6)';
  const x0 = 56;
  const x1 = W - 56;
  const y0 = 178;
  const y1 = 1640;
  const L = 34;
  const mark = (x: number, y: number, dx: number, dy: number) => (
    <path d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} stroke={c} strokeWidth={2} fill="none" />
  );
  const sec = Math.floor(f / 30);
  const fr = f % 30;
  const tc = `00:00:${String(sec).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
  const label: React.CSSProperties = {
    position: 'absolute',
    fontSize: 24,
    color: c,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.02em',
    ...axes(100, 520),
  };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={W} height={H} style={{ position: 'absolute' }}>
        {mark(x0, y0, 1, 1)}
        {mark(x1, y0, -1, 1)}
        {mark(x0, y1, 1, -1)}
        {mark(x1, y1, -1, -1)}
      </svg>
      <div style={{ ...label, left: x0 + 48, top: y0 - 12 }}>Motion Studio</div>
      <div style={{ ...label, right: W - x1 + 48, top: y0 - 12 }}>1080 × 1920</div>
      <div style={{ ...label, left: x0 + 48, top: y1 - 18 }}>{tc}</div>
      <div style={{ ...label, right: W - x1 + 48, top: y1 - 18 }}>30 fps</div>
    </AbsoluteFill>
  );
};

/**
 * Playhead wipe: the incoming scene is revealed left→right behind a 3 px accent line.
 * Place inside a Sequence that starts `dur` frames before the cut; the child sees its
 * own frame 0 while the wipe runs, then plays normally.
 */
export const WipeIn: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const p = ease(f, 0, dur, 0, 1, inOut);
  const wiping = f < dur;
  return (
    <AbsoluteFill style={{ clipPath: wiping ? `inset(0 ${(1 - p) * 100}% 0 0)` : undefined }}>
      <Freeze frame={dur} active={wiping}>
        <Sequence from={dur}>{children}</Sequence>
      </Freeze>
      {wiping ? (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: p * W - 3, width: 3, background: T.accent }}>
          <div
            style={{
              position: 'absolute',
              top: 120,
              left: -9,
              width: 21,
              height: 21,
              background: T.accent,
              transform: 'rotate(45deg)',
            }}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Product capture camera                                              */
/* ------------------------------------------------------------------ */

export type CamKey = { f: number; x: number; y: number; z: number };

/** Interpolates camera keyframes (image-pixel centre + zoom) with in-out easing. */
export const camAt = (frame: number, keys: CamKey[]) => {
  if (frame <= keys[0]!.f) return keys[0]!;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (frame <= b.f) {
      const t = inOut((frame - a.f) / (b.f - a.f));
      // zoom interpolated in log space so pushes feel linear
      const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * t);
      return { f: frame, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z };
    }
  }
  return keys[keys.length - 1]!;
};

/**
 * Shows a 2880×1800 capture inside a viewport rect. `cam.x/y` is the image pixel at the
 * viewport centre; `cam.z` is screen px per image px.
 */
export const Shot: React.FC<{
  src: string;
  cam: { x: number; y: number; z: number };
  vp: { x: number; y: number; w: number; h: number };
  radius?: number;
  layers?: React.ReactNode; // extra layers in image-pixel space
  iw?: number;
  ih?: number;
}> = ({ src, cam, vp, radius = 6, layers, iw = 4320, ih = 2700 }) => (
  <div
    style={{
      position: 'absolute',
      left: vp.x,
      top: vp.y,
      width: vp.w,
      height: vp.h,
      overflow: 'hidden',
      borderRadius: radius,
      outline: `1px solid ${T.line}`,
      background: T.ink,
    }}
  >
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: iw,
        height: ih,
        transformOrigin: '0 0',
        transform: `translate(${vp.w / 2 - cam.x * cam.z}px, ${vp.h / 2 - cam.y * cam.z}px) scale(${cam.z})`,
      }}
    >
      <Img src={staticFile(src)} style={{ position: 'absolute', width: iw, height: ih }} />
      {layers}
    </div>
  </div>
);

/** macOS-style pointer drawn in image-pixel space, with a click ripple. */
export const Pointer: React.FC<{ x: number; y: number; clickAt?: number; scale?: number }> = ({ x, y, clickAt, scale = 2 }) => {
  const f = useCurrentFrame();
  const press = clickAt !== undefined ? interpolate(f, [clickAt - 2, clickAt, clickAt + 4], [0, 1, 0], clamp) : 0;
  const ripple = clickAt !== undefined && f >= clickAt ? ease(f, clickAt, clickAt + 16, 0, 1) : 0;
  return (
    <>
      {ripple > 0 && ripple < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: x - 40 * scale * ripple,
            top: y - 40 * scale * ripple,
            width: 80 * scale * ripple,
            height: 80 * scale * ripple,
            borderRadius: '50%',
            border: `${3 * scale * (1 - ripple)}px solid ${T.accent}`,
            opacity: 1 - ripple,
          }}
        />
      ) : null}
      <svg
        width={28 * scale}
        height={40 * scale}
        viewBox="0 0 28 40"
        style={{
          position: 'absolute',
          left: x - 2 * scale,
          top: y - 2 * scale,
          transform: `scale(${1 - press * 0.12})`,
          transformOrigin: '10% 10%',
          filter: `drop-shadow(0 ${2 * scale}px ${3 * scale}px rgba(0,0,0,.45))`,
        }}
      >
        <path d="M2 2 L2 30 L9 23.5 L13.6 34 L18.2 32 L13.8 21.8 L23 21.8 Z" fill="black" stroke="white" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    </>
  );
};

/** Point on a gentle quadratic arc between a and b (t eased by caller). */
export const arc = (a: [number, number], b: [number, number], t: number, bend = 0.18): [number, number] => {
  const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * bend;
  const my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend;
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]];
};
