// Headless render page: driven from Node via window.__mg (see src/render.ts).
import '@mg/engine/fonts';
import { preloadAssets, renderFrame, validatePayload } from '@mg/engine';
import type { LoadedAssets, RenderJobPayload } from '@mg/engine';

let payload: RenderJobPayload | null = null;
let loaded: LoadedAssets | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

/** Draws a frame and starts PNG encoding; toBlob snapshots the canvas synchronously. */
function startEncode(frame: number): Promise<Blob> {
  if (!payload || !loaded || !canvas || !ctx) throw new Error('capture() called before init()');
  renderFrame(ctx, frame, payload, loaded);
  return new Promise<Blob>((resolve, reject) =>
    canvas!.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png'),
  );
}

async function capture(frame: number): Promise<string> {
  return toBase64(await (await startEncode(frame)).arrayBuffer());
}

/**
 * Captures `count` consecutive frames starting at `start`. PNG encoding of earlier
 * frames runs off the main thread while later frames are drawn, so batches overlap
 * encode work across cores.
 */
async function captureBatch(start: number, count: number): Promise<string[]> {
  const blobs: Promise<Blob>[] = [];
  for (let i = 0; i < count; i++) blobs.push(startEncode(start + i));
  return Promise.all(blobs.map(async (b) => toBase64(await (await b).arrayBuffer())));
}

async function init(input: unknown): Promise<void> {
  const v = validatePayload(input);
  if (!v.ok) throw new Error(`Invalid payload: ${v.errors.join('; ')}`);
  payload = v.payload;
  const { width, height } = payload.settings;
  canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Could not create 2D context');
  loaded = await preloadAssets(payload);
}

declare global {
  interface Window {
    __mg: { init: typeof init; capture: typeof capture; captureBatch: typeof captureBatch };
  }
}

window.__mg = { init, capture, captureBatch };
