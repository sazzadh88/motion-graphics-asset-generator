import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import express from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { ASSET_URL_PATTERN } from '@mg/contract';
import type {
  ApiError,
  AssetUploadResponse,
  CreateRenderRequest,
  GeneratedTemplate,
  GenerateEvent,
  GenerateRequest,
  GenerateStatus,
  TemplateSummary,
} from '@mg/contract';
import { GENERATED_ID_PATTERN, LIMITS, getTemplate, listTemplates, validatePayload } from '@mg/engine';
import { shutdown as shutdownWorkerBrowsers, sniffImage } from '@mg/worker';
import type { Config } from './config';
import { GenerateError } from './generate';
import type { SceneGenerator } from './generate';
import { newSceneId, SceneStore } from './scenes';
import { friendlyFilename, outputExpired, toRenderJob } from './jobView';
import { WorkerPool } from './pool';
import { SqliteQueue } from './queue/sqlite';
import type { JobQueue } from './queue/types';
import { attachSockets } from './sockets';
import { LocalStorage } from './storage/local';
import { UrlSigner } from './storage/signing';
import type { Storage } from './storage/types';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const TMP_MAX_AGE_MS = 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** Generations running at once (each holds a model connection for up to a few minutes). */
export const MAX_CONCURRENT_GENERATIONS = 2;
const MAX_PROMPT_CHARS = 2000;
const MAX_PALETTE_COLORS = 16;
const DRAFT_TTL_MS = 24 * 3600_000;
const HEX6 = /^#[0-9a-f]{6}$/i;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

/** The scene generator as configured at startup (see ./generate createGenerator). */
export interface GenerationSetup {
  generator: SceneGenerator | null;
  model?: string;
  /** Why generation is disabled, shown to the studio. */
  reason?: string;
}

export interface AppOptions {
  /** Defaults to disabled. */
  generation?: GenerationSetup;
}

export interface AppContext {
  app: express.Express;
  server: HttpServer;
  queue: JobQueue;
  storage: Storage;
  signer: UrlSigner;
  scenes: SceneStore;
  /** Starts the worker pool and sweeper, then listens. Resolves with the bound port. */
  listen(port?: number, host?: string): Promise<number>;
  /** Deletes expired outputs, expired unreferenced assets, old unreferenced drafts and orphaned temp files now. */
  sweep(): Promise<void>;
  /** Graceful shutdown: stop accepting, abort active renders, kill children, close db and browsers. */
  close(): Promise<void>;
}

/** Receives one `file` field into a temp file, enforcing the size cap. */
function receiveUpload(req: Request, tmpDir: string): Promise<{ tmpPath: string }> {
  return new Promise((resolve, reject) => {
    if (!req.is('multipart/form-data')) return reject(new HttpError(415, 'Expected multipart/form-data with a "file" field'));
    const tmpPath = path.join(tmpDir, `upload-${randomBytes(8).toString('hex')}`);
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 10, parts: 12 } });
    } catch {
      return reject(new HttpError(400, 'Malformed multipart request'));
    }
    let written: Promise<void> | undefined;
    let truncated = false;
    let tooMany = false;
    let failed: Error | undefined;
    bb.on('file', (name, stream) => {
      if (name !== 'file' || written) {
        stream.resume();
        return;
      }
      stream.on('limit', () => {
        truncated = true;
      });
      written = pipeline(stream, createWriteStream(tmpPath));
      written.catch((e: Error) => {
        failed = e;
      });
    });
    bb.on('filesLimit', () => {
      tooMany = true;
    });
    bb.on('error', (e) => {
      failed = e instanceof Error ? e : new Error(String(e));
    });
    bb.on('close', () => {
      void (async () => {
        await written?.catch(() => undefined);
        const cleanup = () => rm(tmpPath, { force: true }).catch(() => undefined);
        if (truncated) {
          await cleanup();
          return reject(new HttpError(413, `File too large (max ${MAX_UPLOAD_BYTES / 1048576} MB)`));
        }
        if (failed) {
          await cleanup();
          return reject(new HttpError(400, 'Malformed multipart request'));
        }
        if (!written) return reject(new HttpError(400, 'Missing "file" field'));
        if (tooMany) {
          await cleanup();
          return reject(new HttpError(400, 'Upload exactly one file'));
        }
        resolve({ tmpPath });
      })();
    });
    req.pipe(bb);
  });
}

