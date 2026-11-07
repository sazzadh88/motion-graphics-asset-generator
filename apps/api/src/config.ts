import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  host: string;
  storageDir: string;
  renderConcurrency: number;
  maxQueued: number;
  outputTtlHours: number;
  /** Uploaded assets older than this are deleted unless a queued or active job references them. */
  assetTtlDays: number;
  downloadUrlTtlSeconds: number;
  signingSecret: string;
}

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function int(v: string | undefined, def: number, min = 0): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`invalid numeric env value: ${v}`);
  return Math.floor(n);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const storageDir = path.resolve(env.STORAGE_DIR || path.join(repoRoot, 'storage'));
  mkdirSync(storageDir, { recursive: true });
  let secret = env.SIGNING_SECRET;
  if (!secret) {
    const file = path.join(storageDir, '.secret');
    try {
      secret = readFileSync(file, 'utf8').trim();
    } catch {
      secret = '';
    }
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  return {
    port: int(env.PORT, 3001),
    host: env.HOST || '127.0.0.1',
    storageDir,
    renderConcurrency: int(env.RENDER_CONCURRENCY, Math.max(1, Math.floor(cpus().length / 4)), 1),
    maxQueued: int(env.MAX_QUEUED, 50, 1),
    outputTtlHours: int(env.OUTPUT_TTL_HOURS, 24, 1),
    assetTtlDays: int(env.ASSET_TTL_DAYS, 7, 1),
    downloadUrlTtlSeconds: int(env.DOWNLOAD_URL_TTL_SECONDS, 3600, 1),
    signingSecret: secret,
  };
}
