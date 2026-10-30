// Builds the browser extension's pages: the full OpenGaze app (setup + calibration), the popup,
// the offscreen sensor page and the service worker. The content script is built separately
// (vite.content.config.ts) because content scripts can't be ES modules.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        popup: resolve(__dirname, 'extension/popup.html'),
        offscreen: resolve(__dirname, 'extension/offscreen.html'),
        background: resolve(__dirname, 'extension/src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  worker: { format: 'es' },
});
