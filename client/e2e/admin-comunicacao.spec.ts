import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const DASH = {
  total: 12, respondidas: 9, taxa_resposta: 0.75,
  media_geral: 4.3, media_limpeza: 4.6, media_atendimento: 4.8,
  media_custo: 3.9, media_localizacao: 4.7, nps: 62,
  plataformas: {},
};

const AVALIACOES = [
  { id: 1, idreserva: 42, plataforma: 'booking', nota_geral: 5, nota_limpeza: 5, nota_atendimento: 5, nota_custo: 4, nota_localizacao: 5, nps: 10, comentario: 'Estadia perfeita.', resposta: null, status: 'respondida', criado_em: '2025-02-01T10:00:00Z' },
  { id: 2, idreserva: 38, plataforma: 'google', nota_geral: 1, nota_limpeza: 2, nota_atendimento: 1, nota_custo: 2, nota_localizacao: 3, nps: 2, comentario: 'Quarto com cheiro de mofo.', resposta: 'Lamentamos a experiência.', status: 'respondida', criado_em: '2025-01-28T10:00:00Z' },
];

const FILA = [
  { id: 1, canal: 'whatsapp', destino: '+55 48 99999-0001', template: 'checkout_review', payload: {}, idreserva: 42, tentativas: 1, ultimo_erro: null, status: 'enviado', agendado_para: '2025-02-01T10:00:00Z', criado_em: '2025-02-01T10:00:00Z', enviado_em: '2025-02-01T10:01:00Z' },
  { id: 2, canal: 'email', destino: 'ana@exemplo.com', template: 'pre_checkin', payload: {}, idreserva: null, tentativas: 0, ultimo_erro: null, status: 'pendente', agendado_para: '2025-02-02T10:00:00Z', criado_em: '2025-02-01T11:00:00Z', enviado_em: null },
];

const MATRIZ = [
  { evento: 'reserva_criada', canal: 'inbox', papel: 3, ativo: true },
  { evento: 'reserva_criada', canal: 'push', papel: 1, ativo: true },
  { evento: 'reserva_criada', canal: 'push', papel: 2, ativo: false },
  { evento: 'falha_pagamento', canal: 'email', papel: 1, ativo: true },
];

const LGPD = [
  { id: 7, idcliente: 11, idreserva: null, tipo: 'acesso', detalhe: 'Gostaria de cópia dos meus dados.', canal: 'portal', status: 'aberta', resposta: null, respondida_em: null, respondida_por: null, criado_em: '2025-02-01T09:00:00Z', atualizado_em: '2025-02-01T09:00:00Z' },
];

const ATENDIMENTOS = [
  { id: 3, protocolo: 'ATD-2025-0003', origem: 'whatsapp', setor: 'recepcao', prioridade: 'urgente', status: 'aberto', telefone: '+55 48 98888-0002', idreserva: 42, idcliente: 11, assunto: 'Toalhas extras', ultima_msg: 'Podem subir toalhas?', motivo: null, idfuncionario: null, prazo_aceite: '2030-01-01T00:00:00Z', criado_em: '2025-02-01T12:00:00Z', atribuido_em: null, escalado_em: null, resolvido_em: null },
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
    if (url.includes('/comunicacao/painel'))
      body = {
        avaliacoes_dash: DASH,
        avaliacoes: AVALIACOES,
        fila: FILA,
        matriz: MATRIZ,
        lgpd: LGPD,
        atendimentos: ATENDIMENTOS,
      };
    else if (url.includes('/avaliacoes/dashboard')) body = DASH;
    else if (url.includes('/avaliacoes')) body = AVALIACOES;
    else if (url.includes('/comunicacao/fila')) body = FILA;
    else if (url.includes('/comunicacao/matriz')) body = MATRIZ;
    else if (url.includes('/lgpd/solicitacoes')) body = LGPD;
    else if (url.includes('/atendimentos')) body = ATENDIMENTOS;
    else if (url.includes('/push/')) body = {};
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else if (url.includes('/resumo')) body = {};
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('comunicação — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/comunicacao');
  await expect(page.locator('h2.pg-titulo')).toContainText('Comunicação', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Central');
  await expect(page.locator('.abas .aba')).toHaveCount(5);

  // dashboard de avaliações
  await expect(page.locator('.cards .card')).toHaveCount(7);
  await expect(page.locator('.cards .card').first()).toContainText('62'); // NPS
  await expect(page.locator('.bloco tbody tr')).toHaveCount(2);
  await expect(page.locator('.bloco tbody tr.critica')).toHaveCount(1); // nota 1 → linha crítica

  // aba fila de envio
  await page.locator('.abas .aba').nth(1).click();
  await expect(page.locator('.bloco h3')).toContainText('Fila de envio');
  await expect(page.locator('.bloco tbody tr')).toHaveCount(2);
  await expect(page.locator('.bloco .st-enviado')).toHaveCount(1);
  await expect(page.locator('.bloco .st-pendente')).toHaveCount(1);

  // aba matriz — eventos × canais × papéis
  await page.locator('.abas .aba').nth(2).click();
  await expect(page.locator('.bloco tbody tr')).toHaveCount(2); // 2 eventos distintos
  await expect(page.locator('.bloco input[type="checkbox"]')).toHaveCount(24); // 2 ev × 4 canais × 3 papéis

  // aba LGPD — modal de resposta acima da MAR IA (z-310)
  await page.locator('.abas .aba').nth(3).click();
  await expect(page.locator('.bloco tbody tr')).toHaveCount(1);
  await expect(page.locator('.bloco .st-aberta')).toHaveCount(1);
  await page.locator('.bloco .btn-mini').last().click();
  await expect(page.locator('.modal')).toBeVisible();
  await expect(page.locator('.modal h3')).toContainText('Solicitação #7');
  const topo = await page.evaluate(() => {
    const el = document.elementFromPoint(1700, 540) as HTMLElement | null;
    return el?.closest('.mar-fab') ? 'mar-fab' : 'overlay';
  });
  expect(topo).toBe('overlay');
  await page.locator('.modal .btn-sec').click();
  await expect(page.locator('.modal')).toHaveCount(0);

  // aba atendimentos — urgente em destaque semântico
  await page.locator('.abas .aba').nth(4).click();
  await expect(page.locator('.bloco tbody tr')).toHaveCount(1);
  await expect(page.locator('.bloco tbody tr.linha-urgente')).toHaveCount(1); // prioridade urgente destaca a linha
  await expect(page.locator('.bloco .st-escalado')).toHaveCount(1); // chip urgente
  await expect(page.locator('.bloco')).toContainText('ATD-2025-0003');

  await page.screenshot({ path: 'capturas-crm/comunicacao-min-1920.png' });
});
