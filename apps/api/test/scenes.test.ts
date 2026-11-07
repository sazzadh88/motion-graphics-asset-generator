import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetUploadResponse, GeneratedTemplate, GenerateEvent, GenerateStatus, RenderJob } from '@mg/contract';
import { getTemplate } from '@mg/engine';
import quoteCard from '../../../packages/engine/src/scenes/quote_card_v1.json';
import { createApp, MAX_CONCURRENT_GENERATIONS } from '../src/app';
import type { AppContext } from '../src/app';
import type { Config } from '../src/config';
import { GenerateError } from '../src/generate';
import type { GenerateInput, GenerateResult, SceneGenerator } from '../src/generate';
import { newSceneId } from '../src/scenes';

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

function sceneFor(id: string, name = 'Fake scene'): Record<string, unknown> {
  return { ...structuredClone(quoteCard), id, name };
}

type Behavior = (input: GenerateInput) => Promise<GenerateResult>;

class FakeGenerator implements SceneGenerator {
  readonly model = 'fake-model-1';
  readonly calls: GenerateInput[] = [];
  behavior: Behavior = async (input) => {
    input.onEvent({ type: 'step', step: 'writing', attempt: 1, message: 'Writing scene' });
    input.onEvent({ type: 'issues', attempt: 1, issues: ['  /layers/0: example issue'] });
    input.onEvent({ type: 'step', step: 'repairing', attempt: 2, message: 'Repairing' });
    return { scene: sceneFor(input.sceneId), name: 'Fake scene', repairs: 1 };
  };
  generate(input: GenerateInput): Promise<GenerateResult> {
    this.calls.push(input);
    return this.behavior(input);
  }
}

const VALID = { prompt: 'A bold quote card', width: 1080, height: 1350, fps: 30, durationSeconds: 6 };

let dir: string;
let ctx: AppContext;
let base: string;
const gen = new FakeGenerator();

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mg-gen-api-'));
  ctx = createApp(makeConfig(dir), { generation: { generator: gen, model: gen.model } });
  base = `http://127.0.0.1:${await ctx.listen(0, '127.0.0.1')}`;
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function postGenerate(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

async function events(res: Response): Promise<GenerateEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GenerateEvent);
}

async function generateOk(body: unknown = VALID): Promise<GeneratedTemplate> {
  const res = await postGenerate(body);
  expect(res.status).toBe(200);
  const ev = await events(res);
  const done = ev.at(-1);
  if (done?.type !== 'done') throw new Error(`expected done, got ${JSON.stringify(ev)}`);
  return done.template;
}

