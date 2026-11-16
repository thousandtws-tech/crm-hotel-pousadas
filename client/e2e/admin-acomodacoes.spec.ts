import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const ACOMODACOES = [
  {
    id: 1, nome: 'Suíte Master', numero: 1, andar: 1, descricao: 'Vista para o mar',
    idtipo_acomodacao: 1, valor: 350, capacidade: 4, cor: '#1a6f8a',
    ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z',
  },
  {
    id: 2, nome: 'Chalé Jardim', numero: 2, andar: 0, descricao: null,
    idtipo_acomodacao: 2, valor: 280, capacidade: 2, cor: '#b5811f',
    ativo: true, version: 1, criado_em: '2025-02-01T10:00:00Z', atualizado_em: '2025-02-01T10:00:00Z',
  },
  {
    id: 3, nome: 'Apartamento Família', numero: 3, andar: 2, descricao: 'Dois quartos',
    idtipo_acomodacao: 1, valor: null, capacidade: 6, cor: null,
    ativo: false, version: 2, criado_em: '2024-08-15T10:00:00Z', atualizado_em: '2025-03-01T10:00:00Z',
  },
];

const TIPOS = [
  { id: 1, nome: 'Suíte', ativo: true, version: 1 },
  { id: 2, nome: 'Chalé', ativo: true, version: 1 },
];

const QUARTOS = [
  { id: 11, numero: '101', ativo: true },
  { id: 12, numero: '102', ativo: false },
];

const TARIFAS = [
  { id: 1, valor: 320, vigente_desde: '2025-01-01', vigente_ate: '2025-06-30' },
  { id: 2, valor: 350, vigente_desde: '2025-07-01', vigente_ate: null },
];

async function mockAdminApi(page: Page): Promise<void> {
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-access', refresh_token: 'e2e-refresh',
        token_type: 'Bearer', expira_em: 3600,
        funcionario: { id: 1, nome: 'Admin E2E', login: 'admin', nivel: 1, financeiro: true, ativo: true },
      }),
    })
  );

  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/auth/login')) return route.fallback();
    let body: unknown;
    if (url.includes('/tarifas')) body = TARIFAS;
    else if (url.includes('/quartos')) body = QUARTOS;
    else if (url.includes('/tipos-acomodacao')) body = method === 'GET' ? TIPOS : TIPOS[0];
    else if (url.includes('/acomodacoes')) {
      if (method === 'GET' && !/\/acomodacoes\/\d/.test(url))
        body = { items: ACOMODACOES, total: ACOMODACOES.length };
      else body = ACOMODACOES[0];
    } else if (url.includes('/estacionamento')) body = [];
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('acomodacoes — página minimalista + drawer de cadastro', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/acomodacoes');
  await expect(page.locator('h2.acm-titulo')).toContainText('Acomodações', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Cadastro');
  await expect(page.locator('.acm-contador')).toContainText('3 acomodações · 2 ativas');
  await expect(page.locator('.acm-info-card')).toHaveCount(3);
  await expect(page.locator('tr.acm-row')).toHaveCount(3);
  await expect(page.locator('.st-chip')).toHaveCount(3);
  await expect(page.locator('.acao-btn').first()).toBeVisible();

  await page.screenshot({ path: 'capturas-crm/acomodacoes-min-1920.png' });

  // Nova acomodação abre a drawer ancorada à direita
  await page.locator('#tour-nova').click();
  const drawer = page.locator('aside.drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('h5')).toContainText('Nova acomodação');
  const box = await drawer.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x + box!.width).toBeGreaterThan(vw - 2);
  expect(box!.height).toBeGreaterThan(1000);
  await expect(drawer.locator('button[type="submit"]')).toContainText('Cadastrar acomodação');
  await expect(drawer.locator('button[type="submit"]')).toHaveClass(/btn-dark-blue/);

  // a drawer cobre header, sidebar e a bolha da MAR IA (z-index efetivo)
  const topo = await page.evaluate(() => {
    const alvo = document.elementFromPoint(1880, 1040);
    return alvo?.closest('.drawer-foot-acoes, .mar-fab')?.className ?? 'nada';
  });
  expect(topo).toContain('drawer-foot-acoes');

  await page.screenshot({ path: 'capturas-crm/acomodacoes-drawer-1920.png' });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Modal detalhe: quartos físicos + histórico de tarifas, acima da MAR IA
  await page.locator('.acm-ver').first().click();
  const detalhe = page.locator('.modal-detalhe');
  await expect(detalhe).toBeVisible();
  await expect(detalhe.locator('.chip strong').first()).toContainText('101');
  await expect(detalhe.locator('.st-chip.estatico').last()).toContainText('vigente');
  const topoModal = await page.evaluate(() => {
    const alvo = document.elementFromPoint(1880, 1040);
    return alvo?.closest('.overlay, .mar-fab')?.className ?? 'nada';
  });
  expect(topoModal).toContain('overlay'); // backdrop do modal acima da MAR IA
  await page.screenshot({ path: 'capturas-crm/acomodacoes-detalhe-1920.png' });
});
