import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const ITENS = [
  { id: 1, nome: 'Café torrado 500g', idcategoria: 1, quantidade: 12, valor_unitario: '32.90', unidade: 'pct', estoque_minimo: 4, eh_insumo: false, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
  { id: 2, nome: 'Leite integral 1L', idcategoria: 1, quantidade: 0, valor_unitario: '5.49', unidade: 'un', estoque_minimo: 6, eh_insumo: true, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
  { id: 3, nome: 'Guardanapo folha simples', idcategoria: 2, quantidade: 40, valor_unitario: null, unidade: 'pct', estoque_minimo: 0, eh_insumo: false, ativo: false, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z' },
];

const CATEGORIAS = [
  { id: 1, nome: 'Alimentos', impressora_id: null, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z' },
  { id: 2, nome: 'Descartáveis', impressora_id: null, ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z' },
];

const PEDIDOS = [
  { id: 11, idfornecedor: 1, fornecedor: 'Atacadão Sul', fornecedor_cnpj: '12.345.678/0001-90', data_prevista: '2025-03-01', valor_total: '1250.00', status: 'pendente', origem: 'manual', idlancamento: null, criado_por: 'Admin', observacao: null, total_itens: 8, recebido_itens: 0, criado_em: '2025-02-10T10:00:00Z' },
  { id: 12, idfornecedor: 2, fornecedor: 'Distribuidora Litoral', fornecedor_cnpj: null, data_prevista: '2025-02-20', valor_total: '480.50', status: 'parcial', origem: 'manual', idlancamento: 7, criado_por: 'Admin', observacao: null, total_itens: 5, recebido_itens: 3, criado_em: '2025-02-05T10:00:00Z' },
  { id: 13, idfornecedor: 1, fornecedor: 'Atacadão Sul', fornecedor_cnpj: '12.345.678/0001-90', data_prevista: '2025-01-15', valor_total: '890.00', status: 'recebido', origem: 'maria', idlancamento: 5, criado_por: 'Maria', observacao: null, total_itens: 4, recebido_itens: 4, criado_em: '2025-01-12T10:00:00Z' },
  { id: 14, idfornecedor: 3, fornecedor: 'Hortifruti Express', fornecedor_cnpj: null, data_prevista: '2025-01-05', valor_total: '210.00', status: 'cancelado', origem: 'manual', idlancamento: null, criado_por: 'Admin', observacao: null, total_itens: 2, recebido_itens: 0, criado_em: '2025-01-02T10:00:00Z' },
];

const FORNECEDORES = [
  { id: 1, nome: 'Atacadão Sul', cnpj: '12.345.678/0001-90', contato: 'João', telefone: '47 99999-0001', lead_time_dias: 3, ativo: true, criado_em: '2025-01-01T10:00:00Z', atualizado_em: '2025-01-01T10:00:00Z' },
  { id: 2, nome: 'Distribuidora Litoral', cnpj: null, contato: null, telefone: null, lead_time_dias: 5, ativo: true, criado_em: '2025-01-01T10:00:00Z', atualizado_em: '2025-01-01T10:00:00Z' },
  { id: 3, nome: 'Hortifruti Express', cnpj: null, contato: null, telefone: null, lead_time_dias: 1, ativo: false, criado_em: '2025-01-01T10:00:00Z', atualizado_em: '2025-01-01T10:00:00Z' },
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
    const status = new URL(url).searchParams.get('status');
    let body: unknown;
    if (url.includes('/estoque/itens/')) body = []; // ficha / conversões
    else if (url.includes('/estoque/itens')) body = { items: ITENS, total: ITENS.length };
    else if (url.includes('/estoque/categorias')) body = CATEGORIAS;
    else if (url.includes('/estoque/movimentacoes')) body = { items: [], total: 0 };
    else if (url.includes('/estoque/alertas'))
      body = [{ id: 2, nome: 'Leite integral 1L', unidade: 'un', quantidade: 0, estoque_minimo: 6 }];
    else if (url.includes('/impressoras')) body = [];
    else if (url.includes('/compras/fornecedores')) body = FORNECEDORES;
    else if (url.includes('/compras/pedidos')) {
      const itens = status ? PEDIDOS.filter((p) => p.status === status) : PEDIDOS;
      body = { items: itens, total: itens.length };
    }
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('estoque — página minimalista', async ({ page }) => {
  await mockAdminApi(page);
  await login(page);

  await page.goto('/estoque');
  await expect(page.locator('h2.est-titulo')).toContainText('Estoque', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Suprimentos');
  await expect(page.locator('.est-contador')).toContainText('3 itens');
  await expect(page.locator('.est-alerta')).toContainText('1 sem estoque');
  await expect(page.locator('.est-info-card')).toHaveCount(3);
  await expect(page.locator('tr.est-row')).toHaveCount(3);
  await expect(page.locator('tr.est-row .st-chip')).toHaveCount(3);
  await expect(page.locator('.st-chip.off')).toHaveCount(1); // guardanapo inativo
  await expect(page.locator('.est-tag-zero')).toContainText('sem estoque');
  await expect(page.locator('.acao-btn').first()).toBeVisible();

  // drawer de cadastro encostada à direita, acima da MAR IA
  await page.locator('#tour-novo').click();
  await expect(page.locator('.drawer')).toBeVisible();
  const topo = await page.evaluate(() => {
    const btn = document.querySelector('.drawer-foot .btn-dark-blue') as HTMLElement | null;
    if (!btn) return 'sem-botao';
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as HTMLElement | null;
    return el?.closest('.mar-fab') ? 'mar-fab' : 'drawer';
  });
  expect(topo).toBe('drawer');

  // modal de categorias: chips neutros + ação ghost
  await page.locator('.drawer-fechar').click();
  await page.locator('#tour-categorias').click();
  await expect(page.locator('.modal-inn')).toBeVisible();
  await expect(page.locator('.modal-inn .st-chip')).toHaveCount(2);
  await expect(page.locator('.modal-inn .acao-btn.perigo')).toHaveCount(2);

  await page.screenshot({ path: 'capturas-crm/estoque-min-1920.png' });
});

test('insumos — página minimalista', async ({ page }) => {
  await mockAdminApi(page);
  await login(page);

  await page.goto('/insumos');
  await expect(page.locator('.pg h1')).toContainText('Insumos', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Suprimentos');
  await expect(page.locator('.alertas')).toContainText('1 item(ns)');
  await expect(page.locator('.alerta')).toHaveCount(1);
  await expect(page.locator('.linha')).toHaveCount(3);
  await expect(page.locator('.tag.insumo')).toHaveCount(1); // leite é insumo
  await expect(page.locator('.tag.baixo')).toHaveCount(1); // leite zerado no mínimo

  // selecionar item abre ficha + conversões
  await page.locator('.linha').first().click();
  await expect(page.locator('.col-dir .card-head h2').first()).toContainText('Ficha técnica — Café torrado 500g');
  await expect(page.locator('.col-dir section.card').last()).toBeVisible();

  await page.screenshot({ path: 'capturas-crm/insumos-min-1920.png' });
});

test('compras — página minimalista', async ({ page }) => {
  await mockAdminApi(page);
  await login(page);

  await page.goto('/compras');
  await expect(page.locator('.cab h1')).toContainText('Compras', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Suprimentos');
  await expect(page.locator('.kpi-card')).toHaveCount(4);
  await expect(page.locator('.kpi-card').nth(0)).toContainText('1');
  await expect(page.locator('.kpi-card').nth(3)).toContainText('2/3'); // fornecedores ativos/total
  await expect(page.locator('tr.row-click')).toHaveCount(4);
  await expect(page.locator('.st.st_parcial')).toHaveCount(1);
  await expect(page.locator('.st.st_recebido')).toHaveCount(1);
  await expect(page.locator('.maria')).toHaveCount(1); // tag de origem Maria neutra

  // aba fornecedores
  await page.locator('.cab-acoes .btn-out').click();
  await expect(page.locator('.sec h2')).toContainText('Fornecedores');
  await expect(page.locator('.sec-cnt')).toContainText('2 ativos de 3');
  await expect(page.locator('tr.inativo')).toHaveCount(1); // hortifruti inativo

  await page.screenshot({ path: 'capturas-crm/compras-min-1920.png' });
});
