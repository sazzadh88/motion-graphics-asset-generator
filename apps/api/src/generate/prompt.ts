/**
 * Prompt construction for the Claude scene generator.
 *
 * The system prompt is identical across requests (spec + allowed values + design guidance +
 * example scenes) so it is cached with prompt caching; everything request-specific goes in the
 * user turn. Keep buildSystemPrompt() deterministic: any byte change invalidates the cache.
 */
import { FONT_FAMILIES, LIMITS, SCENE_CATEGORIES } from '@mg/engine';
import type Anthropic from '@anthropic-ai/sdk';
import { bundledScene, sceneFormatSpec } from './resources';
import { durationFrames } from './scene';
import type { GenerateInput } from './types';

export const SUBMIT_TOOL_NAME = 'submit_scene';

/** Bundled scenes shown to the model as complete, valid examples (varied categories and techniques). */
export const EXAMPLE_SCENE_IDS = ['testimonial_v1', 'sale_burst_v1', 'stat_counter_v1'] as const;

/**
 * The output channel. `scene` is deliberately an open object: the engine validator is the source
 * of truth for the scene schema, and its errors drive the repair turns.
 */
export const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: SUBMIT_TOOL_NAME,
  description:
    'Submit the finished scene. Call this exactly once per turn with the complete mg-scene@1 document ' +
    '(never a partial scene or a diff) and a short human name for the template.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short human-readable template name, at most 40 characters, e.g. "Spring Sale Burst".',
      },
      scene: {
        type: 'object',
        description: 'The complete mg-scene@1 scene document as a JSON object.',
      },
    },
    required: ['name', 'scene'],
  },
};

const ROLE = `You are a senior motion designer who writes animated templates for a motion-graphics studio app.
Templates are mg-scene@1 JSON documents. The app renders them deterministically on a canvas at any
aspect ratio, users edit the params in an inspector, and the result is exported as video. A palette
tool later recolors templates by reading the labels of their color params.

Return your work only by calling the ${SUBMIT_TOOL_NAME} tool with { "name", "scene" }. The scene must be a complete,
strictly valid document that follows the specification below exactly: no comments, no properties the
spec does not define, no features it says are unavailable. The app validates the scene; if anything is
wrong you will get the validator's errors (JSON-pointer path + message) and must call ${SUBMIT_TOOL_NAME} again with
the complete corrected scene.`;

function allowedValues(): string {
  const fonts = Object.values(FONT_FAMILIES);
  return `Allowed values (the validator enforces these):
- fonts: ${fonts.map((f) => `"${f}"`).join(', ')}. The variable families take any weight 100-900; "Anton" is 400 only (a condensed display face for loud headlines). List every family a layer uses in /fonts.
- category: ${SCENE_CATEGORIES.join(' | ')}.
- defaultSettings: width/height ${LIMITS.minSize}-${LIMITS.maxSize} px, fps one of ${LIMITS.fps.join(', ')}, duration at most ${LIMITS.maxDurationSeconds} s. The user message gives the exact values to use.
- Scene size: at most 64 layers in total and 64 KB of JSON; aim for 8-30 layers.`;
}

const GUIDANCE = `Design guidance:
- Hierarchy: one hero element (headline, number, product or logo) is clearly dominant; one or two
  supporting lines; at most one call to action. Generous safe margins (at least ~6% of each side),
  deliberate alignment, and a limited type scale (2-3 sizes).
- Color: 2-4 color params with clear roles, named like the bundled scenes so palette mapping works:
  bgColor labeled "Background" (bgColor2 "Background 2" if needed), textColor or inkColor labeled "Text",
  accentColor "Accent", accent2 "Accent 2"; put them in group "Colors". Bind every color in the design to
  one of these params (directly, with "alpha", or via "mix" with #FFFFFF/#000000) so a palette change
  recolors the whole scene. Default text colors need at least 4.5:1 contrast against what they sit on.
- Text through params: every visible string is a text param (group "Text") interpolated with
  "{{key}}", with a maxLength that fits the layout. Give text layers maxWidth (in %w) plus autoFit and
  maxLines so longer user text still fits. Defaults should be realistic copy for the request.
- Motion: build in reading order with enter presets (rise, mask-up, slide-*, pop, scale-in, wipe-*,
  fade, typewriter), word or line stagger on headlines, and starts offset by 0.1-0.3 s. Everything is in
  place by about 40% of the duration, then holds with at most subtle ambient motion on one or two
  decorative layers. End calmly: a gentle exit in the last 0.5-0.8 s (exit presets or "end-…" times)
  or a still hold; no abrupt cuts or late surprises.
- Responsive: the same scene must look good at 9:16, 1:1 and 16:9 (and survive 3:1). Size things in
  vmin (plain numbers), place them in %w/%h, avoid px, keep text inside maxWidth, and keep important
  content away from the edges where 9:16 crops width.
- Optional images: add an image param (default null, group "Media") only when the request implies a
  logo, product shot or photo; image layers are skipped when empty, so use visibleIf with "not": true
  for a fallback (e.g. a wordmark).
- Keep it buildable: descriptive layer ids, a one-sentence description, no unused params, and only the
  layer types, presets and ease names the spec lists.`;

