const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(path.join(root, 'node_modules/puppeteer'));
const pub = path.join(root, 'promo/reel/public');
const out = path.join(pub, 'ui3');
const URL = 'http://localhost:5174';
const S = 3;
const EXPORT_TEMPLATE = process.env.EXPORT_TEMPLATE || 'Breaking News';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(3, '0');
const boxes = {};
const notes = [];
const CARET = '*{caret-color:transparent !important}';

async function hideCaret(p) { await p.evaluate((css) => { let s = document.getElementById('nocaret'); if (!s) { s = document.createElement('style'); s.id = 'nocaret'; document.head.appendChild(s); } s.textContent = css; }, CARET); }
async function showCaret(p) { await p.evaluate(() => { const s = document.getElementById('nocaret'); if (s) s.textContent = ''; }); }
async function fresh(b) {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: S });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await hideCaret(p);
  await sleep(1200);
  return p;
}
const shot = async (p, rel, clip) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await p.screenshot(clip ? { path: f, clip } : { path: f });
};
async function clickText(p, sel, txt) {
  for (const h of await p.$$(sel)) {
    const t = await h.evaluate((e) => e.textContent);
    if (t.includes(txt)) { await h.click(); return h; }
  }
  throw new Error('no ' + sel + ' ' + txt);
}
async function findText(p, sel, txt) {
  for (const h of await p.$$(sel)) {
    const t = await h.evaluate((e) => e.textContent);
    if (t.includes(txt)) return h;
  }
  return null;
}
async function box(handleOrSel, p, name, seq) {
  const h = typeof handleOrSel === 'string' ? await p.$(handleOrSel) : handleOrSel;
  if (!h) { notes.push('box missing: ' + name); return; }
  const r = await h.evaluate((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  const e = boxes[name] || (boxes[name] = { css: r, image: { x: r.x * S, y: r.y * S, width: r.width * S, height: r.height * S }, sequences: [] });
  if (!e.sequences.includes(seq)) e.sequences.push(seq);
}
const selectTemplate = async (p, name = 'Product Reveal') => { await clickText(p, 'nav.templates button', name); await sleep(2500); };
async function scrubTo(p, frac) {
  const r = await p.$eval('.scrubber', (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const x = r.x + 4 + (r.w - 8) * frac, y = r.y + r.h / 2;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up();
  await p.mouse.move(720, 20);
}
const maxFrame = (p) => p.$eval('.scrubber', (e) => +e.getAttribute('aria-valuemax'));
async function scrubToFrame(p, frame) {
  const max = await maxFrame(p);
  await scrubTo(p, Math.min(1, frame / max));
  await sleep(500);
  return p.$eval('.scrubber', (e) => e.getAttribute('aria-valuenow'));
}

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await fresh(b);
  await selectTemplate(p, 'Breaking News');
  await scrubToFrame(p, 120);
  await p.mouse.move(720, 20);
  await clickText(p, 'header .btn.primary', 'Export');
  await p.waitForSelector('dialog[open] form');
  await sleep(900);
  const mp4 = await findText(p, 'dialog label.seg', 'MP4');
  if (mp4) await mp4.click();
  await sleep(400);
  const d = await (await p.$('dialog[open]')).boundingBox();
  const btn = await (await findText(p, 'dialog[open] button', 'Render video')).boundingBox();
  await shot(p, 'export/dialog_bn.png');
  await p.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2); await sleep(300);
  await shot(p, 'export/dialog_bn_hover.png');
  console.log(JSON.stringify({ dialog: d, renderBtn: btn }));
  await b.close();
})();
