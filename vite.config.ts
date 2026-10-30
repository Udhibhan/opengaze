/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  // MediaPipe ships its own WASM loader; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
