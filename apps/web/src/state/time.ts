const pad = (n: number) => String(n).padStart(2, '0');

/** mm:ss.ff timecode for a frame index. */
export function timecode(frame: number, fps: number): string {
  const secs = Math.floor(frame / fps);
  const ff = frame - secs * fps;
  return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}.${pad(ff)}`;
}
