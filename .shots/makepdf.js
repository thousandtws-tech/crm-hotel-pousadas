const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('file:///D:/clientes/projeto-clarituz-crm-hotel-pousadas/Manual/manual_sistema.html',
    { waitUntil: 'networkidle' });
  await page.pdf({
    path: 'D:/clientes/projeto-clarituz-crm-hotel-pousadas/Manual/manual_sistema.pdf',
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  await browser.close();
  console.log('PDF OK');
})().catch(e => { console.error('ERR', e); process.exit(1); });
