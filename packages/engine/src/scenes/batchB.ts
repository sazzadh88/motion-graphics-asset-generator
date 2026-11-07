// Scene batch B: list this batch's scenes here (see index.ts).
import type { SceneSource } from '../scene/registry';
import testimonial from './testimonial_v1.json';
import newPost from './new_post_v1.json';
import breakingNews from './breaking_news_v1.json';
import barChart from './bar_chart_v1.json';
import milestone from './milestone_v1.json';
import logoSting from './logo_sting_v1.json';

export const BATCH_B: SceneSource[] = [
  { file: 'testimonial_v1.json', json: testimonial },
  { file: 'new_post_v1.json', json: newPost },
  { file: 'breaking_news_v1.json', json: breakingNews },
  { file: 'bar_chart_v1.json', json: barChart },
  { file: 'milestone_v1.json', json: milestone },
  { file: 'logo_sting_v1.json', json: logoSting },
];
