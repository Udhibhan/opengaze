// Offscreen sensor page: runs the webcam + MediaPipe once for the whole browser and streams gaze features
// (numbers only, never images) to the content script of the focused tab. Nothing is stored or uploaded.
import { tracker } from '../../src/gaze/tracker';
import { GAZE_PORT, type FrameMsg } from './protocol';

const ports = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== GAZE_PORT) return;
  ports.add(p);
  p.onDisconnect.addListener(() => ports.delete(p));
});

const ticker = new Worker(new URL('./ticker.ts', import.meta.url), { type: 'module' });
let pending: (() => void) | null = null;
ticker.onmessage = () => {
  const cb = pending;
  pending = null;
  cb?.();
};
tracker.scheduler = (cb) => {
  pending = cb;
};

tracker.on((fr) => {
  if (!ports.size) return;
  const f = fr.f;
  const msg: FrameMsg = f
    ? {
        type: 'frame',
        t: fr.t,
        face: true,
        v: f.vector,
        head: f.head,
        blinkL: f.blinkL,
        blinkR: f.blinkR,
        nose: f.nose,
        tilt: f.tilt,
        eyeRatio: f.eyeDistPx / fr.videoW,
      }
    : { type: 'frame', t: fr.t, face: false };
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {
      ports.delete(p);
    }
  }
});

tracker
  .start()
  .then(() => chrome.runtime.sendMessage({ type: 'og-offscreen', ok: true }))
  .catch((e: unknown) =>
    chrome.runtime.sendMessage({
      type: 'og-offscreen',
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }),
  );
