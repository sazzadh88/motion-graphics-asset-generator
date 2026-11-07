import type { RenderJob } from '@mg/contract';
import type { Config } from './config';
import type { JobRecord } from './queue/types';
import type { UrlSigner } from './storage/signing';

/** True once the rendered file is past its retention time. */
export function outputExpired(job: JobRecord, config: Config, now = Date.now()): boolean {
  if (!job.finishedAt) return false;
  return Date.parse(job.finishedAt) + config.outputTtlHours * 3600_000 < now;
}

export function friendlyFilename(job: JobRecord): string {
  const { templateId, settings } = job.payload;
  return `${templateId}-${settings.width}x${settings.height}.${job.format}`;
}

/** Maps a stored job to the contract's RenderJob (signing a fresh download URL when completed). */
export function toRenderJob(job: JobRecord, config: Config, signer: UrlSigner): RenderJob {
  const { settings, templateId } = job.payload;
  const out: RenderJob = {
    id: job.id,
    status: job.status,
    phase: job.phase,
    format: job.format,
    templateId,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    durationFrames: settings.durationFrames,
    progress: Math.round(job.progress * 10) / 10,
    frame: job.frame,
    renderFps: Math.round(job.renderFps * 10) / 10,
    createdAt: job.createdAt,
  };
  if (job.status === 'queued' && job.queuePosition !== undefined) out.queuePosition = job.queuePosition;
  if (job.startedAt) out.startedAt = job.startedAt;
  if (job.finishedAt) out.finishedAt = job.finishedAt;
  if (job.error) out.error = job.error;
  if (job.status === 'completed' && job.outputKey && !outputExpired(job, config)) {
    const { url, expiresAt } = signer.sign(job.id);
    out.download = { url, expiresAt: expiresAt.toISOString(), bytes: job.outputBytes ?? 0, filename: friendlyFilename(job) };
  }
  return out;
}
