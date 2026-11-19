import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const FRIGOBARES = [
  { id: 1, idacomodacao: 1, modelo: 'Consul 80L', patrimonio: '000123', ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z' },
  { id: 2, idacomodacao: 2, modelo: 'Brastemp 93L', patrimonio: '000124', ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z' },
  { id: 3, idacomodacao: 1, modelo: null, patrimonio: null, ativo: false, version: 1, criado_em: '2025-01-10T10:00:00Z' },
];

const ACOMODACOES = [
  {
    id: 1, nome: 'Suíte Master', numero: 1, andar: 1, descricao: null,
    idtipo_acomodacao: 1, valor: 350, capacidade: 4, cor: '#1a6f8a',
    ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z',
  },
  {
    id: 2, nome: 'Chalé Jardim', numero: 2, andar: 0, descricao: null,
    idtipo_acomodacao: 2, valor: 280, capacidade: 2, cor: '#b5811f',
    ativo: true, version: 1, criado_em: '2025-02-01T10:00:00Z', atualizado_em: '2025-02-01T10:00:00Z',
  },
];

const ITENS = [
  { id: 10, idfrigobar: 1, iditem: 5, quantidade: 4, ativo: true, version: 1, item_nome: 'Água sem gás', valor_unitario: '6.00' },
  { id: 11, idfrigobar: 1, iditem: 6, quantidade: 2, ativo: true, version: 1, item_nome: 'Cerveja long neck', valor_unitario: '12.00' },
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
    if (url.includes('/auth/login')) return route.fallback();
    let body: unknown;
    if (url.includes('/frigobares/painel'))
      body = { frigobares: FRIGOBARES, acomodacoes: ACOMODACOES, itens: [], categorias: [] };
    else if (url.includes('/frigobares/') && url.includes('/itens')) body = ITENS;
    else if (url.includes('/frigobares')) body = FRIGOBARES;
    else if (url.includes('/estoque/itens')) body = { items: [], total: 0 };
    else if (url.includes('/estoque/categorias')) body = [];
    else if (url.includes('/acomodacoes')) body = { items: ACOMODACOES, total: ACOMODACOES.length };
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('frigobares — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/frigobares');
  await expect(page.locator('h2.fr-titulo')).toContainText('Frigobares', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Cadastro');
  await expect(page.locator('.fr-contador')).toContainText('3 frigobares · 2 ativos');
  await expect(page.locator('.fr-info-card')).toHaveCount(3);
  await expect(page.locator('tr.fr-row')).toHaveCount(3);
  await expect(page.locator('.st-chip')).toHaveCount(3);
  await expect(page.locator('.st-chip.off')).toHaveCount(1); // frigobar 3 inativo
  await expect(page.locator('.acao-btn').first()).toBeVisible();

  // busca filtra por modelo
  await page.locator('.fr-busca-input').fill('consul');
  await expect(page.locator('tr.fr-row')).toHaveCount(1);
  await page.locator('.fr-busca-input').fill('');

  // drawer abre à direita, por cima de tudo (incl. bolha MAR IA)
  await page.locator('#tour-novo').click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeGreaterThanOrEqual(1919);
  await page.locator('.drawer-fechar').click();
  await expect(drawer).toBeHidden();

  // modal detalhe — itens e chips neutros
  await page.locator('.acao-btn.fr-ver').first().click();
  const modal = page.locator('.modal-fr');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.det-faixa')).toBeVisible();
  await expect(modal.locator('.fr-tabela-itens tbody tr')).toHaveCount(2);
  await expect(modal.locator('.modal-body .st-chip')).toHaveCount(2);

  await page.screenshot({ path: 'capturas-crm/frigobares-min-1920.png' });
});
