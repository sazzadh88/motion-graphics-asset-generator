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
  let p;

  // ---------- A + B
  try {
    p = await fresh(b);
    await selectTemplate(p);
    await box('.stage canvas', p, 'preview canvas (1:1 state)', 'A');
    await clickText(p, 'button', 'Generate template');
    await p.waitForSelector('dialog.gen-dialog textarea');
    await sleep(900);
    const sels = await p.$$('dialog.gen-dialog select');
    const opts = await p.$$eval('dialog.gen-dialog select', (ss) => ss.map((s) => [...s.options].map((o) => [o.value, o.textContent])));
    const vert = opts[0].find(([v, t]) => /9\s*:\s*16/i.test(t));
    if (vert) await sels[0].select(vert[0]);
    const six = opts[1].find(([v, t]) => /^6\b/.test(t.trim()));
    if (six) await sels[1].select(six[0]);
    const ta = await p.$('dialog.gen-dialog textarea');
    await ta.click({ clickCount: 3 }); await p.keyboard.press('Backspace');
    await ta.focus();
    await sleep(500);
    await box('dialog.gen-dialog', p, 'generate dialog panel', 'A');
    await box(ta, p, 'textarea', 'A');
    await box('dialog.gen-dialog .dialog-actions button.primary', p, 'Generate button', 'A');
    // type sequence: caret visible
    await showCaret(p);
    const text = 'Neon launch reel for new sneakers';
    await shot(p, 'type/000.png');
    for (let i = 0; i < text.length; i++) {
      await p.keyboard.type(text[i]);
      await sleep(60);
      await shot(p, 'type/' + pad(i + 1) + '.png');
    }
    await hideCaret(p);
    const gen = await p.$('dialog.gen-dialog .dialog-actions button.primary');
    const gb = await gen.boundingBox();
    await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, { steps: 8 });
    await sleep(500);
    await shot(p, 'type/hover.png');
    await p.mouse.down(); await sleep(150);
    await shot(p, 'type/press.png');
    await p.mouse.up();
    const clip = { x: 420, y: 260, width: 600, height: 380 };
    const t0 = Date.now(); let n = 0; const times = [];
    while (n < 120) {
      await shot(p, 'gen/' + pad(n) + '.png', clip); times.push(Date.now() - t0); n++;
      const state = await p.evaluate(() => ({ result: !!document.querySelector('.gen-result'), failure: !!document.querySelector('.gen-failure'), open: !!document.querySelector('dialog[open]') }));
      if (state.result || state.failure || !state.open) { notes.push('gen ended after ' + (Date.now() - t0) + 'ms, shots ' + n + ' ' + JSON.stringify(state)); break; }
    }
    fs.writeFileSync(path.join(out, 'gen/times.json'), JSON.stringify({ clip, shots: n, totalMs: Date.now() - t0, timesMs: times }, null, 2));
    await sleep(600);
    await shot(p, 'gen/full_result.png');
    await box('dialog.gen-dialog', p, 'generate dialog panel (result state)', 'B');
    await box('dialog.gen-dialog .gen-result', p, 'gen-result block', 'B');
    const keep = await findText(p, 'dialog .dialog-actions button', 'Keep');
    if (keep) await keep.click(); else notes.push('no Keep button');
    await sleep(2500);
    await p.mouse.move(720, 20);
    await box('.stage canvas', p, 'preview canvas (9:16 generated)', 'B');
    notes.push('result frame ' + (await scrubToFrame(p, (await maxFrame(p)) / 2)));
    await shot(p, 'result/full.png');
    await p.close();
  } catch (e) { notes.push('A/B failed: ' + e.stack); console.error(e); try { await p.close(); } catch (e2) {} }

  // ---------- C palette
  try {
    p = await fresh(b);
    await selectTemplate(p);
    await p.mouse.move(720, 20);
    await p.evaluate(() => { const e = document.querySelector('.refpal-drop'); if (e) e.scrollIntoView({ block: 'center' }); });
    await sleep(600);
    await box('.refpal-drop', p, 'palette drop zone', 'C');
    notes.push('palette before frame ' + (await scrubToFrame(p, 60)));
    await shot(p, 'palette/before.png');
    const inp = await p.$('input[type=file]');
    await inp.uploadFile(path.join(pub, 'palette/photo.png'));
    await p.waitForSelector('.refpal-strip', { timeout: 10000 });
    await sleep(2000);
    await p.evaluate(() => { const e = document.querySelector('.refpal-strip'); if (e) e.scrollIntoView({ block: 'center' }); });
    await sleep(800);
    await box('.refpal-strip', p, 'palette swatch strip', 'C');
    await box('.refpal-thumb', p, 'palette thumbnail', 'C');
    await box('.refpal-row', p, 'palette row (thumb+strip)', 'C');
    notes.push('palette after frame ' + (await scrubToFrame(p, 60)));
    await shot(p, 'palette/after.png');
    await p.close();
  } catch (e) { notes.push('C failed: ' + e.stack); console.error(e); try { await p.close(); } catch (e2) {} }

  // ---------- D export
  try {
    p = await fresh(b);
    await selectTemplate(p, 'Product Reveal');
    await p.mouse.move(720, 20);
    await clickText(p, 'header .btn.primary', 'Export');
    await p.waitForSelector('dialog[open] form');
    await sleep(900);
    const mp4 = await findText(p, 'dialog label.seg', 'MP4');
    if (mp4) await mp4.click();
    await sleep(400);
    await box('dialog[open]', p, 'export dialog panel (Product Reveal)', 'D');
    await box(await findText(p, 'dialog[open] button', 'Render video'), p, 'Render video button', 'D');
    await shot(p, 'export/dialog.png');
    await p.keyboard.press('Escape'); await sleep(600);
    // render the longer template for denser progress
    await selectTemplate(p, EXPORT_TEMPLATE);
    await p.mouse.move(720, 20);
    await clickText(p, 'header .btn.primary', 'Export');
    await p.waitForSelector('dialog[open] form');
    await sleep(700);
    const mp4b = await findText(p, 'dialog label.seg', 'MP4');
    if (mp4b) await mp4b.click();
    notes.push('export dialog text: ' + (await p.$eval('dialog[open]', (d) => d.innerText.replace(/\n+/g, ' | '))));
    await (await findText(p, 'dialog[open] button', 'Render video')).click();
    const clip = { x: 1040, y: 0, width: 400, height: 360 };
    const t0 = Date.now(); let n = 0, fin = false; const times = [];
    let boxed = false;
    while (Date.now() - t0 < 240000) {
      await shot(p, 'export/' + pad(n) + '.png', clip); times.push(Date.now() - t0); n++;
      if (!boxed) {
        const tab = await p.$('#tab-renders'); if (tab) await tab.click();
        await p.mouse.move(720, 20);
        await box('.progress', p, 'render progress bar', 'D'); await box('li.job', p, 'render job row', 'D');
        await box('li.job .job-meta', p, 'progress text line', 'D'); await box('header .chip', p, 'top-bar chip', 'D');
        boxed = !!(await p.$('li.job'));
      }
      const st = await p.evaluate(() => { const e = document.querySelector('.badge'); return e ? e.textContent : ''; });
      if (/Completed|Failed|Cancelled/.test(st)) { fin = true; notes.push('export ended ' + st + ' after ' + (Date.now() - t0) + 'ms, shots ' + n); break; }
    }
    fs.writeFileSync(path.join(out, 'export/times.json'), JSON.stringify({ template: EXPORT_TEMPLATE, clip, shots: n, finished: fin, totalMs: Date.now() - t0, timesMs: times }, null, 2));
    await sleep(800);
    await box('li.job .job-actions button, li.job .job-actions a', p, 'Download video button', 'D');
    await box('li.job', p, 'render job row (done)', 'D');
    await p.mouse.move(720, 20);
    await shot(p, 'export/done.png');
    await p.close();
  } catch (e) { notes.push('D failed: ' + e.stack); console.error(e); try { await p.close(); } catch (e2) {} }

  await b.close();
  fs.writeFileSync(path.join(out, 'boxes.json'), JSON.stringify({ viewport: { cssWidth: 1440, cssHeight: 900, deviceScaleFactor: S, imageWidth: 1440 * S, imageHeight: 900 * S }, boxes, notes }, null, 2));
  console.log(notes.join('\n'));
})();
