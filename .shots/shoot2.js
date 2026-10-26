const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  await page.goto('http://localhost:4200/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[formcontrolname="login"]', 'admin');
  await page.fill('input[formcontrolname="senha"]', 'admin123');
  await page.click('button.btn-acessar');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.goto('http://localhost:4200/estoque', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.click('[role="tab"]:has-text("Adicionar Saida")');
  await sleep(700);
  await page.screenshot({ path: __dirname + '/img/32-estoque-saida.png' });
  console.log('OK 32');
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
