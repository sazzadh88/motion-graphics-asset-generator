# Motion Studio Reel: design direction (v2)

Why v2: v1 read as a generic template (blurred gradient orbs, scale-slam text with shake, glowing rounded cards, all-caps eyebrows, middle-dot meta strings, an arrow on the CTA).

## Concept: "the viewer"
The reel is framed as if you are watching it inside Motion Studio's own viewer.
- Thin crop marks at the safe area, a running timecode and the frame size sit at the edges, like the studio's viewer chrome.
- Scene changes use the studio's own playhead: a 3 px accent line sweeps across the frame and wipes to the next scene.
- The real product UI is the hero. It is shown as pixel-accurate captures with slow camera pushes, a real pointer and real hover and press states.

## Colour (taken from the studio's CSS)
| Token | Hex | Role |
|---|---|---|
| ink | #0E0F11 | Studio background; dark scenes; type on paper |
| surface | #16181B | UI panels, window chrome |
| line | #2B2F35 | Hairlines and frame borders on dark |
| paper | #E6E8EB | Light scenes (the studio's text colour, flipped to a background) |
| dim | #9AA1AB | Secondary type |
| accent | #4C8DFF | Playhead, pointer ripple, the one thing that matters per beat (under 5 % of pixels) |
| ok | #4CC38A | The rendered/done state only |

There are no gradients. Colour in the frame comes from the templates themselves.

## Type
- Archivo variable (wdth 62–125, wght 100–900), one family.
  - Headlines: sentence case, left-aligned, wght 760, wdth 100, tracking -3 %, 96–120 px.
  - Hero moments (hook and end card): the width axis animates from 62 to 125. This is the one bold move, and it is motion-native.
  - Supporting text: wght 450, 40–44 px, dim.
  - Viewer chrome: tabular figures, 24 px, wght 500.
- No all-caps eyebrows, no middle-dot strings, no arrows on CTAs, no monospace labels.

## Layout
- A 1080×1920 canvas with a 96 px left margin, and text on a left-aligned column.
- The safe area runs from y = 250 to y = 1500.
- Headlines sit in the top third. Product UI or footage fills the middle. The lower 300 px is kept quiet for the Instagram caption overlay.

```
+----------------------------+
| ⌐ 1080×1920           ¬    |  viewer chrome
|                            |
|  Describe the              |  headline, left-aligned, masked line reveal
|  video you need.           |
|  +----------------------+  |
|  |  real UI, camera     |  |  product capture with a slow push
|  |  push + pointer      |  |
|  +----------------------+  |
|                            |
| L 00:00:05:12          ┘   |  timecode
+----------------------------+
```

## Motion
- Entrances use expo-out, cubic-bezier(0.16, 1, 0.3, 1), over 16–24 frames.
  - Text uses masked line reveals: each line rises 100 % of its height from behind a clip mask, staggered 3 frames.
- Camera moves use cubic-bezier(0.65, 0, 0.35, 1) over 18–40 frames.
  - At most two things move at once.
  - During holds, a 2–3 % scale drift keeps the frame alive.
- No blur slams, no shake, no glow.
- Fine film grain (about 5 %) sits over everything.
- Cuts land on the downbeats of the existing 120 BPM grid. The soundtrack cue times in STORYBOARD.md are unchanged.

## Review against generic defaults
- Removed: orbs, glows, all-caps step eyebrows, chips joined with middle dots, the CTA arrow, rounded-card kit (the studio's 4 px radius is used instead).
- Dark product scenes alternate with light "paper" type scenes, so it is not the near-black plus one acid accent default. The accent is the product's own blue, and it is rare.
