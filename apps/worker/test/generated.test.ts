import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTemplate, unregisterTemplate } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import quoteCard from '../../../packages/engine/src/scenes/quote_card_v1.json';
import { renderVideo, shutdown } from '../src/index';
import { probe } from './helpers';

const ID = 'gen_workertest01';
const dir = mkdtempSync(path.join(tmpdir(), 'mg-gen-'));
afterAll(async () => {
  unregisterTemplate(ID);
  await shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const scene = { ...structuredClone(quoteCard), id: ID, name: 'Generated quote' };

function payload(): RenderJobPayload {
  return {
    templateId: ID,
    settings: { width: 320, height: 400, fps: 30, durationFrames: 12, transparent: false },
    assets: {},
  };
}

describe('renderVideo with a generated (runtime-registered) scene', () => {
  it('renders a gen_ scene passed as opts.scene (registered in Node and in the render page)', async () => {
    const out = path.join(dir, 'gen.mp4');
    const r = await renderVideo(payload(), { format: 'mp4', outPath: out, scene });
    expect(r.frames).toBe(12);
    expect(getTemplate(ID)?.origin).toBe('generated');
    const s = probe(out);
    expect([s.width, s.height]).toEqual([320, 400]);
    expect(s.nb_read_frames).toBe('12');
  }, 180_000);

  it('rejects a scene whose id does not match the payload, and an invalid scene', async () => {
    const out = path.join(dir, 'bad.mp4');
    const other = { ...scene, id: 'gen_someotherid1' };
    await expect(renderVideo(payload(), { format: 'mp4', outPath: out, scene: other })).rejects.toThrow(/^Invalid scene: .*does not match/);
    unregisterTemplate('gen_someotherid1');
    await expect(renderVideo(payload(), { format: 'mp4', outPath: out, scene: { ...scene, layers: 'nope' } })).rejects.toThrow(/^Invalid scene/);
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});
