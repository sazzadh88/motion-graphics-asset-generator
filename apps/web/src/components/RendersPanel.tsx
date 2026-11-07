import { useState } from 'react';
import { getTemplate } from '@mg/engine';
import type { RenderJob } from '@mg/contract';
import type { RendersApi } from '../state/renders';
import { isTerminal } from '../state/renders';
import { DownloadIcon } from './Icons';

export function RendersPanel({ renders }: { renders: RendersApi }) {
  const { jobs, load } = renders;

  if (load.state === 'offline' || (load.state === 'error' && jobs.length === 0)) {
    return (
      <div className="state-box">
        <p className="state-title">{load.state === 'offline' ? 'Render server is offline' : 'Could not load renders'}</p>
        <p className="hint">
          {load.state === 'offline' ? (
            <>
              Render server is offline — start it with <code>npm run dev</code>.
            </>
          ) : (
            load.message
          )}
        </p>
        <button type="button" className="btn" onClick={() => void renders.refresh()}>
          Retry connection
        </button>
      </div>
    );
  }
  if (load.state === 'idle' || (load.state === 'loading' && jobs.length === 0)) {
    return (
      <div className="state-box" role="status">
        <p className="hint">Loading renders…</p>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="state-box">
        <p className="state-title">No renders yet</p>
        <p className="hint">
          Choose Export in the top bar to render the current design as a video. Progress and downloads appear here.
        </p>
      </div>
    );
  }
  return (
    <ul className="jobs" aria-label="Renders">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} renders={renders} />
      ))}
    </ul>
  );
}

const STATUS_LABEL: Record<RenderJob['status'], string> = {
  queued: 'Queued',
  active: 'Rendering',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const PHASE_LABEL: Record<RenderJob['phase'], string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  rendering: 'Rendering frames',
  encoding: 'Encoding',
  done: 'Finishing',
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function JobRow({ job, renders }: { job: RenderJob; renders: RendersApi }) {
  const name = getTemplate(job.templateId)?.name ?? job.templateId;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setProblem(null);
    setProblem(await fn());
    setBusy(false);
  };

  return (
    <li className="job">
      <div className="job-head">
        <span className="job-name">{name}</span>
        <span className={`badge s-${job.status}`}>{STATUS_LABEL[job.status]}</span>
      </div>
      <p className="job-meta">
        {job.format.toUpperCase()} · {job.width}×{job.height} · {job.fps} fps · {new Date(job.createdAt).toLocaleTimeString()}
      </p>

      {job.status === 'active' ? (
        <>
          <Progress value={job.progress} label={`${name} render progress`} />
          <p className="job-meta">
            {PHASE_LABEL[job.phase]} · {Math.round(job.progress)}% · frame {job.frame}/{job.durationFrames}
            {job.phase === 'rendering' && job.renderFps > 0 ? ` · ${job.renderFps.toFixed(1)} fps` : ''}
          </p>
        </>
      ) : null}
      {job.status === 'queued' ? (
        <p className="job-meta">{job.queuePosition ? `Position ${job.queuePosition} in queue` : 'Waiting in queue'}</p>
      ) : null}
      {job.status === 'failed' ? <p className="error">{job.error ?? 'The render failed.'}</p> : null}
      {job.status === 'completed' && job.download ? (
        <p className="job-meta">
          {job.download.filename} · {formatBytes(job.download.bytes)}
        </p>
      ) : null}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="job-actions">
        {!isTerminal(job.status) ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => renders.cancel(job.id))}>
            Cancel render
          </button>
        ) : null}
        {job.status === 'completed' && job.download ? (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => renders.download(job.id))}>
            <DownloadIcon />
            Download video
          </button>
        ) : null}
      </div>
    </li>
  );
}
