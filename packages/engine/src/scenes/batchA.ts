// Scene batch A: list this batch's scenes here (see index.ts).
import type { SceneSource } from '../scene/registry';
import quoteCard from './quote_card_v1.json';
import countdown from './countdown_v1.json';
import productReveal from './product_reveal_v1.json';
import eventAnnouncement from './event_announcement_v1.json';
import titleSequence from './title_sequence_v1.json';
import saleBurst from './sale_burst_v1.json';

export const BATCH_A: SceneSource[] = [
  { file: 'quote_card_v1.json', json: quoteCard },
  { file: 'countdown_v1.json', json: countdown },
  { file: 'product_reveal_v1.json', json: productReveal },
  { file: 'event_announcement_v1.json', json: eventAnnouncement },
  { file: 'title_sequence_v1.json', json: titleSequence },
  { file: 'sale_burst_v1.json', json: saleBurst },
];
