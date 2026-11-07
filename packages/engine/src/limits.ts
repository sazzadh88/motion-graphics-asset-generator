/** Render limits shared by payload validation (core) and scene validation (no imports: avoids cycles). */
export const LIMITS = {
  minSize: 64,
  maxSize: 3840,
  fps: [24, 25, 30, 50, 60] as const,
  maxDurationSeconds: 60,
} as const;
