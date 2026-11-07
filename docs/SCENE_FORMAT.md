# Scene format `mg-scene@1`

A scene is a JSON document that describes an animated template as **data**. The engine
interprets it with the same `renderFrame` used for code templates, so studio preview, export,
parity and determinism guarantees all carry over. Scenes are what humans author for the
template library, what users will save ("save as template"), and what AI generation will
produce later — so the format must be strict, validated, and produce readable errors.

Non-goals for v1: arbitrary paths/SVG, filters/blur, blend modes, audio, 3D, scripting.

## Top level

```jsonc
{
  "format": "mg-scene@1",
  "id": "lower_third_v1",            // /^[a-z][a-z0-9_]{2,47}$/, unique across all templates
  "name": "Lower Third",
  "description": "Name and title bar that slides in over footage.",
  "category": "broadcast",           // social | promo | broadcast | typography | data | event
  "defaultSettings": { "width": 1920, "height": 1080, "fps": 30, "durationFrames": 180, "transparent": true },
  "fonts": ["Inter Variable"],       // only families bundled in packages/engine/src/fonts.ts
  "params": [ /* ParamDef[] — exactly the engine's existing ParamDef type */ ],
  "background": "#0F172A",           // Fill | null. Not painted when settings.transparent is true.
  "layers": [ /* Layer[], painted in order (first = bottom) */ ]
}
```

## Values and bindings

Any property marked *bindable* accepts a literal **or** a param binding:

- `{ "param": "primaryColor" }` — the current value of that param (type must fit the property).
- Colors additionally accept `{ "param": "primaryColor", "alpha": 0.4 }` and `{ "mix": [Color, Color], "t": 0.5 }`.
- Strings in `text` interpolate params: `"{{headline}}"`, and support `|upper`, `|lower`:
  `"{{headline|upper}}"`. Unknown param names are validation errors.
- **Number transforms** (anywhere a number or Length may bind a number param):
  `{ "param": "value1", "map": { "in": [0, 100], "out": [0, 40] }, "clamp": true }` maps the param
  linearly from `in` onto `out` (extrapolates unless `clamp`); `{ "param": "value1", "ofMax":
  ["value1", "value2", "value3"], "out": [0, 40], "clamp"?: true }` maps `value1 / max(listed params)`
  onto `out` (charts auto-scale to their largest value). `out` values are in the property's unit:
  for a Length they follow the literal Length rules (`"out": ["0%h", "40%h"]`; numbers = % of vmin).
- **Select cases** (any bindable property: colors, fills, numbers, Lengths, `text`/`prefix`/`suffix`
  strings and a motion's `preset`): `{ "param": "style", "cases": { "bold": <value>, "minimal":
  <value> }, "default": <value> }`. Case keys must be options of that select param; every option needs
  a case unless `default` is given. Case values are any value valid for the property except another
  `cases` (no nesting).

**Color**: `#RRGGBB` | `#RRGGBBAA` | binding.
**Fill**: Color | `{ "linear": { "angle": 135, "stops": [[0, Color], [1, Color]] } }`
| `{ "radial": { "cx": "50%w", "cy": "50%h", "r": 60, "stops": [[0, Color], [1, Color]] } }`.

**Length** (all positions and sizes; keeps scenes responsive across 9:16 / 1:1 / 16:9 / 3:1):
- number → percent of `vmin` (= min(width, height)); `10` = 10% of the short side;
- string with unit: `"50%w"` (of width), `"40%h"` (of height), `"12vmin"`, `"24px"` (output pixels).
Positions are measured from the canvas top-left. Negative values are allowed (off-canvas).

**Time**: seconds (number). Layer times are relative to the scene start; keyframe times are
relative to the layer's `start`. `"end"` and `"end-0.5"` refer to the scene end (duration in s).

## Layer (common fields)

```jsonc
{
  "id": "title",                     // unique within the scene, /^[a-z][a-zA-Z0-9_-]{0,39}$/
  "type": "text",                    // text | rect | ellipse | polygon | image | counter | group
  "start": 0.2, "end": "end",        // visible window (default whole scene)
  "x": "8%w", "y": "78%h",           // Length; anchor point position
  "anchor": [0, 0.5],                // [ax, ay] in the layer's own box, default [0.5, 0.5]
  "rotation": 0, "scale": 1, "opacity": 1,
  "visibleIf": { "param": "showLogo" },  // optional boolean/image param gate; add "not": true to invert
  "enter": Motion, "exit": Motion,   // optional presets (below)
  "keyframes": { "x": [Keyframe…], "opacity": [Keyframe…] },   // optional, per animatable prop
  "ambient": [{ "prop": "rotation", "amplitude": 3, "period": 4, "phase": 0 }]  // optional sine motion
}
```

