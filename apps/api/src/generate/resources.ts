/**
 * Repo files the generator needs at runtime: the scene format spec (docs/SCENE_FORMAT.md) and
 * the bundled scene JSON (packages/engine/src/scenes/*.json). Located by walking up from this
 * file, so it works from src/ under tsx and vitest regardless of the process cwd. Read once.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC = join('docs', 'SCENE_FORMAT.md');
const SCENES_DIR = join('packages', 'engine', 'src', 'scenes');

let root: string | null = null;

export function repoRoot(): string {
  if (root) return root;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, SPEC)) && existsSync(join(dir, SCENES_DIR))) return (root = dir);
    const up = dirname(dir);
    if (up === dir) throw new Error(`Could not find ${SPEC} above ${fileURLToPath(import.meta.url)}`);
    dir = up;
  }
}

let spec: string | null = null;

export function sceneFormatSpec(): string {
  return (spec ??= readFileSync(join(repoRoot(), SPEC), 'utf8').replace(/\r\n/g, '\n').trim());
}

let scenes: Map<string, Record<string, unknown>> | null = null;

/** Bundled scenes by id, in file-name order (deterministic). */
export function bundledScenes(): Map<string, Record<string, unknown>> {
  if (scenes) return scenes;
  const dir = join(repoRoot(), SCENES_DIR);
  const map = new Map<string, Record<string, unknown>>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const json = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
    if (typeof json.id === 'string') map.set(json.id, json);
  }
  return (scenes = map);
}

export function bundledScene(id: string): Record<string, unknown> {
  const s = bundledScenes().get(id);
  if (!s) throw new Error(`Bundled scene '${id}' not found in ${SCENES_DIR}`);
  return s;
}
