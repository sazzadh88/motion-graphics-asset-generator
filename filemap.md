# File map

package.json — root workspaces + scripts (dev, typecheck, test, build)
.npmrc — script-shell = Git bin/bash.exe (path contains `&`; do not change)
tsconfig.base.json — shared compiler options extended by every workspace
.prettierrc / .editorconfig — formatting
.gitignore — ignores node_modules, dist, output/, storage/, *.sqlite, .env
.claude/launch.json — preview server configs for agents
docs/SPEC.md — original spec + implementation notes

packages/engine/ — deterministic canvas renderer shared by studio and worker
packages/engine/src/index.ts — public exports
packages/engine/src/types.ts — engine contract (templates, payload, params) + determinism rules
packages/engine/src/core.ts — renderFrame (single draw entry), asset preloading, payload helpers
packages/engine/src/math.ts — clamp, easing, interpolation, colors, seeded RNG (createRng)
packages/engine/src/draw.ts — canvas drawing primitives (rounded rects etc.)
packages/engine/src/text.ts — text measuring / layout
packages/engine/src/fonts.ts — side-effect import registering bundled @font-face (`@mg/engine/fonts`)
packages/engine/src/templates/index.ts — template registry; register new templates here
packages/engine/src/templates/kinetic_text.ts — kinetic_text_v1
packages/engine/src/templates/promo_card.ts — promo_card_v1
packages/engine/src/templates/banner.ts — banner_v1
packages/engine/src/templates/shared.ts — helpers shared between templates
packages/engine/test/ — vitest: core, determinism (@napi-rs/canvas), math

packages/contract/src/index.ts — HTTP + Socket.io types and ASSET_URL_PATTERN; change first when the API shape changes

apps/worker/ — headless render: Puppeteer + FFmpeg
apps/worker/render-page/ — index.html + main.ts loaded in Chromium, driven via window.__mg
apps/worker/vite.render.config.ts — builds render-page into dist/render-page (auto-rebuilt when stale)
apps/worker/src/index.ts — package exports used by the API
apps/worker/src/render.ts — render orchestration: page frames → encoder
apps/worker/src/browser.ts — Chromium launch / page lifecycle
apps/worker/src/server.ts — local static server for the render page bundle
apps/worker/src/encoder.ts — FFmpeg process wrapper (mp4 / webm, alpha)
apps/worker/src/assets.ts — resolves /api/assets/<id> image params to data: URLs
apps/worker/src/security.ts — validation of image params / URL safety
apps/worker/src/child.ts — long-lived render child process forked by the API pool
apps/worker/src/ipc.ts — parent ↔ child message protocol
apps/worker/src/cli.ts — `npm run render -w @mg/worker` entry
apps/worker/samples/ — example payload JSONs for the CLI
apps/worker/test/ — vitest: encoder, render, browser (recycling/leaks), determinism (byte-identical frames across jobs/browsers) (+ helpers.ts)
apps/worker/test/parity.test.ts, parity/ — studio ≡ render page (exact pixels), lossless pipeline round-trip, MP4/WebM PSNR floor
apps/worker/scripts/soak.ts — perf/soak harness (throughput, long render, recycle, concurrency, crash); results in docs/perf.md
docs/perf.md — measured throughput, memory, recycling and crash-recovery results

apps/api/ — Express 5 + Socket.io server on :3001
apps/api/src/index.ts — process entry: config, storage, queue, pool, listen
apps/api/src/app.ts — Express routes (templates, asset upload, jobs, downloads)
apps/api/src/config.ts — config values (ports, paths, secrets, limits)
apps/api/src/sockets.ts — Socket.io job progress events
apps/api/src/pool.ts — pool of worker child processes consuming the queue
apps/api/src/jobView.ts — job → API view mapping, retention/expiry checks
apps/api/src/queue/types.ts — JobQueue interface (swap point for BullMQ)
apps/api/src/queue/sqlite.ts — node:sqlite JobQueue implementation
apps/api/src/storage/types.ts — blob storage interface (S3 would plug in here)
apps/api/src/storage/local.ts — local-disk storage under storage/
apps/api/src/storage/signing.ts — HMAC-SHA256 signed download URLs
apps/api/test/ — vitest: api.test.ts, queue.test.ts

apps/web/ — React 19 studio (Vite, :5173)
apps/web/vite.config.ts — Vite config + proxy to the API on :3001
apps/web/src/main.tsx, App.tsx — entry and app shell
apps/web/src/styles.css — all studio styles
apps/web/src/components/ — UI: Stage (canvas preview), Timeline, Inspector/ParamControl/NumField/Switch, TemplateList, TopBar, JsonPanel, ExportDialog, RendersPanel, Toast, Icons
apps/web/src/hooks/ — useAssets (preload images/fonts), usePlayback (playhead clock), useShortcuts (keyboard), useStudioTestHook (window.__studio for parity tests, only with ?mgtest=1)
apps/web/src/state/ — store (payload + playhead), renders (job list), storage (localStorage persistence), time (timecode)
apps/web/src/api/ — client.ts (HTTP), socket.ts (Socket.io job updates)
