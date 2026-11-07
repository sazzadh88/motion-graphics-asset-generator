/**
 * Scene generator: prompt (+ optional reference image, palette, output settings or a base scene
 * to refine) → validated mg-scene@1 scene. See README "AI generation" for the env vars.
 *
 *   MG_GENERATOR=mock      offline MockGenerator (no network, deterministic)
 *   ANTHROPIC_API_KEY      enables the Claude generator
 *   MG_GENERATOR_MODEL     model id for the Claude generator (default claude-sonnet-5-5)
 */
import { ClaudeGenerator, DEFAULT_MODEL, createClaudeClient } from './claude';
import { MockGenerator } from './mock';
import type { SceneGenerator } from './types';

export { GenerateError, MAX_REPAIRS } from './types';
export type { GenerateInput, GenerateResult, SceneGenerator } from './types';
export { ClaudeGenerator, DEFAULT_MODEL, toGenerateError } from './claude';
export type { ClaudeClient, ClaudeGeneratorOptions } from './claude';
export { MockGenerator, pickMockScene } from './mock';

export const DISABLED_REASON = 'Set ANTHROPIC_API_KEY on the API server to enable generation.';

export function createGenerator(env: NodeJS.ProcessEnv): {
  generator: SceneGenerator | null;
  model?: string;
  reason?: string;
} {
  if (env.MG_GENERATOR?.trim().toLowerCase() === 'mock') {
    const generator = new MockGenerator();
    return { generator, model: generator.model };
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { generator: null, reason: DISABLED_REASON };
  const model = env.MG_GENERATOR_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const generator = new ClaudeGenerator({ client: createClaudeClient(apiKey), model });
    return { generator, model };
  } catch (e) {
    // Only reachable when the repo files the prompt needs are missing (docs/SCENE_FORMAT.md, bundled scenes).
    return { generator: null, reason: `Generation is unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}
