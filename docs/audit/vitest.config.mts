import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve('src') } },
  test: { environment: 'jsdom', include: ['docs/audit/upload-queue.probe.test.tsx'], restoreMocks: true },
});
