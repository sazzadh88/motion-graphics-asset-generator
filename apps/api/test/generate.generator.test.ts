// Unit tests for src/generate (Claude generator with a fake client, mock generator, factory).
// No network: the Anthropic client is injected.
import { describe, expect, it } from 'vitest';
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import type { GenerateEvent } from '@mg/contract';
import { applyPalette, templateFromScene, validateScene } from '@mg/engine';
import type { Scene } from '@mg/engine';
import {
  ClaudeGenerator,
  DEFAULT_MODEL,
  GenerateError,
  MockGenerator,
  createGenerator,
  pickMockScene,
  toGenerateError,
} from '../src/generate';
import type { ClaudeClient, GenerateInput } from '../src/generate';
import { EXAMPLE_SCENE_IDS, buildSystemPrompt } from '../src/generate/prompt';
import { bundledScene } from '../src/generate/resources';

type BetaMessage = Anthropic.Beta.BetaMessage;
type Params = Parameters<ClaudeClient['beta']['messages']['stream']>[0];
type Opts = Parameters<ClaudeClient['beta']['messages']['stream']>[1];
type Reply = BetaMessage | Error | ((params: Params, opts: Opts) => Promise<BetaMessage>);

const SCENE_ID = 'gen_abc123';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function validScene(id = 'quote_card_v1'): Record<string, unknown> {
  return clone(bundledScene(id));
}

function invalidScene(): Record<string, unknown> {
  const s = validScene();
  (s.layers as Record<string, unknown>[])[0]!.enter = { preset: 'zoom' };
  return s;
}

let toolSeq = 0;
function message(content: unknown[], stop_reason: BetaMessage['stop_reason'] = 'tool_use'): BetaMessage {
  return {
    id: `msg_${++toolSeq}`,
    type: 'message',
    role: 'assistant',
    model: DEFAULT_MODEL,
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as BetaMessage;
}

function submit(scene: unknown, name: unknown = 'Bold Quote', stop: BetaMessage['stop_reason'] = 'tool_use'): BetaMessage {
  return message(
    [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: `toolu_${toolSeq + 1}`, name: 'submit_scene', input: { name, scene } },
    ],
    stop,
  );
}

function fakeClient(replies: Reply[]) {
  const calls: { params: Params; opts: Opts }[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        stream(params, opts) {
          calls.push({ params, opts });
          const reply = replies[calls.length - 1];
          return {
            async finalMessage() {
              if (!reply) throw new Error('no more fake replies');
              if (reply instanceof Error) throw reply;
              if (typeof reply === 'function') return reply(params, opts);
              return reply;
            },
          };
        },
      },
    },
  };
  return { client, calls };
}

function input(over: Partial<GenerateInput> = {}): GenerateInput & { events: GenerateEvent[] } {
  const events: GenerateEvent[] = [];
  return {
    sceneId: SCENE_ID,
    prompt: 'A bold quote card for a design conference',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 8,
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
    events,
    ...over,
  };
}

