import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Backend address for the dev proxy; override to run a second instance next to the default one.
const apiTarget = process.env['ATOMSCOPE_API_URL'] ?? 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
