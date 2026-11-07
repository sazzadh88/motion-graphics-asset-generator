import { useRef } from 'react';
import type { Dispatch, KeyboardEvent, PointerEvent } from 'react';
import type { Action } from '../state/store';
import { timecode } from '../state/time';
import {
  LoopIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon,
  StepForwardIcon,
  ToEndIcon,
  ToStartIcon,
} from './Icons';

interface Props {
  frame: number;
  total: number;
  fps: number;
  playing: boolean;
  loop: boolean;
  dispatch: Dispatch<Action>;
}

export function Timeline({ frame, total, fps, playing, loop, dispatch }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = Math.max(1, total - 1);
  const pct = total > 1 ? (frame / (total - 1)) * 100 : 0;

  const frameAt = (e: PointerEvent<HTMLDivElement>): number => {
    const el = trackRef.current;
    if (!el) return frame;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return Math.round(x * (total - 1));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = frame - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = frame + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = total - 1;
    else if (e.key === ' ') {
      e.preventDefault();
      dispatch({ type: 'togglePlay' });
      return;
    }
    if (next !== null) {
      e.preventDefault();
      dispatch({ type: 'pause' });
      dispatch({ type: 'setFrame', frame: next });
    }
  };

  const seconds = Math.floor((total - 1) / fps);
  const ticks: number[] = [];
  for (let s = 0; s <= seconds && s <= 120; s++) ticks.push(s);

  return (
    <div className="timeline">
      <div className="transport">
        <button type="button" className="btn icon" title="Jump to start (Home)" aria-label="Jump to start" onClick={() => dispatch({ type: 'setFrame', frame: 0 })}>
          <ToStartIcon />
        </button>
        <button
          type="button"
          className="btn icon"
          title="Step back (Left, Shift = 10 frames)"
          aria-label="Step back one frame"
          onClick={() => {
            dispatch({ type: 'pause' });
            dispatch({ type: 'setFrame', frame: frame - 1 });
          }}
        >
          <StepBackIcon />
        </button>
        <button
          type="button"
          className="btn icon primary"
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => dispatch({ type: 'togglePlay' })}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="btn icon"
          title="Step forward (Right, Shift = 10 frames)"
          aria-label="Step forward one frame"
          onClick={() => {
            dispatch({ type: 'pause' });
            dispatch({ type: 'setFrame', frame: frame + 1 });
          }}
        >
          <StepForwardIcon />
        </button>
        <button type="button" className="btn icon" title="Jump to end (End)" aria-label="Jump to end" onClick={() => dispatch({ type: 'setFrame', frame: total - 1 })}>
          <ToEndIcon />
        </button>
        <button
          type="button"
          className="btn icon"
          aria-pressed={loop}
          title={loop ? 'Loop on' : 'Loop off'}
          aria-label="Loop"
          onClick={() => dispatch({ type: 'toggleLoop' })}
        >
          <LoopIcon />
        </button>
      </div>

      <div
        ref={trackRef}
        className="scrubber"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1)}
        aria-valuenow={frame}
        aria-valuetext={`Frame ${frame} of ${total}, ${timecode(frame, fps)}`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus();
          dragging.current = true;
          dispatch({ type: 'pause' });
          dispatch({ type: 'setFrame', frame: frameAt(e) });
        }}
        onPointerMove={(e) => {
          if (dragging.current) dispatch({ type: 'setFrame', frame: frameAt(e) });
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <div className="scrub-ticks" aria-hidden="true">
          {ticks.map((s) => (
            <span key={s} className="tick" style={{ left: `${Math.min(100, ((s * fps) / last) * 100)}%` }} />
          ))}
        </div>
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
        <div className="scrub-thumb" style={{ left: `${pct}%` }} />
      </div>

      <div className="readout" aria-live="off">
        <span className="readout-frame">
          {frame} / {total}
        </span>
        <span className="readout-time">{timecode(frame, fps)}</span>
      </div>
    </div>
  );
}
