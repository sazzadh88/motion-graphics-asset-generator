import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./render-page', import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/render-page', import.meta.url)),
    emptyOutDir: true,
    // Keep font files as real files (never inlined) so they load over http.
    assetsInlineLimit: 0,
    target: 'es2022',
  },
});
