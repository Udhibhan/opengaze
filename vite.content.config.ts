// Content script bundle: a single classic (IIFE) script, as Chrome requires.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-extension',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'extension/src/content.ts'),
      formats: ['iife'],
      name: 'OpenGazeContent',
      fileName: () => 'content.js',
    },
  },
});
