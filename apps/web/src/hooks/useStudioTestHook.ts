import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { validatePayload } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import type { Action } from '../state/store';
import type { AssetsState } from './useAssets';

/** Test-only driver used by the worker's preview-vs-export parity test. */
export interface StudioTestHook {
  /** Validates and loads a payload (like picking a template: playhead to 0, stopped). */
  setPayload(p: unknown): void;
  setFrame(n: number): void;
  /** Resolves once assets for the current payload are loaded and its frame is on the canvas. */
  ready(): Promise<void>;
}

declare global {
  interface Window {
    __studio?: StudioTestHook;
  }
}

const ENABLED = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mgtest') === '1';

/**
 * Exposes `window.__studio` when the page URL has `?mgtest=1`; inert otherwise.
 * Must be called from the component that renders <Stage>: React runs child effects
 * before parent effects, so the effect below runs after Stage has drawn the frame.
 */
export function useStudioTestHook(
  payload: RenderJobPayload,
  frame: number,
  assets: AssetsState,
  dispatch: Dispatch<Action>,
): void {
  const [tick, setTick] = useState(0);
  const waiters = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!ENABLED) return;
    const bump = () => setTick((t) => t + 1);
    window.__studio = {
      setPayload(p) {
        const v = validatePayload(p);
        if (!v.ok) throw new Error(`Invalid payload: ${v.errors.join('; ')}`);
        dispatch({ type: 'selectTemplate', payload: v.payload });
        bump();
      },
      setFrame(n) {
        dispatch({ type: 'pause' });
        dispatch({ type: 'setFrame', frame: n });
        bump();
      },
      ready() {
        // Force a commit so the effect below re-checks even when nothing changed.
        const p = new Promise<void>((resolve) => waiters.current.push(resolve));
        bump();
        return p;
      },
    };
    return () => {
      delete window.__studio;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!ENABLED) return;
    if (!assets.loaded || assets.loading || assets.loadedTemplateId !== payload.templateId) return;
    const pending = waiters.current.splice(0);
    for (const resolve of pending) resolve();
  }, [tick, payload, frame, assets]);
}
