import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

/** Respostas sintéticas — nenhum dado real ou backend envolvido. */
async function mockAdminApi(page: Page): Promise<void> {
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-access',
        refresh_token: 'e2e-refresh',
        token_type: 'Bearer',
        expira_em: 3600,
        funcionario: {
          id: 1,
          nome: 'Admin E2E',
          login: 'admin',
          nivel: 1,
          financeiro: true,
          ativo: true,
        },
      }),
    })
  );

  // Restante da API com o shape correto por endpoint — a jornada testa
  // auth+shell, não os dados do dashboard (séries = arrays, resumos = objetos).
  await page.route(`${API}/**`, (route) => {
    const path = route.request().url();
    if (path.includes('/auth/login')) return route.fallback();
    const body = path.includes('/series/')
      ? []
      : path.includes('/dashboard')
        ? {
            cards: {
              total_acomodacoes: 0,
              acomodacoes_disponiveis: 0,
              acomodacoes_ocupadas: 0,
              hospedes_atuais: 0,
              checkins_hoje: 0,
              checkouts_hoje: 0,
              checkins_pendentes_hoje: 0,
              checkouts_pendentes_hoje: 0,
            },
            ultimas_reservas: [],
            checkins_pendentes: [],
            checkouts_pendentes: [],
            acomodacoes_disponiveis: [],
            acomodacoes_ocupadas: [],
          }
        : path.includes('/resumo')
          ? {}
          : { items: [], total: 0 };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('admin — jornada de autenticação', () => {
  test('login válido entra no shell autenticado', async ({ page }) => {
    await mockAdminApi(page);

    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);

    await page.locator('input[formcontrolname="login"]').fill('admin');
    await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
    await page.locator('button[type="submit"]').click();

    // authGuard libera → shell com navegação do produto
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/reserva|dashboard|recep/i, {
      timeout: 15_000,
    });

    // sessão persistida
    expect(await page.evaluate(() => localStorage.getItem('clarituz.access'))).toBe(
      'e2e-access'
    );
  });

  test('login inválido (401) permanece na tela e mostra erro', async ({ page }) => {
    await page.route(`${API}/auth/login`, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ erro: { mensagem: 'Credenciais inválidas' } }),
      })
    );

    await page.goto('/login');
    await page.locator('input[formcontrolname="login"]').fill('admin');
    await page.locator('input[formcontrolname="senha"]').fill('errada');
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.alert-err[role="alert"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('clarituz.access'))).toBeNull();
  });
});
