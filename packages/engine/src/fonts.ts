// Side-effect entry: hosts (studio, worker render page) import '@mg/engine/fonts'
// to register the bundled @font-face rules before calling preloadAssets().
import '@fontsource-variable/inter'; // "Inter Variable"      - body/UI (wght 100-900)
import '@fontsource-variable/montserrat'; // "Montserrat Variable" - geometric bold headlines
import '@fontsource/anton'; // "Anton"               - condensed display (weight 400 only)

export { FONT_FAMILIES } from './fontFamilies';
