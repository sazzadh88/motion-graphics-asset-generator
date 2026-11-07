import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WEB_ROOT = fileURLToPath(new URL('../../../web', import.meta.url));

/** Production-builds the studio (apps/web) into `outDir` with the Vite JS API. */
export async function buildStudio(outDir: string): Promise<void> {
  const { build } = await import('vite');
  await build({
    root: WEB_ROOT,
    configFile: path.join(WEB_ROOT, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export interface Served {
  origin: string;
  close(): Promise<void>;
}

/** Tiny static file server for `dir` on 127.0.0.1:<random port> (404 for anything missing, e.g. /api). */
export async function serveDir(dir: string): Promise<Served> {
  const root = path.resolve(dir);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        let rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        const file = path.resolve(root, '.' + rel);
        if (!file.startsWith(root + path.sep) || !(await stat(file).then((s) => s.isFile(), () => false))) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
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
  if (!addr || typeof addr === 'string') throw new Error('studio server failed to bind');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
