/**
 * Bundled font families (no side effects, safe to import anywhere). `fonts.ts` registers the
 * matching @font-face rules for browser hosts.
 */
export const FONT_FAMILIES = {
  body: 'Inter Variable',
  geometric: 'Montserrat Variable',
  display: 'Anton',
} as const;

/** Weight range each bundled family actually ships (variable fonts cover the full range). */
export const FONT_WEIGHTS: Record<string, { min: number; max: number }> = {
  'Inter Variable': { min: 100, max: 900 },
  'Montserrat Variable': { min: 100, max: 900 },
  Anton: { min: 400, max: 400 },
};