function steps(events: GenerateEvent[]): string[] {
  return events.map((e) => (e.type === 'step' ? `${e.step}:${e.attempt}` : `${e.type}:${'attempt' in e ? e.attempt : ''}`));
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return (content as { type: string; text?: string }[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Waits until the request signal aborts, then rejects like the SDK does. */
function hangUntilAbort(_p: Params, opts: Opts): Promise<BetaMessage> {
  return new Promise((_, reject) => {
    opts?.signal?.addEventListener('abort', () => reject(new APIUserAbortError()), { once: true });
  });
}

describe('ClaudeGenerator', () => {
  it('happy path: one call, forced id/settings, cached system prompt, events in order', async () => {
    const { client, calls } = fakeClient([submit({ ...validScene(), id: 'something_else', format: 'nope' })]);
    const inp = input();
    const res = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(inp);

    expect(res.repairs).toBe(0);
    expect(res.name).toBe('Bold Quote');
    const scene = res.scene as Scene;
    expect(validateScene(scene).ok).toBe(true);
    expect(scene.id).toBe(SCENE_ID);
    expect(scene.format).toBe('mg-scene@1');
    expect(scene.name).toBe('Bold Quote');
    expect(scene.defaultSettings).toEqual({ width: 1080, height: 1920, fps: 30, durationFrames: 240, transparent: false });
    expect(steps(inp.events)).toEqual(['writing:1', 'checking:1']);

    expect(calls).toHaveLength(1);
    const { params, opts } = calls[0]!;
    expect(params.model).toBe(DEFAULT_MODEL);
    expect(params.tools?.map((t) => ('name' in t ? t.name : ''))).toEqual(['submit_scene']);
    expect(params.tool_choice).toBeUndefined(); // forced tool_choice is a 400 on current models
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
    const system = params.system as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(1);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]!.text).toBe(buildSystemPrompt());
    expect(params.messages).toHaveLength(1);
    const user = textOf(params.messages[0]!.content);
    expect(user).toContain('A bold quote card for a design conference');
    expect(user).toContain('durationFrames 240');
    expect(user).toContain(`"${SCENE_ID}"`);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(opts?.timeout).toBe(120_000);
  });

  it('system prompt is deterministic and carries spec, allowed values and examples', () => {
    const a = buildSystemPrompt();
    expect(buildSystemPrompt()).toBe(a);
    expect(a).toContain('# Scene format `mg-scene@1`');
    expect(a).toContain('"Inter Variable"');
    expect(a).toContain('social | promo | broadcast');
    for (const id of EXAMPLE_SCENE_IDS) expect(a).toContain(`<example_scene id="${id}">`);
  });

  it('omits fallbacks for models without server-side fallback', async () => {
    const { client, calls } = fakeClient([submit(validScene())]);
    await new ClaudeGenerator({ client, model: 'claude-haiku-5-5' }).generate(input());
    expect(calls[0]!.params.fallbacks).toBeUndefined();
    expect(calls[0]!.params.betas).toBeUndefined();
  });

  it('repairs once: feeds validator errors back as a tool_result and succeeds', async () => {
    const { client, calls } = fakeClient([submit(invalidScene()), submit(validScene())]);
    const inp = input();
    const res = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(inp);

    expect(res.repairs).toBe(1);
    expect(validateScene(res.scene).ok).toBe(true);
    expect(steps(inp.events)).toEqual(['writing:1', 'checking:1', 'issues:1', 'repairing:2', 'checking:2']);
    const issues = inp.events.find((e) => e.type === 'issues');
    expect(issues?.type === 'issues' && issues.issues.some((i) => i.startsWith('/layers/0/enter/preset'))).toBe(true);

    const second = calls[1]!.params.messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    // The assistant turn is passed back unchanged (thinking block included).
    const assistant = second[1]!.content as { type: string; id?: string }[];
    expect(assistant.map((b) => b.type)).toEqual(['thinking', 'tool_use']);
    const repair = second[2]!.content as { type: string; tool_use_id?: string; is_error?: boolean; content?: string }[];
    expect(repair[0]).toMatchObject({ type: 'tool_result', tool_use_id: assistant[1]!.id, is_error: true });
    expect(repair[0]!.content).toContain('/layers/0/enter/preset');
    expect(repair[1]!.type).toBe('text');
    // The first call's messages were not mutated by the follow-up turn.
    expect(calls[0]!.params.messages).toHaveLength(1);
  });

  it('gives up after 2 repairs with the last issues', async () => {
    const { client, calls } = fakeClient([submit(invalidScene()), submit(invalidScene()), submit(invalidScene())]);
    const inp = input();
    const err = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(inp).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerateError);
    expect((err as GenerateError).message).toBe('The generated scene still had problems after 2 fixes.');
    expect((err as GenerateError).issues?.[0]).toMatch(/^\/layers\/0\/enter\/preset/);
    expect(calls).toHaveLength(3);
    expect(steps(inp.events)).toEqual([
      'writing:1',
      'checking:1',
      'issues:1',
      'repairing:2',
      'checking:2',
      'issues:2',
      'repairing:3',
      'checking:3',
      'issues:3',
    ]);
  });

  it('asks again when no scene was submitted or the output was cut off', async () => {
    const { client, calls } = fakeClient([
      message([{ type: 'text', text: 'Here is my idea…' }], 'end_turn'),
      submit(validScene(), 'Cut', 'max_tokens'),
      submit(validScene()),
    ]);
    const res = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input());
    expect(res.repairs).toBe(2);
    const second = calls[1]!.params.messages[2]!.content as { type: string }[];
    expect(second.map((b) => b.type)).toEqual(['text']);
    expect(textOf(second)).toContain('submit_scene');
    const third = calls[2]!.params.messages[4]!.content as { type: string; content?: string }[];
    expect(third[0]!.type).toBe('tool_result');
    expect(third[0]!.content).toContain('output limit');
  });

  it('applies the palette to the color param defaults and keeps the scene valid', async () => {
    const palette = {
      colors: [
        { hex: '#1B3A4B', weight: 0.6 },
        { hex: '#F4D35E', weight: 0.25 },
        { hex: '#EE964B', weight: 0.15 },
      ],
    };
    const { client, calls } = fakeClient([submit(validScene())]);
    const res = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input({ palette }));
    const scene = res.scene as Scene;
    expect(validateScene(scene).ok).toBe(true);

    const unpaletted = validateScene({ ...validScene(), id: SCENE_ID, name: 'Bold Quote', defaultSettings: scene.defaultSettings });
    expect(unpaletted.ok).toBe(true);
    if (!unpaletted.ok) return;
    const expected = applyPalette(templateFromScene(unpaletted.scene), palette);
    const colors = Object.fromEntries(scene.params.filter((p) => p.type === 'color').map((p) => [p.key, p.default]));
    expect(colors).toEqual(expected);
    const before = Object.fromEntries(unpaletted.scene.params.filter((p) => p.type === 'color').map((p) => [p.key, p.default]));
    expect(colors).not.toEqual(before);
    expect(textOf(calls[0]!.params.messages[0]!.content)).toContain('#1B3A4B, #F4D35E, #EE964B');
  });

  it('refine mode sends the base scene and the requested change', async () => {
    const base = { ...validScene(), id: 'gen_base01' };
    const { client, calls } = fakeClient([submit(validScene())]);
    await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input({ prompt: 'Make the accent red', baseScene: base }));
    const text = textOf(calls[0]!.params.messages[0]!.content);
    expect(text).toContain('Edit this existing scene');
    expect(text).toContain(JSON.stringify(base));
    expect(text).toContain('Make the accent red');
    expect(text).toContain('keep everything else');
  });

  it('sends the reference image as an image block; rejects unsupported types', async () => {
    const { client, calls } = fakeClient([submit(validScene())]);
    const gen = new ClaudeGenerator({ client, model: DEFAULT_MODEL });
    await gen.generate(input({ image: { mime: 'image/png', base64: 'iVBORw0KGgo=' } }));
    const content = calls[0]!.params.messages[0]!.content as { type: string; source?: unknown }[];
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    expect(textOf(content)).toContain("don't copy its text verbatim");

    const err = await gen.generate(input({ image: { mime: 'image/svg+xml', base64: 'PHN2Zz4=' } })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerateError);
    expect(calls).toHaveLength(1);
  });

  it('aborts promptly while waiting for Claude', async () => {
    const { client } = fakeClient([hangUntilAbort]);
    const ac = new AbortController();
    const p = new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input({ signal: ac.signal }));
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not call Claude when already aborted', async () => {
    const { client, calls } = fakeClient([submit(validScene())]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input({ signal: ac.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });

  it('times out a call that takes too long', async () => {
    const { client } = fakeClient([hangUntilAbort]);
    const err = await new ClaudeGenerator({ client, model: DEFAULT_MODEL, timeoutMs: 20 })
      .generate(input())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerateError);
    expect((err as Error).message).toMatch(/took too long/);
  });

  it('maps API errors to user-safe messages', async () => {
    const h = new Headers();
    const key = 'sk-ant-test-secret';
    const auth = APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: `bad key ${key}` } }, undefined, h);
    const { client } = fakeClient([auth]);
    const err = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerateError);
    expect((err as Error).message).toBe('The Anthropic API key was rejected.');
    expect((err as Error).message).not.toContain(key);

    const busy = 'Claude is busy right now. Try again in a minute.';
    expect(toGenerateError(APIError.generate(429, {}, 'rate', h), DEFAULT_MODEL).message).toBe(busy);
    expect(toGenerateError(APIError.generate(529, {}, 'overloaded', h), DEFAULT_MODEL).message).toBe(busy);
    expect(toGenerateError(APIError.generate(503, {}, 'unavailable', h), DEFAULT_MODEL).message).toBe(busy);
    expect(toGenerateError(APIError.generate(404, {}, 'nope', h), 'claude-x').message).toContain('claude-x');
    expect(toGenerateError(APIError.generate(500, {}, 'boom', h), DEFAULT_MODEL).message).toBe(
      'Generating the scene failed. Try again in a moment.',
    );
    expect(toGenerateError(new APIUserAbortError(), DEFAULT_MODEL).name).toBe('AbortError');
  });

  it('reports a refusal as a GenerateError', async () => {
    const { client } = fakeClient([message([], 'refusal')]);
    const err = await new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerateError);
    expect((err as Error).message).toMatch(/declined/);
  });

  it('falls back to a prompt-derived name and clips long names', async () => {
    const noName = { ...validScene() };
    delete noName.name;
    const { client } = fakeClient([
      submit(noName, ''),
      submit(validScene(), 'An extraordinarily long template name that keeps going'),
    ]);
    const gen = new ClaudeGenerator({ client, model: DEFAULT_MODEL });
    expect((await gen.generate(input({ prompt: 'spring sale for our bakery, 30% off!' }))).name).toBe(
      'Spring sale for our bakery 30%', // first six words
    );
    const long = (await gen.generate(input())).name;
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe('An extraordinarily long template name');
  });

  it('rejects a scene id the validator would never accept', async () => {
    const { client } = fakeClient([submit(validScene())]);
    await expect(
      new ClaudeGenerator({ client, model: DEFAULT_MODEL }).generate(input({ sceneId: 'gen_ABC' })),
    ).rejects.toThrow(/sceneId/);
  });
});

