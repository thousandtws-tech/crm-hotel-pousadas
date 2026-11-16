import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const LOGS = {
  items: [
    { id: 10, idfuncionario: 2, funcionario_nome: 'Vinicius Oliveira Moreira', acao: 'login', obs: 'Login realizado com sucesso.', tabela: 'funcionario', idtabela: 2, dados: null, criado_em: '2026-11-16T18:34:28Z' },
    { id: 9, idfuncionario: 2, funcionario_nome: 'Vinicius Oliveira Moreira', acao: 'remoção', obs: 'Cliente excluído do cadastro.', tabela: 'cliente', idtabela: 3, dados: { nome: 'Cliente Teste', motivo: 'cadastro duplicado' }, criado_em: '2026-11-16T14:11:24Z' },
    { id: 8, idfuncionario: 2, funcionario_nome: 'Vinicius Oliveira Moreira', acao: 'cadastro', obs: null, tabela: 'cliente', idtabela: 3, dados: null, criado_em: '2026-11-16T14:09:17Z' },
    { id: 7, idfuncionario: 3, funcionario_nome: 'Maria Silva', acao: 'checkin', obs: 'Check-in da reserva 42.', tabela: 'reserva', idtabela: 42, dados: { reserva: 42, quarto: 101 }, criado_em: '2026-11-16T13:57:49Z' },
    { id: 6, idfuncionario: null, funcionario_nome: null, acao: 'webhook', obs: 'Evento de pagamento recebido.', tabela: 'pagamento', idtabela: 8, dados: null, criado_em: '2026-11-16T12:48:46Z' },
  ],
  total: 5,
};

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
    if (url.includes('/auditoria/logs')) body = LOGS;
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('auditoria — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/auditoria');
  await expect(page.locator('.aud-titulo')).toContainText('Auditoria', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Configurações');
  await expect(page.locator('.aud-total')).toContainText('5 registros');

  // filtros estilizados (não Material)
  await expect(page.locator('.aud-input')).toHaveCount(2);
  await expect(page.locator('.aud-filtrar')).toHaveCSS('background-color', 'rgb(5, 64, 84)');

  // lista: chips neutros + colunas quem/o quê/quando
  await expect(page.locator('.aud-item')).toHaveCount(5);
  await expect(page.locator('.aud-acao', { hasText: 'login' })).toHaveCount(1);
  await expect(page.locator('.aud-acao', { hasText: 'remoção' })).toHaveCount(1);
  await expect(page.locator('.aud-autor', { hasText: 'Maria Silva' })).toHaveCount(1);
  await expect(page.locator('.aud-autor', { hasText: 'sistema' })).toHaveCount(1); // webhook sem autor
  await expect(page.locator('.aud-alvo', { hasText: 'reserva · #42' })).toHaveCount(1);

  // expansão: detalhe com obs + JSON
  await page.locator('.aud-linha', { hasText: 'remoção' }).click();
  await expect(page.locator('.aud-item.aberto')).toHaveCount(1);
  await expect(page.locator('.aud-obs', { hasText: 'Cliente excluído' })).toBeVisible();
  await expect(page.locator('.aud-dados')).toContainText('cadastro duplicado');

  // expande outro fecha o anterior (acordeão)
  await page.locator('.aud-linha', { hasText: 'checkin' }).click();
  await expect(page.locator('.aud-item.aberto')).toHaveCount(1);
  await expect(page.locator('.aud-dados')).toContainText('"quarto": 101');

  // filtro dispara request com parâmetros
  const req = page.waitForRequest((r) => r.url().includes('/auditoria/logs') && r.url().includes('tabela=cliente'));
  await page.locator('.aud-input').first().fill('cliente');
  await page.locator('.aud-filtrar').click();
  await req;

  await page.screenshot({ path: 'capturas-crm/auditoria-min-1920.png' });
});
