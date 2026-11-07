import React from 'react';
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Video } from '@remotion/media';
import { CamKey, Headline, Pointer, Shot, T, arc, camAt, clamp, ease, inOut } from './ui';

/**
 * Product scenes built from pixel-accurate captures of the studio at deviceScaleFactor 3
 * (public/ui3, 4320×2700). Boxes are CSS px from public/ui3/boxes.json; ×3 gives image px.
 */
const DPR = 3;
const VP = { x: 56, y: 560, w: 968, h: 940 };

type Box = { x: number; y: number; w: number; h: number };
const px = (b: Box): Box => ({ x: b.x * DPR, y: b.y * DPR, w: b.w * DPR, h: b.h * DPR });
/** Camera key from a CSS-pixel centre. */
const k = (f: number, cssX: number, cssY: number, z: number): CamKey => ({ f, x: cssX * DPR, y: cssY * DPR, z });

const RESULT_DIALOG = px({ x: 440, y: 354.5, w: 560, h: 191 });
const PREV11 = px({ x: 311.5, y: 80.2, w: 737, h: 737 });
const PREV916 = px({ x: 473, y: 80.2, w: 414, h: 737 });
const GEN_CLIP = px({ x: 420, y: 260, w: 600, h: 380 });
const STRIP = px({ x: 1185, y: 136.4, w: 239, h: 24 });
// measured in gen/full_result.png: 9:16 image inside the square thumbnail frame (image px)
const THUMB_RESULT: Box = { x: 1422, y: 1230, w: 117, h: 210 };
const THUMB = px({ x: 1137, y: 128.4, w: 40, h: 40 });
const GENERATE_BTN = { x: (879.4 + 51.8) * DPR, y: (568.4 + 16) * DPR };
const RENDER_BTN = { x: (799.1 + 52) * DPR, y: (537 + 16) * DPR };
const DOWNLOAD_BTN = { x: (1137 + 73) * DPR, y: (178 + 16) * DPR };

const pad = (n: number) => String(n).padStart(3, '0');
/** Pointer stays ~56 px tall on screen whatever the zoom. */
const pointerScale = (z: number) => 1.4 / z;

const PreviewVideo: React.FC<{ box: Box; src: string; trim?: number; from?: number; style?: React.CSSProperties }> = ({
  box,
  src,
  trim = 30,
  from = 0,
  style,
}) => (
  <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', ...style }}>
    <Sequence from={from} layout="none">
      <Video src={staticFile(src)} trimBefore={trim} muted loop objectFit="cover" style={{ width: '100%', height: '100%' }} />
    </Sequence>
  </div>
);

const ImgAt: React.FC<{ src: string; box: Box; style?: React.CSSProperties }> = ({ src, box, style }) => (
  <Img src={staticFile(src)} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, ...style }} />
);

/* ------------------------------------------------------------------ */
/* 2 Prompt → generated template   (6.0–16.0 s, 300 frames)            */
/* ------------------------------------------------------------------ */

const PROMPT_CAM: CamKey[] = [
  k(0, 720, 450, 0.25),
  k(30, 720, 450, 0.25), // 7.0 wide hold
  k(60, 720, 450, 0.52), // 8.0 pushed into the dialog
  k(150, 720, 445, 0.54), // typing, near-still
  k(190, 800, 500, 0.7), // toward Generate
  k(197, 800, 500, 0.7),
  k(222, 720, 450, 0.55), // re-centre on the dialog while it generates
  k(237, 720, 450, 0.56),
  k(285, 680, 448.7, 0.425), // 14.5 → 15.5 settle on the generated preview
  k(300, 680, 448.7, 0.43),
];

