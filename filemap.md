# File map

Where everything lives, and when to touch it. Paths are relative to the repo root.

- [Repo root](#repo-root)
- [Docs](#docs)
- [Engine — `packages/engine`](#engine--packagesengine)
- [Contract — `packages/contract`](#contract--packagescontract)
- [Render worker — `apps/worker`](#render-worker--appsworker)
- [API — `apps/api`](#api--appsapi)
- [Studio — `apps/web`](#studio--appsweb)
- [Promo reel — `promo`](#promo-reel--promo)

## Repo root

| Path | What it is |
|---|---|
| `package.json` | Workspaces and root scripts (`dev`, `typecheck`, `test`, `build`) |
| `.npmrc` | `script-shell` = Git `bin/bash.exe`, because the path contains `&`. Do not change |
| `tsconfig.base.json` | Shared compiler options, extended by every workspace |
| `.prettierrc`, `.editorconfig` | Formatting |
| `.gitignore` | `node_modules`, `dist`, `output/`, `storage/`, `*.sqlite`, `.env`, regenerable promo media |
| `.env.example` | Every env var with its default. Copy to `.env` (gitignored, loaded by the API at startup) |
| `.claude/launch.json` | Preview servers for agents: `studio`, `api`, plus `api-mock` (:3002, `MG_GENERATOR=mock`, `STORAGE_DIR=storage/mock`) and `studio-mock` (:5174, proxies to it via `MG_API_TARGET`) |

## Docs

| Path | What it is |
|---|---|
| `docs/SPEC.md` | Original product spec and implementation notes |
| `docs/SCENE_FORMAT.md` | The `mg-scene@1` scene format and engine implementation notes |
| `docs/perf.md` | Measured throughput, memory, recycling and crash-recovery results |

## Engine — `packages/engine`

Deterministic canvas renderer shared by the studio and the worker.

### Core

| Path | What it is |
|---|---|
| `src/index.ts` | Public exports |
| `src/types.ts` | Engine contract (templates, payload, params) and determinism rules |
| `src/core.ts` | `renderFrame` (the single draw entry), asset preloading, payload helpers |
| `src/registry.ts` | `listTemplates` / `getTemplate` over bundled and runtime templates; `registerScene` / `unregisterTemplate` for generated `gen_…` scenes |
| `src/limits.ts` | `LIMITS` (sizes, fps, max duration); re-exported by core |
| `src/math.ts` | Clamp, easing, interpolation, colors, seeded RNG (`createRng`) |
| `src/draw.ts` | Canvas drawing primitives |
| `src/text.ts` | Text measuring and layout |
| `src/fonts.ts` | Side-effect import that registers the bundled `@font-face` rules (`@mg/engine/fonts`) |
| `src/fontFamilies.ts` | `FONT_FAMILIES` and per-family weight ranges (no side effects) |

### Templates and scenes

| Path | What it is |
|---|---|
| `src/templates/index.ts` | Bundled template list (code templates + bundled scenes). Register new templates here |
| `src/templates/kinetic_text.ts`, `promo_card.ts`, `banner.ts` | The three code templates |
| `src/templates/shared.ts` | Helpers shared between code templates |
| `src/scenes/` | Bundled scene JSON (14 scenes), listed in `index.ts`, `batchA.ts`, `batchB.ts`. Add new scenes there |
| `src/scene/types.ts` | `mg-scene@1` types and `SCENE_CATEGORIES` |
| `src/scene/validate.ts` | `validateScene`: strict validator with JSON-pointer paths and actionable messages |
| `src/scene/interpret.ts` | Scene interpreter (lengths, bindings, keyframes, presets, layers) and `templateFromScene` |
| `src/scene/registry.ts` | `loadSceneTemplates`: validates bundled scenes, throws on errors or duplicate ids |
| `src/scene/index.ts` | Scene module exports |

### Palette — `src/palette/`

Pure, deterministic palette extraction and mapping.

| File | What it is |
|---|---|
| `extract.ts` | `extractPalette`: OKLab k-means over image pixels |
| `roles.ts` | `colorRole`: background / foreground / accent heuristics |
| `apply.ts` | `applyPalette`: palette → template color params with contrast constraints and variants; `paletteSignature` |
| `color.ts` | Internal OKLab / OKLCH / gamut / WCAG math |
| `types.ts` | Palette types |

### Scripts and tests

| Path | What it is |
|---|---|
| `scripts/contact-sheet.ts` | `npx tsx scripts/contact-sheet.ts <id\|--scenes\|--all>` → `output/<id>.png` (4 aspects × 6 frames). `--palette "#hex,#hex:0.5"` and `--variant n` apply a palette first |
| `output/` | Contact sheets (gitignored) |
| `test/` | Vitest: core, determinism, math, registry, scene.validate, scene.interpret, scene.features, palette |

## Contract — `packages/contract`

| Path | What it is |
|---|---|
| `src/index.ts` | HTTP and Socket.io types, `ASSET_URL_PATTERN`, generated-template types. Change this first when the API shape changes |

## Render worker — `apps/worker`

Headless rendering with Puppeteer and FFmpeg.

| Path | What it is |
|---|---|
| `render-page/` | `index.html` + `main.ts` loaded in Chromium, driven via `window.__mg` |
| `vite.render.config.ts` | Builds the render page into `dist/render-page` (auto-rebuilt when stale) |
| `src/index.ts` | Package exports used by the API |
| `src/render.ts` | Render orchestration: page frames → encoder. `opts.scene` registers a generated scene |
| `src/browser.ts` | Chromium launch and page lifecycle |
| `src/server.ts` | Local static server for the render page bundle |
| `src/encoder.ts` | FFmpeg process wrapper (MP4, WebM with alpha) |
| `src/assets.ts` | Resolves `/api/assets/<id>` image params to `data:` URLs |
| `src/security.ts` | Image param and URL safety checks |
| `src/child.ts` | Long-lived render child process forked by the API pool |
| `src/ipc.ts` | Parent ↔ child message protocol (`run` carries `scene` for `gen_` templates) |
| `src/cli.ts` | `npm run render -w @mg/worker` entry (payload JSON may carry a top-level `scene`) |
| `samples/` | Example payload JSONs for the CLI |
| `scripts/soak.ts` | Perf and soak harness; results in `docs/perf.md` |
| `test/` | Vitest: encoder, render, generated scenes, browser recycling, determinism |
| `test/parity.test.ts`, `test/parity/` | Studio ≡ render page (exact pixels), lossless round trip, MP4/WebM PSNR floor |

## API — `apps/api`

Express 5 + Socket.io server on :3001.

| Path | What it is |
|---|---|
| `src/index.ts` | Process entry: config, storage, queue, pool, generator, listen |
| `src/env.ts` | Loads the repo-root `.env` (imported first; real env vars win) |
| `src/app.ts` | Routes (templates, assets, renders, downloads, generate, scenes) and the sweeper (outputs, assets, 24 h drafts) |
| `src/scenes.ts` | `SceneStore`: generated templates in `storage/scenes/<id>.json`, loaded and registered at startup |
| `src/config.ts` | Config values (ports, paths, secrets, limits) |
| `src/sockets.ts` | Socket.io job progress events |
| `src/pool.ts` | Pool of worker child processes consuming the queue |
| `src/jobView.ts` | Job → API view mapping, retention and expiry checks |
| `src/queue/types.ts` | `JobQueue` interface (swap point for BullMQ) |
| `src/queue/sqlite.ts` | `node:sqlite` job queue |
| `src/storage/types.ts` | Blob storage interface (swap point for S3) |
| `src/storage/local.ts` | Local-disk storage under `storage/` |
| `src/storage/signing.ts` | HMAC-SHA256 signed download URLs |
| `test/` | Vitest: `api`, `queue`, `scenes` (endpoints with a fake generator), `generate.generator` (generator with a fake Anthropic client) |

### Scene generator — `src/generate/`

Prompt → validated `mg-scene@1` scene.

| File | What it is |
|---|---|
| `index.ts` | `createGenerator` (from env) and public types |
| `claude.ts` | `ClaudeGenerator`: streamed Messages call, `submit_scene` tool, validate → repair (max 2), error mapping |
| `prompt.ts` | Cached system prompt (spec, allowed values, design guidance, 3 example scenes) and user / repair turns |
| `scene.ts` | Forces id / format / settings, validates, applies palette to color defaults, picks names |
| `mock.ts` | `MockGenerator` for `MG_GENERATOR=mock` |
| `resources.ts` | Reads `docs/SCENE_FORMAT.md` and the bundled scene JSON |
| `types.ts` | Interfaces, `GenerateError`, abort helpers |

## Studio — `apps/web`

React 19 studio (Vite, :5173).

| Path | What it is |
|---|---|
| `vite.config.ts` | Vite config and API proxy to :3001 (override with `MG_API_TARGET`) |
| `src/main.tsx`, `src/App.tsx` | Entry and app shell |
| `src/styles.css` | All studio styles |
| `src/thumbnails.ts` | Library thumbnail scheduler: sequential, lazy, cached per template + DPR + palette |
| `src/api/client.ts` | HTTP client, including the generate NDJSON stream and scenes calls |
| `src/api/socket.ts` | Socket.io job updates |

### Components — `src/components/`

| File | What it is |
|---|---|
| `TemplateList.tsx` | Library rail: Generate button, search, "Your templates" group (Draft tag, delete), categories, keyboard nav |
| `TemplateThumb.tsx` | Lazy 72×72 template preview, recolored by the reference palette |
| `GenerateDialog.tsx` | Generate flow: compose → live steps → Keep / Refine / Try again / Discard; error, disabled and offline states |
| `DeleteTemplateDialog.tsx` | Confirm and delete a generated template (409 message while rendering) |
| `ReferencePalette.tsx` | Inspector's first section: reference image → palette, Shuffle / Replace / Remove |
| `Stage.tsx`, `Timeline.tsx` | Canvas preview and playhead |
| `Inspector.tsx`, `ParamControl.tsx`, `NumField.tsx`, `Switch.tsx` | Param editing |
| `ExportDialog.tsx`, `RendersPanel.tsx`, `Toast.tsx` | Export flow and render list |
| `TopBar.tsx`, `JsonPanel.tsx`, `Icons.tsx` | App chrome, payload JSON editor, icons |

### State and hooks

| Path | What it is |
|---|---|
| `src/state/store.ts` | Payload and playhead reducer (`setAssets` patches many params at once) |
| `src/state/generated.ts` | Registers kept generated templates from `/api/scenes`, tracks session drafts |
| `src/state/referencePalette.ts` | Reference palette store (localStorage `mg.referencePalette`), local image decode, apply on template switch |
| `src/state/renders.ts` | Render job list |
| `src/state/storage.ts` | localStorage persistence |
| `src/state/time.ts` | Timecode helpers |
| `src/hooks/` | `useAssets`, `usePlayback`, `useShortcuts`, `useStudioTestHook` (`window.__studio`, only with `?mgtest=1`) |

## Promo reel — `promo`

The 28 s Instagram Reel for Motion Studio. Rendered media is gitignored and rebuilt by the scripts.

| Path | What it is |
|---|---|
| `DESIGN.md`, `STORYBOARD.md`, `STORYBOARD-v3.md` | Design notes and storyboards |
| `payloads/` | Render payloads for the template clips |
| `scripts/` | Payload generation, clip rendering through the worker CLI (`render-all.cjs`), UI capture sequences |
| `audio-src/` | Code-generated soundtrack: render, master and verify steps (`.build*/` intermediates are gitignored) |
| `reel/` | Remotion project (`src/`), captured UI frames in `public/`; clips and audio in `public/` are gitignored, output in `out/` |
