export { renderVideo } from './render';
export type { RenderOptions, RenderResult, RenderProgress, RenderPhase } from './render';
export type { VideoFormat } from './encoder';
export { resolveAssetUrls, sniffImage, AssetError } from './assets';
export type { ImageMime } from './assets';
export type { ParentToChild, ChildToParent } from './ipc';

import { closeBrowser } from './browser';
import { stopStaticServer } from './server';

/** Closes the shared browser and the static server (call on process shutdown). */
export async function shutdown(): Promise<void> {
  await closeBrowser();
  await stopStaticServer();
}
