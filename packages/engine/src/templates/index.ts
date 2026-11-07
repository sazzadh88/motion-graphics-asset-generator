import type { TemplateDefinition } from '../types';
import { kineticText } from './kinetic_text';
import { promoCard } from './promo_card';
import { banner } from './banner';
import { loadSceneTemplates } from '../scene/registry';
import { BUNDLED_SCENES } from '../scenes';

const codeTemplates: TemplateDefinition[] = [kineticText, promoCard, banner];

/** Code templates first, then bundled scenes (validated here: an invalid scene throws at startup). */
export const templates: TemplateDefinition[] = [
  ...codeTemplates,
  ...loadSceneTemplates(
    BUNDLED_SCENES,
    codeTemplates.map((t) => t.id),
  ),
];
