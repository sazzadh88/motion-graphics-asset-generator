// product_reveal_v1 colours from the palette the studio extracted for photo.png (strip widths = weights), variant 0.
import { applyPalette, getTemplate } from '@mg/engine';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const strip: [string, number][] = [['#957649', 126], ['#A15052', 102], ['#2C4279', 80], ['#7C2555', 76], ['#4867C5', 66], ['#C13C84', 24]];
const total = strip.reduce((s, [, w]) => s + w, 0);
const pal = { colors: strip.map(([hex, w]) => ({ hex, weight: w / total })) };
const params = applyPalette(getTemplate('product_reveal_v1')!, pal, { variant: 0 });
console.log(params);
writeFileSync(path.join(root, 'promo/payloads/palette_after_11.json'), JSON.stringify({ templateId: 'product_reveal_v1', settings: { width: 1080, height: 1080, fps: 30, durationFrames: 150, transparent: false }, assets: params }, null, 2));
