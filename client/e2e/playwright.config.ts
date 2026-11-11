import { defineConfig } from '@playwright/test';

/**
 * Jornadas críticas dos dois frontends, sem backend real:
 * `page.route` intercepta a API e devolve fixtures sintéticas.
 *
 *   cd client/e2e
 *   npx playwright test            # sobe os dois ng serve e roda tudo
 *   npx playwright test --project=admin
 *   npx playwright test --project=web
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  workers: 1, // dois dev servers na mesma máquina — serial evita contenção
  reporter: [['list']],
  use: {
    locale: 'pt-BR',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'admin',
      testMatch: 'admin-*.spec.ts',
      use: { baseURL: 'http://localhost:4301' },
    },
    {
      name: 'web',
      testMatch: 'web-*.spec.ts',
      use: { baseURL: 'http://localhost:4302' },
    },
  ],
  webServer: [
    {
      command: 'npm run start -- --port 4301',
      cwd: '../admin',
      url: 'http://localhost:4301',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'npm run start -- --port 4302',
      cwd: '../web',
      url: 'http://localhost:4302',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
