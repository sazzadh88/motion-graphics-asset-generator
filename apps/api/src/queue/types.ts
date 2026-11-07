import type { EventEmitter } from 'node:events';
import type { JobPhase, JobStatus, VideoFormat } from '@mg/contract';
import type { RenderJobPayload } from '@mg/engine';

export interface JobRecord {
  id: string;
  status: JobStatus;
  phase: JobPhase;
  format: VideoFormat;
  payload: RenderJobPayload;
  /** 0..100 */
  progress: number;
  frame: number;
  renderFps: number;
  attempts: number;
  error?: string;
  outputKey?: string;
  outputBytes?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 1-based, only when status is 'queued'. */
  queuePosition?: number;
}

export interface ProgressUpdate {
  phase: JobPhase;
  frame: number;
  percent: number;
  fps: number;
}

/** A job that has been started this many times (crash / retryable error) is failed. */
export const MAX_ATTEMPTS = 2;

/** Events: 'update' on any change (including every progress tick), 'enqueued' when work is available. */
export type QueueEvents = { update: [JobRecord]; enqueued: [JobRecord] };

/**
 * Job queue abstraction. SqliteQueue is the only implementation today (no Redis needed).
 * A BullMQ adapter would go in src/queue/bullmq.ts: add -> Queue.add, claimNext -> a Worker
 * fed through the pool's idle slots, progress -> job.updateProgress, events -> QueueEvents.
 * Everything besides job creation must tolerate calls for jobs that are no longer active
 * (cancelled meanwhile): they are ignored.
 */
export interface JobQueue {
  readonly events: EventEmitter<QueueEvents>;
  add(payload: RenderJobPayload, format: VideoFormat): JobRecord;
  get(id: string): JobRecord | undefined;
  /** Most recent first. */
  list(limit: number): JobRecord[];
  countQueued(): number;
  countActive(): number;
  /** Payloads of every queued and active job (used to keep the assets they reference). */
  pendingPayloads(): RenderJobPayload[];
  /** Cancels a queued or active job immediately. Returns undefined when unknown, or the job unchanged when finished. */
  cancel(id: string): { job: JobRecord; wasActive: boolean; changed: boolean } | undefined;
  /** Atomically moves the oldest queued job to active. */
  claimNext(): JobRecord | undefined;
  updateProgress(id: string, p: ProgressUpdate): void;
  complete(id: string, output: { key: string; bytes: number }): JobRecord | undefined;
  /** Fails the job, or sends it back to the queue when `retryable` and attempts remain. */
  fail(id: string, error: string, retryable: boolean): JobRecord | undefined;
  /** Returns an active job to the queue without counting an attempt (graceful shutdown). */
  release(id: string): void;
  /** Crash recovery on startup: every active job is requeued (attempts+1) or failed. Returns the number touched. */
  requeueStale(): number;
  close(): void;
}
