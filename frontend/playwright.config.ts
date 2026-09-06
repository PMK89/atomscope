import { defineConfig } from '@playwright/test';

// Assumes `make dev-backend` and `make dev-frontend` are running (or start them via webServer).
//
// e2e/perf.spec.ts is the performance harness (tagged @perf). It is deliberately kept out of the
// normal suite -- it loads 1e5-atom structures and orbits for seconds -- and only runs with
// ATOMSCOPE_PERF=1 (`make test-perf`).
//
// e2e/course-visual.spec.ts takes pictures of finished CP-PAW course runs. It is out of the
// normal suite for two reasons: it needs real runs under .scratch/course-runs, and it opens
// structures of its own, which the rest of the suite cannot take -- those specs share one
// document and one project and depend on the order they run in. ATOMSCOPE_COURSE=1 runs it.
const PERF = process.env['ATOMSCOPE_PERF'] === '1';
const COURSE = process.env['ATOMSCOPE_COURSE'] === '1';
const OUT_OF_SUITE = /(perf|course-visual)\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  ...(PERF
    ? { testMatch: /perf\.spec\.ts/ }
    : COURSE
      ? { testMatch: /course-visual\.spec\.ts/ }
      : { testIgnore: OUT_OF_SUITE }),
  timeout: PERF ? 900_000 : 60_000,
  // All tests share one backend process (one open project at a time): run serially.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173',
    headless: true,
    // the clipboard test reads back what Copy wrote, which Chromium gates behind these
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  reporter: [['list']],
});
