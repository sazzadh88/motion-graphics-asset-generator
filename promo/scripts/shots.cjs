const path = require('path');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(path.join(root, 'node_modules/puppeteer'));
const pub = path.join(root, 'promo/reel/public');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto('http://localhost:5174', { waitUntil: 'networkidle0' });
  await sleep(1500);
  const clickText = async (sel, txt) => {
    const hs = await p.$$(sel);
    for (const h of hs) {
      const t = await h.evaluate((e) => e.textContent);
      if (t.includes(txt)) { await h.click(); return true; }
    }
    return false;
  };
  console.log('select', await clickText('nav.templates button', 'Product Reveal'));
  await sleep(2500);
  await p.mouse.click(720, 875);
  await sleep(800);
  await p.screenshot({ path: path.join(pub, 'shots/studio.png') });
  console.log('gen', await clickText('button', 'Generate template'));
  await sleep(800);
  await p.waitForSelector('textarea');
  await p.type('textarea', 'Neon launch reel for new sneakers', { delay: 20 });
  await sleep(500);
  await p.screenshot({ path: path.join(pub, 'shots/generate.png') });
  await p.keyboard.press('Escape');
  await sleep(500);
  if (await p.$('textarea')) await clickText('button[aria-label="Close"]', '');
  await sleep(500);
  const inputs = await p.$$('input[type=file]');
  console.log('file inputs', inputs.length);
  await inputs[0].uploadFile(path.join(pub, 'palette/photo.png'));
  await sleep(2500);
  await p.evaluate(() => {
    const e = document.querySelector('[class*=refpal]');
    if (e) e.scrollIntoView({ block: 'center' });
  });
  await sleep(800);
  await p.mouse.click(720, 875);
  await sleep(800);
  await p.screenshot({ path: path.join(pub, 'shots/palette.png') });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
