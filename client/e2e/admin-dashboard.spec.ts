import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';
const HOJE = new Date().toISOString().slice(0, 10);
const DEPOIS = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

const DASH = {
  cards: {
    total_acomodacoes: 12,
    acomodacoes_disponiveis: 7,
    acomodacoes_ocupadas: 5,
    hospedes_atuais: 9,
    checkins_hoje: 1,
    checkouts_hoje: 0,
    checkins_pendentes_hoje: 2,
    checkouts_pendentes_hoje: 1,
  },
  checkins_pendentes: [
    { idreserva: 42, cliente_nome: 'Ana Souza', acomodacao_nome: 'Suíte 01' },
    { idreserva: 43, cliente_nome: 'Diego Melo', acomodacao_nome: 'Chalé 02' },
  ],
  checkouts_pendentes: [
    { idreserva: 90, cliente_nome: 'Bruno Lima', acomodacao_nome: 'Quarto 03' },
  ],
  ultimas_reservas: [
    { id: 97, cliente_nome: 'Ana Souza', acomodacao_nome: 'Suíte 01', acomodacao_numero: 1, acomodacao_cor: '#4b95ab', idcliente: 1, quantidade_hospedes: 2, entradaprevista: HOJE, saidaprevista: DEPOIS, status: 'p', valor_diaria: '280', valor_total: '840' },
    { id: 96, cliente_nome: 'Bruno Lima', acomodacao_nome: 'Quarto 03', acomodacao_numero: 3, acomodacao_cor: '#8fa3ab', idcliente: 2, quantidade_hospedes: 1, entradaprevista: HOJE, saidaprevista: DEPOIS, status: 'i', valor_diaria: '190', valor_total: '570' },
    { id: 95, cliente_nome: 'Carla Nunes', acomodacao_nome: 'Chalé 02', acomodacao_numero: 2, acomodacao_cor: '#4b95ab', idcliente: 3, quantidade_hospedes: 2, entradaprevista: HOJE, saidaprevista: DEPOIS, status: 'f', valor_diaria: '230', valor_total: '460' },
  ],
  acomodacoes_disponiveis: [],
  acomodacoes_ocupadas: [],
};

const SERIE_DIAS = Array.from({ length: 14 }, (_, i) => ({
  rotulo: `${String(i + 1).padStart(2, '0')}/11`,
  valor: String(200 + ((i * 137) % 520)),
  quantidade: (i * 7) % 4,
}));

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
    if (url.includes('/dashboard')) body = DASH;
    else if (url.includes('/financeiro/resumo')) body = { recebido: '6120.00', previsto: '2380.00', vendas: '0', contas_abertas: '0' };
    else if (url.includes('/series/por-pagamento'))
      body = [
        { rotulo: 'Cartão', valor: '3800' },
        { rotulo: 'Pix', valor: '1900' },
        { rotulo: 'Dinheiro', valor: '420' },
      ];
    else if (url.includes('/series/por-acomodacao'))
      body = [
        { rotulo: 'Suíte 01', valor: '2400' },
        { rotulo: 'Chalé 02', valor: '1610' },
        { rotulo: 'Quarto 03', valor: '980' },
      ];
    else if (url.includes('/series/')) body = SERIE_DIAS;
    else if (url.includes('/eventos')) body = [];
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('dashboard — visual minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/dashboard');
  await expect(page.locator('h2.d-titulo')).toContainText('Dashboard', { timeout: 15_000 });
  await expect(page.locator('.kpi')).toHaveCount(6);
  await page.waitForTimeout(1500); // echarts anima depois do dado

  await page.screenshot({ path: 'capturas-crm/dashboard-min-1920.png' });
});
