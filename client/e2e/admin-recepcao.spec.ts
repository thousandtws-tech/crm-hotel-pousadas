import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';
const HOJE = new Date().toISOString().slice(0, 10);
const AMANHA = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const DEPOIS = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

const CHEGADA = (id: number, nome: string) => ({
  id, cliente_nome: nome, acomodacao_nome: 'Suíte', acomodacao_numero: id,
  quantidade_hospedes: 2, entradaprevista: HOJE, saidaprevista: DEPOIS, status: 'p',
});
const NACASA = (id: number, nome: string, saida: string) => ({
  id, cliente_nome: nome, acomodacao_nome: 'Chalé', acomodacao_numero: id,
  quantidade_hospedes: 1, entradaprevista: AMANHA, saidaprevista: saida, status: 'i',
});

const MAPA = [
  { id: 1, numero: 1, nome: 'Quarto 01', andar: 0, status_hoje: 'l', bloqueado: false, limpeza_pendente: 0, manut_aberta: 0, idreserva_hoje: null },
  { id: 2, numero: 2, nome: 'Quarto 02', andar: 0, status_hoje: 'i', bloqueado: false, limpeza_pendente: 1, manut_aberta: 0, idreserva_hoje: 90 },
  { id: 3, numero: 3, nome: 'Quarto 03', andar: 0, status_hoje: 'p', bloqueado: false, limpeza_pendente: 0, manut_aberta: 1, idreserva_hoje: 42 },
  { id: 4, numero: 4, nome: 'Quarto 04', andar: 0, status_hoje: 'l', bloqueado: true, limpeza_pendente: 0, manut_aberta: 0, idreserva_hoje: null },
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
    if (url.includes('/reservas/painel-recepcao'))
      body = {
        chegadas: [CHEGADA(42, 'Ana Souza'), CHEGADA(43, 'Diego Melo')],
        na_casa: [NACASA(90, 'Bruno Lima', HOJE), NACASA(91, 'Carla Nunes', DEPOIS)],
        mapa: MAPA,
      };
    else if (url.includes('/reservas/mapa')) body = MAPA;
    else if (url.includes('/reservas') && url.includes('status=i'))
      body = { items: [NACASA(90, 'Bruno Lima', HOJE), NACASA(91, 'Carla Nunes', DEPOIS)], total: 2 };
    else if (url.includes('/reservas') && url.includes('status=p'))
      body = { items: [CHEGADA(42, 'Ana Souza'), CHEGADA(43, 'Diego Melo')], total: 2 };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('recepção — visual minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/recepcao');
  await expect(page.locator('h2.titulo')).toContainText('Recepção', { timeout: 15_000 });
  await expect(page.locator('.qt').first()).toBeVisible();

  const fdWidth = await page.locator('.fd').evaluate((el) => el.getBoundingClientRect().width);
  expect(fdWidth).toBeGreaterThan(1500);

  await page.screenshot({ path: 'capturas-crm/recepcao-min-1920.png' });
});
