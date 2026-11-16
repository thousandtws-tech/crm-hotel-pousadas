import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const COMPROVANTES = [
  { comprovante: 'comp-000042.txt', idreserva: 42, cliente: 'Ana Costa', acomodacao: 'Suíte Master' },
  { comprovante: 'comp-000038.txt', idreserva: 38, cliente: 'Bruno Lima', acomodacao: 'Chalé Jardim' },
];

const FORMAS = [
  { id: 1, nome: 'PIX', ativo: true, version: 1, criado_em: '2025-01-01T10:00:00Z' },
  { id: 2, nome: 'Cartão de crédito', ativo: true, version: 1, criado_em: '2025-01-01T10:00:00Z' },
  { id: 3, nome: 'Dinheiro', ativo: true, version: 1, criado_em: '2025-01-01T10:00:00Z' },
  { id: 4, nome: 'Vale-refeição', ativo: true, version: 1, criado_em: '2025-01-01T10:00:00Z' },
  { id: 5, nome: 'Boleto', ativo: false, version: 1, criado_em: '2025-01-01T10:00:00Z' },
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
    if (url.includes('/pagamentos/comprovantes')) body = COMPROVANTES;
    else if (url.includes('/formas-pagamento')) body = FORMAS;
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('pagamentos — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/pagamentos');
  await expect(page.locator('h2.pg-titulo')).toContainText('Pagamentos', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Financeiro');
  await expect(page.locator('.pg-banner')).toHaveCount(3);
  await expect(page.locator('.pg-est')).toHaveCount(3);
  await expect(page.locator('.pg-est-num').nth(0)).toContainText('2'); // comprovantes
  await expect(page.locator('.pg-est-num').nth(1)).toContainText('4'); // ativas
  await expect(page.locator('.pg-est-num').nth(2)).toContainText('5'); // cadastradas
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('.pg-tabela .acao-btn')).toHaveCount(6);
  await expect(page.locator('.pg-chip').first()).toContainText('Nº 42');

  // modal formas de pagamento: chips neutros + ações ghost + overlay acima da MAR IA
  await page.locator('#tour-formas').click();
  await expect(page.locator('.modal-inn')).toBeVisible();
  await expect(page.locator('.modal-inn .st-chip')).toHaveCount(5);
  await expect(page.locator('.modal-inn .st-chip.off')).toHaveCount(1); // boleto inativo
  await expect(page.locator('.modal-inn .acao-btn.perigo')).toHaveCount(5); // admin vê lixeira
  const topo = await page.evaluate(() => {
    const el = document.elementFromPoint(1700, 540) as HTMLElement | null;
    return el?.closest('.mar-fab') ? 'mar-fab' : 'overlay';
  });
  expect(topo).toBe('overlay');

  await page.screenshot({ path: 'capturas-crm/pagamentos-min-1920.png' });
});
