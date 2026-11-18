import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const FUNCIONARIOS = {
  items: [
    { id: 1, nome: 'Vinicius Oliveira Moreira', login: 'vinicius', cpf: null, data_nascimento: null, nivel: 1, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
    { id: 2, nome: 'Maria Silva Souza', login: 'maria.s', cpf: '123.456.789-00', data_nascimento: '1990-05-10', nivel: 2, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
    { id: 3, nome: 'João Recepcionista', login: 'joao.r', cpf: '987.654.321-00', data_nascimento: '1995-03-20', nivel: 3, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
    { id: 4, nome: 'Ana Exemplo', login: 'ana.e', cpf: null, data_nascimento: null, nivel: 3, ativo: false, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
  ],
  total: 4,
};

async function mockAdminApi(page: Page): Promise<void> {
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-access', refresh_token: 'e2e-refresh',
        token_type: 'Bearer', expira_em: 3600,
        funcionario: { id: 1, nome: 'Vinicius Oliveira Moreira', login: 'vinicius', nivel: 1, financeiro: true, ativo: true },
      }),
    })
  );

  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/auth/login')) return route.fallback();
    let body: unknown;
    if (url.includes('/funcionarios')) body = FUNCIONARIOS;
    else if (url.includes('/cargos')) body = [];
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('funcionários — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/funcionarios');
  await expect(page.locator('.fn-titulo')).toContainText('Funcionários', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Configurações');

  // banners neutros + resumo
  await expect(page.locator('.fn-banner')).toHaveCount(3);
  await expect(page.locator('.fn-banner-ic.tint-teal, .fn-banner-ic.tint-gold')).toHaveCount(0);
  await expect(page.locator('.fn-est')).toHaveCount(5);
  await expect(page.locator('.fn-est-num').nth(0)).toContainText('4');
  await expect(page.locator('.fn-est-num').nth(1)).toContainText('3'); // ativos

  // tabela: selos neutros, chip de status, ações ghost
  await expect(page.locator('.fn-tabela tbody tr')).toHaveCount(4);
  await expect(page.locator('.fn-nivel', { hasText: 'Administrador' })).toHaveCount(1);
  await expect(page.locator('.fn-nivel', { hasText: 'Gerente' })).toHaveCount(1);
  await expect(page.locator('.fn-nivel', { hasText: 'Recepção' })).toHaveCount(2);
  await expect(page.locator('.st-chip')).toHaveCount(4);
  await expect(page.locator('.st-chip.off')).toHaveCount(1); // Ana inativa
  await expect(page.locator('.acao-btn')).toHaveCount(8);
  await expect(page.locator('.fn-voce')).toHaveCount(1); // selo "você" no próprio usuário

  // status do próprio usuário desabilitado
  const linhaEu = page.locator('tr', { hasText: 'Vinicius Oliveira Moreira' });
  await expect(linhaEu.locator('.st-chip')).toBeDisabled();
  await expect(linhaEu.locator('.acao-btn.perigo')).toBeDisabled();

  // busca filtra
  await page.locator('.fn-busca-input').fill('maria');
  await expect(page.locator('.fn-tabela tbody tr')).toHaveCount(1);
  await page.locator('.fn-busca-input').fill('');

  // drawer acima da MAR IA
  await page.locator('#tour-novo').click();
  await expect(page.locator('.drawer')).toBeVisible();
  const topo = await page.evaluate(() => {
    const el = document.elementFromPoint(1700, 540) as HTMLElement | null;
    return el?.closest('.mar-fab') ? 'mar-fab' : 'drawer';
  });
  expect(topo).toBe('drawer');
  await expect(page.locator('.dsec-tit', { hasText: 'Dados pessoais' })).toBeVisible();
  await expect(page.locator('.drawer-foot-acoes .btn-dark-blue')).toContainText('Cadastrar funcionário');
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'capturas-crm/funcionarios-min-1920.png' });
});
