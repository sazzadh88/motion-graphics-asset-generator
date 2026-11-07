import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_ID_PATTERN } from '@mg/engine';
import type { ChildToParent, ParentToChild } from '@mg/worker';
import { repoRoot } from './config';
import type { JobQueue, JobRecord } from './queue/types';
import type { Storage } from './storage/types';

const CHILD_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker', 'src', 'child.ts');
const RESPAWN_DELAY_MS = 500;
const SHUTDOWN_GRACE_MS = 5000;

interface Slot {
  n: number;
  proc: ChildProcess | null;
  job?: JobRecord;
  outPath?: string;
  cancelRequested?: boolean;
  respawnTimer?: NodeJS.Timeout;
}

export interface PoolOptions {
  concurrency: number;
  queue: JobQueue;
  storage: Storage;
  /** The mg-scene@1 document of a generated (`gen_…`) template, sent to the child with the job. */
  resolveScene?: (templateId: string) => unknown;
  log?: (msg: string) => void;
}

/**
 * Long-lived render child processes (each keeps its own Chromium warm). A dispatcher hands the
 * oldest queued job to any idle child. Protocol: apps/worker/src/ipc.ts.
 */
export class WorkerPool {
  private readonly slots: Slot[] = [];
  private stopping = false;
  private unsubscribe?: () => void;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: PoolOptions) {
    this.log = opts.log ?? (() => undefined);
  }

  start(): void {
    for (let n = 0; n < this.opts.concurrency; n++) {
      const slot: Slot = { n, proc: null };
      this.slots.push(slot);
      this.spawn(slot);
    }
    const onEnqueued = () => this.dispatch();
    this.opts.queue.events.on('enqueued', onEnqueued);
    this.unsubscribe = () => this.opts.queue.events.off('enqueued', onEnqueued);
    this.dispatch();
  }

  private spawn(slot: Slot): void {
    if (this.stopping) return;
    const proc = fork(CHILD_ENTRY, [], { execArgv: ['--import', 'tsx'], cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    slot.proc = proc;
    proc.on('message', (m: ChildToParent) => void this.onMessage(slot, m));
    proc.on('error', (e) => this.log(`worker ${slot.n} error: ${e.message}`));
    proc.on('exit', (code, signal) => this.onExit(slot, proc, code, signal));
  }

  private onExit(slot: Slot, proc: ChildProcess, code: number | null, signal: string | null): void {
    if (slot.proc !== proc) return;
    slot.proc = null;
    const job = slot.job;
    if (job) {
      const outPath = slot.outPath;
      const cancelled = slot.cancelRequested;
      slot.job = undefined;
      slot.outPath = undefined;
      slot.cancelRequested = false;
      if (outPath) void rm(outPath, { force: true });
      if (!cancelled && !this.stopping) {
        this.log(`worker ${slot.n} died (code ${code}, signal ${signal}) while rendering ${job.id}`);
        this.opts.queue.fail(job.id, `Render process crashed (${signal ?? `exit code ${code}`})`, true);
      }
    }
    if (this.stopping) return;
    slot.respawnTimer = setTimeout(() => {
      this.spawn(slot);
      this.dispatch();
    }, RESPAWN_DELAY_MS);
  }

  private async onMessage(slot: Slot, m: ChildToParent): Promise<void> {
    const job = slot.job;
    if (!job || m.jobId !== job.id) return;
    const { queue, storage } = this.opts;
    if (m.type === 'progress') {
      queue.updateProgress(job.id, { phase: m.phase, frame: m.frame, percent: m.percent, fps: m.fps });
      return;
    }
    const outPath = slot.outPath;
    slot.job = undefined;
    slot.outPath = undefined;
    const cancelled = slot.cancelRequested;
    slot.cancelRequested = false;
    try {
      if (m.type === 'done') {
        const current = queue.get(job.id);
        if (cancelled || current?.status !== 'active') {
          if (outPath) await rm(outPath, { force: true });
        } else {
          const key = `${job.id}.${job.format}`;
          const { bytes } = await storage.putFile('outputs', key, outPath!);
          queue.complete(job.id, { key, bytes });
        }
      } else {
        if (outPath) await rm(outPath, { force: true });
        if (!cancelled && !m.cancelled) queue.fail(job.id, m.message, m.retryable);
      }
    } catch (e) {
      queue.fail(job.id, `Could not store the render output: ${e instanceof Error ? e.message : String(e)}`, false);
    } finally {
      this.dispatch();
    }
  }

  /** Hands queued jobs to idle children. */
  dispatch(): void {
    if (this.stopping) return;
    for (const slot of this.slots) {
      if (!slot.proc || slot.job) continue;
      const job = this.opts.queue.claimNext();
      if (!job) return;
      const assetsDir = this.opts.storage.localDir?.('assets');
      if (!assetsDir) {
        this.opts.queue.fail(job.id, 'Storage backend has no local asset directory', false);
        continue;
      }
      // Child processes and their render pages have their own engine instances: a generated
      // template travels with the job. Deleting a scene in use is refused (409), so it exists.
      let scene: unknown;
      if (GENERATED_ID_PATTERN.test(job.payload.templateId)) {
        scene = this.opts.resolveScene?.(job.payload.templateId);
        if (scene === undefined) {
          this.opts.queue.fail(job.id, 'This generated template no longer exists', false);
          continue;
        }
      }
      const outPath = path.join(this.opts.storage.tmpDir(), `${job.id}.${job.format}`);
      slot.job = job;
      slot.outPath = outPath;
      slot.cancelRequested = false;
      this.send(slot, {
        type: 'run',
        jobId: job.id,
        payload: job.payload,
        format: job.format,
        outPath,
        assetsDir,
        ...(scene !== undefined ? { scene } : {}),
      });
    }
  }

  private send(slot: Slot, msg: ParentToChild): void {
    try {
      slot.proc?.send(msg);
    } catch (e) {
      this.log(`could not message worker ${slot.n}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Aborts the render of an active job (the queue row is expected to be cancelled already). */
  cancel(jobId: string): boolean {
    const slot = this.slots.find((s) => s.job?.id === jobId);
    if (!slot) return false;
    slot.cancelRequested = true;
    this.send(slot, { type: 'cancel', jobId });
    return true;
  }

  /** Aborts active renders (they go back to the queue for the next start), stops and kills the children. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    const exits: Promise<void>[] = [];
    for (const slot of this.slots) {
      if (slot.respawnTimer) clearTimeout(slot.respawnTimer);
      if (slot.job) {
        this.opts.queue.release(slot.job.id);
        if (slot.outPath) void rm(slot.outPath, { force: true });
        slot.job = undefined;
      }
      const proc = slot.proc;
      if (!proc || proc.exitCode !== null) continue;
      exits.push(
        new Promise<void>((resolve) => {
          const kill = setTimeout(() => proc.kill('SIGKILL'), SHUTDOWN_GRACE_MS);
          proc.once('exit', () => {
            clearTimeout(kill);
            resolve();
          });
          this.send(slot, { type: 'shutdown' });
        }),
      );
    }
    await Promise.all(exits);
  }
}
