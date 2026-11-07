import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderJobPayload } from '@mg/engine';
import type { JobStatus, RenderJob, VideoFormat } from '@mg/contract';
import { ApiRequestError, cancelRender, createRender, describeError, getRender, listRenders } from '../api/client';
import { isSocketConnected, onJobUpdate, trackJobs } from '../api/socket';

export type LoadState = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

export const isTerminal = (s: JobStatus) => s === 'completed' || s === 'failed' || s === 'cancelled';

const EXPIRY_MARGIN_MS = 15_000;
const POLL_MS = 5_000;

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface RendersApi {
  /** Newest first. */
  jobs: RenderJob[];
  load: { state: LoadState; message: string | null };
  /** Non-terminal job to show in the top bar (an active one wins over a queued one). */
  current: RenderJob | null;
  activeCount: number;
  refresh: () => Promise<void>;
  start: (payload: RenderJobPayload, format: VideoFormat) => Promise<RenderJob>;
  cancel: (id: string) => Promise<string | null>;
  download: (id: string) => Promise<string | null>;
}

/**
 * Single owner of render-job state. Jobs live in one id -> job map, fed by
 * the REST list, create/cancel responses and Socket.io `job:update` events.
 * Sockets are subscribed only for non-terminal jobs and dropped when they finish.
 */
export function useRenders(onStatusChange: (job: RenderJob, previous: JobStatus) => void): RendersApi {
  const [byId, setById] = useState<Record<string, RenderJob>>({});
  const [load, setLoad] = useState<{ state: LoadState; message: string | null }>({ state: 'idle', message: null });
  const mapRef = useRef(byId);
  const cbRef = useRef(onStatusChange);
  useEffect(() => {
    cbRef.current = onStatusChange;
  });

  const put = useCallback((incoming: RenderJob[]) => {
    const cur = mapRef.current;
    const next = { ...cur };
    const changes: [RenderJob, JobStatus][] = [];
    for (const job of incoming) {
      const prev = cur[job.id];
      // A late non-terminal update must not resurrect a finished job.
      if (prev && isTerminal(prev.status) && !isTerminal(job.status)) continue;
      next[job.id] = job;
      if (prev && prev.status !== job.status) changes.push([job, prev.status]);
    }
    mapRef.current = next;
    setById(next);
    for (const [job, prev] of changes) cbRef.current(job, prev);
  }, []);

  const jobs = useMemo(
    () => Object.values(byId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [byId],
  );
  const activeIds = useMemo(() => jobs.filter((j) => !isTerminal(j.status)).map((j) => j.id), [jobs]);
  const activeKey = activeIds.join(',');

  const refresh = useCallback(async () => {
    setLoad((l) => ({ state: Object.keys(mapRef.current).length ? l.state : 'loading', message: null }));
    try {
      put(await listRenders());
      setLoad({ state: 'ready', message: null });
    } catch (e) {
      setLoad({ state: e instanceof ApiRequestError && e.offline ? 'offline' : 'error', message: describeError(e) });
    }
  }, [put]);

  // Live updates: subscribe to non-terminal jobs only.
  useEffect(() => onJobUpdate((job) => put([job])), [put]);
  useEffect(() => {
    trackJobs(activeKey ? activeKey.split(',') : []);
  }, [activeKey]);

  // Fallback while the socket is down: poll the list so progress never freezes.
  useEffect(() => {
    if (!activeKey) return;
    const t = window.setInterval(() => {
      if (!isSocketConnected()) void listRenders().then(put, () => undefined);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [activeKey, put]);

  const start = useCallback(
    async (payload: RenderJobPayload, format: VideoFormat) => {
      const job = await createRender(payload, format);
      put([job]);
      setLoad((l) => (l.state === 'ready' ? l : { state: 'ready', message: null }));
      return job;
    },
    [put],
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        put([await cancelRender(id)]);
        return null;
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 409) {
          // Already finished on the server: pick up the final state.
          try {
            put([await getRender(id)]);
          } catch {
            /* ignore */
          }
          return 'That render already finished.';
        }
        return describeError(e);
      }
    },
    [put],
  );

  const download = useCallback(
    async (id: string) => {
      let job = mapRef.current[id];
      if (!job?.download) return 'This render has no file to download.';
      try {
        if (Date.parse(job.download.expiresAt) - Date.now() < EXPIRY_MARGIN_MS) {
          job = await getRender(id);
          put([job]);
        }
        if (!job.download) return 'The file is no longer available.';
        triggerDownload(job.download.url, job.download.filename);
        return null;
      } catch (e) {
        return describeError(e);
      }
    },
    [put],
  );

  const current = useMemo(
    () => jobs.find((j) => j.status === 'active') ?? [...jobs].reverse().find((j) => j.status === 'queued') ?? null,
    [jobs],
  );

  return { jobs, load, current, activeCount: activeIds.length, refresh, start, cancel, download };
}
