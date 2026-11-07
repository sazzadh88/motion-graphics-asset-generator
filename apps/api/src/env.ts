// Loads the repo-root .env (if present) into process.env before anything reads it.
// Imported first by index.ts. Variables already set in the real environment win.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
if (existsSync(file)) {
  process.loadEnvFile(file);
  console.log('[api] loaded .env');
}
