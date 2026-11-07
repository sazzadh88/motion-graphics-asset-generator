# Render worker: soak and performance

Measured 2026-11-07 with `apps/worker/scripts/soak.ts`:

```
cd apps/worker
npx tsx scripts/soak.ts            # all checks, each in its own child process; prints the tables below
npx tsx scripts/soak.ts --check long   # one check: throughput | long | recycle | concurrency | crash
```

Chromium memory and PIDs are measured over the process tree rooted at the soak process
(`Get-CimInstance Win32_Process`, Windows only), so other Chrome instances are not counted.

**Machine:** AMD Ryzen 7 6800H (16 logical CPUs), 31.3 GB RAM, Windows 11 (10.0.26200),
Node 26.13.0, Puppeteer 25.16.0 (Chrome 156 headless), FFmpeg 9.0.2.

## 1. Throughput (default size, warm browser)

Since 2026-11-07 the worker launches Chromium with `--disable-accelerated-2d-canvas` (CPU raster
for 2D canvas, `LAUNCH_ARGS` in `apps/worker/src/browser.ts`). The GPU path (ANGLE/D3D11) is not
deterministic: the same kinetic_text frame drawn in two fresh jobs differed on 2 to 43 text-edge
pixels by 1-2 levels, so exports were not bit-reproducible. With CPU raster they are byte-identical
(regression test: `test/determinism.test.ts`, which fails on kinetic_text without the flag).

"Before" is GPU raster (the original measurement; two re-runs in the same session as "after"
gave 39.5-39.9, 31.5-31.6, 15.5 and 16.1-16.7 frames/s). "After" is CPU raster, mean of 3 runs
(`npx tsx scripts/soak.ts --check throughput`).

| Sample | Size | fps | Format | Frames | Before: frames/s (GPU) | After: frames/s (CPU) | After: time (s) | After: x real time | Change |
|---|---|---|---|---|---|---|---|---|---|
| banner | 1500x500 | 30 | mp4 | 120 | 38.0 | **34.6** (33.3-35.4) | 3.5 | 1.2 | -9% |
| promo_card | 1080x1080 | 30 | mp4 | 150 | 30.3 | **26.0** (25.7-26.3) | 5.8 | 0.87 | -14% |
| kinetic_text | 1080x1920 | 60 | mp4 | 180 | 15.2 | **12.9** (12.7-13.4) | 14.0 | 0.22 | -15% |
| kinetic_transparent | 1080x1920 | 60 | webm (alpha) | 180 | 15.5 | **17.0** (16.0-17.6) | 10.6 | 0.28 | +10% |

Against the same-session GPU re-runs the drops are larger: banner -13%, promo_card -18%,
kinetic_text -17%; kinetic_transparent is +4%. CPU raster costs about 15% on opaque output and
is neutral to slightly faster on transparent output. The flag stays: bit-reproducible exports
are a requirement. Parallel jobs (section 4, about 50 frames/s aggregate on GPU raster) are the
lever if throughput matters; that was not re-measured on CPU raster.

All outputs pass ffprobe (exact frame count, size, frame rate). Times include page load and
init (about 0.3 s per job). Sections 2 to 5 were measured before the switch, on GPU raster.

## 2. Long render: kinetic_text, 1080x1920, 60 fps, 3600 frames, MP4

236.9 s, average **15.2 frames/s** (1-s samples: min 11.8, max 20; first half 15.4, second half 15.5).
ffprobe `-count_frames`: **3600** (exact). Output 5.2 MB.

| Metric (sampled every 1 s, 235 samples) | Start | Peak | End | Slope, 2nd half |
|---|---|---|---|---|
| Node RSS (MB) | 115 | 231 | 115 | +9.7 MB/min (sawtooth, see below) |
| Node heapUsed (MB) | 28 | 53 | 23 | +2.5 MB/min |
| Chromium tree working set (MB) | 611 | 858 | 796 | **-0.3 MB/min** |

Chromium processes: 8 to 10 throughout.

**Memory plateaus.** Chromium rises to about 800-850 MB in the first seconds and stays flat
(slope about 0). Node memory is a sawtooth driven by the in-flight base64 frame batches
(4 frames of about 280 KB PNG each, plus their strings and Buffers) and returns to its starting
value at the end; the small positive second-half slope is GC phase noise, not growth.
Render speed does not decay over the 60-second render.

