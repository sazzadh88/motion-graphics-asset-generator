import { defaultPayload, getTemplate, validatePayload } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';

const PAYLOAD_PREFIX = 'mg.studio.payload.';
const LAST_TEMPLATE = 'mg.studio.template';

/** blob: URLs die with the page, so they are never persisted. */
function stripBlobs(payload: RenderJobPayload): RenderJobPayload {
  const t = getTemplate(payload.templateId);
  if (!t) return payload;
  const assets = { ...payload.assets };
  for (const p of t.params) {
    const v = assets[p.key];
    if (typeof v === 'string' && v.startsWith('blob:')) assets[p.key] = p.default;
  }
  return { ...payload, assets };
}

export function savePayload(payload: RenderJobPayload): void {
  try {
    localStorage.setItem(PAYLOAD_PREFIX + payload.templateId, JSON.stringify(stripBlobs(payload)));
    localStorage.setItem(LAST_TEMPLATE, payload.templateId);
  } catch {
    /* storage unavailable or full: persistence is best-effort */
  }
}

export function loadPayload(templateId: string): RenderJobPayload {
  try {
    const raw = localStorage.getItem(PAYLOAD_PREFIX + templateId);
    if (raw) {
      const result = validatePayload(JSON.parse(raw) as unknown);
      if (result.ok && result.payload.templateId === templateId) return result.payload;
    }
  } catch {
    /* fall through to defaults */
  }
  return defaultPayload(templateId);
}

export function loadLastTemplateId(): string | null {
  try {
    return localStorage.getItem(LAST_TEMPLATE);
  } catch {
    return null;
  }
}
