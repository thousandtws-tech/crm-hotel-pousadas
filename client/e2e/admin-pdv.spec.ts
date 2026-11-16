import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const MESAS = [
  { id: 1, numero: '1', lugares: 4, ativo: true, idcomanda: 9, total_aberto: '45.50', garcom_nome: 'Ana' },
  { id: 2, numero: '2', lugares: 4, ativo: true, idcomanda: null, total_aberto: null, garcom_nome: null },
  { id: 3, numero: '3', lugares: 2, ativo: true, idcomanda: null, total_aberto: null, garcom_nome: null },
  { id: 4, numero: '4', lugares: 6, ativo: true, idcomanda: null, total_aberto: null, garcom_nome: null },
  { id: 5, numero: '5', lugares: 4, ativo: false, idcomanda: null, total_aberto: null, garcom_nome: null },
];

const COMANDA_9 = {
  id: 9, tipo: 'mesa', idmesa: 1, mesa_numero: '1', idquarto: null, quarto_numero: null,
  idreserva: null, idcliente: null, cliente_nome: null, idgarcom: 1, garcom_nome: 'Ana',
  rotulo: null, status: 'aberta', total_itens: '45.50', itens_pendentes: 2,
  desconto: '0', total: '45.50', idlancamento: null,
  aberto_em: '2025-11-16T14:30:00Z', fechado_em: null, version: 1,
};

const COMANDAS_ABERTAS = [
  COMANDA_9,
  { ...COMANDA_9, id: 10, tipo: 'balcao', idmesa: null, mesa_numero: null,
    rotulo: 'Balcão 1', total_itens: '12.00', total: '12.00', itens_pendentes: 1 },
];

const ITENS_9 = [
  { id: 1, idcomanda: 9, iditem: 11, item_nome: 'Caipirinha', categoria_nome: 'Bebidas',
    quantidade: 2, valor_unit: '18.00', valor_total: '36.00', status: 'entregue',
    lancado_por: 1, lancado_por_nome: 'Ana', cancelado_por_nome: null,
    motivo_cancelamento: null, criado_em: '2025-11-16T14:35:00Z' },
  { id: 2, idcomanda: 9, iditem: 12, item_nome: 'Água mineral', categoria_nome: 'Bebidas',
    quantidade: 1, valor_unit: '9.50', valor_total: '9.50', status: 'pendente',
    lancado_por: 1, lancado_por_nome: 'Ana', cancelado_por_nome: null,
    motivo_cancelamento: null, criado_em: '2025-11-16T14:40:00Z' },
];

const ITENS_VENDA = [
  { id: 11, nome: 'Caipirinha', categoria_nome: 'Bebidas', quantidade: 30, valor_unitario: '18.00' },
  { id: 12, nome: 'Água mineral', categoria_nome: 'Bebidas', quantidade: 20, valor_unitario: '9.50' },
  { id: 13, nome: 'Porção de peixe', categoria_nome: 'Cozinha', quantidade: 15, valor_unitario: '42.00' },
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
    if (/\/pdv\/comandas\/\d+\/itens/.test(url)) body = ITENS_9;
    else if (/\/pdv\/comandas\/\d+/.test(url)) body = COMANDA_9;
    else if (url.includes('/pdv/mesas')) body = MESAS;
    else if (url.includes('/pdv/comandas')) body = { items: COMANDAS_ABERTAS, total: COMANDAS_ABERTAS.length };
    else if (url.includes('/pdv/itens-venda')) body = ITENS_VENDA;
    else if (url.includes('/pdv/garcons')) body = [{ id: 1, idfuncionario: 1, funcionario_nome: 'Ana', percentual: '10', ativo: true }];
    else if (url.includes('/financeiro/contas') || url.includes('/formas-pagamento')) body = [];
    else if (url.includes('/funcionarios')) body = { items: [{ id: 1, nome: 'Ana' }], total: 1 };
    else if (url.includes('/reservas')) body = { items: [], total: 0 };
    else if (url.includes('/comissoes')) body = { items: [], total: 0 };
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('pdv — visão salão com tiles e visão pedido', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/pdv');
  await expect(page.locator('h2.titulo')).toContainText('PDV', { timeout: 15_000 });

  // ---- visão salão: toolbar + grade de tiles
  await expect(page.locator('.salao-tools')).toBeVisible();
  await expect(page.locator('.salao .tile:not(.inativa)')).toHaveCount(4);
  await expect(page.locator('.tile.ocupada')).toHaveCount(1); // mesa 1 com consumo
  await expect(page.locator('.tile.ocupada .tile-val')).toContainText('45,50');
  await expect(page.locator('.inativas')).toContainText('Mesas inativas (1)');

  // ---- toque em mesa livre → abertura rápida
  await page.locator('.tile:not(.ocupada) .tile-num', { hasText: '2' }).click();
  await expect(page.locator('.quick')).toBeVisible();
  await expect(page.locator('.quick-t')).toContainText('Abrir comanda — Mesa 2');
  await page.locator('.quick-acoes .btn-gray').click(); // voltar
  await expect(page.locator('.quick')).toBeHidden();

  // busca filtra a grade
  await page.locator('.salao-inp').fill('3');
  await expect(page.locator('.salao .tile:not(.inativa)')).toHaveCount(1);
  await page.locator('.salao-inp').fill('');

  await page.screenshot({ path: 'capturas-crm/pdv-salao-1920.png' });

  // ---- toque na mesa ocupada → visão pedido (catálogo + comanda)
  await page.locator('.tile.ocupada').click();
  await expect(page.locator('.atend')).toBeVisible();
  await expect(page.locator('.voltar-salao')).toBeVisible();
  await expect(page.locator('.cat-col')).toBeVisible();
  await expect(page.locator('.com-card')).toBeVisible();
  await expect(page.locator('.cc-head h3')).toContainText('Mesa 1');
  await expect(page.locator('.cc-itens li')).toHaveCount(2);
  await expect(page.locator('.cc-itens')).toContainText('Caipirinha');
  await expect(page.locator('.produtos .prod')).toHaveCount(3);
  await expect(page.locator('.salao')).toBeHidden(); // salão some na visão pedido
  await page.screenshot({ path: 'capturas-crm/pdv-pedido-1920.png' });

  // ---- volta ao salão
  await page.locator('.voltar-salao').click();
  await expect(page.locator('.salao-tools')).toBeVisible();
});
