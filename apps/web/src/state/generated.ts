import { useSyncExternalStore } from 'react';
import { getTemplate, registerScene, unregisterTemplate } from '@mg/engine';
import type { GeneratedTemplate } from '@mg/contract';
import { deleteScene, listScenes } from '../api/client';

/**
 * Generated templates ("Your templates") in the studio: registers them in the engine and keeps a
 * version counter so the library re-renders when the set changes. Drafts generated in this
 * session (kept=false) are tracked so the library can tag them.
 */

let version = 0;
const drafts = new Set<string>();
const listeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getVersion = () => version;

/** Re-renders the caller whenever generated templates are registered, kept or removed. */
export function useGeneratedVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export function isDraft(id: string): boolean {
  return drafts.has(id);
}

/** Registers a generated template in the engine. Throws when the scene is invalid. */
export function addGenerated(rec: GeneratedTemplate): void {
  registerScene(rec.scene);
  if (rec.kept) drafts.delete(rec.id);
  else drafts.add(rec.id);
  bump();
}

export function markKept(id: string): void {
  if (drafts.delete(id)) bump();
}

/** Unregisters a generated template (after the API deleted it). */
export function removeGenerated(id: string): void {
  const had = unregisterTemplate(id);
  const wasDraft = drafts.delete(id);
  if (had || wasDraft) bump();
}

/** DELETE on the API, then unregister; errors are ignored (drafts expire on their own). */
export async function discardQuietly(id: string): Promise<void> {
  try {
    await deleteScene(id);
  } catch {
    return;
  }
  removeGenerated(id);
}

let loading: Promise<void> | null = null;

/** Fetches and registers the kept templates once per page load; invalid ones are skipped. */
export function loadKeptTemplates(): Promise<void> {
  loading ??= (async () => {
    let list: GeneratedTemplate[];
    try {
      list = await listScenes();
    } catch {
      return; // API offline: the library shows bundled templates only
    }
    let changed = false;
    for (const rec of list) {
      if (getTemplate(rec.id)) continue;
      try {
        registerScene(rec.scene);
        changed = true;
      } catch (e) {
        console.warn(`[studio] skipped generated template ${rec.id}:`, e instanceof Error ? e.message : e);
      }
    }
    if (changed) bump();
  })();
  return loading;
}
