import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { AssetUploadResponse, ClientToServerEvents, RenderJob, ServerToClientEvents } from '@mg/contract';
import { defaultPayload } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import { createApp } from '../src/app';
import type { AppContext } from '../src/app';
import { loadConfig } from '../src/config';
import type { Config } from '../src/config';
import { SqliteQueue } from '../src/queue/sqlite';

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function makeConfig(dir: string): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    storageDir: dir,
    renderConcurrency: 1,
    maxQueued: 50,
    outputTtlHours: 24,
    assetTtlDays: 7,
    downloadUrlTtlSeconds: 3600,
    signingSecret: 'test-secret',
  };
}

function tinyBanner(logoUrl: string | null, frames = 12): RenderJobPayload {
  const p = defaultPayload('banner_v1');
  p.settings = { ...p.settings, width: 300, height: 100, fps: 30, durationFrames: frames, transparent: false };
  p.assets = { ...p.assets, logoUrl };
  return p;
}

let dir: string;
let ctx: AppContext;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mg-api-test-'));
  ctx = createApp(makeConfig(dir));
  base = `http://127.0.0.1:${await ctx.listen(0, '127.0.0.1')}`;
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function upload(data: Buffer | Uint8Array, name = 'logo.png', type = 'image/png'): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([data as BlobPart], { type }), name);
  return fetch(`${base}/api/assets`, { method: 'POST', body: form });
}

