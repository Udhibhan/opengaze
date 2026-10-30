#!/usr/bin/env node
// Builds dist-extension/ (load it via chrome://extensions → Developer mode → Load unpacked)
// and a zip for sharing. Set VITE_API_BASE=https://your-app.vercel.app for Claude replies inside the extension.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
run('npx vite build -c vite.extension.config.ts');
run('npx vite build -c vite.content.config.ts');
copyFileSync('extension/manifest.json', 'dist-extension/manifest.json');
if (!existsSync('dist-extension/wasm/vision_wasm_internal.wasm')) {
  console.error('Missing MediaPipe WASM in dist-extension/wasm. Run `npm install` first.');
  process.exit(1);
}
if (existsSync('opengaze-extension.zip')) rmSync('opengaze-extension.zip');
try {
  if (process.platform === 'win32')
    run(
      'powershell -NoProfile -Command "Compress-Archive -Path dist-extension/* -DestinationPath opengaze-extension.zip"',
    );
  else run('cd dist-extension && zip -qr ../opengaze-extension.zip .');
} catch {
  console.warn('Could not create zip (dist-extension/ is still ready to load).');
}
console.log('\n✔ Extension built in dist-extension/. Load it at chrome://extensions (Developer mode → Load unpacked).');
