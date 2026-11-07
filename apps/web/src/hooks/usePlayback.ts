import { useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { Action } from '../state/store';

/**
 * Drives the playhead while `playing`. The frame is derived from wall-clock
 * time (startFrame + elapsed * fps), so slow frames are dropped rather than
 * stretching playback. The reducer's `frame` stays the single source of truth;
 * this hook only writes to it.
 */
export function usePlayback(
  frame: number,
  playing: boolean,
  loop: boolean,
  fps: number,
  total: number,
  dispatch: Dispatch<Action>,
): void {
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useEffect(() => {
    if (!playing) return;
    const startFrame = frameRef.current;
    const t0 = performance.now();
    let last = startFrame;
    let raf = 0;
    const tick = (now: number) => {
      const target = startFrame + Math.floor(((now - t0) / 1000) * fps);
      if (target > total - 1 && !loop) {
        dispatch({ type: 'setFrame', frame: total - 1 });
        dispatch({ type: 'pause' });
        return;
      }
      const next = loop ? target % total : target;
      if (next !== last) {
        last = next;
        dispatch({ type: 'setFrame', frame: next });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, fps, total, dispatch]);
}
