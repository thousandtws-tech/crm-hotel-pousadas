const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // admin: login
  await page.goto('http://localhost:4200/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="text"], input[name="login"], input[formcontrolname="login"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.goto('http://localhost:4200/cms', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'cms-list.png', fullPage: false });
  // abre editor da Suíte Mar
  const rows = page.locator('tr', { hasText: 'Suíte Mar' });
  await rows.locator('button:has-text("Editar")').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'cms-edit.png', fullPage: true });
  await browser.close();

  // site público
  const b2 = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const p2 = await b2.newPage({ viewport: { width: 1400, height: 900 } });
  await p2.goto('http://localhost:4201/acomodacoes', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(4000);
  await p2.screenshot({ path: 'web-acomodacoes.png' });
  await p2.goto('http://localhost:4201/acomodacoes/chale-jardim', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(3500);
  await p2.screenshot({ path: 'web-detail.png' });
  await b2.close();
  console.log('done');
})();
