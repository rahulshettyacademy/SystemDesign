import { defineConfig, devices } from '@playwright/test';

/**
 * Two projects:
 *   api - talks HTTP to the gateway (http://localhost:8080) and the lab API (http://localhost:8081)
 *   ui  - drives the React shop in a real browser
 *
 * The lab is ONE shared system (databases, queues, cache), so tests run one at a time.
 * global-setup resets everything to the seeded state before the run.
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.SHOP_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testDir: './api' },
    { name: 'ui', testDir: './ui', use: { ...devices['Desktop Chrome'] } },
  ],
});
