import { inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  /** Straight (non-premultiplied) RGBA, 8 bits per channel, row-major. */
  data: Buffer;
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Minimal PNG decoder (no dependencies) for what Chromium's canvas encoder emits:
 * 8-bit, non-interlaced, colour type 6 (RGBA) or 2 (RGB). Always returns RGBA.
 */
export function decodePng(buf: Buffer): Rgba {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colorType = body[9]!;
      const interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2))
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  const ch = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error(`PNG data size mismatch (${raw.length})`);
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= ch ? px[dst + i - ch]! : 0;
      const b = y > 0 ? px[up + i]! : 0;
      const c = y > 0 && i >= ch ? px[up + i - ch]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
      px[dst + i] = v & 0xff;
    }
  }
  if (ch === 4) return { width, height, data: px };
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
    data[j] = px[i]!;
    data[j + 1] = px[i + 1]!;
    data[j + 2] = px[i + 2]!;
    data[j + 3] = 255;
  }
  return { width, height, data };
}
