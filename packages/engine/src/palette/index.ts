/** Palette extraction (image -> colors) and mapping (colors -> template color params). Pure + deterministic. */
export type { Palette, PaletteColor, ColorRole } from './types';
export { extractPalette } from './extract';
export { colorRole } from './roles';
export { applyPalette, paletteSignature } from './apply';
