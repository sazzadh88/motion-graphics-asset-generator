import type { GenerateEvent } from '@mg/contract';

export interface GenerateInput {
  /** Forced onto scene.id before validating. Must match the engine's scene id pattern. */
  sceneId: string;
  prompt: string;
  image?: { mime: string; base64: string } | null;
  palette?: { colors: { hex: string; weight: number }[] } | null;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  /** Refine mode: the scene JSON to edit. */
  baseScene?: unknown | null;
  signal: AbortSignal;
  /** Receives only 'step' (writing / checking / repairing) and 'issues' events. */
  onEvent: (e: GenerateEvent) => void;
}

export interface GenerateResult {
  /** Passes validateScene. */
  scene: unknown;
  name: string;
  repairs: number;
}

export interface SceneGenerator {
  readonly model: string;
  generate(input: GenerateInput): Promise<GenerateResult>;
}

/** A user-safe failure: `message` can be shown as is; `issues` are formatted scene errors. */
export class GenerateError extends Error {
  issues?: string[];
  constructor(message: string, issues?: string[], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GenerateError';
    if (issues) this.issues = issues;
  }
}

/** Maximum follow-up turns that feed validation errors back to the model. */
export const MAX_REPAIRS = 2;

export function abortError(): Error {
  const e = new Error('The generation was cancelled.');
  e.name = 'AbortError';
  return e;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}