export const PromptScene: React.FC = () => {
  const f = useCurrentFrame();
  const cam = camAt(f, PROMPT_CAM);
  const perChar = 90 / 33; // 8.0–11.0 s
  const ch = f < 60 ? 0 : Math.min(33, 1 + Math.floor((f - 60) / perChar));
  let src: string;
  let layers: React.ReactNode = null;
  if (f < 180) {
    src = `ui3/type/${pad(ch)}.png`;
  } else if (f < 195) {
    src = 'ui3/type/hover.png';
  } else if (f < 237) {
    src = 'ui3/type/press.png';
    if (f >= 199) {
      // generating: real dialog states at real speed (12 shots over 1.3 s)
      const i = Math.min(11, Math.floor(((f - 199) / 38) * 12));
      layers = <ImgAt src={`ui3/gen/${pad(i)}.png`} box={GEN_CLIP} />;
    }
  } else if (f < 255) {
    src = 'ui3/gen/full_result.png';
    layers = (
      <>
        <PreviewVideo box={PREV916} src="clips/generated.mp4" trim={20} from={237} />
        <div style={{ position: 'absolute', left: PREV916.x, top: PREV916.y, width: PREV916.w, height: PREV916.h, background: 'rgba(0,0,0,0.55)' }} />
        <Img
          src={staticFile(src)}
          style={{
            position: 'absolute',
            width: 4320,
            height: 2700,
            clipPath: `inset(${RESULT_DIALOG.y}px ${4320 - RESULT_DIALOG.x - RESULT_DIALOG.w}px ${2700 - RESULT_DIALOG.y - RESULT_DIALOG.h}px ${RESULT_DIALOG.x}px round 18px)`,
          }}
        />
        <PreviewVideo box={THUMB_RESULT} src="clips/generated.mp4" trim={20} from={237} />
      </>
    );
  } else {
    src = 'ui3/result/full.png';
    const r = ease(f, 255, 275, 100, 0);
    layers = <PreviewVideo box={PREV916} src="clips/generated.mp4" trim={20} from={237} style={{ clipPath: `inset(${r}% 0 0 0)` }} />;
  }
  const t = ease(f, 162, 192, 0, 1, inOut);
  const [ptx, pty] = arc([GENERATE_BTN.x + 420, GENERATE_BTN.y + 520], [GENERATE_BTN.x, GENERATE_BTN.y], t);
  const pointerOn = f >= 158 && f < 215;
  return (
    <AbsoluteFill style={{ background: T.ink }}>
      <Shot
        src={src}
        cam={cam}
        vp={VP}
        layers={
          <>
            {layers}
            {pointerOn ? (
              <div style={{ opacity: interpolate(f, [158, 164, 206, 214], [0, 1, 1, 0], clamp) }}>
                <Pointer x={ptx} y={pty} clickAt={195} scale={pointerScale(cam.z) * 1.5} />
              </div>
            ) : null}
          </>
        }
      />
      <Headline lines={['Describe the', 'video you need.']} at={4} top={262} size={96} out={244} />
      <Headline lines={['It builds the', 'motion for you.']} at={256} top={262} size={96} />
      {f >= 297 ? <AbsoluteFill style={{ background: T.ink }} /> : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 4 Reference palette   (22.0–30.0 s, 240 frames)                     */
/* ------------------------------------------------------------------ */

const PALETTE_CAM: CamKey[] = [
  k(0, 1262, 250, 0.9),
  k(135, 1262, 245, 0.93), // hold on the palette while it fills
  k(165, 680, 448.7, 0.41), // 26.5–27.5 pan to the preview
  k(240, 680, 448.7, 0.425),
];

export const PaletteScene: React.FC = () => {
  const f = useCurrentFrame();
  const cam = camAt(f, PALETTE_CAM);
  const dropped = f >= 45; // 23.5 s
  // strip fills on the four plucks (24.0, 24.5, 25.0, 25.5)
  const stops = [0.266, 0.481, 0.81, 1];
  const starts = [60, 75, 90, 105];
  let fill = 0;
  starts.forEach((s, i) => {
    if (f >= s) fill = (i === 0 ? 0 : stops[i - 1]!) + (stops[i]! - (i === 0 ? 0 : stops[i - 1]!)) * ease(f, s, s + 10, 0, 1);
  });
  // the photo is dragged from below into the drop zone (22.5–23.5)
  const d = ease(f, 15, 45, 0, 1, inOut);
  const card = {
    x: interpolate(d, [0, 1], [1190 * DPR, THUMB.x]),
    y: interpolate(d, [0, 1], [400 * DPR, THUMB.y]),
    w: interpolate(d, [0, 1], [120 * DPR, THUMB.w]),
    h: interpolate(d, [0, 1], [120 * DPR, THUMB.h]),
  };
  const cardIn = interpolate(f, [8, 15], [0, 1], clamp);
  const wipe = ease(f, 180, 204, 0, 1, inOut); // 28.0–28.8
  const coverX = STRIP.x + STRIP.w * fill;
  return (
    <AbsoluteFill style={{ background: T.ink }}>
      <Shot
        src={dropped ? 'ui3/palette/after.png' : 'ui3/palette/before.png'}
        cam={cam}
        vp={VP}
        layers={
          <>
            <PreviewVideo box={PREV11} src="clips/formats/11.mp4" from={120} trim={30} />
            <PreviewVideo box={PREV11} src="clips/palette/after_11.mp4" from={120} trim={30} style={{ clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }} />
            {wipe > 0 && wipe < 1 ? (
              <div style={{ position: 'absolute', left: PREV11.x + wipe * PREV11.w - 6, top: PREV11.y, width: 12, height: PREV11.h, background: T.accent }} />
            ) : null}
            {dropped && fill < 1 ? (
              <div style={{ position: 'absolute', left: coverX, top: STRIP.y + 3, width: STRIP.x + STRIP.w - coverX, height: STRIP.h - 6, background: T.surface }} />
            ) : null}
            {!dropped && f >= 8 ? (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: card.x,
                    top: card.y,
                    width: card.w,
                    height: card.h,
                    borderRadius: 12,
                    overflow: 'hidden',
                    opacity: cardIn,
                    boxShadow: '0 24px 60px rgba(0,0,0,.55)',
                    outline: `3px solid ${T.text}`,
                  }}
                >
                  <Img src={staticFile('palette/photo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ opacity: cardIn }}>
                  <Pointer x={card.x + card.w * 0.72} y={card.y + card.h * 0.72} scale={pointerScale(cam.z) * 1.5} />
                </div>
              </>
            ) : null}
          </>
        }
      />
      <Headline lines={['Pull colours from', 'any image.']} at={4} top={262} size={96} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 6 Export and render   (36.0–44.0 s, 240 frames)                     */
/* ------------------------------------------------------------------ */

const RENDER_CAM_DIALOG: CamKey[] = [k(0, 720, 450, 0.42), k(15, 720, 450, 0.42), k(45, 720, 450, 0.62), k(78, 740, 460, 0.64)];
// the progress captures cover CSS x 1040..1440, y 0..360 (1200×1080 px)
const RENDER_CAM_PANEL: CamKey[] = [{ f: 78, x: 600, y: 540, z: 0.87 }, { f: 240, x: 600, y: 540, z: 0.9 }];

export const RenderScene: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 78) {
    const cam = camAt(f, RENDER_CAM_DIALOG);
    const t = ease(f, 45, 72, 0, 1, inOut);
    const [ptx, pty] = arc([RENDER_BTN.x + 380, RENDER_BTN.y + 460], [RENDER_BTN.x, RENDER_BTN.y], t);
    return (
      <AbsoluteFill style={{ background: T.ink }}>
        <Shot
          src={f >= 66 ? 'ui3/export/dialog_bn_hover.png' : 'ui3/export/dialog_bn.png'}
          cam={cam}
          vp={VP}
          layers={
            f >= 42 ? (
              <div style={{ opacity: interpolate(f, [42, 48], [0, 1], clamp) }}>
                <Pointer x={ptx} y={pty} clickAt={75} scale={pointerScale(cam.z) * 1.5} />
              </div>
            ) : null
          }
        />
        <Headline lines={['Export in', 'one click.']} at={4} top={262} size={96} />
      </AbsoluteFill>
    );
  }
  const cam = camAt(f, RENDER_CAM_PANEL);
  // 60 progress captures over 4.45 s of real time, played across 38.6–42.0 s
  const i = Math.min(59, Math.floor(interpolate(f, [78, 180], [0, 60], clamp)));
  const done = f >= 180;
  const t2 = ease(f, 195, 219, 0, 1, inOut);
  // Download button in panel-capture coordinates (capture origin is CSS 1040, 0)
  const dl = { x: DOWNLOAD_BTN.x - 1040 * DPR, y: DOWNLOAD_BTN.y };
  const [bx, by] = arc([dl.x + 320, dl.y + 420], [dl.x, dl.y], t2);
  return (
    <AbsoluteFill style={{ background: T.ink }}>
      {done ? (
        <Shot
          src="ui3/export/done.png"
          cam={{ x: cam.x + 1040 * DPR, y: cam.y, z: cam.z }}
          vp={VP}
          layers={
            f >= 192 ? (
              <div style={{ opacity: interpolate(f, [192, 198], [0, 1], clamp) }}>
                <Pointer x={bx + 1040 * DPR} y={by} scale={pointerScale(cam.z) * 1.5} />
              </div>
            ) : null
          }
        />
      ) : (
        <Shot src={`ui3/export/${pad(i)}.png`} cam={cam} vp={VP} iw={1200} ih={1080} />
      )}
      <Headline lines={['Export in', 'one click.']} at={-30} top={262} size={96} />
    </AbsoluteFill>
  );
};

