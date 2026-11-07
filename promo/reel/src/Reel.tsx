import React from 'react';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { Grain, T, ViewerChrome, WipeIn, fontFamily } from './ui';
import { EndScene, FormatsScene, HookScene, LibraryScene } from './scenes';
import { PaletteScene, PromptScene, RenderScene } from './uiScenes';

/** Real renders from the Motion Studio engine (public/clips/<id>.mp4). */
export const CLIPS = [
  'product_reveal_v1',
  'sale_burst_v1',
  'stat_counter_v1',
  'testimonial_v1',
  'countdown_v1',
  'logo_sting_v1',
  'kinetic_text_v1',
  'promo_card_v1',
  'quote_card_v1',
  'title_sequence_v1',
  'new_post_v1',
  'event_announcement_v1',
  'bar_chart_v1',
  'milestone_v1',
  'breaking_news_v1',
  'lower_third_v1',
  'banner_v1',
];

/** v3 timeline in seconds (see promo/STORYBOARD-v3.md). 30 fps. */
const S = (s: number) => Math.round(s * 30);
const WIPE = 15; // playhead wipe, half a beat

const SCENES = {
  hook: [0, 6],
  prompt: [6, 16],
  library: [16, 22],
  palette: [22, 30],
  formats: [30, 36],
  render: [36, 44],
  end: [44, 50],
} as const;

const isDark = (f: number) => (f >= S(5.75) && f < S(29.75)) || (f >= S(35.75) && f < S(43.75));

const Chrome: React.FC = () => {
  const f = useCurrentFrame();
  return <ViewerChrome dark={isDark(f)} />;
};

/** Scene that is revealed by the playhead wipe ending exactly on its start time. */
const Wiped: React.FC<{ name: string; span: readonly [number, number]; children: React.ReactNode }> = ({ name, span, children }) => (
  <Sequence name={name} from={S(span[0]) - WIPE} durationInFrames={S(span[1] - span[0]) + WIPE}>
    <WipeIn dur={WIPE}>{children}</WipeIn>
  </Sequence>
);

const Cut: React.FC<{ name: string; span: readonly [number, number]; children: React.ReactNode }> = ({ name, span, children }) => (
  <Sequence name={name} from={S(span[0])} durationInFrames={S(span[1] - span[0])}>
    {children}
  </Sequence>
);

export const Reel: React.FC = () => (
  <AbsoluteFill style={{ fontFamily, background: T.ink }}>
    <Cut name="1 Hook" span={SCENES.hook}>
      <HookScene />
    </Cut>
    <Wiped name="2 Prompt" span={SCENES.prompt}>
      <PromptScene />
    </Wiped>
    <Cut name="3 Library" span={SCENES.library}>
      <LibraryScene clips={CLIPS} />
    </Cut>
    <Cut name="4 Palette" span={SCENES.palette}>
      <PaletteScene />
    </Cut>
    <Wiped name="5 Formats" span={SCENES.formats}>
      <FormatsScene />
    </Wiped>
    <Wiped name="6 Render" span={SCENES.render}>
      <RenderScene />
    </Wiped>
    <Wiped name="7 End" span={SCENES.end}>
      <EndScene />
    </Wiped>
    <Chrome />
    <Grain />
    <Audio src={staticFile('audio/mix3.wav')} />
  </AbsoluteFill>
);