async function postRender(templateId: string, frames = 6): Promise<Response> {
  return fetch(`${base}/api/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      payload: { templateId, settings: { width: 216, height: 270, fps: 30, durationFrames: frames, transparent: false }, assets: {} },
      format: 'mp4',
    }),
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('scene ids', () => {
  it('are gen_ + 12 lowercase base36 chars', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSceneId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^gen_[a-z0-9]{12}$/);
  });
});

describe('GET /api/generate/status', () => {
  it('reports the configured model', async () => {
    const s = (await (await fetch(`${base}/api/generate/status`)).json()) as GenerateStatus;
    expect(s).toEqual({ enabled: true, model: 'fake-model-1' });
  });
});

describe('POST /api/generate', () => {
  it('rejects bad requests with 400 and details', async () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ...VALID, prompt: '' }, /prompt/],
      [{ ...VALID, prompt: '   ' }, /prompt/],
      [{ ...VALID, prompt: 'x'.repeat(2001) }, /2000/],
      [{ ...VALID, width: 1081 }, /even/],
      [{ ...VALID, height: 10 }, /between/],
      [{ ...VALID, fps: 29 }, /fps/],
      [{ ...VALID, durationSeconds: 0 }, /durationSeconds/],
      [{ ...VALID, durationSeconds: 61 }, /durationSeconds/],
      [{ ...VALID, imageUrl: 'https://example.com/a.png' }, /imageUrl/],
      [{ ...VALID, imageUrl: '/api/assets/doesnotexist1234' }, /asset not found/],
      [{ ...VALID, baseSceneId: 'gen_doesnotexist' }, /baseSceneId/],
      [{ ...VALID, palette: { colors: [{ hex: 'red', weight: 1 }] } }, /palette/],
      [{ ...VALID, palette: { colors: [] } }, /palette/],
    ];
    for (const [body, re] of bad) {
      const res = await postGenerate(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      const err = (await res.json()) as { error: string; details: string[] };
      expect(err.details.join(' ')).toMatch(re);
    }
    expect(gen.calls.length).toBe(0);
  });

  it('streams NDJSON events, saves a draft and registers it in the engine', async () => {
    const up = (await (await (async () => {
      const form = new FormData();
      form.append('file', new Blob([PNG], { type: 'image/png' }), 'ref.png');
      return fetch(`${base}/api/assets`, { method: 'POST', body: form });
    })()).json()) as AssetUploadResponse;

    const res = await postGenerate({ ...VALID, imageUrl: up.url, palette: { colors: [{ hex: '#ff0000', weight: 0.6 }, { hex: '#00FF00', weight: 0.4 }] } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/x-ndjson/);
    const ev = await events(res);
    expect(ev.map((e) => (e.type === 'step' ? `step:${e.step}` : e.type))).toEqual([
      'step:writing',
      'issues',
      'step:repairing',
      'step:saving',
      'done',
    ]);
    const done = ev.at(-1) as Extract<GenerateEvent, { type: 'done' }>;
    expect(done.repairs).toBe(1);
    const t = done.template;
    expect(t.id).toMatch(/^gen_[a-z0-9]{12}$/);
    expect(t).toMatchObject({ name: 'Fake scene', prompt: VALID.prompt, kept: false, model: 'fake-model-1' });
    expect(t.baseSceneId).toBeUndefined();
    expect((t.scene as { id: string }).id).toBe(t.id);

    const call = gen.calls.at(-1)!;
    expect(call.sceneId).toBe(t.id);
    expect(call.image).toEqual({ mime: 'image/png', base64: PNG.toString('base64') });
    expect(call.palette).toEqual({ colors: [{ hex: '#FF0000', weight: 0.6 }, { hex: '#00FF00', weight: 0.4 }] });
    expect([call.width, call.height, call.fps, call.durationSeconds]).toEqual([1080, 1350, 30, 6]);
    expect(call.baseScene).toBeNull();

    // persisted, registered, fetchable by id, but not listed (draft) and not in /api/templates
    const file = path.join(dir, 'scenes', `${t.id}.json`);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(t);
    expect(getTemplate(t.id)?.origin).toBe('generated');
    expect(await (await fetch(`${base}/api/scenes/${t.id}`)).json()).toEqual(t);
    expect(((await (await fetch(`${base}/api/scenes`)).json()) as GeneratedTemplate[]).map((x) => x.id)).not.toContain(t.id);
    const templates = (await (await fetch(`${base}/api/templates`)).json()) as { id: string }[];
    expect(templates.some((x) => x.id.startsWith('gen_'))).toBe(false);
  });

  it('refine creates a new draft from the base scene and leaves the base untouched', async () => {
    const first = await generateOk();
    const baseFile = path.join(dir, 'scenes', `${first.id}.json`);
    const before = readFileSync(baseFile, 'utf8');
    const refined = await generateOk({ ...VALID, prompt: 'Make it blue', baseSceneId: first.id });
    expect(refined.id).not.toBe(first.id);
    expect(refined.baseSceneId).toBe(first.id);
    expect(refined.prompt).toBe('Make it blue');
    expect(gen.calls.at(-1)!.baseScene).toEqual(first.scene);
    expect(readFileSync(baseFile, 'utf8')).toBe(before);
  });

  it('reports a GenerateError with its issues as an error event and saves nothing', async () => {
    gen.behavior = async (input) => {
      input.onEvent({ type: 'step', step: 'writing', attempt: 1, message: 'Writing scene' });
      throw new GenerateError('The model could not produce a valid scene.', ['  /layers: must be an array']);
    };
    try {
      const res = await postGenerate(VALID);
      expect(res.status).toBe(200);
      const ev = await events(res);
      expect(ev.at(-1)).toEqual({ type: 'error', error: 'The model could not produce a valid scene.', issues: ['  /layers: must be an array'] });
      expect(existsSync(path.join(dir, 'scenes', `${gen.calls.at(-1)!.sceneId}.json`))).toBe(false);
      expect(getTemplate(gen.calls.at(-1)!.sceneId)).toBeUndefined();
    } finally {
      gen.behavior = new FakeGenerator().behavior;
    }
  });

  it('never leaks unexpected error messages, stacks or keys', async () => {
    gen.behavior = async () => {
      throw new Error('401 invalid x-api-key sk-ant-api03-SECRETSECRET at Object.<anonymous> (claude.ts:12)');
    };
    try {
      const text = await (await postGenerate(VALID)).text();
      expect(text).not.toMatch(/sk-ant|SECRET|claude\.ts|x-api-key/);
      const ev = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as GenerateEvent);
      expect(ev.at(-1)).toEqual({ type: 'error', error: 'Generation failed unexpectedly. Please try again.' });
    } finally {
      gen.behavior = new FakeGenerator().behavior;
    }
  });

  it('aborts the generator when the client disconnects, and saves nothing', async () => {
    const aborted = deferred();
    let sceneId = '';
    gen.behavior = (input) =>
      new Promise((_resolve, reject) => {
        sceneId = input.sceneId;
        input.onEvent({ type: 'step', step: 'writing', attempt: 1, message: 'Writing scene' });
        input.signal.addEventListener('abort', () => {
          aborted.resolve();
          const e = new Error('cancelled');
          e.name = 'AbortError';
          reject(e);
        });
      });
    try {
      const ac = new AbortController();
      const res = await postGenerate(VALID, ac.signal);
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(JSON.parse(first.split('\n')[0]!)).toMatchObject({ type: 'step', step: 'writing' });
      ac.abort();
      await Promise.race([aborted.promise, new Promise((_, rej) => setTimeout(() => rej(new Error('generator not aborted')), 5000))]);
      await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(path.join(dir, 'scenes', `${sceneId}.json`))).toBe(false);
      // the slot was released: a new generation runs
      gen.behavior = new FakeGenerator().behavior;
      await generateOk();
    } finally {
      gen.behavior = new FakeGenerator().behavior;
    }
  });

  it(`allows ${MAX_CONCURRENT_GENERATIONS} concurrent generations, then 429`, async () => {
    const release = deferred();
    let started = 0;
    const allStarted = deferred();
    gen.behavior = async (input) => {
      if (++started === MAX_CONCURRENT_GENERATIONS) allStarted.resolve();
      await release.promise;
      return { scene: sceneFor(input.sceneId), name: 'Slow', repairs: 0 };
    };
    try {
      const running = Array.from({ length: MAX_CONCURRENT_GENERATIONS }, () => postGenerate(VALID).then(events));
      await allStarted.promise;
      const extra = await postGenerate(VALID);
      expect(extra.status).toBe(429);
      expect(await extra.json()).toHaveProperty('error');
      release.resolve();
      for (const ev of await Promise.all(running)) expect(ev.at(-1)?.type).toBe('done');
    } finally {
      gen.behavior = new FakeGenerator().behavior;
    }
  });
});

describe('scenes: keep, list, render, delete', () => {
  it('keeps, lists newest first, renders a generated template and refuses deleting it while in use', async () => {
    const a = await generateOk();
    const b = await generateOk();
    expect((await fetch(`${base}/api/scenes/gen_doesnotexist/keep`, { method: 'POST' })).status).toBe(404);
    const kept = (await (await fetch(`${base}/api/scenes/${a.id}/keep`, { method: 'POST' })).json()) as GeneratedTemplate;
    expect(kept.kept).toBe(true);
    await fetch(`${base}/api/scenes/${b.id}/keep`, { method: 'POST' });
    const list = (await (await fetch(`${base}/api/scenes`)).json()) as GeneratedTemplate[];
    expect(list.slice(0, 2).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(list.every((x) => x.kept)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, 'scenes', `${a.id}.json`), 'utf8')).kept).toBe(true);

    const r = await postRender(a.id);
    expect(r.status).toBe(202);
    const job = (await r.json()) as RenderJob;
    const del = await fetch(`${base}/api/scenes/${a.id}`, { method: 'DELETE' });
    expect(del.status).toBe(409);
    const done = await waitFor(job.id, (j) => j.status !== 'queued' && j.status !== 'active');
    expect(done.status, done.error).toBe('completed');
    expect(done.frame).toBe(6);

    expect((await fetch(`${base}/api/scenes/${a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${base}/api/scenes/${a.id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/scenes/${a.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(existsSync(path.join(dir, 'scenes', `${a.id}.json`))).toBe(false);
    expect(getTemplate(a.id)).toBeUndefined();
    const again = await postRender(a.id);
    expect(again.status).toBe(400);
  });

  it('sweeps drafts older than 24 h unless a pending render uses them; kept ones never expire', async () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    const draft = await generateOk();
    const busy = await generateOk();
    const keptOld = await generateOk();
    await fetch(`${base}/api/scenes/${keptOld.id}/keep`, { method: 'POST' });
    for (const id of [draft.id, busy.id, keptOld.id]) (ctx.scenes.get(id) as { createdAt: string }).createdAt = old;

    const job = (await (await postRender(busy.id, 300)).json()) as RenderJob;
    await ctx.sweep();
    expect(ctx.scenes.has(draft.id)).toBe(false);
    expect(getTemplate(draft.id)).toBeUndefined();
    expect(existsSync(path.join(dir, 'scenes', `${draft.id}.json`))).toBe(false);
    expect(ctx.scenes.has(busy.id)).toBe(true);
    expect(ctx.scenes.has(keptOld.id)).toBe(true);

    await fetch(`${base}/api/renders/${job.id}`, { method: 'DELETE' });
    await ctx.sweep();
    expect(ctx.scenes.has(busy.id)).toBe(false);
    expect(ctx.scenes.has(keptOld.id)).toBe(true);
  });
});