async function post(body: unknown): Promise<Response> {
  return fetch(`${base}/api/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitFor(id: string, pred: (j: RenderJob) => boolean, ms = 120_000): Promise<RenderJob> {
  const end = Date.now() + ms;
  for (;;) {
    const j = (await (await fetch(`${base}/api/renders/${id}`)).json()) as RenderJob;
    if (pred(j)) return j;
    if (Date.now() > end) throw new Error(`timeout waiting for job ${id} (last: ${JSON.stringify(j)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('basics', () => {
  it('serves health, templates (without render/fonts) and JSON 404s', async () => {
    expect((await (await fetch(`${base}/api/health`)).json()).status).toBe('ok');
    const t = (await (await fetch(`${base}/api/templates`)).json()) as Record<string, unknown>[];
    expect(t.map((x) => x.id)).toContain('banner_v1');
    expect(t[0]).not.toHaveProperty('render');
    expect(t[0]).not.toHaveProperty('fonts');
    const r = await fetch(`${base}/api/nope`);
    expect(r.status).toBe(404);
    expect(await r.json()).toHaveProperty('error');
    const bad = await fetch(`${base}/api/renders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid JSON body' });
  });
});

describe('asset upload', () => {
  it('accepts a PNG and serves it back', async () => {
    const res = await upload(PNG);
    expect(res.status).toBe(201);
    const a = (await res.json()) as AssetUploadResponse;
    expect(a.url).toBe(`/api/assets/${a.id}`);
    expect(a.mime).toBe('image/png');
    expect(a.bytes).toBe(PNG.length);
    const got = await fetch(base + a.url);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(got.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('rejects a text file (415) and SVG (415)', async () => {
    expect((await upload(Buffer.from('hello world, not an image'), 'a.png', 'image/png')).status).toBe(415);
    expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml')).status).toBe(415);
  });

  it('rejects an oversize file (413)', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(await res.json()).toHaveProperty('error');
  });

  it('rejects a request without a file (400) and unknown assets (404)', async () => {
    const form = new FormData();
    form.append('other', 'x');
    expect((await fetch(`${base}/api/assets`, { method: 'POST', body: form })).status).toBe(400);
    expect((await fetch(`${base}/api/assets/doesnotexist1234`)).status).toBe(404);
  });
});

describe('render request validation', () => {
  it('returns 400 with details for a bad payload', async () => {
    const p = tinyBanner(null);
    (p.settings as { width: number }).width = 301;
    const res = await post({ payload: p, format: 'mp4' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string[] };
    expect(body.details.join(' ')).toMatch(/even/);
    expect((await post({ payload: { templateId: 'nope' }, format: 'mp4' })).status).toBe(400);
    expect((await post({ payload: tinyBanner(null), format: 'avi' })).status).toBe(400);
  });

  it('rejects foreign / unknown image URLs', async () => {
    for (const url of ['https://example.com/x.png', 'data:image/png;base64,AAAA', '/api/assets/doesnotexist1234']) {
      const res = await post({ payload: tinyBanner(url), format: 'mp4' });
      expect(res.status, url).toBe(400);
      expect(((await res.json()) as { details: string[] }).details[0]).toMatch(/logoUrl/);
    }
  });
});

describe('render jobs', () => {
  it('renders end to end with socket progress, a signed download and tamper checks', async () => {
    const asset = (await (await upload(PNG)).json()) as AssetUploadResponse;
    const created = await post({ payload: tinyBanner(asset.url), format: 'mp4' });
    expect(created.status).toBe(202);
    const job = (await created.json()) as RenderJob;
    expect(job.status).toBe('queued');
    expect(job.width).toBe(300);

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(base, { transports: ['websocket'] });
    const updates: RenderJob[] = [];
    const final = await new Promise<RenderJob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket timeout')), 150_000);
      socket.on('job:update', (j) => {
        updates.push(j);
        if (j.status === 'completed' || j.status === 'failed') {
          clearTimeout(timer);
          resolve(j);
        }
      });
      socket.on('connect', () => socket.emit('job:subscribe', job.id));
    });
    socket.close();

    expect(final.error).toBeUndefined();
    expect(final.status).toBe('completed');
    expect(final.progress).toBe(100);
    expect(updates[0]).toBeDefined();
    expect(updates.some((u) => u.status === 'active')).toBe(true);
    expect(final.download?.filename).toBe('banner_v1-300x100.mp4');

    const dl = final.download!;
    const res = await fetch(base + dl.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="banner_v1-300x100.mp4"');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(dl.bytes);
    const file = path.join(dir, 'downloaded.mp4');
    writeFileSync(file, buf);
    const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', file], { encoding: 'utf8' });
    const stream = (JSON.parse(r.stdout) as { streams: { nb_read_frames: string; width: number; height: number }[] }).streams[0]!;
    expect(stream.nb_read_frames).toBe('12');
    expect([stream.width, stream.height]).toEqual([300, 100]);

    // tampered / expired signatures
    const u = new URL(dl.url, base);
    const sig = u.searchParams.get('sig')!;
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect((await fetch(`${base}/api/files/${job.id}?exp=${u.searchParams.get('exp')}&sig=${flipped}`)).status).toBe(403);
    expect((await fetch(`${base}/api/files/${job.id}?exp=${Number(u.searchParams.get('exp')) + 5}&sig=${sig}`)).status).toBe(403);
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = ctx.signer.sign(job.id, (past - 3600) * 1000);
    expect((await fetch(base + expired.url)).status).toBe(403);
    expect((await fetch(`${base}/api/files/${job.id}`)).status).toBe(403);

    // listing and re-signing
    const list = (await (await fetch(`${base}/api/renders`)).json()) as RenderJob[];
    expect(list.find((j) => j.id === job.id)?.status).toBe('completed');
    expect((await fetch(`${base}/api/renders/${job.id}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('cancels queued and active jobs', async () => {
    const first = (await (await post({ payload: tinyBanner(null, 90), format: 'mp4' })).json()) as RenderJob;
    const second = (await (await post({ payload: tinyBanner(null), format: 'mp4' })).json()) as RenderJob;
    expect(second.status).toBe('queued');
    expect(second.queuePosition).toBe(1);

    const del = await fetch(`${base}/api/renders/${second.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(((await del.json()) as RenderJob).status).toBe('cancelled');
    expect((await fetch(`${base}/api/renders/${second.id}`, { method: 'DELETE' })).status).toBe(409);
    expect((await fetch(`${base}/api/renders/nonexistent`, { method: 'DELETE' })).status).toBe(404);

    // cancel the first one while it renders (or still queued)
    await waitFor(first.id, (j) => j.status === 'active');
    const act = await fetch(`${base}/api/renders/${first.id}`, { method: 'DELETE' });
    expect(((await act.json()) as RenderJob).status).toBe('cancelled');

    // the pool must be usable again afterwards
    const third = (await (await post({ payload: tinyBanner(null), format: 'webm' })).json()) as RenderJob;
    const done = await waitFor(third.id, (j) => j.status === 'completed' || j.status === 'failed');
    expect(done.status).toBe('completed');
    expect(done.download?.filename).toBe('banner_v1-300x100.webm');
  });

  it('returns 429 when the queue is full', async () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'mg-api-full-'));
    const small = createApp({ ...makeConfig(dir2), maxQueued: 1 });
    try {
      // no pool started (listen not called), so jobs stay queued
      const server = small.server.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/renders`;
      const send = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: tinyBanner(null), format: 'mp4' }) });
      expect((await send()).status).toBe(202);
      expect((await send()).status).toBe(429);
    } finally {
      await small.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('asset retention', () => {
  it('reads ASSET_TTL_DAYS (default 7)', () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'mg-api-config-'));
    try {
      const env = { STORAGE_DIR: dir2, SIGNING_SECRET: 'x' };
      expect(loadConfig(env).assetTtlDays).toBe(7);
      expect(loadConfig({ ...env, ASSET_TTL_DAYS: '3' }).assetTtlDays).toBe(3);
      expect(() => loadConfig({ ...env, ASSET_TTL_DAYS: '0' })).toThrow(/invalid/);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('sweeps assets older than the TTL unless a queued or active job references them', async () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'mg-api-assets-'));
    const app = createApp({ ...makeConfig(dir2), assetTtlDays: 7 }); // pool not started: jobs stay put
    try {
      const assetsDir = app.storage.localDir!('assets');
      const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
      const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000);
      const put = (id: string, mtime: Date) => {
        const f = path.join(assetsDir, id);
        writeFileSync(f, PNG);
        utimesSync(f, mtime, mtime);
      };
      put('oldActiveAsset01', eightDaysAgo);
      put('oldQueuedAsset01', eightDaysAgo);
      put('oldUnusedAsset01', eightDaysAgo);
      put('oldDoneAsset0001', eightDaysAgo);
      put('recentAsset00001', sixDaysAgo);

      const active = app.queue.add(tinyBanner('/api/assets/oldActiveAsset01'), 'mp4');
      expect(app.queue.claimNext()?.id).toBe(active.id);
      app.queue.add(tinyBanner('/api/assets/oldQueuedAsset01'), 'mp4');
      const cancelled = app.queue.add(tinyBanner('/api/assets/oldDoneAsset0001'), 'mp4');
      expect(app.queue.cancel(cancelled.id)?.changed).toBe(true);

      await app.sweep();

      expect(readdirSync(assetsDir).sort()).toEqual(['oldActiveAsset01', 'oldQueuedAsset01', 'recentAsset00001']);
    } finally {
      await app.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('restart recovery', () => {
  it('requeues active jobs left by a crash and fails them after 2 attempts', async () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'mg-api-restart-'));
    try {
      const q = new SqliteQueue(path.join(dir2, 'mg.sqlite'));
      const a = q.add(tinyBanner(null), 'mp4');
      const b = q.add(tinyBanner(null), 'mp4');
      expect(q.claimNext()?.id).toBe(a.id);
      expect(q.get(a.id)?.status).toBe('active');
      q.close(); // simulated crash: the row stays 'active'

      const app = createApp(makeConfig(dir2)); // pool not started
      const recovered = app.queue.get(a.id)!;
      expect(recovered.status).toBe('queued');
      expect(recovered.attempts).toBe(1);
      expect(app.queue.get(b.id)?.status).toBe('queued');
      // second crash -> failed
      expect(app.queue.claimNext()?.id).toBe(a.id);
      app.queue.close();
      const app2 = createApp(makeConfig(dir2));
      const failed = app2.queue.get(a.id)!;
      expect(failed.status).toBe('failed');
      expect(failed.attempts).toBe(2);
      await app2.close();
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
