import { useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { Action } from '../state/store';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.closest('[role="slider"]')) return true; // scrubber handles its own keys
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useShortcuts(frame: number, total: number, dispatch: Dispatch<Action>): void {
  const ref = useRef({ frame, total });
  ref.current = { frame, total };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const { frame: f, total: n } = ref.current;
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case ' ':
          // A focused button already "clicks" on Space; don't double-fire.
          if (e.target instanceof HTMLButtonElement) return;
          dispatch({ type: 'togglePlay' });
          break;
        case 'ArrowLeft':
          dispatch({ type: 'pause' });
          dispatch({ type: 'setFrame', frame: f - step });
          break;
        case 'ArrowRight':
          dispatch({ type: 'pause' });
          dispatch({ type: 'setFrame', frame: f + step });
          break;
        case 'Home':
          dispatch({ type: 'setFrame', frame: 0 });
          break;
        case 'End':
          dispatch({ type: 'setFrame', frame: n - 1 });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}
