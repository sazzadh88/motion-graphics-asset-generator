import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, RenderJob, ServerToClientEvents } from '@mg/contract';

type StudioSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: StudioSocket | null = null;
const tracked = new Set<string>();
const listeners = new Set<(job: RenderJob) => void>();

/** Created on first use so the app stays quiet when no job needs live updates. */
function get(): StudioSocket {
  if (!socket) {
    const s: StudioSocket = io({ path: '/socket.io' });
    // Fires on first connect and after every reconnect: re-join the job rooms.
    s.on('connect', () => {
      for (const id of tracked) s.emit('job:subscribe', id);
    });
    s.on('job:update', (job) => {
      for (const l of listeners) l(job);
    });
    socket = s;
  }
  return socket;
}

/** Make the set of subscribed jobs equal to `ids`. */
export function trackJobs(ids: Iterable<string>): void {
  const want = new Set(ids);
  if (want.size === 0 && !socket) {
    tracked.clear();
    return;
  }
  const s = get();
  for (const id of [...tracked]) {
    if (want.has(id)) continue;
    tracked.delete(id);
    if (s.connected) s.emit('job:unsubscribe', id);
  }
  for (const id of want) {
    if (tracked.has(id)) continue;
    tracked.add(id);
    if (s.connected) s.emit('job:subscribe', id);
  }
}

export function onJobUpdate(listener: (job: RenderJob) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
