/**
 * Shared post-processing for generated scenes: force the server-owned fields (id, format,
 * output settings), validate with the engine, apply a palette to the color defaults, and
 * pick a short human name. Pure functions; no network.
 */
import { SCENE_FORMAT, applyPalette, templateFromScene, validateScene } from '@mg/engine';
import type { Palette, Scene, SceneError } from '@mg/engine';
import type { GenerateInput } from './types';

/** Same pattern as the engine validator's scene id rule (packages/engine/src/scene/validate.ts). */
const SCENE_ID_PATTERN = /^[a-z][a-z0-9_]{2,47}$/;
const MAX_NAME = 40;
/** Issues listed per repair turn / event; the rest are summarised in one line. */
const MAX_ISSUES = 40;

export type Settings = Pick<GenerateInput, 'width' | 'height' | 'fps' | 'durationSeconds'>;

export type CheckResult = { ok: true; scene: Scene } | { ok: false; issues: string[] };

export function assertSceneId(id: string): void {
  if (!SCENE_ID_PATTERN.test(id))
    throw new TypeError(`sceneId '${id}' must match ${SCENE_ID_PATTERN} (lowercase letters, digits, underscores)`);
}

export function durationFrames(s: Settings): number {
  return Math.round(s.durationSeconds * s.fps);
}

export function formatIssues(errors: SceneError[]): string[] {
  const lines = errors.map((e) => `${e.path || '/'}: ${e.message}`);
  if (lines.length <= MAX_ISSUES) return lines;
  return [...lines.slice(0, MAX_ISSUES), `…and ${lines.length - MAX_ISSUES} more problems`];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Overwrites the fields the server owns (format, id, name, defaultSettings except `transparent`),
 * validates, and checks the scene loads as a template. Never throws.
 */
export function checkCandidate(raw: unknown, sceneId: string, name: string, settings: Settings): CheckResult {
  if (!isObj(raw)) return { ok: false, issues: ['/: the scene must be a JSON object'] };
  let candidate: Record<string, unknown>;
  try {
    candidate = structuredClone(raw);
  } catch {
    return { ok: false, issues: ['/: the scene must be plain JSON'] };
  }
  const prev = isObj(candidate.defaultSettings) ? candidate.defaultSettings : {};
  candidate.format = SCENE_FORMAT;
  candidate.id = sceneId;
  candidate.name = name;
  candidate.defaultSettings = {
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    durationFrames: durationFrames(settings),
    transparent: typeof prev.transparent === 'boolean' ? prev.transparent : false,
  };
  const result = validateScene(candidate);
  if (!result.ok) return { ok: false, issues: formatIssues(result.errors) };
  try {
    templateFromScene(result.scene);
  } catch (e) {
    return { ok: false, issues: [`/: the scene could not be loaded as a template: ${e instanceof Error ? e.message : String(e)}`] };
  }
  return { ok: true, scene: result.scene };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Accepts the request palette shape; drops malformed entries. Null when nothing usable is left. */
export function normalisePalette(p: GenerateInput['palette']): Palette | null {
  if (!p || !Array.isArray(p.colors)) return null;
  const colors = p.colors
    .filter((c) => c && typeof c.hex === 'string' && HEX.test(c.hex))
    .map((c) => ({ hex: c.hex.toUpperCase(), weight: Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0 }))
    .slice(0, 8);
  if (!colors.length) return null;
  if (!colors.some((c) => c.weight > 0)) for (const c of colors) c.weight = 1 / colors.length;
  colors.sort((a, b) => b.weight - a.weight);
  return { colors };
}

/**
 * Writes `applyPalette` results into the scene's color param defaults. Returns the original
 * scene when the palette cannot be applied or the result would not validate.
 */
export function applyPaletteToScene(scene: Scene, palette: Palette | null): Scene {
  if (!palette) return scene;
  try {
    const mapped = applyPalette(templateFromScene(scene), palette);
    if (!Object.keys(mapped).length) return scene;
    const next = structuredClone(scene) as Scene;
    for (const p of next.params) {
      const hex = mapped[p.key];
      if (p.type === 'color' && typeof hex === 'string' && HEX.test(hex)) p.default = hex.toUpperCase();
    }
    const v = validateScene(next);
    return v.ok ? v.scene : scene;
  } catch {
    return scene;
  }
}

function clip(s: string, max = MAX_NAME): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space >= 12 ? cut.slice(0, space) : clean.slice(0, max)).replace(/[\s,.;:–—-]+$/, '');
}

/** Short title from a prompt: first few words, sentence case, ≤ 40 chars. */
export function nameFromPrompt(prompt: string): string {
  const words = prompt
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\p{L}\p{N}%&'’ -]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  const s = clip(words.join(' '));
  if (!s) return 'Generated scene';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** First usable name: the model's tool `name`, then the scene's `name`, then the prompt. */
export function pickName(candidates: unknown[], prompt: string): string {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const s = clip(c);
      if (s) return s;
    }
  }
  return nameFromPrompt(prompt);
}
