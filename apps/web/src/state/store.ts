import type { ParamValue, RenderJobPayload, RenderSettings } from '@mg/engine';

export interface StudioState {
  payload: RenderJobPayload;
  /** Single source of truth for the playhead. */
  frame: number;
  playing: boolean;
  loop: boolean;
}

export type Action =
  /** Switch template: new payload, playhead to 0, stopped. */
  | { type: 'selectTemplate'; payload: RenderJobPayload }
  /** Replace the payload (reset / JSON apply); playhead is kept but clamped. */
  | { type: 'applyPayload'; payload: RenderJobPayload }
  | { type: 'setAsset'; key: string; value: ParamValue }
  /** Patch several params in one update (e.g. a reference palette). */
  | { type: 'setAssets'; patch: Record<string, ParamValue> }
  | { type: 'setSettings'; patch: Partial<RenderSettings> }
  | { type: 'setFrame'; frame: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'togglePlay' }
  | { type: 'toggleLoop' };

export function clampFrame(frame: number, total: number): number {
  return Math.max(0, Math.min(Math.max(0, total - 1), Math.round(frame)));
}

export function initState(payload: RenderJobPayload): StudioState {
  return { payload, frame: 0, playing: false, loop: true };
}

function withPayload(state: StudioState, payload: RenderJobPayload): StudioState {
  return {
    ...state,
    payload,
    frame: clampFrame(state.frame, payload.settings.durationFrames),
  };
}

export function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case 'selectTemplate':
      return { ...state, payload: action.payload, frame: 0, playing: false };
    case 'applyPayload':
      return withPayload(state, action.payload);
    case 'setAsset':
      if (state.payload.assets[action.key] === action.value) return state;
      return withPayload(state, {
        ...state.payload,
        assets: { ...state.payload.assets, [action.key]: action.value },
      });
    case 'setAssets': {
      const keys = Object.keys(action.patch);
      if (keys.every((k) => state.payload.assets[k] === action.patch[k])) return state;
      return withPayload(state, {
        ...state.payload,
        assets: { ...state.payload.assets, ...action.patch },
      });
    }
    case 'setSettings':
      return withPayload(state, {
        ...state.payload,
        settings: { ...state.payload.settings, ...action.patch },
      });
    case 'setFrame': {
      const frame = clampFrame(action.frame, state.payload.settings.durationFrames);
      return frame === state.frame ? state : { ...state, frame };
    }
    case 'play': {
      if (state.playing) return state;
      const last = state.payload.settings.durationFrames - 1;
      return { ...state, playing: true, frame: state.frame >= last ? 0 : state.frame };
    }
    case 'pause':
      return state.playing ? { ...state, playing: false } : state;
    case 'togglePlay':
      return reducer(state, { type: state.playing ? 'pause' : 'play' });
    case 'toggleLoop':
      return { ...state, loop: !state.loop };
  }
}
