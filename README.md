# Motion Graphics & Asset Generator

Generate parameterised motion graphics (MP4/WebM) from templates, with a live browser studio.

## Prerequisites
- Node 26+
- FFmpeg on PATH
- Git for Windows (npm scripts run in its bash; see `.npmrc`)

## Install
```sh
npm install
npm run setup:browser -w @mg/worker   # downloads Chromium for Puppeteer
```

## Run
```sh
npm run dev   # API on :3001, studio on :5173
```
Open http://localhost:5173.

### AI generation
The API generates templates from a prompt with Claude. Put these in `.env` at the repo root (copy `.env.example`; it is gitignored) and restart `npm run dev`. Variables set in the shell override `.env`.

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables generation with Claude. Without it (and without mock mode) generation is disabled and the status endpoint says why. |
| `MG_GENERATOR_MODEL` | Model id, default `claude-sonnet-5-5`. |
| `MG_GENERATOR=mock` | Offline mode: no key, no network. Returns a bundled scene picked by keywords in the prompt, so the studio can be built and demoed. |

The generator (`apps/api/src/generate/`) sends the scene spec (`docs/SCENE_FORMAT.md`) and three bundled scenes as a cached system prompt, validates Claude's scene with the engine validator, and sends the errors back for up to two fixes.

## Render from the CLI
```sh
npm run render -w @mg/worker -- samples/kinetic_text.json --format mp4
```
For a generated template (`gen_…` id) add its scene document as a top-level `"scene"` field of the payload JSON (e.g. the `scene` of `storage/scenes/<id>.json`).

## Test
```sh
npm run typecheck
npm run test --workspaces --if-present
```

## Architecture
```
studio (React, apps/web) --HTTP/Socket.io--> API (Express, apps/api)
API --> SQLite job queue (node:sqlite, JobQueue interface)
queue --> pool of render child processes (apps/worker)
child --> headless Chromium draws frames with packages/engine
frames --> FFmpeg encodes MP4/WebM --> storage/ on local disk
API --> HMAC-signed download URL --> studio
```
See `filemap.md` for where things live and `docs/SPEC.md` for the original spec.
