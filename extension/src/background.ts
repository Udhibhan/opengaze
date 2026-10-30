// Service worker: owns the offscreen sensor page (one camera + face model for the whole browser).
import type { ControlMsg } from './protocol';

const OFFSCREEN = 'extension/offscreen.html';

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Eye tracking from the webcam, processed locally on this device.',
  });
}

async function stop() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

chrome.runtime.onMessage.addListener((msg: ControlMsg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'og-start':
        await chrome.storage.local.set({ enabled: true });
        await ensureOffscreen();
        break;
      case 'og-stop':
        await chrome.storage.local.set({ enabled: false });
        await stop();
        break;
      case 'og-open-app':
        await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
        break;
      case 'og-offscreen':
        await chrome.storage.local.set({ camera: { ok: msg.ok, error: msg.error ?? '', at: Date.now() } });
        if (!msg.ok) await stop();
        break;
    }
    reply({ ok: true });
  })().catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onInstalled.addListener((d) => {
  // First install: open OpenGaze so the user can allow the camera and calibrate.
  if (d.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

chrome.runtime.onStartup.addListener(async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  if (enabled) await ensureOffscreen();
});
