import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const ctx = createApp(config);
const port = await ctx.listen(config.port, config.host);
console.log(
  `[api] listening on http://${config.host}:${port} (storage ${config.storageDir}, ${config.renderConcurrency} render worker(s))`,
);

let shuttingDown = false;
const stop = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  ctx
    .close()
    .catch((e) => console.error('[api] shutdown error:', e))
    .finally(() => process.exit(0));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
