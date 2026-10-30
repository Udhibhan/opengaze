#!/usr/bin/env node
// Copies the MediaPipe Tasks Vision WASM runtime into public/wasm so the app works fully offline
// (no CDN fetches at demo time). Runs automatically after `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dst = 'public/wasm';
if (!existsSync(src)) {
  console.warn('[copy-wasm] @mediapipe/tasks-vision not installed yet; skipping.');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-wasm] MediaPipe WASM copied to public/wasm');
