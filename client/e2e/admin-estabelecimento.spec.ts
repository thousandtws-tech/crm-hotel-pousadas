import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const ESTABELECIMENTO = {
  id: 1,
  cnpj: '10.501.202/0001-70',
  razao_social: 'KONATUS SOLUCOES INTELIGENTES LTDA',
  site: 'www.pousada.com.br',
  email: 'devops.clarituz@gmail.com',
  telefone: '11981254860',
  celular: '11998597865',
  taxa_early: 0,
  taxa_late: 0,
  wifi_nome: 'Pousada-Guest',
  wifi_senha: 'bemvindo2026',
  horario_checkin: 'a partir das 14h',
  horario_checkout: 'até as 12h',
  horario_cafe: '7h às 10h',
  info_servicos: null,
  cadastur: null,
  politica_cancelamento: null,
  retencao_dados_anos: 5,
  dpo_email: null,
  fnrh_assinatura: false,
  version: 3,
};

const ENDERECO = {
  id: 1,
  logradouro: 'Rua Geraldo Rodrigues Soares',
  numero: '59',
  complemento: 'casa',
  bairro: 'Morumbi',
  cidade: 'São Paulo',
  cep: '05688-032',
  version: 2,
};

const IMPRESSORAS = [
  { id: 1, nome: 'Recepção', setor: 'recepcao', ip: '192.168.0.50', porta: 9100, ativa: true, padrao: true, etiqueta: false, version: 1, criado_em: '2025-01-10T10:00:00Z' },
  { id: 2, nome: 'Cozinha', setor: 'cozinha', ip: '192.168.0.51', porta: 9100, ativa: false, padrao: false, etiqueta: true, version: 1, criado_em: '2025-01-10T10:00:00Z' },
];

const DESCOBERTAS = [
  { id: 7, tipo: 'usb', endereco: 'USB001', porta: null, modelo: 'Elgin i9', origem: 'agente local', status: 'pendente', impressora_id: null, visto_em: '2025-01-12T10:00:00Z' },
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

  await page.route(`${API}/estabelecimento/logo`, (route) =>
    route.fulfill({ status: 404, body: '' })
  );

  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/auth/login') || url.includes('/estabelecimento/logo')) return route.fallback();
    let body: unknown;
    if (url.includes('/estabelecimento/endereco')) body = ENDERECO;
    else if (url.includes('/estabelecimento')) body = ESTABELECIMENTO;
    else if (url.includes('/impressoras/descobertas')) body = DESCOBERTAS;
    else if (url.includes('/impressoras')) body = IMPRESSORAS;
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('estabelecimento — página minimalista e densa', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/estabelecimento');
  await expect(page.locator('.est-titulo')).toContainText('Estabelecimento', { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toContainText('Configurações');

  // checklist: dados fiscais + endereço ok; logo e impressora padrão ok/pendente
  await expect(page.locator('.est-check-item')).toHaveCount(4);
  await expect(page.locator('.est-check-item.ok')).toHaveCount(3); // dados, endereço, impressora padrão

  // cards empilhados (sem grade lado a lado com espaço morto)
  await expect(page.locator('.est-secoes .est-card')).toHaveCount(2);
  await expect(page.locator('fieldset.fld')).toHaveCount(2); // Concierge Inná + Conformidade
  await expect(page.locator('.grid-3').first()).toBeVisible();

  // descoberta: caixa neutra + registrar navy
  await expect(page.locator('.desc-box')).toBeVisible();
  await expect(page.locator('.desc-linha .btn-dark-blue', { hasText: 'Registrar' })).toBeVisible();

  // tabela impressoras: chips neutros + ghost actions
  await expect(page.locator('.est-tabela tbody tr')).toHaveCount(2);
  await expect(page.locator('.st-chip')).toHaveCount(2);
  await expect(page.locator('.st-chip.off')).toHaveCount(1); // cozinha inativa
  await expect(page.locator('.est-chip-padrao')).toHaveCount(2); // comprovantes + etiquetas
  await expect(page.locator('.est-chip-setor')).toHaveCount(2);
  await expect(page.locator('.acao-btn')).toHaveCount(6);
  await expect(page.locator('.acao-btn.perigo')).toHaveCount(2);

  // modal nova impressora acima da MAR IA
  await page.locator('button', { hasText: 'Nova impressora' }).click();
  await expect(page.locator('.modal-inn')).toBeVisible();
  const topo = await page.evaluate(() => {
    const el = document.elementFromPoint(1700, 540) as HTMLElement | null;
    return el?.closest('.mar-fab') ? 'mar-fab' : 'overlay';
  });
  expect(topo).toBe('overlay');
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'capturas-crm/estabelecimento-min-1920.png', fullPage: true });
});
