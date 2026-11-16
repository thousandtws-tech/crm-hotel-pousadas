import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const VAGAS = [
  { id: 1, numero: '1', idacomodacao: 1, ativo: true },
  { id: 2, numero: '2', idacomodacao: null, ativo: true },
  { id: 3, numero: '3', idacomodacao: null, ativo: true },
  { id: 4, numero: '4', idacomodacao: 2, ativo: false },
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
    if (url.includes('/estacionamento')) body = VAGAS;
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

test('estacionamento — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/estacionamento');
  await expect(page.locator('h2.est-titulo')).toContainText('Estacionamento', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Cadastro');
  await expect(page.locator('.est-contador')).toContainText('4 vagas · 2 livres');
  await expect(page.locator('.est-info-card')).toHaveCount(3);
  await expect(page.locator('#tour-form')).toBeVisible();
  await expect(page.locator('tr.est-row')).toHaveCount(4);
  await expect(page.locator('.st-chip')).toHaveCount(4);
  await expect(page.locator('.st-chip.off')).toHaveCount(1); // vaga 4 inativa
  await expect(page.locator('.est-dot.on')).toHaveCount(2); // vagas 1 e 4 vinculadas
  await expect(page.locator('.acao-btn').first()).toBeVisible();

  // busca "livre" filtra só vagas sem dono
  await page.locator('.est-busca-input').fill('livre');
  await expect(page.locator('tr.est-row')).toHaveCount(2);

  await page.locator('.est-busca-input').fill('');
  await page.screenshot({ path: 'capturas-crm/estacionamento-min-1920.png' });
});
