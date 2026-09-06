import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Frontend unit tests (C3.1).
 *
 * Deliberately separate from vite.config.ts: the dev config loads the Lovable
 * tagger plugin, and a test run has no business doing that. jsdom is on for the
 * reducer and hook tests that arrive with the upload queue in C4.2.
 *
 * The server has its own suite (`cd server && npm test`) — that is where the
 * API's behaviour is proven; these tests cover browser-side logic only.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