## 3. Browser recycling (`MG_BROWSER_MAX_JOBS=5`, 22 banner jobs of 60 frames, sequential)

| Check | Result |
|---|---|
| Browser launches | **5** (expected ceil(22/5) = 5); root PIDs change exactly after jobs 5, 10, 15, 20 |
| Browsers alive between jobs | 1 (the retired browser is closed when the next job acquires) |
| Chromium processes after each job | 7 7 7 7 7 7 7 7 7 7 6 6 6 6 6 7 7 7 7 7 7 7 (flat) |
| Chromium processes after `shutdown()` | 0 |
| Outputs valid | 22 / 22 |

Before the fix below, this check failed: the counts were
`10 11 12 13 14 | 9 10 11 12 13 | ...`, one extra process per job until the browser was retired.

## 4. Concurrency (3 jobs in parallel in one process)

| Job | Template | Expected | ffprobe | OK |
|---|---|---|---|---|
| 0 | banner_v1 | 1500x500, 90 frames | 1500x500, 90 frames | yes |
| 1 | promo_card_v1 | 720x720, 75 frames | 720x720, 75 frames | yes |
| 2 | kinetic_text_v1 | 540x960, 120 frames | 540x960, 120 frames | yes |

One shared browser (one context and page per job), 5.7 s wall time, about 50 frames/s aggregate,
peak 11 Chromium processes. No cross-talk.

## 5. Crash recovery (kill at about frame 115 of a 600-frame 540x960 job)

| Killed | Rejects | Error | Latency after kill | `.part` left | Output left | Next job |
|---|---|---|---|---|---|---|
| Chromium (whole tree, `taskkill /T /F`) | yes | `Chromium exited during render (crashed or killed): Protocol error (Runtime.callFunctionOn): Target closed` | 0.3 s | 0 | no | OK, on a relaunched browser (new PID) |
| ffmpeg | yes | `ffmpeg exited with code 1` | 0.16 s | 0 | no | OK, same browser |

No stray Chromium or ffmpeg processes after any check (0 / 0 after `shutdown()`).

## Defects found and fixed

1. **Chromium renderer processes piled up between jobs** (`apps/worker/src/browser.ts`).
   Each job used `browser.newPage()` and `page.close()`. Headless Chrome keeps the closed page's
   renderer process alive for about 30 s, so jobs that ran back to back added one process each
   (and its memory) until the browser was retired: up to about 20 extra renderers with the default
   `MG_BROWSER_MAX_JOBS=20`. A raw Puppeteer reproduction (newPage, navigate, close, x4) showed the
   same growth (2, 4, 7, 9, 11 renderers), falling back to 3 only after 30 s idle.
   **Fix:** each job gets its own `browser.createBrowserContext()`, closed on release. That tears
   the renderer down at once and also isolates storage and cache between jobs. Throughput is
   unchanged (within 2%).
   Regression test: `test/browser.test.ts`, "does not accumulate Chromium processes across
   sequential jobs" (fails 14 > 10 without the fix).
2. **Unclear error when Chromium dies mid-render** (`apps/worker/src/render.ts`). The rejection was
   only Puppeteer's `Protocol error (Runtime.callFunctionOn): Target closed`. It is now prefixed
   with `Chromium exited during render (crashed or killed): ` when the browser is disconnected.
   Regression test: `test/browser.test.ts`, "rejects with a clear error when Chromium dies
   mid-render, leaves no .part, and relaunches".

## Bottleneck

Frame capture in Chromium, not encoding. ffmpeg alone encodes the 180 kinetic_text frames
(1080x1920 PNG, libx264 `-preset fast`) in 1.13 s, about 160 frames/s, compared with 15 frames/s
end to end (13 on CPU raster). Throughput scales roughly with pixel count: 0.75 MP gives 38
frames/s, 1.17 MP gives 30 and 2.07 MP gives 15 (GPU raster; CPU raster: 35, 26 and 13).
That points at the per-frame canvas draw, `canvas.toBlob('image/png')`
(lossless PNG encode of a full frame) and the base64 transfer over CDP (about 375 KB per frame
at 1080x1920). Running 3 jobs in parallel gives about 50 frames/s aggregate, so the machine has
headroom for parallelism. A full-HD-vertical 60 fps job runs at about 0.25x real time.
