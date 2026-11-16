import { test, type Page } from '@playwright/test';

/**
 * Capturas visuais do CRM com API 100% mockada — dados sintéticos,
 * nenhum backend real. Uso:
 *
 *   cd client/e2e
 *   npx playwright test --project=admin admin-capture.spec.ts
 *
 * Saída: capturas-crm/<rota>-<largura>.png (e -full para página inteira).
 */

const API = 'https://api-production-19dc.up.railway.app/api/v1';
const OUT = 'capturas-crm';

const hoje = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const em = (dias: number) => {
  const d = new Date(hoje);
  d.setDate(d.getDate() + dias);
  return d;
};

const RESERVAS = [
  {
    id: 1042, idacomodacao: 3, acomodacao_nome: 'Suíte Mar', acomodacao_numero: 3,
    acomodacao_cor: '#2457A7', idcliente: 51, cliente_nome: 'Marina Duarte',
    quantidade_hospedes: 2, entradaprevista: iso(hoje), saidaprevista: iso(em(3)),
    status: 'p', valordiaria: '420.00', idquarto: 3, quarto_numero: '103',
    valor_estadia: '1260.00',
  },
  {
    id: 1041, idacomodacao: 5, acomodacao_nome: 'Quarto Jardim', acomodacao_numero: 5,
    acomodacao_cor: '#4A7EC2', idcliente: 44, cliente_nome: 'Paulo Henrique Reis',
    quantidade_hospedes: 2, entradaprevista: iso(hoje), saidaprevista: iso(em(2)),
    status: 'i', valordiaria: '350.00', idquarto: 5, quarto_numero: '105',
    valor_estadia: '700.00',
  },
  {
    id: 1039, idacomodacao: 1, acomodacao_nome: 'Bangalô Sol', acomodacao_numero: 1,
    acomodacao_cor: '#B45309', idcliente: 38, cliente_nome: 'Fernanda Lopes',
    quantidade_hospedes: 3, entradaprevista: iso(em(-2)), saidaprevista: iso(em(1)),
    status: 'i', valordiaria: '510.00', idquarto: 1, quarto_numero: '101',
    valor_estadia: '1530.00',
  },
  {
    id: 1038, idacomodacao: 7, acomodacao_nome: 'Suíte Lua', acomodacao_numero: 7,
    acomodacao_cor: '#55606D', idcliente: 30, cliente_nome: 'Carlos Menezes',
    quantidade_hospedes: 2, entradaprevista: iso(em(4)), saidaprevista: iso(em(7)),
    status: 'p', valordiaria: '380.00', idquarto: 7, quarto_numero: '107',
    valor_estadia: null,
  },
  {
    id: 1036, idacomodacao: 2, acomodacao_nome: 'Quarto Brisa', acomodacao_numero: 2,
    acomodacao_cor: '#198754', idcliente: 22, cliente_nome: 'Aline Ribeiro',
    quantidade_hospedes: 1, entradaprevista: iso(em(-5)), saidaprevista: iso(em(-1)),
    status: 'f', valordiaria: '310.00', idquarto: 2, quarto_numero: '102',
    valor_estadia: '1240.00',
  },
  {
    id: 1035, idacomodacao: 4, acomodacao_nome: 'Chalé Dunas', acomodacao_numero: 4,
    acomodacao_cor: '#2457A7', idcliente: 19, cliente_nome: 'Roberto Sales',
    quantidade_hospedes: 4, entradaprevista: iso(em(6)), saidaprevista: iso(em(10)),
    status: 'c', valordiaria: '460.00', idquarto: 4, quarto_numero: '104',
    valor_estadia: null,
  },
];

const MAPA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n, i) => ({
  id: n,
  nome: ['Bangalô Sol', 'Quarto Brisa', 'Suíte Mar', 'Chalé Dunas', 'Quarto Jardim',
    'Suíte Duna', 'Suíte Lua', 'Quarto Farol', 'Bangalô Onda', 'Suíte Coral',
    'Quarto Rio', 'Suíte Estrela'][i],
  numero: n,
  andar: n <= 6 ? 1 : 2,
  cor: ['#2457A7', '#198754', '#4A7EC2', '#B45309', '#55606D', '#4A7EC2',
    '#2457A7', '#198754', '#B45309', '#55606D', '#4A7EC2', '#2457A7'][i],
  tipo: 'standard',
  idreserva_hoje: n === 1 ? 1039 : n === 5 ? 1041 : n === 3 ? 1042 : null,
  status_hoje: n === 1 || n === 5 ? 'i' : n === 3 ? 'p' : null,
  bloqueado: n === 10,
  limpeza_pendente: n === 2 || n === 8 ? 1 : 0,
  manut_aberta: n === 10 ? 1 : 0,
}));

const ACOMODACOES = MAPA.map((q) => ({
  id: q.id, nome: q.nome, numero: q.numero, andar: q.andar, cor: q.cor,
  capacidade: 2 + (q.id % 3), ativo: true, valordiaria: '380.00',
  descricao: 'Acomodação de teste', tipo: q.tipo, bloqueado: q.bloqueado,
}));

const CLIENTES = [
  { id: 51, nome: 'Marina Duarte', cpf: '123.456.789-00', telefone: '(22) 99801-2345', email: 'marina@exemplo.com', cidade: 'Cabo Frio', uf: 'RJ', ativo: true },
  { id: 44, nome: 'Paulo Henrique Reis', cpf: '987.654.321-00', telefone: '(22) 99777-1122', email: 'paulo@exemplo.com', cidade: 'Búzios', uf: 'RJ', ativo: true },
  { id: 38, nome: 'Fernanda Lopes', cpf: '456.123.789-11', telefone: '(21) 98888-3344', email: 'fernanda@exemplo.com', cidade: 'Rio de Janeiro', uf: 'RJ', ativo: true },
];

