import { spawn, spawnSync } from 'node:child_process';
import { ffmpegArgs } from '../../src/encoder';

/**
 * Encodes PNG frames losslessly through the encoder's real input stage: the exact
 * `image2pipe` / `-c:v png` / `-framerate` input arguments from ffmpegArgs(), fed
 * over stdin like createEncoder() does, with a lossless FFV1 (BGRA) output.
 */
export async function encodeLossless(pngs: Buffer[], fps: number, outPath: string): Promise<string[]> {
  const real = ffmpegArgs({ format: 'mp4', fps }, outPath);
  const iInput = real.indexOf('-i');
  if (iInput < 0 || real[iInput + 1] !== '-') throw new Error(`unexpected ffmpegArgs shape: ${real.join(' ')}`);
  const args = [
    ...real.slice(0, iInput + 2),
    '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgra', '-f', 'matroska', outPath,
  ];
  const proc = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const closed = new Promise<number | null>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', resolve);
  });
  for (const png of pngs) {
    if (!proc.stdin.write(png)) await new Promise((r) => proc.stdin.once('drain', r));
  }
  proc.stdin.end();
  const code = await closed;
  if (code !== 0) throw new Error(`lossless ffmpeg exited ${code}: ${stderr}`);
  return args;
}

/**
 * Decodes every frame of a video to raw pixels (no frame-rate conversion, so dropped
 * or duplicated frames would show up as a count mismatch).
 */
export function decodeFrames(
  file: string,
  opts: { width: number; height: number; pixFmt: 'rgba' | 'rgb24'; inputArgs?: string[]; filter?: string },
): Buffer[] {
  const ch = opts.pixFmt === 'rgba' ? 4 : 3;
  const frameBytes = opts.width * opts.height * ch;
  const args = [
    '-v', 'error',
    ...(opts.inputArgs ?? []),
    '-i', file,
    '-map', '0:v:0',
    '-fps_mode', 'passthrough',
    ...(opts.filter ? ['-vf', opts.filter] : []),
    '-f', 'rawvideo', '-pix_fmt', opts.pixFmt, '-',
  ];
  const r = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', args, { maxBuffer: 2 ** 31 - 1, windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg decode of ${file} failed: ${r.stderr?.toString()}`);
  const out = r.stdout;
  if (out.length % frameBytes !== 0)
    throw new Error(`decoded ${out.length} bytes, not a multiple of the ${frameBytes}-byte frame size`);
  const frames: Buffer[] = [];
  for (let i = 0; i < out.length; i += frameBytes) frames.push(out.subarray(i, i + frameBytes));
  return frames;
}
