import type { TemplateDefinition } from '../types';
import { templateFromScene } from './interpret';
import { formatSceneErrors, validateScene } from './validate';

export interface SceneSource {
  /** File name, used in error messages. */
  file: string;
  json: unknown;
}

/**
 * Validates bundled scene documents and wraps them as templates. Throws (fails startup loudly)
 * when any scene is invalid or reuses an id, listing every error.
 */
export function loadSceneTemplates(sources: SceneSource[], takenIds: Iterable<string> = []): TemplateDefinition[] {
  const ids = new Set(takenIds);
  const problems: string[] = [];
  const out: TemplateDefinition[] = [];
  for (const src of sources) {
    const r = validateScene(src.json);
    if (!r.ok) {
      problems.push(`${src.file}:\n${formatSceneErrors(r.errors)}`);
      continue;
    }
    if (ids.has(r.scene.id)) {
      problems.push(`${src.file}:\n  /id: template id '${r.scene.id}' is already used by another template`);
      continue;
    }
    ids.add(r.scene.id);
    out.push(templateFromScene(r.scene));
  }
  if (problems.length) throw new Error(`Invalid bundled scene(s) in packages/engine/src/scenes:\n${problems.join('\n')}`);
  return out;
}
