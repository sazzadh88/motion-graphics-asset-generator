import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getTemplate } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import { ASSET_URL_PATTERN } from '@mg/contract';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** Identifies PNG / JPEG / WebP / GIF from magic bytes (SVG and everything else -> null). */
export function sniffImage(b: Uint8Array): ImageMime | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61)))
    return 'image/gif';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** Thrown for bad asset references; never retried. */
export class AssetError extends Error {
  override name = 'AssetError';
}

/**
 * Replaces every image param that references an uploaded asset (`/api/assets/<id>`) with a
 * data: URL read from `assetsDir`, so the render page needs no network access beyond its static
 * server. Any other non-empty value that is not already a `data:image/...` URL is an error.
 */
export async function resolveAssetUrls(payload: RenderJobPayload, assetsDir: string): Promise<RenderJobPayload> {
  const t = getTemplate(payload.templateId);
  if (!t) throw new AssetError(`Unknown template: ${payload.templateId}`);
  const assets = { ...payload.assets };
  for (const p of t.params) {
    if (p.type !== 'image') continue;
    const v = assets[p.key];
    if (v === null || v === undefined || v === '') {
      assets[p.key] = null;
      continue;
    }
    if (typeof v !== 'string') throw new AssetError(`assets.${p.key}: must be a URL or null`);
    if (/^data:image\//i.test(v)) continue;
    if (!ASSET_URL_PATTERN.test(v)) throw new AssetError(`assets.${p.key}: only uploaded assets (/api/assets/<id>) are allowed`);
    const id = v.slice('/api/assets/'.length);
    let buf: Buffer;
    try {
      buf = await readFile(path.join(assetsDir, id));
    } catch {
      throw new AssetError(`assets.${p.key}: asset ${id} not found`);
    }
    const mime = sniffImage(buf);
    if (!mime) throw new AssetError(`assets.${p.key}: asset ${id} is not a supported image`);
    assets[p.key] = `data:${mime};base64,${buf.toString('base64')}`;
  }
  return { ...payload, assets };
}
