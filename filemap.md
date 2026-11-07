# File map

package.json — root workspaces + scripts (dev, typecheck, test, build)
.npmrc — script-shell = Git bin/bash.exe (path contains `&`; do not change)
tsconfig.base.json — shared compiler options extended by every workspace
.prettierrc / .editorconfig — formatting
.gitignore — ignores node_modules, dist, output/, storage/, *.sqlite, .env
.env.example — every env var with defaults; copy to .env (gitignored, loaded by the API at startup)
.claude/launch.json — preview server configs for agents (studio, api; api-mock on :3002 with MG_GENERATOR=mock + STORAGE_DIR=storage/mock, studio-mock on :5174 proxying to it via MG_API_TARGET)
docs/SPEC.md — original spec + implementation notes
docs/SCENE_FORMAT.md — mg-scene@1 scene format spec + engine implementation notes

packages/engine/ — deterministic canvas renderer shared by studio and worker
packages/engine/src/index.ts — public exports
packages/engine/src/types.ts — engine contract (templates, payload, params) + determinism rules
packages/engine/src/core.ts — renderFrame (single draw entry), asset preloading, payload helpers
packages/engine/src/math.ts — clamp, easing, interpolation, colors, seeded RNG (createRng)
packages/engine/src/draw.ts — canvas drawing primitives (rounded rects etc.)
packages/engine/src/text.ts — text measuring / layout
packages/engine/src/fonts.ts — side-effect import registering bundled @font-face (`@mg/engine/fonts`)
packages/engine/src/templates/index.ts — bundled template list (code templates + bundled scenes); register new templates here
packages/engine/src/registry.ts — listTemplates/getTemplate over bundled + runtime templates; registerScene/unregisterTemplate for generated `gen_…` scenes (GENERATED_ID_PATTERN)
packages/engine/src/templates/kinetic_text.ts — kinetic_text_v1
packages/engine/src/templates/promo_card.ts — promo_card_v1
packages/engine/src/templates/banner.ts — banner_v1
packages/engine/src/templates/shared.ts — helpers shared between templates
packages/engine/src/limits.ts — LIMITS (sizes, fps, max duration); re-exported by core
packages/engine/src/fontFamilies.ts — FONT_FAMILIES + per-family weight ranges (no side effects)
packages/engine/src/scene/types.ts — mg-scene@1 types (Scene, Layer, Motion, Keyframe, Length, Color, Fill), SCENE_CATEGORIES
packages/engine/src/scene/validate.ts — validateScene: strict validator with JSON-pointer paths + actionable messages
packages/engine/src/scene/interpret.ts — scene interpreter (lengths, bindings, keyframes, presets, layers) + templateFromScene
packages/engine/src/scene/registry.ts — loadSceneTemplates: validates bundled scenes, throws on errors / duplicate ids
packages/engine/src/scene/index.ts — scene module exports (incl. helpers used by tests)
packages/engine/src/scenes/ — bundled scene JSON (14 scenes); index.ts + batchA.ts/batchB.ts list them — add new scenes there
packages/engine/src/palette/ — palette module (pure, deterministic): extract.ts (extractPalette: OKLab k-means over image pixels), roles.ts (colorRole: background/foreground/accent heuristics), apply.ts (applyPalette: palette → template color params with contrast/pair constraints + variants; paletteSignature), color.ts (internal OKLab/OKLCH/gamut/WCAG math), types.ts
packages/engine/scripts/contact-sheet.ts — `npx tsx scripts/contact-sheet.ts <id|--scenes|--all>` → output/<id>.png (4 aspects × 6 frames, real fonts); `--palette "#hex,#hex:0.5"` + `--variant n` apply applyPalette first
packages/engine/output/ — contact sheets (gitignored)
packages/engine/test/ — vitest: core, determinism (@napi-rs/canvas), math, registry (runtime scenes), scene.validate, scene.interpret, scene.features, palette (extraction, roles, mapping over all templates × palettes × variants)

packages/contract/src/index.ts — HTTP + Socket.io types and ASSET_URL_PATTERN; change first when the API shape changes