async function mockAdminApi(page: Page): Promise<void> {
  // Rotas mais específicas primeiro — no Playwright a ÚLTIMA registrada
  // tem precedência; o catchall delega /auth/* de volta via fallback().
  const sessao = {
    access_token: 'e2e-access',
    refresh_token: 'e2e-refresh',
    token_type: 'Bearer',
    expira_em: 3600,
    funcionario: {
      id: 1, nome: 'Admin E2E', login: 'admin', nivel: 1,
      financeiro: true, ativo: true,
    },
  };
  await page.route(`${API}/auth/*`, (route) => {
    const path = route.request().url();
    const body = path.includes('/auth/me')
      ? sessao.funcionario
      : path.includes('/auth/logout')
        ? { mensagem: 'ok' }
        : sessao;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    const path = url.split(API)[1] ?? '';
    if (path.startsWith('/auth/')) return route.fallback();
    let body: unknown;

    if (path.startsWith('/dashboard')) {
      body = {
        cards: {
          total_acomodacoes: 12, acomodacoes_disponiveis: 8, acomodacoes_ocupadas: 3,
          hospedes_atuais: 6, checkins_hoje: 2, checkouts_hoje: 1,
          checkins_pendentes_hoje: 1, checkouts_pendentes_hoje: 2,
        },
        ultimas_reservas: RESERVAS,
        checkins_pendentes: [
          { idreserva: 1042, cliente_nome: 'Marina Duarte', acomodacao_nome: 'Suíte Mar' },
        ],
        checkouts_pendentes: [
          { idreserva: 1039, cliente_nome: 'Fernanda Lopes', acomodacao_nome: 'Bangalô Sol' },
          { idreserva: 1030, cliente_nome: 'João Almeida', acomodacao_nome: 'Suíte Lua' },
        ],
        acomodacoes_disponiveis: [],
        acomodacoes_ocupadas: [],
      };
    } else if (path.startsWith('/reservas/mapa')) {
      body = MAPA;
    } else if (path.startsWith('/reservas/eventos')) {
      body = RESERVAS;
    } else if (path.startsWith('/reservas/disponibilidade')) {
      body = { dias: [], acomodacoes: [] };
    } else if (path.match(/\/reservas\/\d+$/)) {
      body = {
        id: 1042, idacomodacao: 3, idcliente: 51, idquarto: 3,
        quantidade_hospedes: 2, entradaprevista: iso(hoje), saidaprevista: iso(em(3)),
        checkin_em: null, checkout_em: null, obs: 'Reserva de teste E2E',
        status: 'p', valordiaria: '420.00', criado_em: iso(em(-3)),
        quarto_numero: '103', acomodacao_nome: 'Suíte Mar', acomodacao_numero: 3,
        acomodacao_valor: '420.00', cliente_nome: 'Marina Duarte',
        cliente_cpf: '123.456.789-00', consumo: null,
      };
    } else if (path.startsWith('/reservas')) {
      body = { items: RESERVAS, page: 1, per_page: 20, total: RESERVAS.length };
    } else if (path.startsWith('/acomodacoes')) {
      body = { items: ACOMODACOES, page: 1, per_page: 20, total: ACOMODACOES.length };
    } else if (path.startsWith('/clientes')) {
      body = { items: CLIENTES, page: 1, per_page: 20, total: CLIENTES.length };
    } else if (/series|eventos|pendentes|itens|historico|timeline|alertas|mapa|logs|feed|quartos/.test(path)) {
      body = [];
    } else if (path.includes('/resumo')) {
      body = {};
    } else {
      body = { items: [], page: 1, per_page: 20, total: 0 };
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/^(?!.*login).*/, { timeout: 15_000 });
}

const TELAS = [
  ['dashboard', '/dashboard'],
  ['recepcao', '/recepcao'],
  ['reservas', '/reservas'],
  ['reserva-detalhe', '/reservas/1042'],
  ['clientes', '/clientes'],
  ['acomodacoes', '/acomodacoes'],
  ['pagamentos', '/pagamentos'],
  ['financeiro', '/financeiro'],
  ['financeiro-contas', '/financeiro/contas'],
  ['financeiro-fluxo-caixa', '/financeiro/fluxo-caixa'],
  ['financeiro-dre', '/financeiro/dre'],
  ['financeiro-caixa', '/financeiro/caixa'],
  ['pdv', '/pdv'],
  ['governanca', '/operacao/governanca'],
  ['cms', '/cms'],
  ['estabelecimento', '/estabelecimento'],
  ['funcionarios', '/funcionarios'],
  ['auditoria', '/auditoria'],
  ['inteligencia', '/inteligencia'],
] as const;

const LARGURAS = [390, 768, 1366] as const;

test('login', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockAdminApi(page);
  await page.goto('/login');
  await page.screenshot({ path: `${OUT}/login-1366.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${OUT}/login-390.png` });
});

for (const [nome, rota] of TELAS) {
  test(nome, async ({ page }) => {
    test.setTimeout(90_000);
    await mockAdminApi(page);
    await login(page);
    for (const w of LARGURAS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(rota);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${nome}-${w}.png` });
    }
    if (nome === 'dashboard' || nome === 'reservas' || nome === 'recepcao') {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto(rota);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${nome}-full.png`, fullPage: true });
    }
  });
}
