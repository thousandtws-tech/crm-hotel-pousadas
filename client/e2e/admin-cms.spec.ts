import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

const CMS_ACOMS = [
  {
    id: 1, nome: 'Suíte Vista Mar', numero: 101, andar: 1, descricao: null,
    idtipo_acomodacao: 1, valor: '420.00', capacidade: 2, cor: '#054054',
    ativo: true, version: 1, criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z',
    cms: {
      id: 1, idacomodacao: 1, slug: 'suite-vista-mar', subtitulo: 'Frente para o mar',
      descricao_curta: null, descricao_longa: null, destaque_editorial: null,
      camas: null, banheiros: null, metragem: null, vista: null, andar: null,
      comodidades: [], status: 'publicado', destaque: true, ordem: 1,
      publicado_em: '2025-01-10T10:00:00Z', version: 1,
      criado_em: '2025-01-10T10:00:00Z', atualizado_em: '2025-01-10T10:00:00Z',
    },
    midias: [],
  },
  {
    id: 2, nome: 'Chalé Jardim', numero: 102, andar: 0, descricao: null,
    idtipo_acomodacao: 2, valor: '280.00', capacidade: 4, cor: '#054054',
    ativo: true, version: 1, criado_em: '2025-02-01T10:00:00Z', atualizado_em: '2025-02-01T10:00:00Z',
    cms: {
      id: 2, idacomodacao: 2, slug: 'chale-jardim', subtitulo: null,
      descricao_curta: null, descricao_longa: null, destaque_editorial: null,
      camas: null, banheiros: null, metragem: null, vista: null, andar: null,
      comodidades: [], status: 'rascunho', destaque: false, ordem: 2,
      publicado_em: null, version: 1,
      criado_em: '2025-02-01T10:00:00Z', atualizado_em: '2025-02-01T10:00:00Z',
    },
    midias: [],
  },
  {
    id: 3, nome: 'Quarto Standard', numero: 103, andar: 0, descricao: null,
    idtipo_acomodacao: 1, valor: '0', capacidade: 2, cor: '#054054',
    ativo: false, version: 1, criado_em: '2025-02-01T10:00:00Z', atualizado_em: '2025-02-01T10:00:00Z',
    cms: null,
    midias: [],
  },
];

const TIPOS = [
  { id: 1, nome: 'Suíte', ativo: true, version: 1, criado_em: '2025-01-01T00:00:00Z', atualizado_em: '2025-01-01T00:00:00Z' },
  { id: 2, nome: 'Chalé', ativo: true, version: 1, criado_em: '2025-01-01T00:00:00Z', atualizado_em: '2025-01-01T00:00:00Z' },
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
    if (url.includes('/cms/acomodacoes')) body = CMS_ACOMS;
    else if (url.includes('/cms/site')) body = [];
    else if (url.includes('/tipos-acomodacao')) body = TIPOS;
    else if (url.includes('/reservas/widget'))
      body = { url: 'https://espiritodomar.com.br/reservar', qr_svg: '<svg/>', snippet: '<script/>' };
    else if (url.includes('/dashboard'))
      body = { cards: { total_acomodacoes: 1, acomodacoes_disponiveis: 1, acomodacoes_ocupadas: 0, hospedes_atuais: 0, checkins_hoje: 0, checkouts_hoje: 0, checkins_pendentes_hoje: 0, checkouts_pendentes_hoje: 0 }, checkins_pendentes: [], checkouts_pendentes: [], ultimas_reservas: [], acomodacoes_disponiveis: [], acomodacoes_ocupadas: [] };
    else if (url.includes('/series/') || url.includes('/eventos')) body = [];
    else body = { items: [], total: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.use({ viewport: { width: 1920, height: 1080 } });

test('cms — página minimalista', async ({ page }) => {
  await mockAdminApi(page);

  await page.goto('/login');
  await page.locator('input[formcontrolname="login"]').fill('admin');
  await page.locator('input[formcontrolname="senha"]').fill('senha-sintetica');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/cms');
  await expect(page.locator('.cms-titulo')).toContainText('Conteúdo do site', { timeout: 15_000 });
  await expect(page.locator('.cms-est')).toHaveCount(4);
  await expect(page.locator('.cms-est-num').nth(0)).toContainText('3'); // total
  await expect(page.locator('.cms-est-num').nth(1)).toContainText('1'); // publicados
  await expect(page.locator('.cms-est-num').nth(3)).toContainText('3'); // sem fotos

  // primário navy (era zinc #18181b)
  await expect(page.locator('.btn-primary')).toHaveCSS('background-color', 'rgb(5, 64, 84)');

  // tabela: chips de publicação
  await expect(page.locator('.cms-tabela tbody tr')).toHaveCount(3);
  await expect(page.locator('.pill-toggle.pill-solid', { hasText: 'No ar' })).toHaveCount(1);
  await expect(page.locator('.pill-toggle', { hasText: 'Rascunho' })).toHaveCount(1);
  await expect(page.locator('.pill-static', { hasText: 'Sem conteúdo' })).toHaveCount(1);
  await expect(page.locator('.tag-neutral', { hasText: 'Destaque' })).toHaveCount(1);
  await expect(page.locator('.capa-vazia')).toHaveCount(3);

  // busca filtra
  await page.locator('.cms-busca-input').fill('chalé');
  await expect(page.locator('.cms-tabela tbody tr')).toHaveCount(1);
  await page.locator('.cms-busca-input').fill('');

  // filtro "No ar"
  await page.locator('.seg-btn', { hasText: 'No ar' }).click();
  await expect(page.locator('.cms-tabela tbody tr')).toHaveCount(1);
  await page.locator('.seg-btn', { hasText: 'Todos' }).click();

  // modal editor: overlay acima da MAR IA
  await page.locator('#tour-novo').click();
  await expect(page.locator('.modal-cms')).toBeVisible();
  const topo = await page.evaluate(() => {
    const el = document.elementFromPoint(1700, 540) as HTMLElement | null;
    return el?.closest('.mar-fab') ? 'mar-fab' : 'overlay';
  });
  expect(topo).toBe('overlay');
  await page.keyboard.press('Escape');

  // aba site
  await page.locator('.cms-tab', { hasText: 'Página inicial e SEO' }).click();
  await expect(page.locator('.cms-tab.ativo')).toContainText('Página inicial e SEO');

  await page.screenshot({ path: 'capturas-crm/cms-min-1920.png' });
});
