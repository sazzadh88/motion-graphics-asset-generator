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

/**
 * GET /api/templates → TemplateSummary[] (template definitions minus the render function).
 * Bundled templates only; generated ones are listed by GET /api/scenes.
 */
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

// ------------------------------------------------------------------ generated templates

/**
 * AI-generated templates ("Your templates"). A generated template is an `mg-scene@1` scene
 * (docs/SCENE_FORMAT.md) stored by the API under storage/scenes/<id>.json. Its template id
 * is the scene's `id`, always `gen_` + 12 random lowercase base36 chars (scene ids must be
 * lowercase, see SCENE_ID_PATTERN; the engine accepts /^gen_[a-z0-9]{6,32}$/), so it can never
 * collide with bundled ids.
 * Drafts (kept=false) are deleted by the sweeper after 24 h; kept ones live until deleted.
 *
 * GET    /api/generate/status       → GenerateStatus
 * POST   /api/generate              → body GenerateRequest; 200 streams NDJSON (one
 *                                      GenerateEvent per line, content-type
 *                                      application/x-ndjson), ending with a 'done' or 'error'
 *                                      event. 400 ApiError for a bad request, 503 when
 *                                      generation is not configured, 429 when one is already
 *                                      running for too many clients (max 2 concurrent).
 *                                      Closing the request aborts the generation.
 * GET    /api/scenes                → GeneratedTemplate[] (kept ones, newest first; drafts are
 *                                      only reachable by id, from the 'done' event)
 * GET    /api/scenes/:id            → GeneratedTemplate (draft or kept)
 * POST   /api/scenes/:id/keep       → GeneratedTemplate (kept=true)
 * DELETE /api/scenes/:id            → 204 (409 while a queued/active render uses it)
 * Unknown ids → 404 ApiError. Refining (baseSceneId) always creates a new draft; the base is
 * never modified.
 *
 * Renders: CreateRenderRequest works unchanged for generated ids; the API resolves the
 * scene from storage and hands it to the worker.
 */
export interface GenerateStatus {
  enabled: boolean;
  /** Model id used, e.g. 'claude-sonnet-5-5', or 'mock' in mock mode. */
  model?: string;
  /** Human-readable reason when disabled, e.g. 'Set ANTHROPIC_API_KEY on the API server.' */
  reason?: string;
}

export interface GenerateRequest {
  /** What to make (new) or what to change (refine). 1..2000 chars. */
  prompt: string;
  /** Optional reference image, an uploaded asset URL matching ASSET_URL_PATTERN. */
  imageUrl?: string | null;
  /** Optional palette extracted in the studio (Phase 2); applied to the scene's color defaults. */
  palette?: { colors: { hex: string; weight: number }[] } | null;
  /** Output settings for the new scene's defaultSettings. */
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  /** Refine mode: id of an existing generated scene to edit instead of starting over. */
  baseSceneId?: string | null;
}

export type GenerateStep = 'writing' | 'checking' | 'repairing' | 'saving';

export type GenerateEvent =
  | { type: 'step'; step: GenerateStep; attempt: number; message: string }
  /** Validation found problems; `issues` are formatted scene errors (JSON-pointer paths). */
  | { type: 'issues'; attempt: number; issues: string[] }
  | { type: 'done'; template: GeneratedTemplate; repairs: number }
  | { type: 'error'; error: string; issues?: string[] };

export interface GeneratedTemplate {
  id: string;
  name: string;
  prompt: string;
  /** The scene this was refined from, if any. */
  baseSceneId?: string;
  kept: boolean;
  createdAt: string; // ISO 8601
  model: string;
  /** The full mg-scene@1 JSON (validated). */
  scene: unknown;
}
