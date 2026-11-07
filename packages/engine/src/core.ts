import type {
  AssetValues,
  Ctx2D,
  LoadedAssets,
  ParamDef,
  ParamValue,
  RenderJobPayload,
  RenderSettings,
  SizePreset,
  TemplateDefinition,
} from './types';
import { getTemplate, listTemplates } from './registry';
import { LIMITS } from './limits';

export { LIMITS, getTemplate, listTemplates };

export const SIZE_PRESETS: SizePreset[] = [
  { label: 'Story 9:16 (1080×1920)', width: 1080, height: 1920 },
  { label: 'Square 1:1 (1080×1080)', width: 1080, height: 1080 },
  { label: 'Portrait 4:5 (1080×1350)', width: 1080, height: 1350 },
  { label: 'Landscape 16:9 (1920×1080)', width: 1920, height: 1080 },
  { label: 'Banner 3:1 (1500×500)', width: 1500, height: 500 },
];

export function defaultValues(t: TemplateDefinition): AssetValues {
  const out: AssetValues = {};
  for (const p of t.params) out[p.key] = p.default;
  return out;
}

export function defaultPayload(templateId: string): RenderJobPayload {
  const t = getTemplate(templateId);
  if (!t) throw new Error(`Unknown template: ${templateId}`);
  return { templateId, settings: { ...t.defaultSettings }, assets: defaultValues(t) };
}

/**
 * Draws one frame of a payload. This is the single entry point used by both
 * the studio preview and the headless render worker.
 */
export function renderFrame(
  ctx: Ctx2D,
  frame: number,
  payload: RenderJobPayload,
  loaded: LoadedAssets,
): void {
  const t = getTemplate(payload.templateId);
  if (!t) throw new Error(`Unknown template: ${payload.templateId}`);
  const { width, height, fps, durationFrames, transparent } = payload.settings;
  const f = Math.max(0, Math.min(durationFrames - 1, Math.floor(frame)));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  t.render(
    {
      ctx,
      frame: f,
      fps,
      time: f / fps,
      durationFrames,
      progress: durationFrames > 1 ? f / (durationFrames - 1) : 1,
      width,
      height,
      transparent,
    },
    payload.assets,
    loaded,
  );
  ctx.restore();
}

// ---------------------------------------------------------------- validation

export type ValidationResult =
  | { ok: true; payload: RenderJobPayload }
  | { ok: false; errors: string[] };

const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

function checkParam(p: ParamDef, v: unknown, errors: string[]): ParamValue {
  if (v === undefined) return p.default;
  const where = `assets.${p.key}`;
  switch (p.type) {
    case 'text':
      if (typeof v !== 'string') errors.push(`${where} must be a string`);
      else if (v.length > (p.maxLength ?? 500)) errors.push(`${where} is too long`);
      return typeof v === 'string' ? v : p.default;
    case 'color':
      if (typeof v !== 'string' || !HEX.test(v)) errors.push(`${where} must be a #RRGGBB color`);
      return typeof v === 'string' ? v : p.default;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max)
        errors.push(`${where} must be a number between ${p.min} and ${p.max}`);
      return typeof v === 'number' ? v : p.default;
    case 'boolean':
      if (typeof v !== 'boolean') errors.push(`${where} must be true or false`);
      return typeof v === 'boolean' ? v : p.default;
    case 'select':
      if (typeof v !== 'string' || !p.options.some((o) => o.value === v))
        errors.push(`${where} must be one of ${p.options.map((o) => o.value).join(', ')}`);
      return typeof v === 'string' ? v : p.default;
    case 'image':
      if (v !== null && typeof v !== 'string') errors.push(`${where} must be a URL or null`);
      return typeof v === 'string' || v === null ? v : p.default;
  }
}

/** Validates and normalizes an untrusted payload (fills missing assets with defaults). */
export function validatePayload(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['payload must be an object'] };
  const raw = input as Record<string, unknown>;
  const t = typeof raw.templateId === 'string' ? getTemplate(raw.templateId) : undefined;
  if (!t) return { ok: false, errors: [`unknown templateId: ${String(raw.templateId)}`] };

  const s = (raw.settings ?? {}) as Partial<Record<keyof RenderSettings, unknown>>;
  const settings: RenderSettings = { ...t.defaultSettings };
  const int = (k: 'width' | 'height' | 'durationFrames', lo: number, hi: number) => {
    const v = s[k];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi)
      errors.push(`settings.${k} must be an integer between ${lo} and ${hi}`);
    else settings[k] = v;
  };
  int('width', LIMITS.minSize, LIMITS.maxSize);
  int('height', LIMITS.minSize, LIMITS.maxSize);
  if (s.fps !== undefined) {
    if (!LIMITS.fps.includes(s.fps as never)) errors.push(`settings.fps must be one of ${LIMITS.fps.join(', ')}`);
    else settings.fps = s.fps as number;
  }
  int('durationFrames', 1, LIMITS.maxDurationSeconds * settings.fps);
  if (s.transparent !== undefined) {
    if (typeof s.transparent !== 'boolean') errors.push('settings.transparent must be a boolean');
    else settings.transparent = s.transparent;
  }
  // H.264 yuv420p needs even dimensions.
  if (settings.width % 2 || settings.height % 2) errors.push('settings.width and height must be even');

  const a = (raw.assets ?? {}) as Record<string, unknown>;
  const assets: AssetValues = {};
  for (const p of t.params) assets[p.key] = checkParam(p, a[p.key], errors);

  return errors.length ? { ok: false, errors } : { ok: true, payload: { templateId: t.id, settings, assets } };
}

// ---------------------------------------------------------------- preloading

function loadImage(url: string): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      img
        .decode()
        .catch(() => undefined)
        .then(() => resolve(img));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Loads fonts and decodes images before frame 0 (browser only).
 * Hosts must import '@mg/engine/fonts' (font-face CSS) beforehand.
 */
export async function preloadAssets(payload: RenderJobPayload): Promise<LoadedAssets> {
  const t = getTemplate(payload.templateId);
  if (!t) throw new Error(`Unknown template: ${payload.templateId}`);
  await Promise.all(
    t.fonts.flatMap((fam) =>
      ['400', '700', '900'].map((w) => document.fonts.load(`${w} 48px "${fam}"`).catch(() => [])),
    ),
  );
  await document.fonts.ready;
  const images: LoadedAssets['images'] = {};
  await Promise.all(
    t.params
      .filter((p) => p.type === 'image')
      .map(async (p) => {
        const v = payload.assets[p.key];
        images[p.key] = typeof v === 'string' && v ? await loadImage(v) : null;
      }),
  );
  return { images };
}
