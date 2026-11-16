import { expect, test, type Page } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

/** Uma acomodação sintética no shape de GET /publico/acomodacoes. */
const ACOMODACAO_E2E = {
  id: 99,
  slug: 'quarto-e2e',
  nome: 'Quarto E2E',
  numero: 99,
  valor: '0',
  capacidade: 2,
  cor: null,
  subtitulo: 'Fixture de teste',
  descricao_curta: 'Acomodação sintética para e2e.',
  descricao_longa: null,
  destaque_editorial: null,
  camas: '1 cama de casal',
  banheiros: 1,
  metragem: null,
  vista: 'Vista interna',
  andar: 'Térreo',
  comodidades: [{ name: 'Wi-Fi', icon: 'wifi' }],
  destaque: true,
  ordem: 1,
  midias: [],
};

/** Fixtures sintéticas — a jornada não toca o backend real. */
async function mockWebApi(page: Page): Promise<void> {
  await page.route(`${API}/publico/reservas`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        idreserva: 9001,
        token_publico: 'e2e-token',
        mensagem: 'Reserva registrada com sucesso!',
      }),
    })
  );

  await page.route(`${API}/publico/acomodacoes`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([ACOMODACAO_E2E]),
    })
  );

  // CMS e demais públicos — listas vazias.
  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/publico/reservas') || url.includes('/publico/acomodacoes')) {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

test.describe('web — jornada de reserva', () => {
  test('formulário completo envia a solicitação e mostra sucesso', async ({ page }) => {
    await mockWebApi(page);

    await page.goto('/reservar');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });

    // 01 · período
    await page.locator('input[name="checkIn"]').fill('2026-12-10');
    await page.locator('input[name="checkOut"]').fill('2026-12-14');
    await page.locator('select[name="guests"]').selectOption('2');

    // 02 · acomodação — card renderizado a partir da fixture da API
    const card = page.locator('[role="radio"]', { hasText: 'Quarto E2E' });
    await card.click();

    // 03 · dados do hóspede
    await page.locator('input[name="guestName"]').fill('Maria Teste E2E');
    await page.locator('input[name="guestEmail"]').fill('e2e@example.com');
    await page.locator('input[name="guestPhone"]').fill('(22) 99999-0000');
    await page.locator('input[name="aceiteTermos"]').check();

    const submit = page.getByRole('button', { name: 'Solicitar cotação' });
    await expect(submit).toBeEnabled();
    await submit.click();

    // sucesso: o serviço devolve a mensagem do backend
    await expect(page.locator('body')).toContainText(/sucesso|registrada|receb/i, {
      timeout: 15_000,
    });
  });

  test('erro da API mostra a mensagem do backend sem quebrar a página', async ({
    page,
  }) => {
    await page.route(`${API}/publico/reservas`, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ erro: { mensagem: 'Datas indisponíveis' } }),
      })
    );
    await page.route(`${API}/publico/acomodacoes`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([ACOMODACAO_E2E]),
      })
    );
    await page.route(`${API}/**`, (route) => {
      const url = route.request().url();
      if (url.includes('/publico/reservas') || url.includes('/publico/acomodacoes')) {
        return route.fallback();
      }
      return route.fulfill({ status: 200, body: '[]' });
    });

    await page.goto('/reservar');
    await page.locator('input[name="checkIn"]').fill('2026-12-10');
    await page.locator('input[name="checkOut"]').fill('2026-12-14');
    await page.locator('[role="radio"]', { hasText: 'Quarto E2E' }).click();
    await page.locator('input[name="guestName"]').fill('Maria Teste E2E');
    await page.locator('input[name="guestEmail"]').fill('e2e@example.com');
    await page.locator('input[name="guestPhone"]').fill('(22) 99999-0000');
    await page.locator('input[name="aceiteTermos"]').check();
    await page.getByRole('button', { name: 'Solicitar cotação' }).click();

    await expect(page.locator('body')).toContainText('Datas indisponíveis', {
      timeout: 15_000,
    });
  });

  test('newsletter do rodapé envia o e-mail e confirma na tela', async ({ page }) => {
    await page.route(`${API}/publico/newsletter`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.route(`${API}/**`, (route) => {
      if (route.request().url().includes('/publico/newsletter')) {
        return route.fallback();
      }
      return route.fulfill({ status: 200, body: '[]' });
    });

    await page.goto('/');
    await page.locator('#footer-newsletter').fill('e2e@example.com');
    await page
      .locator('form[aria-label*="newsletter"] button[type="submit"]')
      .click();

    await expect(page.locator('p[role="status"]')).toContainText(/confirmada/i, {
      timeout: 10_000,
    });
  });
});
