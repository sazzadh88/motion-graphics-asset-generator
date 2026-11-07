// Bundled scene templates (mg-scene@1 JSON, see docs/SCENE_FORMAT.md).
// Add a new scene: drop <id>.json next to this file and list it below (or in a batch file).
import type { SceneSource } from '../scene/registry';
import lowerThird from './lower_third_v1.json';
import statCounter from './stat_counter_v1.json';
import { BATCH_A } from './batchA';
import { BATCH_B } from './batchB';

export const BUNDLED_SCENES: SceneSource[] = [
  { file: 'lower_third_v1.json', json: lowerThird },
  { file: 'stat_counter_v1.json', json: statCounter },
  ...BATCH_A,
  ...BATCH_B,
];
