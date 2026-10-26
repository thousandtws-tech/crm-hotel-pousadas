const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const p = await b.newPage();
  await p.goto('http://localhost:4201/acomodacoes', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  // tela inicial mostra subtitulo atual
  const antes = await p.locator('body').innerText();
  console.log('antes tem "Praia do Pero"?', antes.includes('Praia do Pero'));
  // agora: muda o subtitulo via API (em outro processo) e observa
  await p.waitForTimeout(9000); // tempo pro delta chegar + refetch
  const depois = await p.locator('body').innerText();
  console.log('depois tem "EDITADO-RT"?', depois.includes('EDITADO-RT'));
  await b.close();
})();