Animatable props: `x`, `y`, `rotation`, `scale`, `scaleX`, `scaleY`, `opacity`, and per type:
`width`, `height`, `radius` (rect), `progress` (counter, text `reveal`), `fill` colors are not
animatable in v1. Composition order per frame: base value → keyframes (replace) → enter/exit
preset (multiplies opacity/scale, offsets x/y, applies clip) → ambient (adds).

**Keyframe**: `{ "t": 0.4, "v": "12%w", "ease": "outCubic" }`. Value at time t: before the first
keyframe → first value; after the last → last value; between → eased interpolation using the
*destination* keyframe's `ease`. Ease names: `linear`, `in|out|inOut` × `Quad|Cubic|Quart|Expo|Back`,
`outElastic`, or `{ "cubicBezier": [x1, y1, x2, y2] }`.

## Motion presets (`enter` / `exit`)

```jsonc
{ "preset": "rise", "duration": 0.6, "delay": 0, "ease": "outCubic",
  "distance": 6,                                 // Length, for move presets
  "stagger": { "by": "word", "each": 0.06 } }    // text/counter only: char | word | line
```

Presets: `fade`, `rise`, `drop`, `slide-left`, `slide-right`, `pop` (scale overshoot), `scale-in`,
`mask-up` (each unit rises from behind a clip of its own line box), `wipe-right` / `wipe-left`
(rect clip reveal), `typewriter` (text: units appear one by one, no movement), `blur-in` is NOT
available. `enter` runs from `start`; `exit` runs so it ends at `end` (mirrored motion). With
`stagger`, each unit's window is offset by `index * each`; total duration = duration + (n-1)*each.

## Layer types

- **text**: `text` (string with `{{param}}`), `font: { family, weight, size: Length, lineHeight?:
  1.1, letterSpacing?: em, italic? }`, `color: Color`, `align: left|center|right`,
  `maxWidth?: Length` (wraps by words), `maxLines?`, `autoFit?: { minSize: Length }` (shrinks to fit
  maxWidth × maxLines), `background?: { fill, padding: Length, radius: Length }` (pill/box behind text).
- **rect**: `width`, `height`, `radius?`, `fill?: Fill`, `stroke?: { color, width: Length, dash?: [Length, Length] }`.
- **ellipse**: `width`, `height`, `fill?`, `stroke?`.
- **polygon**: `sides` (3–12), `radius: Length`, `innerRadius?: Length` (makes a star with `sides` points), `fill?`, `stroke?`.
- **image**: `src: { "param": "logoUrl" }` (image params only), `width`, `height`, `fit: contain|cover`,
  `radius?`. Skipped silently when the param is null/empty.
- **counter**: animated number. `from`, `to` (number, bindable to number params), `decimals?: 0`,
  `step?` (> 0: the shown value moves from `from` toward `to` in whole steps, e.g. `1` for a countdown),
  `prefix?`, `suffix?` (strings with `{{param}}`), `separator?: ","`, plus the text font/color fields.
  Its `progress` (0→1) is driven by `count: { duration, delay?, ease? }` relative to `start`.
