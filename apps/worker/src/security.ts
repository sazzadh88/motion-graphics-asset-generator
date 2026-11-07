import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getTemplate } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';

/**
 * SECURITY (interim, replaced by uploaded asset ids in Milestone 4):
 * Image params may be data: URLs or public http(s) URLs. Rejected up front:
 *  - blob: URLs (they cannot exist in a fresh server-side page),
 *  - any other scheme (file:, ftp:, javascript: ...),
 *  - http(s) hosts that are localhost / private / loopback / link-local, either as
 *    a literal or because DNS resolves to such an address (best effort; a DNS
 *    rebinding race between this check and Chromium's own lookup remains possible,
 *    which is why Milestone 4 moves to asset ids served by us).
 * At render time the page's network is additionally locked down with request
 * interception: only the static server origin, data: URLs and the exact image
 * URLs that passed this check are allowed. Redirects are therefore blocked too,
 * because a redirect target is a new request that is not on the allow-list.
 */

function ipv4Private(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

export function isPrivateAddress(addr: string): boolean {
  let h = addr.toLowerCase().replace(/^\[|\]$/g, '');
  const kind = isIP(h);
  if (kind === 4) {
    const [a = 0, b = 0] = h.split('.').map(Number);
    return ipv4Private(a, b);
  }
  if (kind === 6) {
    if (h === '::' || h === '::1') return true;
    const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h);
    if (mapped) {
      if (mapped[1]) return isPrivateAddress(mapped[1]);
      const hi = parseInt(mapped[2]!, 16);
      return ipv4Private(hi >> 8, hi & 255);
    }
    h = h.split('%')[0]!;
    const first = parseInt(h.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  return false;
}

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  return isPrivateAddress(h);
}

/** Throws if the URL is not an allowed image source; returns it normalized for http(s). */
export async function assertAllowedImageUrl(raw: string, where: string): Promise<string> {
  if (/^data:image\//i.test(raw)) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${where}: not a valid URL`);
  }
  if (u.protocol === 'blob:') throw new Error(`${where}: blob: URLs are not supported for server-side rendering`);
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new Error(`${where}: only data: and http(s) image URLs are allowed (got ${u.protocol})`);
  if (u.username || u.password) throw new Error(`${where}: URLs with credentials are not allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHostname(host)) throw new Error(`${where}: URL points to a local or private address`);
  if (!isIP(host)) {
    let addrs: { address: string }[];
    try {
      addrs = await lookup(host, { all: true });
    } catch {
      throw new Error(`${where}: host "${host}" could not be resolved`);
    }
    if (addrs.some((a) => isPrivateAddress(a.address)))
      throw new Error(`${where}: host "${host}" resolves to a local or private address`);
  }
  return u.href;
}

/** Validates all image params of a (validated) payload; returns the http(s) URLs to allow at runtime. */
export async function checkPayloadImages(payload: RenderJobPayload): Promise<Set<string>> {
  const allowed = new Set<string>();
  const t = getTemplate(payload.templateId);
  if (!t) return allowed;
  for (const p of t.params) {
    if (p.type !== 'image') continue;
    const v = payload.assets[p.key];
    if (typeof v !== 'string' || !v) continue;
    const href = await assertAllowedImageUrl(v, `assets.${p.key}`);
    if (!v.startsWith('data:')) allowed.add(href);
  }
  return allowed;
}
