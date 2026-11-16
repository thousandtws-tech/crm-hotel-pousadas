import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const OPERADORAS = [
  { id: 1, nome: 'CVC Viagens', comissao_pct: 15, contato: 'Marcos', email: 'parceria@cvc.com.br', telefone: '11 3000-0000', notas: null, ativa: true },
  { id: 2, nome: 'Decolar', comissao_pct: 12.5, contato: null, email: 'b2b@decolar.com', telefone: null, notas: 'Volume alto no verão', ativa: true },
  { id: 3, nome: 'Hurb', comissao_pct: 18, contato: 'Ana', email: 'ana@hurb.com', telefone: '21 4000-0000', notas: null, ativa: false },
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
    if (url.includes('/operadoras')) body = OPERADORAS;
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('operadoras — kpis + como funciona', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/operadoras');
  await expect(page.locator('h2.titulo')).toContainText('Operadoras', { timeout: 15_000 });
  await expect(page.locator('.kpi')).toHaveCount(4);
  await expect(page.locator('.como')).toBeVisible();

  await page.screenshot({ path: 'capturas-crm/operadoras-min-1920.png' });
});
