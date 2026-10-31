// Offscreen sensor page: runs the webcam + MediaPipe once for the whole browser and streams gaze features
// (numbers only, never images) to the content script of the focused tab. Nothing is stored or uploaded.
import { tracker } from '../../src/gaze/tracker';
import { GAZE_PORT, type FrameMsg, type PreviewMsg, type WantPreviewMsg } from './protocol';

const ports = new Set<chrome.runtime.Port>();
/** Ports (tabs) that asked to see the camera thumbnail. */
const previewPorts = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== GAZE_PORT) return;
  ports.add(p);
  p.onMessage.addListener((m: WantPreviewMsg) => {
    if (m.type !== 'want-preview') return;
    if (m.on) previewPorts.add(p);
    else previewPorts.delete(p);
  });
  p.onDisconnect.addListener(() => {
    ports.delete(p);
    previewPorts.delete(p);
  });
});

// Camera thumbnail for the in-page centring guide: tiny, low quality, only to tabs that ask.
const thumb = document.createElement('canvas');
let ticks = 0;
function sendPreview() {
  const v = tracker.video;
  if (!previewPorts.size || v.readyState < 2 || !v.videoWidth) return;
  thumb.width = 160;
  thumb.height = Math.round((160 * v.videoHeight) / v.videoWidth);
  thumb.getContext('2d')?.drawImage(v, 0, 0, thumb.width, thumb.height);
  const msg: PreviewMsg = { type: 'preview', url: thumb.toDataURL('image/jpeg', 0.55) };
  for (const p of previewPorts) {
    try {
      p.postMessage(msg);
    } catch {
      previewPorts.delete(p);
    }
  }
}

const ticker = new Worker(new URL('./ticker.ts', import.meta.url), { type: 'module' });
let pending: (() => void) | null = null;
ticker.onmessage = () => {
  if (++ticks % 3 === 0) sendPreview();
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
