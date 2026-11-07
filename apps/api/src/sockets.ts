import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, RenderJob, ServerToClientEvents } from '@mg/contract';
import type { Config } from './config';
import { toRenderJob } from './jobView';
import type { JobQueue } from './queue/types';
import type { UrlSigner } from './storage/signing';

const MIN_INTERVAL_MS = 250; // ~4 updates/s per job

export type JobSocketServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface Throttle {
  lastEmit: number;
  lastStatus: string;
  timer?: NodeJS.Timeout;
}

const room = (id: string) => `job:${id}`;

export function attachSockets(http: HttpServer, queue: JobQueue, config: Config, signer: UrlSigner) {
  const io: JobSocketServer = new Server(http);
  const throttles = new Map<string, Throttle>();

  const view = (id: string): RenderJob | undefined => {
    const j = queue.get(id);
    return j ? toRenderJob(j, config, signer) : undefined;
  };
  const hasListeners = (id: string) => (io.sockets.adapter.rooms.get(room(id))?.size ?? 0) > 0;

  const emitNow = (id: string, t: Throttle) => {
    if (t.timer) clearTimeout(t.timer);
    t.timer = undefined;
    t.lastEmit = Date.now();
    const v = view(id);
    if (v) {
      t.lastStatus = v.status;
      io.to(room(id)).emit('job:update', v);
    }
  };

  const onUpdate = (job: { id: string; status: string }) => {
    if (!hasListeners(job.id)) {
      throttles.delete(job.id);
      return;
    }
    let t = throttles.get(job.id);
    if (!t) throttles.set(job.id, (t = { lastEmit: 0, lastStatus: '' }));
    const statusChanged = t.lastStatus !== job.status;
    const wait = MIN_INTERVAL_MS - (Date.now() - t.lastEmit);
    if (statusChanged || wait <= 0) {
      emitNow(job.id, t);
    } else if (!t.timer) {
      const th = t;
      t.timer = setTimeout(() => emitNow(job.id, th), wait);
    }
    if (statusChanged) {
      // queue positions of the jobs waiting behind may have moved
      for (const q of queue.list(50)) if (q.status === 'queued' && q.id !== job.id && hasListeners(q.id)) {
        const qt = throttles.get(q.id) ?? { lastEmit: 0, lastStatus: '' };
        throttles.set(q.id, qt);
        emitNow(q.id, qt);
      }
    }
    if (job.status !== 'queued' && job.status !== 'active' && !t.timer) throttles.delete(job.id);
  };
  queue.events.on('update', onUpdate);

  io.on('connection', (socket) => {
    socket.on('job:subscribe', (jobId) => {
      if (typeof jobId !== 'string' || jobId.length > 64) return;
      void socket.join(room(jobId));
      const v = view(jobId);
      if (v) socket.emit('job:update', v);
    });
    socket.on('job:unsubscribe', (jobId) => {
      if (typeof jobId === 'string') void socket.leave(room(jobId));
    });
  });

  return {
    io,
    async close() {
      queue.events.off('update', onUpdate);
      for (const t of throttles.values()) if (t.timer) clearTimeout(t.timer);
      throttles.clear();
      await io.close();
    },
  };
}
