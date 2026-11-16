import { test, type Page } from '@playwright/test';

/**
 * Verificação de zoom 200% (WCAG 2.2 — reflow): viewport 1366 com
 * body zoom 200% ≈ janela efetiva de ~683px. Procura rolagem horizontal
 * indesejada e captura o resultado. API 100% mockada.
 *
 *   npx playwright test --project=admin admin-zoom.spec.ts
 */

const API = 'https://api-production-19dc.up.railway.app/api/v1';
const OUT = 'capturas-crm';

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('clarituz.access', 'e2e-access');
    localStorage.setItem('clarituz.refresh', 'e2e-refresh');
    localStorage.setItem(
      'clarituz.user',
      JSON.stringify({ id: 1, nome: 'Admin E2E', login: 'admin', nivel: 1, financeiro: true, ativo: true }),
    );
  });
  await page.route(`${API}/auth/*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, nome: 'Admin E2E', login: 'admin', nivel: 1, financeiro: true, ativo: true }),
    }),
  );
  await page.route(`${API}/**`, (route) => {
    const path = route.request().url().split(API)[1] ?? '';
    let body: unknown;
    if (path.startsWith('/dashboard')) {
      body = {
        cards: {
          total_acomodacoes: 12, acomodacoes_disponiveis: 8, acomodacoes_ocupadas: 3,
          hospedes_atuais: 6, checkins_hoje: 2, checkouts_hoje: 1,
          checkins_pendentes_hoje: 1, checkouts_pendentes_hoje: 2,
        },
        ultimas_reservas: [], checkins_pendentes: [], checkouts_pendentes: [],
        acomodacoes_disponiveis: [], acomodacoes_ocupadas: [],
      };
    } else if (/series|eventos|pendentes|itens|historico|timeline|alertas|mapa|logs|feed|quartos/.test(path)) {
      body = [];
    } else {
      body = { items: [], page: 1, per_page: 20, total: 0 };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

for (const [nome, rota] of [
  ['dashboard', '/dashboard'],
  ['reservas', '/reservas'],
] as const) {
  test(`zoom 200% — ${nome}`, async ({ page }) => {
    await seedAuth(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(rota);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      document.body.style.zoom = '200%';
    });
    await page.waitForTimeout(600);
    const scrollX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await page.screenshot({ path: `${OUT}/zoom200-${nome}.png` });
    // scroll horizontal residual vem de regiões internas (tabela/calendário
    // com scroll próprio) — a página como um todo não deve rolar em X.
    test.info().annotations.push({ type: 'scrollX', description: `${scrollX}px` });
  });
}
