import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, 'capturas-redesign');
const WIDTHS = [360, 390, 768, 1024, 1440];

const PAGES: { name: string; url: string }[] = [
  { name: 'home', url: '/' },
  { name: 'acomodacoes', url: '/acomodacoes' },
  { name: 'contato', url: '/contato' },
  { name: 'reservar', url: '/reservar' },
];

test.describe('capturas', () => {
  for (const pg of PAGES) {
    for (const width of WIDTHS) {
      test(`${pg.name} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(pg.url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `${pg.name}-${width}.png`), fullPage: false });
        await page.screenshot({ path: path.join(OUT, `${pg.name}-${width}-full.png`), fullPage: true });
      });
    }
  }
});
