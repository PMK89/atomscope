import { defineConfig } from '@playwright/test';

// Assumes `make dev-backend` and `make dev-frontend` are running (or start them via webServer).
//
// e2e/perf.spec.ts is the performance harness (tagged @perf). It is deliberately kept out of the
// normal suite -- it loads 1e5-atom structures and orbits for seconds -- and only runs with
// ATOMSCOPE_PERF=1 (`make test-perf`).
const PERF = process.env['ATOMSCOPE_PERF'] === '1';

export default defineConfig({
  testDir: './e2e',
  ...(PERF ? { testMatch: /perf\.spec\.ts/ } : { testIgnore: /perf\.spec\.ts/ }),
  timeout: PERF ? 900_000 : 60_000,
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