apps/worker/ — headless render: Puppeteer + FFmpeg
apps/worker/render-page/ — index.html + main.ts loaded in Chromium, driven via window.__mg
apps/worker/vite.render.config.ts — builds render-page into dist/render-page (auto-rebuilt when stale)
apps/worker/src/index.ts — package exports used by the API
apps/worker/src/render.ts — render orchestration: page frames → encoder; `opts.scene` registers a generated scene in Node and in the render page
apps/worker/src/browser.ts — Chromium launch / page lifecycle
apps/worker/src/server.ts — local static server for the render page bundle
apps/worker/src/encoder.ts — FFmpeg process wrapper (mp4 / webm, alpha)
apps/worker/src/assets.ts — resolves /api/assets/<id> image params to data: URLs
apps/worker/src/security.ts — validation of image params / URL safety
apps/worker/src/child.ts — long-lived render child process forked by the API pool (registers the job's generated scene, unregisters after)
apps/worker/src/ipc.ts — parent ↔ child message protocol ('run' carries `scene` for gen_ templates)
apps/worker/src/cli.ts — `npm run render -w @mg/worker` entry (payload JSON may carry a top-level `scene`)
apps/worker/samples/ — example payload JSONs for the CLI
apps/worker/test/ — vitest: encoder, render, generated (gen_ scene via opts.scene), browser (recycling/leaks), determinism (byte-identical frames across jobs/browsers) (+ helpers.ts)
apps/worker/test/parity.test.ts, parity/ — studio ≡ render page (exact pixels), lossless pipeline round-trip, MP4/WebM PSNR floor
apps/worker/scripts/soak.ts — perf/soak harness (throughput, long render, recycle, concurrency, crash); results in docs/perf.md
docs/perf.md — measured throughput, memory, recycling and crash-recovery results

apps/api/ — Express 5 + Socket.io server on :3001
apps/api/src/index.ts — process entry: config, storage, queue, pool, listen
apps/api/src/env.ts — loads repo-root .env into process.env (imported first by index.ts; real env vars win)
apps/api/src/app.ts — Express routes (templates, asset upload, jobs, downloads, generate (NDJSON stream, max 2 concurrent), scenes keep/list/delete), sweeper (outputs, assets, 24 h drafts)
apps/api/src/scenes.ts — SceneStore: generated templates as storage/scenes/<id>.json (atomic writes), loaded + registered at startup (invalid files skipped), newSceneId
apps/api/src/generate/ — scene generator (prompt → validated mg-scene@1): index.ts (createGenerator from env, public types), claude.ts (ClaudeGenerator: streamed Messages call, submit_scene tool, validate → repair ≤ 2, error mapping, injectable client), prompt.ts (cached system prompt: spec + allowed values + design guidance + 3 example scenes; user/repair turns), scene.ts (force id/format/settings, validate, palette → color defaults, names), mock.ts (MockGenerator, MG_GENERATOR=mock), resources.ts (reads docs/SCENE_FORMAT.md + bundled scene JSON), types.ts
apps/api/src/config.ts — config values (ports, paths, secrets, limits)
apps/api/src/sockets.ts — Socket.io job progress events
apps/api/src/pool.ts — pool of worker child processes consuming the queue (attaches the scene of gen_ templates to the 'run' message)
apps/api/src/jobView.ts — job → API view mapping, retention/expiry checks
apps/api/src/queue/types.ts — JobQueue interface (swap point for BullMQ)
apps/api/src/queue/sqlite.ts — node:sqlite JobQueue implementation
apps/api/src/storage/types.ts — blob storage interface (S3 would plug in here)
apps/api/src/storage/local.ts — local-disk storage under storage/
apps/api/src/storage/signing.ts — HMAC-SHA256 signed download URLs
apps/api/test/ — vitest: api.test.ts, queue.test.ts, scenes.test.ts (generate endpoint with a fake generator, scenes CRUD/409, sweeper, startup reload, gen_ render); generate.generator.test.ts (generator unit tests with a fake Anthropic client: repair loop, palette, refine, abort, error mapping, mock)

apps/web/ — React 19 studio (Vite, :5173)
apps/web/vite.config.ts — Vite config + proxy to the API on :3001 (override with MG_API_TARGET)
apps/web/src/main.tsx, App.tsx — entry and app shell
apps/web/src/styles.css — all studio styles
apps/web/src/components/ — UI: Stage (canvas preview), Timeline, Inspector/ParamControl/NumField/Switch, TemplateList (Generate template button, search, "Your templates" group for generated ones with Draft tag + delete button, category groups, roving-focus keyboard nav, Delete key deletes a generated one) + TemplateThumb (lazy 72×72 preview, recolored by the reference palette), ReferencePalette (Inspector's first section: reference image → palette, Shuffle/Replace/Remove, apply-to-every-template switch), TopBar, JsonPanel, ExportDialog, GenerateDialog (prompt + reference image/palette + format/length → NDJSON step list → result: Keep/Refine/Try again/Discard; error + disabled/offline states), DeleteTemplateDialog (confirm + DELETE, 409 message), RendersPanel, Toast, Icons
apps/web/src/thumbnails.ts — template thumbnail scheduler: default payload at 60% duration, sequential + lazy, downscaled per DPR, cached per session per template + DPR + reference-palette key
apps/web/src/hooks/ — useAssets (preload images/fonts), usePlayback (playhead clock), useShortcuts (keyboard), useStudioTestHook (window.__studio for parity tests, only with ?mgtest=1)
apps/web/src/state/ — generated (registers kept generated templates from /api/scenes at startup, session drafts, version subscription for the library), store (payload + playhead; setAssets patches many params at once), referencePalette (subscribe store for the reference palette: localStorage `mg.referencePalette`, local image decode → extractPalette, apply on template switch, originals for Remove), renders (job list), storage (localStorage persistence), time (timecode)
apps/web/src/api/ — client.ts (HTTP; generate status/stream (fetch + NDJSON reader), scenes list/keep/delete), socket.ts (Socket.io job updates)
