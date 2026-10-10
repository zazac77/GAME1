import { defineConfig, devices } from '@playwright/test';

// End-to-end scenario of lot 3.5: the app served by Vite, played in Chromium.
// Run with `npm run test:e2e` (root). PLAYWRIGHT_BROWSERS_PATH may point to a
// preinstalled Chromium; otherwise `npx playwright install chromium` first.
const port = 5179;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
