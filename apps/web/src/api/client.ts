import type { RenderJobPayload } from '@mg/engine';
import type {
  ApiError,
  AssetUploadResponse,
  CreateRenderRequest,
  RenderJob,
  TemplateSummary,
  VideoFormat,
} from '@mg/contract';

export const OFFLINE_MESSAGE = 'Render server is offline — start it with `npm run dev`.';

/** Thrown for every failed API call. `status` is 0 when the server could not be reached. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly details: string[];
  readonly offline: boolean;

  constructor(status: number, message: string, details: string[] = [], offline = false) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
    this.offline = offline;
  }
}

function isApiError(x: unknown): x is ApiError {
  return typeof x === 'object' && x !== null && typeof (x as { error?: unknown }).error === 'string';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError(0, OFFLINE_MESSAGE, [], true);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    if (isApiError(body)) {
      const details = Array.isArray(body.details) ? body.details.filter((d) => typeof d === 'string') : [];
      throw new ApiRequestError(res.status, body.error, details);
    }
    // The dev proxy answers 5xx with a non-JSON body when the API is down.
    if (res.status >= 500) throw new ApiRequestError(res.status, OFFLINE_MESSAGE, [], true);
    throw new ApiRequestError(res.status, `Request failed (${res.status}).`);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export function health(): Promise<unknown> {
  return request('/api/health');
}

export function listTemplates(): Promise<TemplateSummary[]> {
  return request('/api/templates');
}

export function uploadAsset(file: File): Promise<AssetUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/assets', { method: 'POST', body: form });
}

export function createRender(payload: RenderJobPayload, format: VideoFormat): Promise<RenderJob> {
  const body: CreateRenderRequest = { payload, format };
  return request('/api/renders', json('POST', body));
}

export function listRenders(): Promise<RenderJob[]> {
  return request('/api/renders');
}

export function getRender(id: string): Promise<RenderJob> {
  return request(`/api/renders/${encodeURIComponent(id)}`);
}

export function cancelRender(id: string): Promise<RenderJob> {
  return request(`/api/renders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Turn any thrown value into a message that is safe to show. */
export function describeError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.offline) return OFFLINE_MESSAGE;
    if (e.status === 429) return 'The render queue is full. Wait for a render to finish, then try again.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}
