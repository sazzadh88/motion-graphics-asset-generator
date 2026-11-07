import type { RenderResult } from './render';
import type { VideoFormat } from './encoder';

/** Parent (API) -> child (render process). */
export type ParentToChild =
  | { type: 'run'; jobId: string; payload: unknown; format: VideoFormat; outPath: string; assetsDir: string }
  | { type: 'cancel'; jobId: string }
  /** Close the browser and exit. */
  | { type: 'shutdown' };

/** Child (render process) -> parent (API). */
export type ChildToParent =
  | {
      type: 'progress';
      jobId: string;
      phase: 'preparing' | 'rendering' | 'encoding' | 'done';
      frame: number;
      totalFrames: number;
      percent: number;
      fps: number;
    }
  | { type: 'done'; jobId: string; result: RenderResult }
  /** `retryable` is false for validation/asset errors and for cancellations. */
  | { type: 'error'; jobId: string; message: string; retryable: boolean; cancelled?: boolean };
