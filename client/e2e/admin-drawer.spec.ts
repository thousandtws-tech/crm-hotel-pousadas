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

  await page.route(`${API}/**`, (route) => {
    const path = route.request().url();
    if (path.includes('/auth/login')) return route.fallback();
    const body = path.includes('/disponibilidade')
      ? { disponivel: false, quantidade: 0, diarias: 0, acomodacoes: [] }
      : path.includes('/series/') ||
          path.includes('/eventos') ||
          path.includes('/mapa') ||
          path.includes('/bloqueios') ||
          path.includes('/grupos')
        ? []
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

test.use({ viewport: { width: 1920, height: 1080 } });

test('reservas — largura fluida + drawer Nova reserva', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/reservas');
  await expect(page.locator('h2.titulo')).toContainText('Reservas', { timeout: 15_000 });

  // Largura: .rv deve ocupar quase toda a área de conteúdo (sem teto de 1440px)
  const rvWidth = await page.locator('.rv').evaluate((el) => el.getBoundingClientRect().width);
  expect(rvWidth).toBeGreaterThan(1500);

  await page.screenshot({ path: 'capturas-crm/reservas-fluida-1920.png' });

  // Drawer: clique em Nova reserva abre painel lateral à direita
  await page.locator('#tour-nova').click();
  const drawer = page.locator('app-nova-reserva-dialog .nr');
  await expect(drawer).toBeVisible();

  const box = await drawer.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box).not.toBeNull();
  // encostada na borda direita
  expect(Math.round(box!.x + box!.width)).toBeGreaterThanOrEqual(vw - 1);
  // ocupa a altura toda da viewport
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
  // cabeçalho da drawer visível (acima do header do app)
  await expect(drawer.locator('.nr-titulo')).toHaveText('Nova reserva');

  await page.screenshot({ path: 'capturas-crm/reservas-drawer-1920.png' });

  // binding do form: datas válidas habilitam "Verificar disponibilidade"
  const datas = drawer.locator('app-date input.dw-txt');
  await datas.nth(0).fill('20/11/2026');
  await datas.nth(1).fill('25/11/2026');
  await expect(drawer.locator('.btn-disp')).toBeEnabled();
});