describe('without a generator', () => {
  it('reports disabled status and answers 503', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'mg-gen-off-'));
    const off = createApp(makeConfig(d), { generation: { generator: null, reason: 'Set ANTHROPIC_API_KEY on the API server.' } });
    const url = `http://127.0.0.1:${await off.listen(0, '127.0.0.1')}`;
    try {
      expect(await (await fetch(`${url}/api/generate/status`)).json()).toEqual({ enabled: false, reason: 'Set ANTHROPIC_API_KEY on the API server.' });
      const res = await fetch(`${url}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID) });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'Set ANTHROPIC_API_KEY on the API server.' });
    } finally {
      await off.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('startup reload', () => {
  it('registers stored scenes and skips corrupt or invalid files without crashing', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'mg-gen-reload-'));
    const scenesDir = path.join(d, 'scenes');
    mkdirSync(scenesDir, { recursive: true });
    const rec = (id: string, scene: unknown, kept = true): GeneratedTemplate => ({
      id,
      name: 'Stored',
      prompt: 'stored prompt',
      kept,
      createdAt: '2026-11-01T10:00:00.000Z',
      model: 'fake-model-1',
      scene,
    });
    writeFileSync(path.join(scenesDir, 'gen_reloadok0001.json'), JSON.stringify(rec('gen_reloadok0001', sceneFor('gen_reloadok0001'))));
    writeFileSync(path.join(scenesDir, 'gen_reloadbad001.json'), '{ not json');
    const broken = sceneFor('gen_reloadbad002');
    delete broken.layers;
    writeFileSync(path.join(scenesDir, 'gen_reloadbad002.json'), JSON.stringify(rec('gen_reloadbad002', broken)));
    writeFileSync(path.join(scenesDir, 'gen_reloadbad003.json'), JSON.stringify(rec('gen_otherid00003', sceneFor('gen_otherid00003'))));
    writeFileSync(path.join(scenesDir, 'gen_reloadok0001.abc.tmp'), 'partial');

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    let app: AppContext;
    try {
      app = createApp(makeConfig(d), {});
    } finally {
      console.log = orig;
    }
    const url = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
    try {
      expect(getTemplate('gen_reloadok0001')?.origin).toBe('generated');
      for (const id of ['gen_reloadbad002', 'gen_otherid00003']) expect(getTemplate(id)).toBeUndefined();
      const list = (await (await fetch(`${url}/api/scenes`)).json()) as GeneratedTemplate[];
      expect(list.map((x) => x.id)).toEqual(['gen_reloadok0001']);
      expect(logs.filter((l) => l.includes('skipped')).length).toBe(3 + 1); // 3 files + the summary line
      expect(existsSync(path.join(scenesDir, 'gen_reloadok0001.abc.tmp'))).toBe(false);
      expect(existsSync(path.join(scenesDir, 'gen_reloadbad001.json'))).toBe(true); // left for inspection
      const r = await fetch(`${url}/api/renders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: { templateId: 'gen_reloadok0001', settings: { width: 216, height: 270, durationFrames: 3 } }, format: 'mp4' }),
      });
      expect(r.status).toBe(202);
      await fetch(`${url}/api/renders/${((await r.json()) as RenderJob).id}`, { method: 'DELETE' });
    } finally {
      await app.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});
