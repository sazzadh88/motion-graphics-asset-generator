import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedTemplate } from '@mg/contract';
import { GENERATED_ID_PATTERN, registerScene, unregisterTemplate } from '@mg/engine';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_CHARS = 12;

/**
 * New generated-template id: `gen_` + 12 random chars from crypto (~62 bits). Lowercase base36,
 * not base62, because scene ids must match SCENE_ID_PATTERN (lowercase letters, digits, _).
 */
export function newSceneId(): string {
  let out = '';
  while (out.length < ID_CHARS) {
    for (const b of randomBytes(16)) {
      if (b >= 252) continue; // 252 = 36 * 7: rejection sampling keeps the distribution uniform
      out += ALPHABET[b % 36];
      if (out.length === ID_CHARS) break;
    }
  }
  return `gen_${out}`;
}

function isRecord(v: unknown): v is GeneratedTemplate {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    GENERATED_ID_PATTERN.test(r.id) &&
    typeof r.name === 'string' &&
    typeof r.prompt === 'string' &&
    typeof r.kept === 'boolean' &&
    typeof r.createdAt === 'string' &&
    !Number.isNaN(Date.parse(r.createdAt)) &&
    typeof r.model === 'string' &&
    (r.baseSceneId === undefined || typeof r.baseSceneId === 'string') &&
    typeof r.scene === 'object' &&
    r.scene !== null &&
    (r.scene as { id?: unknown }).id === r.id
  );
}

/**
 * Generated templates ("Your templates") persisted as storage/scenes/<id>.json, one
 * GeneratedTemplate record per file, written atomically (temp file + rename). Every stored
 * scene is also registered in this process's engine so payload validation knows its id.
 * Records are immutable apart from `kept`.
 */
export class SceneStore {
  private readonly records = new Map<string, GeneratedTemplate>();

  constructor(
    readonly dir: string,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** Startup: loads and registers every stored record; invalid files are logged and skipped. */
  load(): { loaded: number; skipped: number } {
    let loaded = 0;
    let skipped = 0;
    for (const name of readdirSync(this.dir)) {
      const file = path.join(this.dir, name);
      if (name.endsWith('.tmp')) {
        rmSync(file, { force: true }); // an interrupted write
        continue;
      }
      if (!name.endsWith('.json')) continue;
      try {
        const rec: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (!isRecord(rec)) throw new Error('not a generated template record');
        if (`${rec.id}.json` !== name) throw new Error(`file name does not match id '${rec.id}'`);
        registerScene(rec.scene);
        this.records.set(rec.id, rec);
        loaded++;
      } catch (e) {
        skipped++;
        const msg = e instanceof Error ? e.message.split('\n').slice(0, 4).join(' ') : String(e);
        this.log(`[scenes] skipped ${name}: ${msg}`);
      }
    }
    return { loaded, skipped };
  }

  get(id: string): GeneratedTemplate | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** Kept templates, newest first. */
  listKept(): GeneratedTemplate[] {
    return [...this.records.values()].filter((r) => r.kept).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Drafts created before `cutoff`. */
  draftsOlderThan(cutoff: Date): GeneratedTemplate[] {
    const t = cutoff.getTime();
    return [...this.records.values()].filter((r) => !r.kept && Date.parse(r.createdAt) < t);
  }

  /** Validates + registers the scene, then persists the record. Throws (nothing stored) on an invalid scene. */
  async save(rec: GeneratedTemplate): Promise<GeneratedTemplate> {
    if (!GENERATED_ID_PATTERN.test(rec.id) || (rec.scene as { id?: unknown } | null)?.id !== rec.id)
      throw new Error(`scene id must equal the record id '${rec.id}'`);
    const existed = this.records.has(rec.id);
    registerScene(rec.scene);
    try {
      await this.write(rec);
    } catch (e) {
      if (!existed) unregisterTemplate(rec.id);
      throw e;
    }
    this.records.set(rec.id, rec);
    return rec;
  }

  async keep(id: string): Promise<GeneratedTemplate | undefined> {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    if (rec.kept) return rec;
    const next = { ...rec, kept: true };
    await this.write(next);
    this.records.set(id, next);
    return next;
  }

  /** Removes the record, its file and its engine registration. Returns whether it existed. */
  async delete(id: string): Promise<boolean> {
    if (!this.records.has(id)) return false;
    this.records.delete(id);
    unregisterTemplate(id);
    await rm(path.join(this.dir, `${id}.json`), { force: true });
    return true;
  }

  private async write(rec: GeneratedTemplate): Promise<void> {
    const file = path.join(this.dir, `${rec.id}.json`);
    const tmp = path.join(this.dir, `${rec.id}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(tmp, JSON.stringify(rec, null, 2));
    try {
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }
}
