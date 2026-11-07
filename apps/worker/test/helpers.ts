import { spawnSync } from 'node:child_process';

export interface Stream {
  codec_name: string;
  width: number;
  height: number;
  avg_frame_rate: string;
  r_frame_rate: string;
  nb_read_frames?: string;
  pix_fmt?: string;
  tags?: Record<string, string>;
}

export function probe(file: string): Stream {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_streams', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { streams: Stream[] }).streams[0]!;
}

/** Generates `n` distinct PNG frames (as buffers) with ffmpeg's test source. */
export function makePngs(n: number, w: number, h: number): Buffer[] {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=10`, '-frames:v', String(n), '-f', 'image2pipe', '-c:v', 'png', '-'],
    { maxBuffer: 1 << 28 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  // Split concatenated PNGs on the signature.
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out: Buffer[] = [];
  let idx = r.stdout.indexOf(sig);
  while (idx !== -1) {
    const next = r.stdout.indexOf(sig, idx + 8);
    out.push(r.stdout.subarray(idx, next === -1 ? undefined : next));
    idx = next;
  }
  return out;
}
