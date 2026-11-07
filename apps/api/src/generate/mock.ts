/**
 * Offline generator for building and demoing the studio without an API key (MG_GENERATOR=mock).
 * Deterministic: picks a bundled scene by keyword overlap with the prompt (refine mode reuses the
 * base scene), then runs the same post-processing and emits the same events as the Claude path.
 */
import { bundledScenes } from './resources';
import { applyPaletteToScene, assertSceneId, checkCandidate, nameFromPrompt, normalisePalette } from './scene';
import { GenerateError, abortError, throwIfAborted, type GenerateInput, type GenerateResult, type SceneGenerator } from './types';

export const MOCK_FALLBACK_SCENE = 'title_sequence_v1';

/** Extra words per bundled scene beyond its id, name, description and category. */
const SYNONYMS: Record<string, string[]> = {
  bar_chart_v1: ['chart', 'graph', 'bars', 'statistics', 'growth', 'revenue', 'report'],
  breaking_news_v1: ['news', 'breaking', 'headline', 'live', 'alert'],
  countdown_v1: ['countdown', 'timer', 'launch', 'seconds', 'soon'],
  event_announcement_v1: ['event', 'conference', 'meetup', 'webinar', 'concert', 'register', 'date'],
  logo_sting_v1: ['logo', 'intro', 'brand', 'sting', 'reveal', 'outro'],
  lower_third_v1: ['lower', 'third', 'name', 'speaker', 'interview', 'caption'],
  milestone_v1: ['milestone', 'followers', 'subscribers', 'thank', 'celebration', 'confetti'],
  new_post_v1: ['post', 'video', 'youtube', 'episode', 'upload', 'watch'],
  product_reveal_v1: ['product', 'price', 'shop', 'launch', 'new'],
  quote_card_v1: ['quote', 'saying', 'inspiration', 'motivational'],
  sale_burst_v1: ['sale', 'discount', 'off', 'deal', 'promo', 'offer', 'black', 'friday'],
  stat_counter_v1: ['stat', 'number', 'counter', 'percent', 'metric', 'kpi'],
  testimonial_v1: ['testimonial', 'review', 'customer', 'rating', 'stars', 'feedback'],
  title_sequence_v1: ['title', 'cinematic', 'film', 'movie', 'trailer', 'opening'],
};

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
}

/** Best keyword match among the bundled scenes; ties keep file order. */
export function pickMockScene(prompt: string): string {
  const want = words(prompt);
  let best = MOCK_FALLBACK_SCENE;
  let bestScore = 0;
  for (const [id, scene] of bundledScenes()) {
    const text = [id.replace(/_v\d+$/, '').replace(/_/g, ' '), scene.name, scene.description, scene.category]
      .filter((v) => typeof v === 'string')
      .join(' ');
    const vocab = new Set([...words(text), ...(SYNONYMS[id] ?? [])]);
    let score = 0;
    for (const w of want) if (vocab.has(w)) score += SYNONYMS[id]?.includes(w) ? 2 : 1;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return signal.aborted ? Promise.reject(abortError()) : Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockGenerator implements SceneGenerator {
  readonly model = 'mock';
  private readonly delayMs: number;

  /** `delayMs` is the artificial pause per step (writing, checking). */
  constructor(opts: { delayMs?: number } = {}) {
    this.delayMs = opts.delayMs ?? 600;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    throwIfAborted(input.signal);
    assertSceneId(input.sceneId);
    input.onEvent({ type: 'step', step: 'writing', attempt: 1, message: 'Writing the scene' });
    await sleep(this.delayMs, input.signal);
    const refine = input.baseScene !== undefined && input.baseScene !== null;
    const source = refine ? input.baseScene : bundledScenes().get(pickMockScene(input.prompt));
    input.onEvent({ type: 'step', step: 'checking', attempt: 1, message: 'Checking the scene' });
    await sleep(this.delayMs, input.signal);
    const name = refine && typeof (source as { name?: unknown }).name === 'string'
      ? ((source as { name: string }).name.slice(0, 40).trim() || nameFromPrompt(input.prompt))
      : nameFromPrompt(input.prompt);
    const checked = checkCandidate(source, input.sceneId, name, input);
    if (!checked.ok) {
      input.onEvent({ type: 'issues', attempt: 1, issues: checked.issues });
      throw new GenerateError('The mock generator could not produce a valid scene.', checked.issues);
    }
    return { scene: applyPaletteToScene(checked.scene, normalisePalette(input.palette)), name, repairs: 0 };
  }
}
