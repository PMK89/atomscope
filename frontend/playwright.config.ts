import { defineConfig } from '@playwright/test';

// Assumes `make dev-backend` and `make dev-frontend` are running (or start them via webServer).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // All tests share one backend process (one open project at a time): run serially.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173',
    headless: true,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  reporter: [['list']],
});
