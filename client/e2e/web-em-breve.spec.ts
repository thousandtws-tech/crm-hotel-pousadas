import { expect, test } from '@playwright/test';

const API = 'https://api-production-19dc.up.railway.app/api/v1';

test.use({ viewport: { width: 1920, height: 1080 } });

test('em breve — página teaser com captura de e-mail', async ({ page }) => {
  let capturado: { email?: string; origem?: string } | null = null;

  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/publico/newsletter')) {
      capturado = route.request().postDataJSON() as { email?: string; origem?: string };
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/em-breve');

  // standalone — sem header/footer do site
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.locator('footer')).toHaveCount(0);

  await expect(page.locator('.fundo')).toBeVisible(); // mesmo hero da home
  await expect(page.locator('h1')).toContainText('Em breve');
  await expect(page.locator('.marca')).toBeVisible();

  // validação de e-mail
  await page.locator('#nl-email').fill('nao-e-email');
  await page.locator('.captura button').click();
  await expect(page.locator('.msg .err')).toContainText('e-mail válido');
  expect(capturado).toBeNull();

  // captura real → POST /publico/newsletter com origem 'em-breve'
  await page.locator('#nl-email').fill('hospede@exemplo.com');
  await page.locator('.captura button').click();
  await expect(page.locator('.msg.ok')).toContainText('Inscrição confirmada');
  expect(capturado).toEqual({ email: 'hospede@exemplo.com', origem: 'em-breve' });

  await page.screenshot({ path: 'capturas-crm/em-breve-1920.png' });
});
