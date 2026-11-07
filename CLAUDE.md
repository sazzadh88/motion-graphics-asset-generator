# Motion Graphics & Asset Generator

Stack: npm workspaces, TypeScript 7, Node 26, React 19 + Vite 8 (apps/web), Express 5 + Socket.io (apps/api), node:sqlite job queue, Puppeteer + FFmpeg (apps/worker), canvas engine (packages/engine).

## Commands (repo root; the path has spaces and `&`, always quote it)
- `npm run dev` - API on :3001 + studio on :5173
- `npm run typecheck` - all workspaces
- `npm run test --workspaces --if-present` - all tests; one workspace: `npm run test -w <ws>` (e.g. `@mg/engine`)
- `npm run render -w @mg/worker -- <payload.json> [--format mp4|webm]` - CLI render (samples in apps/worker/samples)
- `npm run setup:browser -w @mg/worker` - downloads Chromium; required on fresh clones (npm blocks puppeteer's postinstall)

## Rules you would otherwise get wrong
- Determinism: every frame is a pure function of (frame index, payload). No Math.random, Date or timers in templates; use `createRng`. `renderFrame` in `packages/engine/src/core.ts` is the single draw entry for both studio and worker.
- `.npmrc` sets `script-shell` to Git's `bin/bash.exe` because the repo path contains `&`. Do not change it to `usr/bin/bash.exe`.
- The API dev script is `exec tsx watch ... < /dev/null` on purpose: a shared stdin pipe stalled API startup on Windows, and `exec` keeps `taskkill /T` working. Keep both.
- The worker's render page bundle (`apps/worker/dist/render-page`) auto-rebuilds when engine or render-page sources are newer; no manual build step.
- Image params in render payloads must be uploaded asset URLs `/api/assets/<id>`. The worker converts them to data: URLs and never fetches over the network.
- The HTTP/socket contract lives in `packages/contract`. Change it there first, then API and web.
- No Redis: the queue is SQLite behind the `JobQueue` interface (`apps/api/src/queue/types.ts`); a BullMQ adapter would plug in there.
- Runtime data (sqlite db, uploads, renders) lives in `storage/` (gitignored).

## More
- `filemap.md` - where everything lives
- `README.md` - human quick start + architecture
- `docs/SPEC.md` - original product spec + implementation deviations
