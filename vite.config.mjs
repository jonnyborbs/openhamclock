import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Stamped once per build — versions the service worker registration URL so
// every deploy rolls out a fresh worker (and fresh ohc-* caches).
const buildStamp = Date.now().toString(36);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/metrics': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@styles': path.resolve(__dirname, './src/styles'),
    },
  },
  define: {
    // mqtt.js needs these for browser
    global: 'globalThis',
    // Service worker versioning (see src/pwa/registerServiceWorker.js)
    __OHC_VERSION__: JSON.stringify(pkg.version),
    __OHC_BUILD_TS__: JSON.stringify(buildStamp),
  },
  optimizeDeps: {
    include: ['mqtt'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          satellite: ['satellite.js'],
          mqtt: ['mqtt'],
        },
      },
    },
  },
});
