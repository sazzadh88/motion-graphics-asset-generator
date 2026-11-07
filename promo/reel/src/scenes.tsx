import React from 'react';
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Video } from '@remotion/media';
import { BEAT, H, Headline, MARGIN, Mask, Sub, T, W, axes, clamp, ease, expoOut, inOut } from './ui';

/* ------------------------------------------------------------------ */
/* 1 Hook (paper)                                                      */
/* ------------------------------------------------------------------ */

export const HookScene: React.FC = () => {
  const f = useCurrentFrame();
  const size = 176;
  const word: React.CSSProperties = { marginRight: '0.22em' };
  // width axis on "video." is the one bold move
  const wdth = ease(f, 8 * BEAT, 8 * BEAT + 24, 62, 125);
  const caretOn = f >= 2 * BEAT + 8 && f < 76 && Math.floor(f / 8) % 2 === 0;
  const drift = interpolate(f, [0, 180], [1, 1.03]);
  return (
    <AbsoluteFill style={{ background: T.paper }}>
      <div
        style={{
          position: 'absolute',
          left: MARGIN,
          top: 640,
          fontSize: size,
          lineHeight: 0.98,
          letterSpacing: '-0.035em',
          color: T.ink,
          transform: `scale(${drift})`,
          transformOrigin: '0 50%',
          ...axes(100, 800),
        }}
      >
        {f < 90 ? (
          <>
            <div>
              <Mask at={0} out={78} style={word}>
                Type
              </Mask>
              <Mask at={BEAT} out={79}>
                a
              </Mask>
            </div>
            <div>
              <Mask at={2 * BEAT} out={80}>
                prompt.
              </Mask>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: size * 0.82,
                  marginLeft: 14,
                  background: T.accent,
                  verticalAlign: 'top',
                  marginTop: size * 0.1,
                  opacity: caretOn ? 1 : 0,
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <Mask at={6 * BEAT} style={word}>
                Get
              </Mask>
              <Mask at={7 * BEAT}>a</Mask>
            </div>
            <div>
              <Mask at={8 * BEAT}>
                <span style={{ ...axes(wdth, 800), color: T.ink }}>video.</span>
              </Mask>
            </div>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 3 Library (ink) — the drop                                          */
/* ------------------------------------------------------------------ */

const TILE_W = 280;
const TILE_H = 498;
const GAP = 24;

const Column: React.FC<{ clips: string[]; x: number; speed: number; offset: number; delay: number }> = ({
  clips,
  x,
  speed,
  offset,
  delay,
}) => {
  const f = useCurrentFrame();
  const y = offset + f * speed;
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', flexDirection: 'column', gap: GAP }}>
      {clips.map((c, i) => {
        const r = ease(f, delay + i * 2, delay + i * 2 + 16, 100, 0);
        return (
          <div
            key={c + i}
            style={{
              width: TILE_W,
              height: TILE_H,
              borderRadius: 4,
              overflow: 'hidden',
              outline: `1px solid ${T.line}`,
              background: T.surface,
              clipPath: `inset(${r}% 0 0 0)`,
            }}
          >
            <Video src={staticFile(`clips/${c}.mp4`)} trimBefore={24} muted loop objectFit="cover" style={{ width: '100%', height: '100%' }} />
          </div>
        );
      })}
    </div>
  );
};

export const LibraryScene: React.FC<{ clips: string[] }> = ({ clips }) => {
  const cols = [0, 1, 2].map((k) => clips.filter((_, i) => i % 3 === k));
  return (
    <AbsoluteFill style={{ background: T.ink }}>
      <AbsoluteFill
        style={{
          maskImage: 'linear-gradient(180deg, transparent 520px, black 640px, black 1500px, transparent 1660px)',
        }}
      >
        <Column clips={[...cols[0]!, ...cols[0]!]} x={MARGIN} speed={-0.9} offset={560} delay={0} />
        <Column clips={[...cols[1]!, ...cols[1]!]} x={MARGIN + TILE_W + GAP} speed={0.7} offset={-1100} delay={3} />
        <Column clips={[...cols[2]!, ...cols[2]!]} x={MARGIN + 2 * (TILE_W + GAP)} speed={-0.6} offset={430} delay={6} />
      </AbsoluteFill>
      <Headline lines={[`${clips.length} templates,`, 'ready to edit.']} at={4} top={262} size={104} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 5 Formats (paper)                                                   */
/* ------------------------------------------------------------------ */

const FORMATS = [
  { key: '916', dims: '1080 × 1920', use: 'Reels and Stories', w: 461, h: 820 },
  { key: '11', dims: '1080 × 1080', use: 'Feed posts', w: 700, h: 700 },
  { key: '169', dims: '1920 × 1080', use: 'YouTube and the web', w: 888, h: 500 },
];

export const FormatsScene: React.FC = () => {
  const f = useCurrentFrame();
  // each size holds 2 s; morphs land on the downbeats at 32.0 and 34.0
  const marks = [60, 120];
  const seq = [0, 1, 2];
  let seg = 0;
  for (const m of marks) if (f >= m) seg++;
  const prev = FORMATS[seq[Math.max(0, seg - 1)]!]!;
  const cur = FORMATS[seq[seg]!]!;
  const s0 = seg === 0 ? -100 : marks[seg - 1]!;
  const k = ease(f, s0, s0 + 16, 0, 1, inOut);
  const w = prev.w + (cur.w - prev.w) * k;
  const h = prev.h + (cur.h - prev.h) * k;
  const cx = W / 2;
  const cy = 1040;
  const enter = ease(f, 0, 20, 0, 1);
  const tick = 22;
  const lab = ease(f, s0, s0 + 12, 1, 0);
  return (
    <AbsoluteFill style={{ background: T.paper }}>
      <Headline lines={['One template,', 'every size.']} at={2} top={262} size={104} color={T.ink} />
      <div
        style={{
          position: 'absolute',
          left: cx - w / 2,
          top: cy - h / 2,
          width: w,
          height: h,
          overflow: 'hidden',
          background: T.ink,
          clipPath: `inset(${(1 - enter) * 100}% 0 0 0)`,
        }}
      >
        {FORMATS.map((fm, i) => (
          <div
            key={fm.key}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: fm.key === cur.key ? Math.min(1, k * 2) : fm.key === prev.key ? 1 - Math.min(1, k * 2) : 0,
            }}
          >
            {/* each clip starts fresh at its own segment, inside the template's held section */}
            <Sequence from={i === 0 ? 0 : marks[i - 1]!} layout="none">
              <Video src={staticFile(`clips/formats/${fm.key}.mp4`)} trimBefore={30} muted objectFit="cover" style={{ width: '100%', height: '100%' }} />
            </Sequence>
          </div>
        ))}
      </div>
      {/* crop ticks outside the frame corners */}
      <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
        {[
          [cx - w / 2, cy - h / 2, -1, -1],
          [cx + w / 2, cy - h / 2, 1, -1],
          [cx - w / 2, cy + h / 2, -1, 1],
          [cx + w / 2, cy + h / 2, 1, 1],
        ].map(([x, y, dx, dy], i) => (
          <g key={i} stroke={T.ink} strokeWidth={2} opacity={enter}>
            <line x1={x! + dx! * 8} y1={y} x2={x! + dx! * (8 + tick)} y2={y} />
            <line x1={x} y1={y! + dy! * 8} x2={x} y2={y! + dy! * (8 + tick)} />
          </g>
        ))}
      </svg>
      <div
        style={{
          position: 'absolute',
          left: cx - w / 2,
          top: cy + h / 2 + 44,
          width: Math.max(w, 600),
          color: T.ink,
          opacity: enter,
        }}
      >
        <div style={{ fontSize: 56, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', ...axes(100, 700), transform: `translateY(${lab * 30}px)`, opacity: 1 - lab }}>
          {cur.dims}
        </div>
        <div style={{ fontSize: 36, color: T.dimOnPaper, marginTop: 6, ...axes(100, 450), opacity: 1 - lab }}>{cur.use}</div>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 7 End card (paper)                                                  */
/* ------------------------------------------------------------------ */

export const EndScene: React.FC = () => {
  const f = useCurrentFrame();
  const wdth = ease(f, 0, 26, 62, 112);
  const logo = ease(f, 0, 18, 0, 1);
  const fade = interpolate(f, [150, 168], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: T.paper }}>
      <div style={{ position: 'absolute', left: MARGIN, top: 560 }}>
        <div
          style={{
            width: 112,
            height: 112,
            borderRadius: 18,
            background: T.accent,
            transform: `scale(${logo})`,
            transformOrigin: '0 100%',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: MARGIN - 6,
          top: 716,
          fontSize: 164,
          lineHeight: 0.96,
          letterSpacing: '-0.035em',
          color: T.ink,
          whiteSpace: 'nowrap',
          ...axes(wdth, 820),
        }}
      >
        <div>
          <Mask at={2}>Motion</Mask>
        </div>
        <div>
          <Mask at={5}>Studio</Mask>
        </div>
      </div>
      <Sub text="Describe it. Get a finished motion graphic." at={30} top={1080} color={T.dimOnPaper} />
      <div style={{ position: 'absolute', left: MARGIN, top: 1220 }}>
        <Mask at={60}>
          <div
            style={{
              display: 'inline-block',
              padding: '24px 40px',
              background: T.ink,
              color: T.paper,
              borderRadius: 4,
              fontSize: 44,
              ...axes(100, 650),
            }}
          >
            Link in bio
          </div>
        </Mask>
      </div>
      <AbsoluteFill style={{ background: T.paper, opacity: fade }} />
    </AbsoluteFill>
  );
};

export { expoOut };
