const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const shot = async (n, full = false, ms = 1600) => {
    await sleep(ms);
    await page.screenshot({ path: __dirname + '/img/' + n + '.png', fullPage: full });
    console.log('OK', n);
  };
  await page.goto('http://localhost:4300/', { waitUntil: 'domcontentloaded' });
  await shot('w1-home', true, 2500);
  await page.goto('http://localhost:4300/acomodacoes', { waitUntil: 'domcontentloaded' });
  await shot('w2-acomodacoes', true);
  await page.goto('http://localhost:4300/reservar', { waitUntil: 'domcontentloaded' });
  await shot('w3-reservar', true);
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
