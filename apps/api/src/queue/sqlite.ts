import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { VideoFormat } from '@mg/contract';
import type { RenderJobPayload } from '@mg/engine';
import { MAX_ATTEMPTS } from './types';
import type { JobQueue, JobRecord, ProgressUpdate, QueueEvents } from './types';

const PERSIST_INTERVAL_MS = 1000;

interface Row {
  seq: number;
  id: string;
  status: JobRecord['status'];
  phase: JobRecord['phase'];
  format: VideoFormat;
  payload: string;
  progress: number;
  frame: number;
  render_fps: number;
  attempts: number;
  error: string | null;
  output_key: string | null;
  output_bytes: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface Live {
  phase: JobRecord['phase'];
  frame: number;
  progress: number;
  renderFps: number;
  lastPersist: number;
}

export class SqliteQueue implements JobQueue {
  readonly events = new EventEmitter<QueueEvents>();
  private readonly db: DatabaseSync;
  /** Latest in-memory progress of active jobs (persisted to the db at most about once a second). */
  private readonly live = new Map<string, Live>();

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        format TEXT NOT NULL,
        payload TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        frame INTEGER NOT NULL DEFAULT 0,
        render_fps REAL NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        output_key TEXT,
        output_bytes INTEGER,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_status_seq ON jobs (status, seq);
    `);
  }

  private toRecord(r: Row): JobRecord {
    const live = r.status === 'active' ? this.live.get(r.id) : undefined;
    const job: JobRecord = {
      id: r.id,
      status: r.status,
      phase: live?.phase ?? r.phase,
      format: r.format,
      payload: JSON.parse(r.payload) as RenderJobPayload,
      progress: live?.progress ?? r.progress,
      frame: live?.frame ?? r.frame,
      renderFps: live?.renderFps ?? r.render_fps,
      attempts: r.attempts,
      createdAt: r.created_at,
    };
    if (r.error) job.error = r.error;
    if (r.output_key) job.outputKey = r.output_key;
    if (r.output_bytes !== null) job.outputBytes = r.output_bytes;
    if (r.started_at) job.startedAt = r.started_at;
    if (r.finished_at) job.finishedAt = r.finished_at;
    if (r.status === 'queued') {
      const pos = this.db
        .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND seq <= ?`)
        .get(r.seq) as { n: number | bigint };
      job.queuePosition = Number(pos.n);
    }
    return job;
  }

  private row(id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
  }

  /**
   * Writes the in-memory progress of an active job to its row and forgets it. Called before every
   * transition out of 'active', so a read after the transition is never older than one before it.
   */
  private flushLive(id: string): void {
    const l = this.live.get(id);
    if (!l) return;
    this.live.delete(id);
    this.db
      .prepare(`UPDATE jobs SET phase = ?, frame = ?, progress = ?, render_fps = ? WHERE id = ? AND status = 'active'`)
      .run(l.phase, l.frame, l.progress, l.renderFps, id);
  }

  private emit(id: string, enqueued = false): JobRecord | undefined {
    const r = this.row(id);
    if (!r) return undefined;
    const job = this.toRecord(r);
    this.events.emit('update', job);
    if (enqueued) this.events.emit('enqueued', job);
    return job;
  }

  add(payload: RenderJobPayload, format: VideoFormat): JobRecord {
    const id = randomBytes(12).toString('base64url');
    this.db
      .prepare(`INSERT INTO jobs (id, status, phase, format, payload, created_at) VALUES (?, 'queued', 'queued', ?, ?, ?)`)
      .run(id, format, JSON.stringify(payload), new Date().toISOString());
    return this.emit(id, true)!;
  }

  get(id: string): JobRecord | undefined {
    const r = this.row(id);
    return r ? this.toRecord(r) : undefined;
  }

  list(limit: number): JobRecord[] {
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY seq DESC LIMIT ?').all(limit) as unknown as Row[];
    return rows.map((r) => this.toRecord(r));
  }

  countQueued(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'`).get() as { n: number | bigint }).n);
  }

  countActive(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'active'`).get() as { n: number | bigint }).n);
  }

  pendingPayloads(): RenderJobPayload[] {
    const rows = this.db.prepare(`SELECT payload FROM jobs WHERE status IN ('queued', 'active')`).all() as unknown as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as RenderJobPayload);
  }

  cancel(id: string): { job: JobRecord; wasActive: boolean; changed: boolean } | undefined {
    const before = this.row(id);
    if (!before) return undefined;
    if (before.status !== 'queued' && before.status !== 'active') return { job: this.toRecord(before), wasActive: false, changed: false };
    this.flushLive(id);
    this.db
      .prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?, error = NULL WHERE id = ? AND status IN ('queued', 'active')`)
      .run(new Date().toISOString(), id);
    const job = this.emit(id)!;
    return { job, wasActive: before.status === 'active', changed: true };
  }

  claimNext(): JobRecord | undefined {
    const r = this.db
      .prepare(
        `UPDATE jobs SET status = 'active', phase = 'preparing', progress = 0, frame = 0, render_fps = 0, error = NULL, started_at = ?
         WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY seq LIMIT 1) RETURNING id`,
      )
      .get(new Date().toISOString()) as { id: string } | undefined;
    if (!r) return undefined;
    this.live.set(r.id, { phase: 'preparing', frame: 0, progress: 0, renderFps: 0, lastPersist: Date.now() });
    return this.emit(r.id);
  }

  updateProgress(id: string, p: ProgressUpdate): void {
    const live = this.live.get(id);
    if (!live) return; // not active (cancelled meanwhile)
    const phaseChanged = live.phase !== p.phase;
    live.phase = p.phase;
    live.frame = p.frame;
    live.progress = p.percent;
    live.renderFps = p.fps;
    const now = Date.now();
    if (phaseChanged || now - live.lastPersist >= PERSIST_INTERVAL_MS) {
      live.lastPersist = now;
      this.db
        .prepare(`UPDATE jobs SET phase = ?, frame = ?, progress = ?, render_fps = ? WHERE id = ? AND status = 'active'`)
        .run(p.phase, p.frame, p.percent, p.fps, id);
    }
    this.emit(id);
  }

  complete(id: string, output: { key: string; bytes: number }): JobRecord | undefined {
    this.flushLive(id); // keeps the last known frame count and fps
    const res = this.db
      .prepare(
        `UPDATE jobs SET status = 'completed', phase = 'done', progress = 100, output_key = ?, output_bytes = ?, finished_at = ?, error = NULL
         WHERE id = ? AND status = 'active'`,
      )
      .run(output.key, output.bytes, new Date().toISOString(), id);
    if (!res.changes) return undefined;
    return this.emit(id);
  }

  fail(id: string, error: string, retryable: boolean): JobRecord | undefined {
    const r = this.row(id);
    if (!r || r.status !== 'active') return undefined;
    this.flushLive(id);
    if (retryable && r.attempts + 1 < MAX_ATTEMPTS) {
      this.db
        .prepare(`UPDATE jobs SET status = 'queued', phase = 'queued', progress = 0, frame = 0, render_fps = 0, attempts = attempts + 1, started_at = NULL WHERE id = ?`)
        .run(id);
      return this.emit(id, true);
    }
    this.db
      .prepare(`UPDATE jobs SET status = 'failed', attempts = attempts + 1, error = ?, finished_at = ? WHERE id = ?`)
      .run(error, new Date().toISOString(), id);
    return this.emit(id);
  }

  release(id: string): void {
    const res = this.db
      .prepare(`UPDATE jobs SET status = 'queued', phase = 'queued', progress = 0, frame = 0, render_fps = 0, started_at = NULL WHERE id = ? AND status = 'active'`)
      .run(id);
    this.live.delete(id);
    if (res.changes) this.emit(id);
  }

  requeueStale(): number {
    const rows = this.db.prepare(`SELECT id FROM jobs WHERE status = 'active'`).all() as { id: string }[];
    for (const { id } of rows) this.fail(id, 'Interrupted by a server restart', true);
    return rows.length;
  }

  close(): void {
    // flush in-memory progress of whatever is still active
    for (const [id, l] of this.live) {
      this.db
        .prepare(`UPDATE jobs SET phase = ?, frame = ?, progress = ?, render_fps = ? WHERE id = ? AND status = 'active'`)
        .run(l.phase, l.frame, l.progress, l.renderFps, id);
    }
    this.live.clear();
    this.db.close();
  }
}
