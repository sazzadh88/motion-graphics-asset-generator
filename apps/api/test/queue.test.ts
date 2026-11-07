import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPayload } from '@mg/engine';
import { SqliteQueue } from '../src/queue/sqlite';
import type { JobRecord } from '../src/queue/types';

let dir: string;
let queue: SqliteQueue;
/** A second connection to the same file: it has no in-memory progress, so it sees only what was persisted. */
let persisted: SqliteQueue;

beforeEach(() => {
  // Freeze the clock so progress ticks are never persisted by the 1 s throttle (only on phase changes).
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  dir = mkdtempSync(path.join(tmpdir(), 'mg-queue-test-'));
  const file = path.join(dir, 'mg.sqlite');
  queue = new SqliteQueue(file);
  persisted = new SqliteQueue(file);
});

afterEach(() => {
  queue.close();
  persisted.close();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Claims a new job and reports frame 10 (persisted: phase change) then frame 59 (in memory only). */
function renderingJob(): JobRecord {
  const job = queue.add(defaultPayload('banner_v1'), 'mp4');
  expect(queue.claimNext()?.id).toBe(job.id);
  queue.updateProgress(job.id, { phase: 'rendering', frame: 10, percent: 10, fps: 30 });
  queue.updateProgress(job.id, { phase: 'rendering', frame: 59, percent: 59, fps: 31 });
  expect(queue.get(job.id)?.frame).toBe(59);
  expect(persisted.get(job.id)?.frame).toBe(10); // precondition: the row is behind the live progress
  return job;
}

describe('progress on status transitions', () => {
  it('cancel keeps the latest in-memory progress', () => {
    const job = renderingJob();
    const updates: JobRecord[] = [];
    queue.events.on('update', (j) => updates.push(j));

    const r = queue.cancel(job.id)!;
    expect(r.wasActive).toBe(true);
    expect(r.job).toMatchObject({ status: 'cancelled', phase: 'rendering', frame: 59, progress: 59, renderFps: 31 });
    expect(updates.at(-1)).toMatchObject({ status: 'cancelled', frame: 59 });
    expect(queue.get(job.id)).toMatchObject({ status: 'cancelled', frame: 59, progress: 59 });
    expect(persisted.get(job.id)).toMatchObject({ status: 'cancelled', frame: 59, progress: 59 });
  });

  it('a non-retryable failure keeps the latest in-memory progress', () => {
    const job = renderingJob();
    const failed = queue.fail(job.id, 'boom', false)!;
    expect(failed).toMatchObject({ status: 'failed', error: 'boom', frame: 59, progress: 59 });
    expect(persisted.get(job.id)).toMatchObject({ status: 'failed', frame: 59, progress: 59 });
  });

  it('completion keeps the latest frame count and fps', () => {
    const job = renderingJob();
    const done = queue.complete(job.id, { key: `${job.id}.mp4`, bytes: 123 })!;
    expect(done).toMatchObject({ status: 'completed', phase: 'done', progress: 100, frame: 59, renderFps: 31 });
    expect(persisted.get(job.id)).toMatchObject({ status: 'completed', progress: 100, frame: 59, renderFps: 31 });
  });

  it('a retryable failure still starts the next attempt from zero', () => {
    const job = renderingJob();
    const requeued = queue.fail(job.id, 'flaky', true)!;
    expect(requeued).toMatchObject({ status: 'queued', phase: 'queued', frame: 0, progress: 0, attempts: 1 });
    expect(persisted.get(job.id)).toMatchObject({ status: 'queued', frame: 0, progress: 0 });
  });
});
