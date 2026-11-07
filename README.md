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

## Render from the CLI
```sh
npm run render -w @mg/worker -- samples/kinetic_text.json --format mp4
```

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
