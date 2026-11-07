/**
 * HTTP + Socket.io contract between the studio (apps/web) and the API (apps/api).
 * Types plus one shared regex (ASSET_URL_PATTERN), so both sides can import it freely.
 *
 * Base path: /api (the studio's Vite dev server proxies /api and /socket.io to the API).
 */
import type { RenderJobPayload, TemplateDefinition } from '@mg/engine';

export type VideoFormat = 'mp4' | 'webm';

// ------------------------------------------------------------------ assets

/**
 * POST /api/assets — multipart/form-data with one field `file`.
 * Accepts PNG, JPEG, WebP, GIF up to 10 MB (sniffed from magic bytes, not the extension).
 * 201 → AssetUploadResponse; 400/413/415 → ApiError.
 *
 * Image params in a payload reference uploads by the returned `url`
 * (always of the form `/api/assets/<id>`). The studio loads that URL for preview;
 * the render worker resolves it from storage, never over the network.
 * GET /api/assets/:id serves the file.
 */
export interface AssetUploadResponse {
  id: string;
  url: string;
  mime: string;
  bytes: number;
}

/** Image param values the API accepts in a render request. */
export const ASSET_URL_PATTERN = /^\/api\/assets\/[A-Za-z0-9_-]{8,64}$/;

// ------------------------------------------------------------------ templates

/** GET /api/templates → TemplateSummary[] (template definitions minus the render function). */
export type TemplateSummary = Pick<
  TemplateDefinition,
  'id' | 'name' | 'description' | 'defaultSettings' | 'params'
>;

// ------------------------------------------------------------------ render jobs

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
export type JobPhase = 'queued' | 'preparing' | 'rendering' | 'encoding' | 'done';

/**
 * POST /api/renders — body CreateRenderRequest.
 * 202 → RenderJob (status 'queued'); 400 → ApiError with `details` = validation errors;
 * 429 → ApiError when the queue is full.
 * Image params must be '' / null, or match ASSET_URL_PATTERN for an existing asset.
 */
export interface CreateRenderRequest {
  payload: RenderJobPayload;
  format: VideoFormat;
}

export interface RenderJob {
  id: string;
  status: JobStatus;
  phase: JobPhase;
  format: VideoFormat;
  templateId: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  /** 0..100 */
  progress: number;
  /** Frames captured so far. */
  frame: number;
  /** Capture throughput (frames/s) while rendering. */
  renderFps: number;
  /** 1-based position among queued jobs, when status is 'queued'. */
  queuePosition?: number;
  createdAt: string; // ISO 8601
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Present when status is 'completed': time-limited signed URL. */
  download?: { url: string; expiresAt: string; bytes: number; filename: string };
}

/**
 * GET    /api/renders          → RenderJob[] (most recent first, max 50)
 * GET    /api/renders/:id      → RenderJob (download URL re-signed on every read)
 * DELETE /api/renders/:id      → RenderJob; cancels a queued/active job (409 if already finished)
 * GET    /api/files/:id?exp=&sig= → the video file (Content-Disposition: attachment);
 *        403 when the signature is invalid or expired, 404/410 when the file is gone.
 */

export interface ApiError {
  error: string;
  details?: string[];
}

// ------------------------------------------------------------------ socket.io

/** Client → server */
export interface ClientToServerEvents {
  /** Start receiving updates for a job; the server immediately replies with a `job:update`. */
  'job:subscribe': (jobId: string) => void;
  'job:unsubscribe': (jobId: string) => void;
}

/** Server → client. `job:update` carries the full job on every change (throttled ~4/s). */
export interface ServerToClientEvents {
  'job:update': (job: RenderJob) => void;
}
