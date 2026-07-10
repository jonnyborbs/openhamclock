import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // Sibling microservices run their own node:test suites (npm test inside
    // each directory) — vitest must not try to collect them.
    exclude: ['**/node_modules/**', 'dist/**', 'ohc-cluster/**', 'dxspider-proxy/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', '*.config.js', '**/*.d.ts', 'dist/', 'build/'],
    },
  },
});