let systemPrompt: string | null = null;

/** Deterministic system prompt (built once per process). Throws if the repo files are missing. */
export function buildSystemPrompt(): string {
  if (systemPrompt) return systemPrompt;
  const examples = EXAMPLE_SCENE_IDS.map(
    (id) => `<example_scene id="${id}">\n${JSON.stringify(bundledScene(id))}\n</example_scene>`,
  ).join('\n\n');
  systemPrompt = [
    ROLE,
    `<scene_format_spec>\n${sceneFormatSpec()}\n</scene_format_spec>`,
    allowedValues(),
    GUIDANCE,
    `Complete bundled scenes that pass validation, for reference on structure and quality (do not copy them verbatim):\n\n${examples}`,
  ].join('\n\n');
  return systemPrompt;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export function isSupportedImage(mime: string): mime is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(mime);
}

function settingsLine(input: GenerateInput, sceneId: string): string {
  const frames = durationFrames(input);
  return `Output settings: set "id" to "${sceneId}" and defaultSettings to width ${input.width}, height ${input.height}, fps ${input.fps}, durationFrames ${frames} (${input.durationSeconds} s), transparent false unless the request asks for an overlay on footage. Time the animation for ${input.durationSeconds} s.`;
}

/** First user turn for a new scene or a refinement. */
export function buildUserContent(input: GenerateInput): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  const hasImage = !!input.image && isSupportedImage(input.image.mime);
  if (hasImage && input.image) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: input.image.mime as ImageType, data: input.image.base64 },
    });
  }
  const parts: string[] = [];
  const refine = input.baseScene !== undefined && input.baseScene !== null;
  if (refine) {
    parts.push(
      'Edit this existing scene:',
      `<base_scene>\n${JSON.stringify(input.baseScene)}\n</base_scene>`,
      `Requested change:\n<request>\n${input.prompt}\n</request>`,
      'Apply the requested change and keep everything else as it is (params, layer ids, copy, colors, timing and motion) unless the change requires otherwise. Return the full updated scene.',
    );
  } else {
    parts.push('Create a new animated template for this request:', `<request>\n${input.prompt}\n</request>`);
  }
  parts.push(settingsLine(input, input.sceneId));
  const colors = input.palette?.colors?.map((c) => c.hex).filter((h) => typeof h === 'string') ?? [];
  if (colors.length)
    parts.push(
      `Palette hint (heaviest first): ${colors.join(', ')}. Choose default colors in this spirit; the app maps the palette onto your color params afterwards, so clear role labels matter more than exact hexes.`,
    );
  if (hasImage)
    parts.push(
      "Reference image: attached above. Use it for style, mood, color and layout cues; don't copy its text verbatim unless the request asks for it.",
    );
  parts.push(`Call ${SUBMIT_TOOL_NAME} with the complete scene.`);
  blocks.push({ type: 'text', text: parts.join('\n\n') });
  return blocks;
}

/** Follow-up turn after a failed check: answers every tool call, then lists what to fix. */
export function buildRepairContent(
  toolUseIds: string[],
  issues: string[],
): Anthropic.Beta.BetaContentBlockParam[] {
  const list = issues.map((i) => `- ${i}`).join('\n');
  const results: Anthropic.Beta.BetaContentBlockParam[] = toolUseIds.map((id) => ({
    type: 'tool_result',
    tool_use_id: id,
    is_error: true,
    content: `The scene was rejected:\n${list}`,
  }));
  const text = toolUseIds.length
    ? `Fix every problem listed above and call ${SUBMIT_TOOL_NAME} again with the complete corrected scene. Change only what is needed to fix them.`
    : `No usable scene was submitted:\n${list}\n\nCall ${SUBMIT_TOOL_NAME} with the complete scene.`;
  return [...results, { type: 'text', text }];
}
