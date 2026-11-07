/**
 * Claude-backed scene generator: one streamed Messages call writes the scene through the
 * submit_scene tool, the engine validator checks it, and up to MAX_REPAIRS follow-up turns feed
 * the validator's errors back for a corrected full scene.
 */
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  OverloadedError,
  PermissionDeniedError,
  RateLimitError,
  ServiceUnavailableError,
} from '@anthropic-ai/sdk';
import { SUBMIT_TOOL, SUBMIT_TOOL_NAME, buildRepairContent, buildSystemPrompt, buildUserContent, isSupportedImage } from './prompt';
import { applyPaletteToScene, assertSceneId, checkCandidate, normalisePalette, pickName } from './scene';
import {
  GenerateError,
  MAX_REPAIRS,
  abortError,
  throwIfAborted,
  type GenerateInput,
  type GenerateResult,
  type SceneGenerator,
} from './types';

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const BUSY_MESSAGE = 'Claude is busy right now. Try again in a minute.';

/** The slice of the Anthropic client the generator uses; tests pass a fake. */
export interface ClaudeClient {
  beta: {
    messages: {
      stream(
        body: Omit<StreamParams, 'stream'>,
        options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
      ): { finalMessage(): Promise<BetaMessage> };
    };
  };
}

export interface ClaudeGeneratorOptions {
  client: ClaudeClient;
  model: string;
  /** Wall-clock limit per model call (ms). Default 120 s. */
  timeoutMs?: number;
  /** Output cap per call; thinking counts against it. Default 64k (streamed). */
  maxTokens?: number;
  /** Default 'medium': keeps a full scene well inside the per-call timeout. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/** Models that accept server-side refusal fallbacks in the `"default"` form. */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

export class ClaudeGenerator implements SceneGenerator {
  readonly model: string;
  private readonly client: ClaudeClient;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly effort: NonNullable<ClaudeGeneratorOptions['effort']>;
  private readonly system: string;

  constructor(opts: ClaudeGeneratorOptions) {
    this.client = opts.client;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxTokens = opts.maxTokens ?? 64_000;
    this.effort = opts.effort ?? 'medium';
    this.system = buildSystemPrompt();
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    throwIfAborted(input.signal);
    assertSceneId(input.sceneId);
    if (input.image && !isSupportedImage(input.image.mime))
      throw new GenerateError('The reference image must be a PNG, JPEG, GIF or WebP file.');
    const palette = normalisePalette(input.palette);
    const messages: BetaMessageParam[] = [{ role: 'user', content: buildUserContent(input) }];

    input.onEvent({ type: 'step', step: 'writing', attempt: 1, message: 'Writing the scene' });
    // attempt = 1-based index of the model call; repairs = attempt - 1.
    for (let attempt = 1; ; attempt++) {
      const msg = await this.call(messages, input.signal);
      throwIfAborted(input.signal);
      input.onEvent({ type: 'step', step: 'checking', attempt, message: 'Checking the scene' });
      if (msg.stop_reason === 'refusal')
        throw new GenerateError('Claude declined this request. Try rephrasing the prompt.');
      messages.push({ role: 'assistant', content: msg.content });

      const toolUses = msg.content.filter((b) => b.type === 'tool_use');
      const submit = [...toolUses].reverse().find((b) => b.name === SUBMIT_TOOL_NAME);
      let issues: string[];
      if (msg.stop_reason === 'max_tokens') {
        issues = ['/: the response hit the output limit before the scene was complete; submit a more compact scene (fewer layers, shorter copy)'];
      } else if (!submit) {
        issues = [`/: no scene was submitted; call the ${SUBMIT_TOOL_NAME} tool with the complete scene`];
      } else {
        const args = (typeof submit.input === 'object' && submit.input !== null ? submit.input : {}) as {
          name?: unknown;
          scene?: unknown;
        };
        const scene = args.scene as { name?: unknown } | undefined;
        const name = pickName([args.name, scene?.name], input.prompt);
        const checked = checkCandidate(args.scene, input.sceneId, name, input);
        if (checked.ok) return { scene: applyPaletteToScene(checked.scene, palette), name, repairs: attempt - 1 };
        issues = checked.issues;
      }

      input.onEvent({ type: 'issues', attempt, issues });
      if (attempt > MAX_REPAIRS)
        throw new GenerateError(`The generated scene still had problems after ${MAX_REPAIRS} fixes.`, issues);
      input.onEvent({
        type: 'step',
        step: 'repairing',
        attempt: attempt + 1,
        message: `Fixing ${issues.length} problem${issues.length === 1 ? '' : 's'}`,
      });
      messages.push({ role: 'user', content: buildRepairContent(toolUses.map((b) => b.id), issues) });
    }
  }

  private async call(messages: BetaMessageParam[], signal: AbortSignal): Promise<BetaMessage> {
    throwIfAborted(signal);
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const fallback = FALLBACK_MODELS.has(this.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          // Stable prefix (tools → system) cached; the request-specific part is in messages.
          system: [{ type: 'text', text: this.system, cache_control: { type: 'ephemeral' } }],
          tools: [SUBMIT_TOOL],
          thinking: { type: 'adaptive' },
          output_config: { effort: this.effort },
          messages: [...messages],
          ...fallback,
        },
        { signal: AbortSignal.any([signal, deadline]), timeout: this.timeoutMs, maxRetries: 1 },
      );
      return await stream.finalMessage();
    } catch (e) {
      if (signal.aborted) throw abortError();
      if (deadline.aborted)
        throw new GenerateError('Claude took too long to write the scene. Try again or simplify the prompt.', undefined, {
          cause: e,
        });
      throw toGenerateError(e, this.model);
    }
  }
}

/** Maps SDK / network errors to user-safe GenerateErrors (never includes the API key). */
export function toGenerateError(e: unknown, model: string): Error {
  if (e instanceof GenerateError) return e;
  if (e instanceof APIUserAbortError) return abortError();
  const err = (message: string) => new GenerateError(message, undefined, { cause: e });
  if (e instanceof AuthenticationError) return err('The Anthropic API key was rejected.');
  if (e instanceof PermissionDeniedError) return err(`The Anthropic API key is not allowed to use ${model}.`);
  if (e instanceof NotFoundError) return err(`The model ${model} is not available. Check MG_GENERATOR_MODEL.`);
  if (e instanceof RateLimitError || e instanceof OverloadedError || e instanceof ServiceUnavailableError)
    return err(BUSY_MESSAGE);
  if (e instanceof APIConnectionTimeoutError) return err('Claude took too long to respond. Try again.');
  if (e instanceof APIConnectionError) return err('Could not reach the Anthropic API. Check the server’s network connection.');
  if (e instanceof APIError && (e.status === 529 || e.status === 503)) return err(BUSY_MESSAGE);
  return err('Generating the scene failed. Try again in a moment.');
}

export function createClaudeClient(apiKey: string): ClaudeClient {
  return new Anthropic({ apiKey });
}
