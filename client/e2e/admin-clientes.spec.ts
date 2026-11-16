import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const CLIENTES = [
  {
    id: 1, nome: 'Maria da Silva Santos', cpf: '123.456.789-00',
    data_nascimento: '1985-03-14', email: 'maria.silva@email.com', telefone: '(47) 99999-1234',
    estado: 'SC', cidade: 'Florianópolis', nacionalidade: 'Brasileira', naturalidade: null,
    profissao: 'Advogada', logradouro: null, numero: null, complemento: null, bairro: null,
    cep: null, pais: 'Brasil', ativo: true, tem_foto: false, version: 1,
    criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z',
  },
  {
    id: 2, nome: 'João Pedro Oliveira', cpf: 'SITE-a1b2c3d4',
    data_nascimento: '1990-07-22', email: null, telefone: null,
    estado: null, cidade: null, nacionalidade: null, naturalidade: null,
    profissao: null, logradouro: null, numero: null, complemento: null, bairro: null,
    cep: null, pais: null, ativo: true, tem_foto: false, version: 1,
    criado_em: '2025-02-01T10:00:00Z', atualizado_em: '2025-02-01T10:00:00Z',
  },
  {
    id: 3, nome: 'Ana Beatriz Costa', cpf: '987.654.321-00',
    data_nascimento: '1978-11-05', email: 'ana.costa@email.com', telefone: '(47) 98888-7777',
    estado: 'SC', cidade: 'Balneário Camboriú', nacionalidade: 'Brasileira', naturalidade: null,
    profissao: null, logradouro: null, numero: null, complemento: null, bairro: null,
    cep: null, pais: 'Brasil', ativo: false, tem_foto: false, version: 2,
    criado_em: '2024-08-15T10:00:00Z', atualizado_em: '2025-03-01T10:00:00Z',
  },
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
    if (url.includes('/clientes')) body = { items: CLIENTES, total: CLIENTES.length };
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('clientes — página minimalista + drawer de cadastro', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/clientes');
  await expect(page.locator('h2.cli-titulo')).toContainText('Clientes', { timeout: 15_000 });
  await expect(page.locator('.cli-info-card')).toHaveCount(3);
  await expect(page.locator('tr.cli-row')).toHaveCount(3);
  await expect(page.locator('.st-chip')).toHaveCount(3);
  await expect(page.locator('.acao-btn').first()).toBeVisible();
  await expect(page.locator('.tag-site')).toContainText('Via site');

  await page.screenshot({ path: 'capturas-crm/clientes-min-1920.png' });

  // Cadastrar cliente abre a drawer modal ancorada à direita
  await page.locator('#tour-novo').click();
  const drawer = page.locator('aside.drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('h5')).toContainText('Novo cliente');
  const box = await drawer.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x + box!.width).toBeGreaterThan(vw - 2); // encostada à direita
  expect(box!.height).toBeGreaterThan(1000); // altura total
  await expect(drawer.locator('button[type="submit"]')).toContainText('Cadastrar cliente');

  await page.screenshot({ path: 'capturas-crm/clientes-drawer-1920.png' });
  await page.screenshot({
    path: 'capturas-crm/clientes-drawer-topo.png',
    clip: { x: 1340, y: 0, width: 580, height: 140 },
  });

  // a drawer cobre header, sidebar e a bolha da MAR IA (z-index efetivo)
  const topo = await page.evaluate(() => {
    const alvo = document.elementFromPoint(1880, 1040);
    return alvo?.closest('.drawer-foot-acoes, .mar-fab')?.className ?? 'nada';
  });
  expect(topo).toContain('drawer-foot-acoes');
});
