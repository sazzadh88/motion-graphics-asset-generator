export type * from './types';
export {
  LIMITS,
  SIZE_PRESETS,
  listTemplates,
  getTemplate,
  defaultValues,
  defaultPayload,
  renderFrame,
  validatePayload,
  preloadAssets,
} from './core';
export type { ValidationResult } from './core';
export { registerScene, unregisterTemplate, GENERATED_ID_PATTERN } from './registry';
export * from './math';
export * from './text';
export * from './draw';
export { FONT_FAMILIES } from './fontFamilies';
export {
  SCENE_CATEGORIES,
  SCENE_FORMAT,
  validateScene,
  formatSceneErrors,
  templateFromScene,
  loadSceneTemplates,
} from './scene';
export type * from './scene/types';
export type { SceneSource } from './scene';
export { extractPalette, colorRole, applyPalette, paletteSignature } from './palette';
export type { Palette, PaletteColor, ColorRole } from './palette';
