const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'http://localhost:4200';
const OUT = __dirname + '/img';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
  });
  const page = await ctx.newPage();
  const shot = async (name, opts = {}) => {
    await sleep(opts.wait ?? 500);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
    console.log('OK', name);
  };
  const clickOpt = async (sel, ms = 2500) => {
    try { await page.click(sel, { timeout: ms }); return true; } catch { return false; }
  };
  const closeModal = async () => {
    await page.keyboard.press('Escape');
    await clickOpt('.modal-inn .close', 1500);
    await clickOpt('button.close', 1200);
    await clickOpt('.overlay', 800);
    await sleep(250);
  };

  // ---------- LOGIN ----------
  await page.goto(BASE + '/login', { waitUntil: "domcontentloaded" });
  await shot('01-login');
  await page.fill('input[formcontrolname="login"]', 'admin');
  await page.fill('input[formcontrolname="senha"]', 'admin123');
  await page.click('button.btn-acessar');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForSelector('text=Check-in', { timeout: 15000 });
  await sleep(1400);
  await shot('02-dashboard', { full: true });

  // ---------- BUSCA GLOBAL ----------
  await page.click('.busca-input');
  await page.fill('.busca-input', 'maria');
  await sleep(900);
  await shot('03-busca');
  await page.keyboard.press('Escape');

  // ---------- NOTIFICAÇÕES ----------
  await page.click('button.sino');
  await sleep(900);
  await shot('04-notificacoes');
  await clickOpt('.sino-fechar', 2000);

  // ---------- CLIENTES ----------
  await page.goto(BASE + '/clientes', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('10-clientes');
  await page.click('text=Cadastrar Cliente');
  await sleep(700);
  await shot('11-cliente-form', { full: true });
  await closeModal();
  const docBtn = page.locator('button[title="Documentos e fichas FNRH"]').first();
  if (await docBtn.count()) {
    await docBtn.click();
    await sleep(800);
    await shot('12-cliente-documentos', { full: true });
    await closeModal();
  }

  // ---------- ACOMODAÇÕES ----------
  await page.goto(BASE + '/acomodacoes', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('20-acomodacoes');
  const eyeBtn = page.locator('button:has(mat-icon:text("visibility"))').first();
  if (await eyeBtn.count()) {
    await eyeBtn.click();
    await sleep(800);
    await shot('21-acomodacao-detalhes', { full: true });
    await page.goto(BASE + '/acomodacoes', { waitUntil: "domcontentloaded" });
    await sleep(600);
  }
  await page.click('text=Tipo de acomodação');
  await sleep(700);
  await shot('22-tipos-acomodacao');
  await closeModal();
  await clickOpt('button:has-text("Acomodação")');
  await sleep(700);
  await shot('23-acomodacao-form', { full: true });
  await closeModal();

  // ---------- ESTOQUE ----------
  await page.goto(BASE + '/estoque', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('30-estoque');
  const tabEntrada = page.locator('[role="tab"]:has-text("Entrada")').first();
  if (await tabEntrada.count()) { await tabEntrada.click(); await sleep(600); await shot('31-estoque-entrada'); }
  const tabSaida = page.locator('[role="tab"]:has-text("Saída")').first();
  if (await tabSaida.count()) { await tabSaida.click(); await sleep(600); await shot('32-estoque-saida'); }
  const tabMov = page.locator('[role="tab"]:has-text("Moviment")').first();
  if (await tabMov.count()) { await tabMov.click(); await sleep(600); await shot('33-estoque-movimentacoes'); }
  await clickOpt('button:has-text("Categorias")');
  await sleep(700);
  await shot('34-categorias');
  await closeModal();
  await clickOpt('button:has-text("Adicionar Item")');
  await sleep(700);
  await shot('35-item-form');
  await closeModal();

  // ---------- FRIGOBARES ----------
  await page.goto(BASE + '/frigobares', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('40-frigobares');
  const eyeF = page.locator('button:has(mat-icon:text("visibility"))').first();
  if (await eyeF.count()) {
    await eyeF.click();
    await sleep(900);
    await shot('41-frigobar-detalhe', { full: true });
  }

  // ---------- ESTACIONAMENTO ----------
  await page.goto(BASE + '/estacionamento', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('50-estacionamento');

  // ---------- RESERVAS ----------
  await page.goto(BASE + '/reservas', { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await shot('60-reservas');
  await page.click('text=Nova Reserva');
  await sleep(800);
  await shot('61-nova-reserva');
  await closeModal();

  await page.goto(BASE + '/reservas/4', { waitUntil: "domcontentloaded" });
  await sleep(1400);
  await shot('62-reserva-estadia', { full: true });
  if (await clickOpt('button:has-text("Realizar Check-out")')) {
    await sleep(800);
    await shot('63-checkout-modal', { full: true });
    await closeModal();
  }
  if (await clickOpt('button:has-text("Emitir FNRH")')) {
    await sleep(700);
    await shot('64-fnrh-modal');
    await closeModal();
  }
  if (await clickOpt('button:has-text("Cancelar reserva")')) {
    await sleep(600);
    await shot('65-cancelar-modal');
    await clickOpt('button:has-text("NÃO")', 1500);
    await closeModal();
  }

  await page.goto(BASE + '/reservas/5', { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await shot('66-reserva-pendente', { full: true });
  if (await clickOpt('button:has-text("Realizar Check-in")')) {
    await sleep(700);
    await shot('67-checkin-modal');
    await closeModal();
  }

  await page.goto(BASE + '/reservas/3', { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await shot('68-reserva-finalizada', { full: true });
  if (await clickOpt('button:has-text("Dados do Check-out")')) {
    await sleep(700);
    await shot('69-dados-checkout');
    await closeModal();
  }

  // ---------- PAGAMENTOS ----------
  await page.goto(BASE + '/pagamentos', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('70-pagamentos');
  await clickOpt('button:has-text("Formas de pagamento")');
  await sleep(700);
  await shot('71-formas-pagamento');
  await closeModal();
  // comprovante visualizar (primeiro)
  const eyeC = page.locator('button:has(mat-icon:text("visibility"))').first();
  if (await eyeC.count()) {
    await eyeC.click();
    await sleep(900);
    await shot('72-comprovante');
    await closeModal();
  }

  // ---------- FINANCEIRO ----------
  await page.goto(BASE + '/financeiro', { waitUntil: "domcontentloaded" });
  await sleep(1800);
  await shot('80-financeiro', { full: true });

  // ---------- ESTABELECIMENTO ----------
  await page.goto(BASE + '/estabelecimento', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('90-estabelecimento', { full: true });

  // ---------- FUNCIONÁRIOS ----------
  await page.goto(BASE + '/funcionarios', { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await shot('91-funcionarios', { full: true });

  // ---------- AUDITORIA ----------
  await page.goto(BASE + '/auditoria', { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await shot('92-auditoria', { full: true });

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