describe('MockGenerator', () => {
  const prompts: [string, string][] = [
    ['Black Friday sale, 50% off everything', 'sale_burst_v1'],
    ['Customer review with five stars', 'testimonial_v1'],
    ['Animated bar chart of quarterly revenue', 'bar_chart_v1'],
    ['Countdown to our launch', 'countdown_v1'],
    ['something completely unrelated', 'title_sequence_v1'],
  ];

  it.each(prompts)('%s → %s', async (prompt, expected) => {
    expect(pickMockScene(prompt)).toBe(expected);
    const inp = input({ prompt });
    const res = await new MockGenerator({ delayMs: 0 }).generate(inp);
    const scene = res.scene as Scene;
    expect(validateScene(scene).ok).toBe(true);
    expect(scene.id).toBe(SCENE_ID);
    expect(scene.defaultSettings.durationFrames).toBe(240);
    expect(res.repairs).toBe(0);
    expect(res.name.length).toBeGreaterThan(0);
    expect(res.name.length).toBeLessThanOrEqual(40);
    expect(steps(inp.events)).toEqual(['writing:1', 'checking:1']);
  });

  it('is deterministic, refines the base scene and applies a palette', async () => {
    const gen = new MockGenerator({ delayMs: 0 });
    const a = await gen.generate(input({ prompt: 'sale' }));
    const b = await gen.generate(input({ prompt: 'sale' }));
    expect(a).toEqual(b);

    const base: Record<string, unknown> = { ...validScene('stat_counter_v1'), id: 'gen_base01' };
    const palette = { colors: [{ hex: '#102030', weight: 0.7 }, { hex: '#FF6600', weight: 0.3 }] };
    const refined = await gen.generate(input({ prompt: 'bigger number', baseScene: base, palette }));
    const scene = refined.scene as Scene;
    expect(validateScene(scene).ok).toBe(true);
    expect(scene.id).toBe(SCENE_ID);
    expect(scene.layers.map((l) => l.id)).toEqual((base.layers as { id: string }[]).map((l) => l.id));
    const colors = scene.params.filter((p) => p.type === 'color').map((p) => p.default);
    const baseColors = (base.params as { type: string; default: string }[]).filter((p) => p.type === 'color').map((p) => p.default);
    expect(colors).not.toEqual(baseColors);
  });

  it('aborts during the artificial delay', async () => {
    const ac = new AbortController();
    const p = new MockGenerator({ delayMs: 5_000 }).generate(input({ signal: ac.signal }));
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createGenerator', () => {
  it('mock mode needs no key', () => {
    const r = createGenerator({ MG_GENERATOR: 'mock' });
    expect(r.generator).toBeInstanceOf(MockGenerator);
    expect(r.model).toBe('mock');
  });

  it('uses Claude when a key is set, with the default or configured model', () => {
    const r = createGenerator({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(r.generator).toBeInstanceOf(ClaudeGenerator);
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.generator?.model).toBe('claude-sonnet-5-5');
    expect(createGenerator({ ANTHROPIC_API_KEY: 'sk-ant-test', MG_GENERATOR_MODEL: 'claude-opus-5-5' }).model).toBe('claude-opus-5-5');
  });

  it('is disabled without a key', () => {
    const r = createGenerator({});
    expect(r.generator).toBeNull();
    expect(r.reason).toBe('Set ANTHROPIC_API_KEY on the API server to enable generation.');
  });
});
