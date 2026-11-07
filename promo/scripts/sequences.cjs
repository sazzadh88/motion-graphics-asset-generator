const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(path.join(root, 'node_modules/puppeteer'));
const pub = path.join(root, 'promo/reel/public');
const out = path.join(pub, 'ui');
const URL = 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(3, '0');
const boxes = {};
const notes = [];

async function fresh(b) {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await sleep(1200);
  return p;
}
const shot = async (p, rel) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: f });
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
  const e = boxes[name] || (boxes[name] = { css: r, image: { x: r.x * 2, y: r.y * 2, width: r.width * 2, height: r.height * 2 }, sequences: [] });
  if (!e.sequences.includes(seq)) e.sequences.push(seq);
}
const selectTemplate = async (p) => { await clickText(p, 'nav.templates button', 'Product Reveal'); await sleep(2500); };
async function scrubTo(p, frac) {
  const r = await p.$eval('.scrubber', (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const x = r.x + 4 + (r.w - 8) * frac, y = r.y + r.h / 2;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up();
  await p.mouse.move(720, 20);
}

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  let p;

  // ---------- A + B
  try {
    p = await fresh(b);
    await selectTemplate(p);
    await box('.rail', p, 'template sidebar', 'A');
    await box('.stage canvas', p, 'preview canvas', 'A');
    await box('.panel', p, 'inspector panel', 'A');
    await box('.timeline', p, 'timeline/playhead bar', 'A');
    await box('.scrubber', p, 'timeline scrubber', 'A');
    await box('header .btn.primary', p, 'Export button', 'A');
    await clickText(p, 'button', 'Generate template');
    await p.waitForSelector('dialog.gen-dialog textarea');
    await sleep(900);
    const opts = await p.$$eval('dialog.gen-dialog select', (ss) => ss.map((s) => [...s.options].map((o) => [o.value, o.textContent])));
    notes.push('select options: ' + JSON.stringify(opts));
    const sels = await p.$$('dialog.gen-dialog select');
    const vert = opts[0].find(([v, t]) => /9\s*:\s*16|vertical|portrait/i.test(t));
    if (vert) { await sels[0].select(vert[0]); notes.push('format chose ' + vert[1]); } else notes.push('no 9:16 option');
    const six = opts[1].find(([v, t]) => /^6\b/.test(t.trim()));
    if (six) await sels[1].select(six[0]); else notes.push('no 6 s option');
    const ta = await p.$('dialog.gen-dialog textarea');
    await ta.click({ clickCount: 3 }); await p.keyboard.press('Backspace');
    await ta.focus();
    await sleep(500);
    await box('dialog.gen-dialog', p, 'generate dialog panel', 'A');
    await box(ta, p, 'textarea', 'A');
    await box('dialog.gen-dialog .dialog-actions button.primary', p, 'Generate button', 'A');
    await box(await findText(p, 'dialog.gen-dialog .dialog-actions button', 'Cancel'), p, 'Cancel button', 'A');
    const text = 'Neon launch reel for new sneakers';
    await shot(p, 'type/000.png');
    for (let i = 0; i < text.length; i++) {
      await p.keyboard.type(text[i]);
      await sleep(60);
      await shot(p, 'type/' + pad(i + 1) + '.png');
    }
    const gen = await p.$('dialog.gen-dialog .dialog-actions button.primary');
    const gb = await gen.boundingBox();
    await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, { steps: 8 });
    await sleep(500);
    await shot(p, 'type/hover.png');
    await p.mouse.down(); await sleep(150);
    await shot(p, 'type/press.png');
    await p.mouse.up();
    const t0 = Date.now();
    let n = 0, done = false;
    while (n < 40) {
      await shot(p, 'gen/' + pad(n) + '.png'); n++;
      const state = await p.evaluate(() => ({ result: !!document.querySelector('.gen-result'), failure: !!document.querySelector('.gen-failure'), open: !!document.querySelector('dialog[open]') }));
      if (state.result || state.failure || !state.open) { done = true; notes.push('gen ended after ' + (Date.now() - t0) + 'ms, shots ' + n + ' state ' + JSON.stringify(state)); break; }
      await sleep(120);
    }
    if (!done) notes.push('gen not finished in 40 shots');
    await sleep(700);
    await shot(p, 'gen/final.png');
    await box('dialog.gen-dialog', p, 'generate dialog panel (result state)', 'B');
    const keep = await findText(p, 'dialog .dialog-actions button', 'Keep');
    if (keep) await keep.click(); else notes.push('no Keep button');
    await sleep(2500);
    await p.mouse.move(720, 20);
    await box('.stage canvas', p, 'preview canvas (generated)', 'B');
    for (let i = 0; i < 16; i++) { await scrubTo(p, (i / 15) * 0.97); await sleep(250); await shot(p, 'result/' + pad(i) + '.png'); }
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
    await shot(p, 'palette/before.png');
    const inp = await p.$('input[type=file]');
    await inp.uploadFile(path.join(pub, 'palette/photo.png'));
    await p.waitForSelector('.refpal-strip', { timeout: 10000 });
    await sleep(2000);
    await p.evaluate(() => { const e = document.querySelector('.refpal-strip'); if (e) e.scrollIntoView({ block: 'center' }); });
    await sleep(800);
    await box('.refpal-strip', p, 'palette swatch strip', 'C');
    await box('.refpal-row', p, 'palette row (thumb+strip)', 'C');
    await box(await findText(p, 'button', 'Shuffle'), p, 'Shuffle button', 'C');
    await shot(p, 'palette/after.png');
    for (let i = 1; i <= 2; i++) { await (await findText(p, 'button', 'Shuffle')).click(); await p.mouse.move(720, 20); await sleep(1200); await shot(p, 'palette/shuffle' + i + '.png'); }
    await p.close();
  } catch (e) { notes.push('C failed: ' + e.stack); console.error(e); try { await p.close(); } catch (e2) {} }

  // ---------- D export
  try {
    p = await fresh(b);
    await selectTemplate(p);
    await p.mouse.move(720, 20);
    await clickText(p, 'header .btn.primary', 'Export');
    await p.waitForSelector('dialog[open] form');
    await sleep(900);
    const mp4 = await findText(p, 'dialog label.seg', 'MP4');
    if (mp4) await mp4.click();
    notes.push('export dialog text: ' + (await p.$eval('dialog[open]', (d) => d.innerText.replace(/\n+/g, ' | '))));
    await sleep(400);
    await box('dialog[open]', p, 'export dialog panel', 'D');
    await box(await findText(p, 'dialog[open] button', 'Render video'), p, 'Render video button', 'D');
    await shot(p, 'export/dialog.png');
    await (await findText(p, 'dialog[open] button', 'Render video')).click();
    await sleep(500);
    const tab = await p.$('#tab-renders'); if (tab) await tab.click();
    await sleep(300);
    await p.mouse.move(720, 20);
    await box('.panel', p, 'render panel (renders tab)', 'D');
    const t0 = Date.now(); let n = 0, fin = false;
    while (n < 60 && Date.now() - t0 < 180000) {
      await sleep(250);
      await shot(p, 'export/' + pad(n) + '.png'); n++;
      if (n === 3) { await box('.progress', p, 'render progress bar', 'D'); await box('li.job', p, 'render job row', 'D'); await box('.chip', p, 'topbar progress chip', 'D'); }
      const st = await p.evaluate(() => { const e = document.querySelector('.badge'); return e ? e.textContent : ''; });
      if (/Completed|Failed|Cancelled/.test(st)) { fin = true; notes.push('export ended ' + st + ' after ' + (Date.now() - t0) + 'ms, shots ' + n); break; }
    }
    if (!fin) {
      while (Date.now() - t0 < 180000) {
        const st = await p.evaluate(() => { const e = document.querySelector('.badge'); return e ? e.textContent : ''; });
        if (/Completed|Failed|Cancelled/.test(st)) { fin = true; break; }
        await sleep(1000);
      }
      notes.push('export shot cap reached at ' + n + '; finished=' + fin);
    }
    await sleep(800);
    await shot(p, 'export/done.png');
    await p.close();
  } catch (e) { notes.push('D failed: ' + e.stack); console.error(e); try { await p.close(); } catch (e2) {} }

  // ---------- E library
  try {
    p = await fresh(b);
    await p.mouse.move(720, 20);
    await box('.templates-scroll', p, 'template list scroll area', 'E');
    await shot(p, 'library/top.png');
    const info = await p.$eval('.templates-scroll', (e) => { e.scrollTop = Math.max(0, (e.scrollHeight - e.clientHeight) / 2); return [e.scrollHeight, e.clientHeight, e.scrollTop]; });
    notes.push('library scroll ' + info);
    await sleep(800);
    await shot(p, 'library/mid.png');
    await p.close();
  } catch (e) { notes.push('E failed: ' + e.stack); console.error(e); }

  await b.close();
  fs.writeFileSync(path.join(out, 'boxes.json'), JSON.stringify({ viewport: { cssWidth: 1440, cssHeight: 900, deviceScaleFactor: 2, imageWidth: 2880, imageHeight: 1800 }, boxes, notes }, null, 2));
  console.log(notes.join('\n'));
})();
