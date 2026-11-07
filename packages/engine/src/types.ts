/**
 * Engine contract shared by the studio (browser preview) and the render worker (headless Chromium).
 *
 * DETERMINISM RULES for every template `render`:
 *  - Output must depend ONLY on (frame, settings, values, loaded assets).
 *  - Never use Math.random, Date, performance.now, timers, or mutable module state.
 *    Use `createRng(seed)` from ./math for pseudo-randomness.
 *  - Never await inside render; all async loading happens in `preloadAssets`.
 */

/** Any 2D context we can draw into (DOM canvas or OffscreenCanvas). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface ParamBase {
  /** Key in `RenderJobPayload.assets`. */
  key: string;
  label: string;
  /** Optional UI grouping, e.g. "Text", "Colors", "Layout". */
  group?: string;
  description?: string;
}

export type ParamDef =
  | (ParamBase & { type: 'text'; default: string; maxLength?: number; multiline?: boolean })
  | (ParamBase & { type: 'color'; default: string })
  | (ParamBase & {
      type: 'number';
      default: number;
      min: number;
      max: number;
      step?: number;
      unit?: string;
    })
  /** Value is an image URL (data:/blob:/http(s) URL), or null for none. */
  | (ParamBase & { type: 'image'; default: string | null })
  | (ParamBase & { type: 'boolean'; default: boolean })
  | (ParamBase & {
      type: 'select';
      default: string;
      options: { value: string; label: string }[];
    });

export type ParamValue = string | number | boolean | null;
export type AssetValues = Record<string, ParamValue>;

export interface RenderSettings {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  /** When true, templates must not paint an opaque background (for alpha WebM export). */
  transparent: boolean;
}

/** The deterministic job payload (matches the spec's JSON, plus `transparent`). */
export interface RenderJobPayload {
  templateId: string;
  settings: RenderSettings;
  assets: AssetValues;
}

/** Decoded resources, produced by `preloadAssets` before frame 0. Keyed by image param key. */
export interface LoadedAssets {
  images: Record<string, CanvasImageSource | null>;
}

export interface FrameInfo {
  ctx: Ctx2D;
  /** Integer frame index, 0 .. durationFrames-1. */
  frame: number;
  fps: number;
  /** frame / fps, in seconds. */
  time: number;
  durationFrames: number;
  /** frame / (durationFrames - 1), 0..1. */
  progress: number;
  width: number;
  height: number;
  transparent: boolean;
}

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  defaultSettings: RenderSettings;
  params: ParamDef[];
  /** Font families (CSS family names) this template draws with; preloaded before rendering. */
  fonts: string[];
  /** Draw exactly one frame. Must be pure (see rules above). */
  render(f: FrameInfo, values: AssetValues, loaded: LoadedAssets): void;
}