async function readHead(storage: Storage, key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of await storage.read('assets', key, { start: 0, end: 15 })) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Hides anything that looks like an API key before text leaves the server. */
function scrub(text: string): string {
  let out = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]');
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  return out;
}

interface ValidGenerateRequest {
  prompt: string;
  image: { mime: string; base64: string } | null;
  palette: { colors: { hex: string; weight: number }[] } | null;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  base: GeneratedTemplate | null;
}

export function createApp(config: Config, options: AppOptions = {}): AppContext {
  const storage = new LocalStorage(config.storageDir);
  const queue: JobQueue = new SqliteQueue(path.join(config.storageDir, 'mg.sqlite'));
  const signer = new UrlSigner(config.signingSecret, config.downloadUrlTtlSeconds);
  const generation: GenerationSetup = options.generation ?? { generator: null, reason: 'Generation is not configured on the API server.' };

  // Generated templates must be registered before any render request or queued job needs them.
  const scenes = new SceneStore(path.join(config.storageDir, 'scenes'), (m) => console.log(m));
  const { loaded, skipped } = scenes.load();
  if (loaded || skipped) console.log(`[api] loaded ${loaded} generated template(s)${skipped ? `, skipped ${skipped} invalid file(s)` : ''}`);

  // Startup recovery: jobs left active by a crash go back to the queue (or fail after 2 attempts).
  const recovered = queue.requeueStale();
  if (recovered) console.log(`[api] recovered ${recovered} interrupted job(s)`);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const a = <T extends express.RequestHandler>(fn: T): express.RequestHandler => fn;

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', queued: queue.countQueued(), active: queue.countActive(), concurrency: config.renderConcurrency });
  });

  // Bundled templates only: generated ones are served by /api/scenes.
  app.get('/api/templates', (_req, res) => {
    const out: TemplateSummary[] = listTemplates()
      .filter((t) => t.origin !== 'generated')
      .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      defaultSettings: t.defaultSettings,
      params: t.params,
    }));
    res.json(out);
  });

  // ------------------------------------------------------------ assets
  app.post(
    '/api/assets',
    a(async (req, res) => {
      const { tmpPath } = await receiveUpload(req, storage.tmpDir());
      try {
        const fh = await open(tmpPath, 'r');
        const head = Buffer.alloc(16);
        let n = 0;
        try {
          n = (await fh.read(head, 0, 16, 0)).bytesRead;
        } finally {
          await fh.close();
        }
        const mime = sniffImage(head.subarray(0, n));
        if (!mime) throw new HttpError(415, 'Unsupported file type: upload a PNG, JPEG, WebP or GIF image');
        const id = randomBytes(16).toString('base64url');
        const { bytes } = await storage.putFile('assets', id, tmpPath);
        const body: AssetUploadResponse = { id, url: `/api/assets/${id}`, mime, bytes };
        res.status(201).json(body);
      } catch (e) {
        await rm(tmpPath, { force: true }).catch(() => undefined);
        throw e;
      }
    }),
  );

  app.get(
    '/api/assets/:id',
    a(async (req, res) => {
      const id = String(req.params.id);
      if (!ID_PATTERN.test(id) || !(await storage.stat('assets', id))) throw new HttpError(404, 'Asset not found');
      const mime = sniffImage(await readHead(storage, id));
      if (!mime) throw new HttpError(404, 'Asset not found');
      res.set({
        'Content-Type': mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      await pipeline(await storage.read('assets', id), res);
    }),
  );

  // ------------------------------------------------------------ renders
  app.post(
    '/api/renders',
    a(async (req, res) => {
      const body = req.body as Partial<CreateRenderRequest> | undefined;
      if (typeof body !== 'object' || body === null || typeof body.payload !== 'object' || body.payload === null)
        throw new HttpError(400, 'Invalid request', ['body must be { payload, format }']);
      if (body.format !== 'mp4' && body.format !== 'webm') throw new HttpError(400, 'Invalid request', ['format must be "mp4" or "webm"']);
      const v = validatePayload(body.payload);
      if (!v.ok) throw new HttpError(400, 'Invalid payload', v.errors);

      const errors: string[] = [];
      const t = getTemplate(v.payload.templateId)!;
      for (const p of t.params) {
        if (p.type !== 'image') continue;
        const val = v.payload.assets[p.key];
        if (val === null || val === undefined || val === '') {
          v.payload.assets[p.key] = null;
          continue;
        }
        if (typeof val !== 'string' || !ASSET_URL_PATTERN.test(val)) {
          errors.push(`assets.${p.key} must be empty or the URL of an uploaded asset (/api/assets/<id>)`);
        } else if (!(await storage.stat('assets', val.slice('/api/assets/'.length)))) {
          errors.push(`assets.${p.key}: asset not found`);
        }
      }
      if (errors.length) throw new HttpError(400, 'Invalid payload', errors);
      // A generated template may have been deleted while the asset checks were awaited.
      if (GENERATED_ID_PATTERN.test(v.payload.templateId) && !scenes.has(v.payload.templateId))
        throw new HttpError(400, 'Invalid payload', [`unknown templateId: ${v.payload.templateId}`]);

      if (queue.countQueued() >= config.maxQueued) throw new HttpError(429, 'Render queue is full, try again shortly');
      const job = queue.add(v.payload, body.format);
      res.status(202).json(toRenderJob(job, config, signer));
    }),
  );

  app.get('/api/renders', (_req, res) => {
    res.json(queue.list(50).map((j) => toRenderJob(j, config, signer)));
  });

  app.get('/api/renders/:id', (req, res) => {
    const job = queue.get(String(req.params.id));
    if (!job) throw new HttpError(404, 'Render not found');
    res.json(toRenderJob(job, config, signer));
  });

  let pool: WorkerPool | undefined;
  app.delete('/api/renders/:id', (req, res) => {
    const r = queue.cancel(String(req.params.id));
    if (!r) throw new HttpError(404, 'Render not found');
    if (!r.changed) throw new HttpError(409, `Render already ${r.job.status}`);
    if (r.wasActive) pool?.cancel(r.job.id);
    res.json(toRenderJob(r.job, config, signer));
  });

  app.get(
    '/api/files/:id',
    a(async (req, res) => {
      const id = String(req.params.id);
      if (!signer.verify(id, req.query.exp, req.query.sig)) throw new HttpError(403, 'Invalid or expired download link');
      const job = queue.get(id);
      if (!job || job.status !== 'completed' || !job.outputKey) throw new HttpError(404, 'File not found');
      if (outputExpired(job, config)) throw new HttpError(410, 'This file has expired');
      const st = await storage.stat('outputs', job.outputKey);
      if (!st) throw new HttpError(410, 'This file is no longer available');
      res.set({
        'Content-Type': job.format === 'webm' ? 'video/webm' : 'video/mp4',
        'Content-Length': String(st.bytes),
        'Content-Disposition': `attachment; filename="${friendlyFilename(job)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=0, no-store',
      });
      await pipeline(await storage.read('outputs', job.outputKey), res);
    }),
  );

  // ------------------------------------------------------------ generated templates
  /** Template ids used by queued or active jobs (those scenes must not be deleted). */
  const templatesInUse = (): Set<string> => new Set(queue.pendingPayloads().map((p) => p.templateId));

  app.get('/api/generate/status', (_req, res) => {
    const g = generation.generator;
    const body: GenerateStatus = g
      ? { enabled: true, model: g.model }
      : { enabled: false, ...(generation.reason ? { reason: generation.reason } : {}) };
    res.json(body);
  });

  const validateGenerate = async (input: unknown): Promise<ValidGenerateRequest> => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new HttpError(400, 'Invalid request', ['body must be a JSON object']);
    const b = input as Partial<Record<keyof GenerateRequest, unknown>>;
    const errors: string[] = [];
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
    if (typeof b.prompt !== 'string' || !prompt) errors.push('prompt must be a non-empty string');
    else if (prompt.length > MAX_PROMPT_CHARS) errors.push(`prompt must be at most ${MAX_PROMPT_CHARS} characters`);

    const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
    for (const k of ['width', 'height'] as const) {
      const v = b[k];
      if (!isInt(v) || v < LIMITS.minSize || v > LIMITS.maxSize) errors.push(`${k} must be an integer between ${LIMITS.minSize} and ${LIMITS.maxSize}`);
      else if (v % 2) errors.push(`${k} must be even`);
    }
    const fpsOk = typeof b.fps === 'number' && (LIMITS.fps as readonly number[]).includes(b.fps);
    if (!fpsOk) errors.push(`fps must be one of ${LIMITS.fps.join(', ')}`);
    const d = b.durationSeconds;
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0 || d > LIMITS.maxDurationSeconds)
      errors.push(`durationSeconds must be a number above 0 and at most ${LIMITS.maxDurationSeconds}`);
    else if (fpsOk && Math.round(d * (b.fps as number)) < 1) errors.push('durationSeconds is shorter than one frame');

    let palette: ValidGenerateRequest['palette'] = null;
    if (b.palette !== undefined && b.palette !== null) {
      const colors = typeof b.palette === 'object' ? (b.palette as { colors?: unknown }).colors : undefined;
      const okColor = (c: unknown): c is { hex: string; weight: number } => {
        if (typeof c !== 'object' || c === null) return false;
        const { hex, weight } = c as { hex?: unknown; weight?: unknown };
        return typeof hex === 'string' && HEX6.test(hex) && typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1;
      };
      if (!Array.isArray(colors) || colors.length < 1 || colors.length > MAX_PALETTE_COLORS || !colors.every(okColor))
        errors.push(`palette must be { colors: [{ hex: "#RRGGBB", weight: 0..1 }] } with 1..${MAX_PALETTE_COLORS} colors`);
      else palette = { colors: colors.map((c) => ({ hex: c.hex.toUpperCase(), weight: c.weight })) };
    }

    let base: GeneratedTemplate | null = null;
    if (b.baseSceneId !== undefined && b.baseSceneId !== null) {
      const rec = typeof b.baseSceneId === 'string' ? scenes.get(b.baseSceneId) : undefined;
      if (!rec) errors.push('baseSceneId: generated template not found');
      else base = rec;
    }

    let image: ValidGenerateRequest['image'] = null;
    if (b.imageUrl !== undefined && b.imageUrl !== null && b.imageUrl !== '') {
      if (typeof b.imageUrl !== 'string' || !ASSET_URL_PATTERN.test(b.imageUrl)) {
        errors.push('imageUrl must be empty or the URL of an uploaded asset (/api/assets/<id>)');
      } else {
        const id = b.imageUrl.slice('/api/assets/'.length);
        const dir = storage.localDir?.('assets');
        const buf = dir && (await storage.stat('assets', id)) ? await readFile(path.join(dir, id)).catch(() => null) : null;
        const mime = buf ? sniffImage(buf.subarray(0, 16)) : null;
        if (!buf || !mime) errors.push('imageUrl: asset not found');
        else image = { mime, base64: buf.toString('base64') };
      }
    }

    if (errors.length) throw new HttpError(400, 'Invalid request', errors);
    return {
      prompt,
      image,
      palette,
      width: b.width as number,
      height: b.height as number,
      fps: b.fps as number,
      durationSeconds: d as number,
      base,
    };
  };

  let generating = 0;
  app.post(
    '/api/generate',
    a(async (req, res) => {
      const generator = generation.generator;
      if (!generator) throw new HttpError(503, generation.reason ?? 'Generation is not configured on the API server.');
      const input = await validateGenerate(req.body);
      if (generating >= MAX_CONCURRENT_GENERATIONS)
        throw new HttpError(429, 'Too many generations are running, try again in a minute');
      generating++;

      const ac = new AbortController();
      // 'close' also fires after a normal end; only an unfinished response means the client left.
      const onClose = () => {
        if (!res.writableEnded) ac.abort();
      };
      res.on('close', onClose);
      res.status(200).set({
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const send = (e: GenerateEvent) => {
        if (!ac.signal.aborted && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(e)}\n`);
      };

      try {
        const sceneId = newSceneId();
        const result = await generator.generate({
          sceneId,
          prompt: input.prompt,
          image: input.image,
          palette: input.palette,
          width: input.width,
          height: input.height,
          fps: input.fps,
          durationSeconds: input.durationSeconds,
          baseScene: input.base?.scene ?? null,
          signal: ac.signal,
          onEvent: (e) => {
            if (e.type === 'step' || e.type === 'issues') send(e);
          },
        });
        if (ac.signal.aborted) return;
        send({ type: 'step', step: 'saving', attempt: result.repairs + 1, message: 'Saving template' });
        // The generator already forces the id; enforced again so a record can never mismatch its scene.
        const scene = typeof result.scene === 'object' && result.scene !== null ? { ...(result.scene as object), id: sceneId } : result.scene;
        const rec: GeneratedTemplate = {
          id: sceneId,
          name: typeof result.name === 'string' && result.name.trim() ? result.name.trim().slice(0, 80) : 'Untitled',
          prompt: input.prompt,
          ...(input.base ? { baseSceneId: input.base.id } : {}),
          kept: false,
          createdAt: new Date().toISOString(),
          model: generator.model,
          scene,
        };
        try {
          await scenes.save(rec);
        } catch (e) {
          console.error('[api] generated scene could not be saved:', e instanceof Error ? e.message : e);
          send({ type: 'error', error: 'The generated template could not be saved. Please try again.' });
          return;
        }
        send({ type: 'done', template: rec, repairs: result.repairs });
      } catch (e) {
        if (ac.signal.aborted) return; // the client went away: nobody to tell
        if (e instanceof GenerateError) {
          send({
            type: 'error',
            error: scrub(e.message || 'Generation failed'),
            ...(e.issues?.length ? { issues: e.issues.map(scrub) } : {}),
          });
        } else {
          console.error('[api] generation failed:', e instanceof Error ? scrub(e.message) : e);
          send({ type: 'error', error: 'Generation failed unexpectedly. Please try again.' });
        }
      } finally {
        generating--;
        res.off('close', onClose);
        if (!res.writableEnded && !res.destroyed) res.end();
      }
    }),
  );

  app.get('/api/scenes', (_req, res) => {
    res.json(scenes.listKept());
  });

  app.get('/api/scenes/:id', (req, res) => {
    const rec = scenes.get(String(req.params.id));
    if (!rec) throw new HttpError(404, 'Template not found');
    res.json(rec);
  });

  app.post(
    '/api/scenes/:id/keep',
    a(async (req, res) => {
      const rec = await scenes.keep(String(req.params.id));
      if (!rec) throw new HttpError(404, 'Template not found');
      res.json(rec);
    }),
  );

  app.delete(
    '/api/scenes/:id',
    a(async (req, res) => {
      const id = String(req.params.id);
      if (!scenes.has(id)) throw new HttpError(404, 'Template not found');
      if (templatesInUse().has(id)) throw new HttpError(409, 'This template is used by a queued or running render');
      await scenes.delete(id);
      res.status(204).end();
    }),
  );

  // ------------------------------------------------------------ errors
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    let status = 500;
    let body: ApiError = { error: 'Internal server error' };
    if (err instanceof HttpError) {
      status = err.status;
      body = { error: err.message, ...(err.details ? { details: err.details } : {}) };
    } else if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
      status = err.status;
      const type = 'type' in err ? String(err.type) : '';
      body = { error: type === 'entity.too.large' ? 'Request body too large' : type === 'entity.parse.failed' ? 'Invalid JSON body' : 'Bad request' };
    } else {
      console.error('[api] unexpected error:', err);
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).json(body);
  };
  app.use(onError);

  // ------------------------------------------------------------ server, sockets, pool, sweeper
  const server = createServer(app);
  const sockets = attachSockets(server, queue, config, signer);
  let sweeper: NodeJS.Timeout | undefined;
  let closed = false;

  /** Asset ids referenced by queued or active jobs (their files must outlive the asset TTL). */
  const assetsInUse = (): Set<string> => {
    const ids = new Set<string>();
    for (const payload of queue.pendingPayloads()) {
      for (const v of Object.values(payload.assets)) {
        if (typeof v === 'string' && ASSET_URL_PATTERN.test(v)) ids.add(v.slice('/api/assets/'.length));
      }
    }
    return ids;
  };

  const sweep = async () => {
    const ttl = config.outputTtlHours * 3600_000;
    for (const key of await storage.listOlderThan('outputs', new Date(Date.now() - ttl))) await storage.delete('outputs', key);
    const oldAssets = await storage.listOlderThan('assets', new Date(Date.now() - config.assetTtlDays * 86_400_000));
    for (const key of oldAssets) {
      // Re-checked per file: a job may have been queued while earlier deletes were awaited.
      if (!assetsInUse().has(key)) await storage.delete('assets', key);
    }
    for (const draft of scenes.draftsOlderThan(new Date(Date.now() - DRAFT_TTL_MS))) {
      // Re-checked per draft, like assets: a render may have been queued meanwhile.
      if (!templatesInUse().has(draft.id)) await scenes.delete(draft.id);
    }
    const tmp = storage.tmpDir();
    const cutoff = Date.now() - TMP_MAX_AGE_MS;
    for (const name of await readdir(tmp).catch(() => [] as string[])) {
      const f = path.join(tmp, name);
      const { mtimeMs } = await stat(f).catch(() => ({ mtimeMs: Infinity }));
      if (mtimeMs < cutoff) await rm(f, { force: true, recursive: true });
    }
  };

  // Temp files left by a crashed previous run (nothing can be in flight yet).
  void (async () => {
    for (const name of await readdir(storage.tmpDir()).catch(() => [] as string[])) await rm(path.join(storage.tmpDir(), name), { force: true, recursive: true });
  })();

  return {
    app,
    server,
    queue,
    storage,
    signer,
    scenes,
    sweep,
    async listen(port = config.port, host = config.host) {
      pool = new WorkerPool({
        concurrency: config.renderConcurrency,
        queue,
        storage,
        resolveScene: (id) => scenes.get(id)?.scene,
        log: (m) => console.log(`[pool] ${m}`),
      });
      pool.start();
      sweeper = setInterval(() => void sweep().catch((e) => console.error('[api] sweep failed:', e)), SWEEP_INTERVAL_MS);
      sweeper.unref();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve());
      });
      return (server.address() as AddressInfo).port;
    },
    async close() {
      if (closed) return;
      closed = true;
      if (sweeper) clearInterval(sweeper);
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
      await sockets.close(); // also closes the http server's upgraded connections
      server.closeAllConnections();
      await stopped.catch(() => undefined);
      await pool?.shutdown();
      queue.close();
      await shutdownWorkerBrowsers().catch(() => undefined);
    },
  };
}