- **group**: `layers: Layer[]`; its transform/opacity/enter/exit apply to all children
  (children positions are relative to the group's x/y). Max nesting depth 4.
  `timing?: "absolute" | "relative"`: with `"relative"`, numeric child `start`/`end` count from the
  group's start (see Implementation notes → Time).

## Limits (validation errors when exceeded)

≤ 64 layers in total (including nested), ≤ 32 keyframes per property, nesting depth ≤ 4,
text ≤ 500 chars after interpolation is not checked at validation (param `maxLength` covers it),
scene JSON ≤ 64 KB, `durationFrames` within engine `LIMITS`.

## Validation and errors

`validateScene(input: unknown) → { ok: true, scene } | { ok: false, errors: SceneError[] }` where
`SceneError = { path: string /* JSON pointer, e.g. /layers/3/enter/preset */, message: string }`.
Messages must be specific and actionable ("unknown preset 'zoom'; expected one of fade, rise, …")
because they will be fed back to an AI model for self-repair in a later phase. Validation also
checks that every `{param}` binding / `{{name}}` refers to a declared param of a compatible type,
that fonts are bundled, and that ids are unique.

## Determinism

The interpreter is a pure function of (scene, frame, settings, values, loaded assets). No
randomness, clocks, timers, or caches whose contents affect output. Text layout may be memoized
only by a key that includes every input that affects it.

## Implementation notes (engine v1 decisions)

The engine implements this spec in `packages/engine/src/scene/` (`validate.ts`, `interpret.ts`).
Where the text above was ambiguous, these rules apply; they are binding for authors.

**Bundling and tooling**
- Bundled scenes are `packages/engine/src/scenes/<id>.json`, listed in `src/scenes/index.ts`. They
  are registered after the code templates; an invalid scene or a duplicate template id throws at
  import time with every error listed (the app does not start).
- Check your work visually: from `packages/engine`, run
  `npx tsx scripts/contact-sheet.ts <templateId|--scenes|--all> [--logo] [--transparent|--opaque] [--frames a,b,c] [--cell 360] [--set key=value …]`.
  It renders 9:16, 1:1, 16:9 and 3:1 × 6 frames with the real bundled fonts into
  `packages/engine/output/<id>.png` (checkerboard behind transparent cells). `--logo` fills image
  params with a sample logo; `--frames` picks exact frames (e.g. the intro); `--set` overrides param
  values (e.g. `--set startAt=10`) and adds them to the file name.

**Validation**
- Unknown properties are errors everywhere (catches typos). Required: `format`, `id`, `name`,
  `description` (may be empty), `category`, `defaultSettings` (all 5 fields), `fonts` (non-empty),
  `params`, `layers` (non-empty; groups too).
- Extra limits: name ≤ 80 chars, description ≤ 300, ≤ 40 params, literal `text` ≤ 500 chars,
  `prefix`/`suffix` ≤ 40, `separator` ≤ 3, `maxLines` 1–20, `decimals` 0–6, ≤ 8 ambient entries,
  gradients 2–8 stops with non-decreasing offsets, keyframe times strictly increasing. Top-level
  layers are depth 1; layers deeper than 4 are rejected.
- Params follow the engine `ParamDef` exactly (key `/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/`, unique; defaults
  must satisfy their own constraints). Font weights must exist in the family (`Anton` is 400 only);
  a font used by a layer must also be listed in `/fonts` so it is preloaded.
- Scene-id uniqueness across templates is checked at registration, not by `validateScene`.

**Bindings**
- Bindable: every Length (number params, read as percent of vmin), every Color (color params), and
  the numbers `rotation`, `scale`, `scaleX`, `scaleY`, `opacity`, text `progress`, counter
  `from`/`to` and keyframe `v` (number params). Everything else is literal.
- Number-param bindings take three shapes: plain `{ "param" }` (a Length reads it as percent of vmin),
  `{ "param", "map": { "in": [a, b], "out": [c, d] }, "clamp"? }` and
  `{ "param", "ofMax": [keys], "out": [c, d], "clamp"? }`. `in` values must differ; `out` holds exactly
  two literal values of the property (Lengths: numbers or unit strings, mixed units allowed, each
  resolved to px before interpolating; numbers: within the property's literal range, e.g. opacity
  0–1). `ofMax` lists 1–16 distinct number params; the ratio is `param / max(listed)`, or 0 when that
  max is ≤ 0. The bound param does not have to be in the list (then the ratio can exceed 1; use
  `clamp`). `clamp` clamps the ratio to 0–1, i.e. the result to the `out` range.
- Select cases: `{ "param": "<select>", "cases": {...}, "default"? }`. Accepted for every Length,
  Color, Fill (gradient fills as case values are fine), bindable number, keyframe `v`, text `text`,
  counter `prefix`/`suffix`, and `enter.preset`/`exit.preset` (each case is checked like a literal
  preset for that layer type, e.g. no `typewriter` on shapes). Values cannot be cases again. A case
  value may itself be a binding (`{ "param": "accent" }`, a `map`, …). At render time an unknown option
  falls back to `default`, then to the case of the select's declared default. To show/hide a layer by a
  select, use cases on `opacity` (`0` hides it).
- `{{name}}` interpolates text, select and number params (numbers via `String(n)`).
- `visibleIf` accepts a boolean param, or an image param (visible when an image is set);
  `"not": true` inverts it (`{ "param": "logoUrl", "not": true }` = only without a logo). Use it for
  fallbacks instead of covering them with a plate.
- `{ "mix": [a, b], "t" }`: `t` is a literal 0–1; mixes nest at most 3 levels.

**Lengths and fills**
- Inside a Fill (`radial` `cx`/`cy`/`r`), Lengths resolve against the filled box (the layer's own
  box; the canvas for `background`), so `"50%w"` is the box centre and `50` is half its short side.
- `linear.angle` uses CSS degrees: 0 = bottom→top, 90 = left→right, 180 = top→bottom; the gradient
  spans the filled box.

**Time**
- `"end"` is the timestamp of the last frame, `(durationFrames − 1) / fps`, so exits finish exactly
  on the last frame and it is clean. A layer is visible for `start ≤ t ≤ end`; group children are
  also limited to the group's window.
- Group timing: by default (`"timing": "absolute"`) group children use scene-absolute times. With
  `"timing": "relative"` on a group, a child's numeric `start`/`end` are seconds after the group's
  (resolved) start, and a missing child `start` means the group's start. `"end"` / `"end-x"` always
  mean the scene end. Keyframe times stay relative to the child's own start. The setting is inherited
  by nested groups (their children are relative to *their own* start) until a nested group sets
  `timing` itself; top-level layers are absolute.
- `rotation` is in degrees (clockwise). `anchor` values are 0–1.

**Composition order** (deviation from the order above): base → keyframes → ambient → preset. The
preset multiplies the already-modulated opacity/scale (and offsets x/y), so a layer is fully
invisible before its enter and after its exit even with ambient opacity/scale. Keyframe default
ease: `linear`. **Ambient**: `value += amplitude · sin(2π · (t_layer / period + phase))`; `phase` is a
fraction of a cycle; `amplitude` is a Length for x/y/width/height/radius, degrees for rotation, a
plain number otherwise. Animatable `radius` also covers polygon and image.

**Presets** (p = eased progress, 1 = at rest; defaults: `duration` 0.6, `delay` 0, `ease`
`outCubic` (`outBack` for `pop`), `distance` 6 for rise/drop, 10 for slides):
- `fade` opacity · `rise` from below, `drop` from above (both fade) · `slide-left` moves leftwards
  into place (comes from the right), `slide-right` comes from the left (both fade) · `pop` scale 0→1
  with overshoot and a quick fade · `scale-in` scale 0.6→1 + fade · `mask-up` clipped rise, no fade ·
  `wipe-right` reveals left→right, `wipe-left` right→left · `typewriter` each unit appears instantly.
- `exit` is the enter played backwards in time and ends `delay` seconds before `end`. With stagger
  the last unit leaves first (an exact mirror; typewriter "backspaces").
- Units: `stagger.by`, else `typewriter` → `char` with `each = duration / chars`, `mask-up` → `line`
  (each line rises from behind its own line box, all at once), others → the whole layer.
  Characters are non-space glyphs.
- A text `background` follows the first unit's motion, applied to the whole box.
- `typewriter` is text/counter only; `mask-up`/`wipe-*` are not allowed on groups (a group has no
  box). Group scale presets pivot on the group's (x, y).
- Scale presets (`pop`, `scale-in`) pivot on the layer's anchor point — the same point `scale` and
  `rotation` use — for every layer type, so a text and a rect with the same preset, timing and anchor
  grow identically (a wordmark stays inside its plate). Text/counter motions with per-unit units
  (`stagger`, `mask-up` lines, `typewriter` chars) scale each unit's glyphs around that unit's own centre
  instead, so the block grows unevenly by design; a text `background` always scales around the anchor.

**Layer details**
- Box and anchor: text = laid-out block plus background padding (`padding` may be `[h, v]`);
  counter = one line as wide as the wider of the `from` and `to` values (digits use fixed-width
  cells so counting does not jitter; `align` positions the text in that box); rect/ellipse/image =
  width × height; polygon = 2r × 2r (first vertex points up); group = no box, pivot at its (x, y),
  `anchor` ignored.
- Text: empty text (after interpolation, trimmed) draws nothing, including the background. Without
  `maxWidth` lines only break at `\n`. `autoFit` requires `maxWidth`; it shrinks the font (down to
  `minSize`) until every word fits the width and the line count fits `maxLines`. Lines beyond
  `maxLines` are cut and the last kept line ends in `…`. Text `progress` (0–1, default 1) is the
  fraction of characters drawn. A fully transparent `color` skips the glyphs: with a `background`
  this makes a content-sized bar (see `lower_third_v1`).
- Counter: `count` defaults to `{ "duration": 1.5, "ease": "outCubic" }`; `keyframes.progress`
  replaces it. `step` (> 0) shows `from + k·step` for the largest whole `k` the count has reached
  (floor toward `to`; a countdown 5→0 with `step: 1` shows 5 until the value reaches 4, …) and exactly
  `to` once progress is 1; with a linear `count` the steps are evenly spaced
  (`count.duration / (|to − from| / step)` apart). `from`/`to` bind number params (also `map`/`ofMax`/
  cases). The decimal point is always `.`; `separator` defaults to `","` (`""` disables); no
  `-0`. Counters do not wrap or auto-fit: size the font for the largest expected value.
- Image: `contain` places the image inside its box at the anchor (`[0, 1]` = bottom-left); `radius`
  rounds the drawn image. `cover` crops to the box.
- rect/ellipse/polygon need a `fill` and/or `stroke` (validation error otherwise). Strokes are
  centred on the outline with round joins; `dash` = [dash, gap].
