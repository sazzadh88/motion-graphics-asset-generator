import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';

export type VideoFormat = 'mp4' | 'webm';

export interface EncoderOptions {
  format: VideoFormat;
  fps: number;
  outPath: string;
  ffmpegPath?: string;
}

export interface Encoder {
  /** Writes one PNG frame; resolves once ffmpeg's stdin has accepted it (backpressure aware). */
  write(png: Buffer): Promise<void>;
  /** Ends input, waits for ffmpeg to exit, renames the temp file to outPath. */
  finish(): Promise<void>;
  /** Kills ffmpeg and deletes the temp file. Safe to call repeatedly. */
  abort(): Promise<void>;
}

export function ffmpegArgs(o: { format: VideoFormat; fps: number }, tmpPath: string): string[] {
  const input = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(o.fps), '-i', '-',
  ];
  const out =
    o.format === 'mp4'
      ? [
          '-an',
          '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'fast',
          '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
          '-movflags', '+faststart', '-f', 'mp4',
        ]
      : [
          '-an',
          '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30',
          '-row-mt', '1', '-auto-alt-ref', '0', '-f', 'webm',
        ];
  return [...input, ...out, tmpPath];
}

export function createEncoder(opts: EncoderOptions): Encoder {
  const tmpPath = `${opts.outPath}.part`;
  const bin = opts.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const proc = spawn(bin, ffmpegArgs(opts, tmpPath), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-8000);
  });
  proc.stdout.resume();

  const tail = () => stderr.trim().split(/\r?\n/).slice(-20).join('\n');
  let spawnError: Error | null = null;
  let stdinError: Error | null = null;
  let aborted = false;
  let exited = false;
  const closed = new Promise<number | null>((resolve) => {
    proc.on('error', (e) => {
      spawnError = e;
      exited = true;
      resolve(-1);
    });
    proc.on('close', (code) => {
      exited = true;
      resolve(code);
    });
  });
  // EPIPE etc.: surfaced together with ffmpeg's stderr from write()/finish().
  proc.stdin.on('error', (e) => {
    stdinError = e;
  });

  const failure = (code: number | null): Error => {
    const se = spawnError as Error | null;
    if (se) return new Error(`failed to start ffmpeg (${bin}): ${se.message}`);
    return new Error(`ffmpeg exited with code ${code}\n${tail()}`);
  };

  const cleanup = () => rm(tmpPath, { force: true }).catch(() => undefined);

  return {
    async write(png) {
      if (aborted) throw new Error('encoder aborted');
      if (exited || stdinError) throw failure(await closed);
      if (proc.stdin.write(png)) return;
      const ok = await new Promise<boolean>((resolve) => {
        const finish = (v: boolean) => {
          proc.stdin.off('drain', onDrain);
          proc.stdin.off('error', onFail);
          proc.off('close', onFail);
          resolve(v);
        };
        const onDrain = () => finish(true);
        const onFail = () => finish(false);
        proc.stdin.once('drain', onDrain);
        proc.stdin.once('error', onFail);
        proc.once('close', onFail);
      });
      if (!ok) throw failure(await closed);
    },
    async finish() {
      if (!proc.stdin.destroyed && !stdinError) proc.stdin.end();
      const code = await closed;
      if (aborted) throw new Error('encoder aborted');
      if (code !== 0) {
        await cleanup();
        throw failure(code);
      }
      try {
        await rename(tmpPath, opts.outPath);
      } catch (e) {
        await cleanup();
        throw e;
      }
    },
    async abort() {
      if (aborted) return;
      aborted = true;
      proc.stdin.destroy();
      proc.kill('SIGKILL');
      await closed;
      await cleanup();
    },
  };
}
