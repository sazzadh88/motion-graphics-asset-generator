/**
 * Template registry: bundled templates (code + bundled scenes, fixed at startup) followed by
 * scenes registered at runtime (AI-generated templates, ids `gen_…`).
 *
 * The runtime map is the only mutable module state in the engine. It is never read while drawing
 * a frame beyond the template lookup, so rendering stays a pure function of (frame, payload) as
 * long as a given id always maps to the same scene (generated scenes are immutable once saved).
 */
import type { TemplateDefinition } from './types';
import { templates as bundled } from './templates';
import { templateFromScene } from './scene/interpret';
import { formatSceneErrors, validateScene } from './scene/validate';

/**
 * Ids of runtime-registered (generated) scenes. Lowercase only, because scene ids must also match
 * SCENE_ID_PATTERN (`/^[a-z][a-z0-9_]{2,47}$/`).
 */
export const GENERATED_ID_PATTERN = /^gen_[a-z0-9]{6,32}$/;

const generated = new Map<string, TemplateDefinition>();
let cache: TemplateDefinition[] | null = bundled;

/** Bundled templates first, then registered ones in registration order. */
export function listTemplates(): TemplateDefinition[] {
  cache ??= [...bundled, ...generated.values()];
  return cache;
}

export function getTemplate(id: string): TemplateDefinition | undefined {
  return generated.get(id) ?? bundled.find((t) => t.id === id);
}

/**
 * Validates an `mg-scene@1` document and registers it as a template (origin 'generated').
 * The id must match GENERATED_ID_PATTERN. Registering an id again replaces the previous scene.
 * Throws an Error listing every validation problem.
 */
export function registerScene(json: unknown): TemplateDefinition {
  const r = validateScene(json);
  if (!r.ok) throw new Error(`Invalid scene:\n${formatSceneErrors(r.errors)}`);
  const { id } = r.scene;
  if (!GENERATED_ID_PATTERN.test(id)) throw new Error(`Invalid scene:\n  /id: runtime scene ids must match ${GENERATED_ID_PATTERN}, got '${id}'`);
  if (bundled.some((t) => t.id === id)) throw new Error(`Invalid scene:\n  /id: '${id}' is a bundled template id`);
  const t: TemplateDefinition = { ...templateFromScene(r.scene), origin: 'generated' };
  generated.set(id, t); // a replacement keeps its position
  cache = null;
  return t;
}

/** Removes a registered (generated) template. Bundled ids cannot be removed. Returns whether it existed. */
export function unregisterTemplate(id: string): boolean {
  if (!GENERATED_ID_PATTERN.test(id)) return false;
  const existed = generated.delete(id);
  if (existed) cache = generated.size ? null : bundled;
  return existed;
}
