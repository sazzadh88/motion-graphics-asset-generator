import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKER_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PAGE_DIR = path.join(WORKER_ROOT, 'dist', 'render-page');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.map': 'application/json',
};

async function exists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Newest mtime (ms) of any file under `dir`, recursively; 0 if missing. */
async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const t = e.isDirectory() ? await newestMtime(p) : (await stat(p)).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

/**
 * Builds the render page with Vite when dist is missing OR older than its sources
 * (the engine and render-page code). A stale bundle would silently render old
 * templates, so exports would no longer match the studio preview.
 */
export async function ensureBuilt(): Promise<void> {
  const index = path.join(PAGE_DIR, 'index.html');
  if (await exists(index)) {
    const builtAt = (await stat(index)).mtimeMs;
    const sources = await Promise.all([
      newestMtime(path.join(WORKER_ROOT, 'render-page')),
      newestMtime(path.join(WORKER_ROOT, '..', '..', 'packages', 'engine', 'src')),
    ]);
    if (Math.max(...sources) <= builtAt) return;
  }
  const { build } = await import('vite');
  await build({ configFile: path.join(WORKER_ROOT, 'vite.render.config.ts'), logLevel: 'warn' });
}

let serverPromise: Promise<{ server: Server; origin: string }> | null = null;

/** Starts (once) a static server for dist/render-page on 127.0.0.1:<random port>. */
export function startStaticServer(): Promise<{ server: Server; origin: string }> {
  serverPromise ??= (async () => {
    await ensureBuilt();
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          let rel = decodeURIComponent(url.pathname);
          if (rel.endsWith('/')) rel += 'index.html';
          const file = path.resolve(PAGE_DIR, '.' + rel);
          if (file !== PAGE_DIR && !file.startsWith(PAGE_DIR + path.sep)) {
            res.writeHead(403).end();
            return;
          }
          if (!(await exists(file))) {
            res.writeHead(404).end();
            return;
          }
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': 'max-age=3600',
          });
          createReadStream(file).pipe(res);
        } catch {
          res.writeHead(400).end();
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('static server failed to bind');
    return { server, origin: `http://127.0.0.1:${addr.port}` };
  })().catch((e) => {
    serverPromise = null;
    throw e;
  });
  return serverPromise;
}

export async function stopStaticServer(): Promise<void> {
  const p = serverPromise;
  serverPromise = null;
  if (!p) return;
  const { server } = await p.catch(() => ({ server: null }));
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
