const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const out = 'D:/clientes/projeto-clarituz-crm-hotel-pousadas/.shots/';
  await page.goto('http://localhost:4200/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + 'ux-login.png' });
  await page.goto('http://localhost:4200/cadastro', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + 'ux-cadastro.png' });
  // login -> dashboard (shell novo)
  await page.goto('http://localhost:4200/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.fill('input[formcontrolname="login"]', 'admin');
  await page.fill('input[formcontrolname="senha"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out + 'ux-dashboard.png' });
  // sidebar fechada
  await page.click('.header_toggle');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + 'ux-sidebar-mini.png' });
  await browser.close();
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
