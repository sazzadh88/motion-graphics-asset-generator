/**
 * Long-lived render process: forked by the API's worker pool, reuses its Chromium across jobs.
 * Protocol: see ipc.ts.
 */
import { resolveAssetUrls, AssetError } from './assets';
import type { ChildToParent, ParentToChild } from './ipc';
import { renderVideo, shutdown } from './index';
import { registerScene, unregisterTemplate } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';

const controllers = new Map<string, AbortController>();

function send(msg: ChildToParent): void {
  if (process.connected) process.send?.(msg);
}

async function run(m: Extract<ParentToChild, { type: 'run' }>): Promise<void> {
  const ac = new AbortController();
  controllers.set(m.jobId, ac);
  let sceneId: string | undefined;
  try {
    // Generated templates exist only at runtime: register before the asset/payload checks.
    if (m.scene !== undefined && m.scene !== null) sceneId = registerScene(m.scene).id;
    const payload = await resolveAssetUrls(m.payload as RenderJobPayload, m.assetsDir);
    const result = await renderVideo(payload, {
      scene: m.scene,
      format: m.format,
      outPath: m.outPath,
      signal: ac.signal,
      onProgress: (p) => send({ type: 'progress', jobId: m.jobId, ...p }),
    });
    send({ type: 'done', jobId: m.jobId, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
      send({ type: 'error', jobId: m.jobId, message: 'Render cancelled', retryable: false, cancelled: true });
    } else {
      const permanent = e instanceof AssetError || /^Invalid (payload|frame range|scene)/.test(message);
      send({ type: 'error', jobId: m.jobId, message, retryable: !permanent });
    }
  } finally {
    controllers.delete(m.jobId);
    if (sceneId) unregisterTemplate(sceneId);
  }
}

async function exit(): Promise<void> {
  for (const c of controllers.values()) c.abort();
  await shutdown().catch(() => undefined);
  process.exit(0);
}

process.on('message', (m: ParentToChild) => {
  if (m.type === 'run') void run(m);
  else if (m.type === 'cancel') controllers.get(m.jobId)?.abort();
  else if (m.type === 'shutdown') void exit();
});
// The parent went away: do not leave Chromium behind.
process.on('disconnect', () => void exit());
process.on('SIGTERM', () => void exit());
process.on('SIGINT', () => void exit());
