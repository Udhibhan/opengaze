// Toolbar popup: carer-facing start/stop, pointer mode (head / eyes), head range, re-centre, calibration, dwell.
import type { StoredCalibration } from '../../src/lib/extensionBridge';

const $ = (id: string) => document.getElementById(id)!;

async function render() {
  const s = (await chrome.storage.local.get([
    'enabled',
    'calibration',
    'camera',
    'dwellMs',
    'pointer',
    'headRange',
    'grid',
    'showCamera',
  ])) as {
    grid?: string;
    showCamera?: boolean;
    enabled?: boolean;
    calibration?: StoredCalibration;
    camera?: { ok: boolean; error: string };
    dwellMs?: number;
    pointer?: 'head' | 'eyes';
    headRange?: string;
  };
  const pointer = s.pointer ?? 'head';
  $('mode-head').setAttribute('aria-pressed', String(pointer === 'head'));
  $('mode-eyes').setAttribute('aria-pressed', String(pointer === 'eyes'));
  $('head-opts').style.display = pointer === 'head' ? 'block' : 'none';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-range]'))
    b.setAttribute('aria-pressed', String(b.dataset.range === (s.headRange ?? 'medium')));

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-grid]'))
    b.setAttribute('aria-pressed', String(b.dataset.grid === (s.grid ?? 'auto')));
  $('camera').setAttribute('aria-pressed', String(s.showCamera !== false));
  const lines: string[] = [];
  if (pointer === 'head') lines.push('Head pointer: no eye calibration needed.');
  else if (!s.calibration) lines.push('<span class="warn">Eyes not calibrated yet.</span> Open setup to calibrate.');
  else if (s.calibration.accuracy)
    lines.push(
      `Eyes calibrated: <b class="ok">${s.calibration.accuracy.grade}</b> (${s.calibration.accuracy.meanDeg.toFixed(1)}°, ±${Math.round(s.calibration.accuracy.p95Px)} px)`,
    );
  else lines.push('Eyes calibrated (not validated).');
  if (s.enabled) {
    if (s.camera && !s.camera.ok)
      lines.push(`<span class="bad">Camera unavailable</span>: ${s.camera.error}. Open setup and allow the camera.`);
    else lines.push('<span class="ok">● Control is on</span>');
  } else lines.push('Control is off.');
  $('status').innerHTML = lines.join('<br>');
  $('toggle').textContent = s.enabled ? 'Stop' : 'Start';
  ($('toggle') as HTMLButtonElement).disabled = pointer === 'eyes' && !s.calibration;
  $('dwell').textContent = `${((s.dwellMs ?? 1000) / 1000).toFixed(1)} s dwell`;
}

$('toggle').addEventListener('click', async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.runtime.sendMessage({ type: enabled ? 'og-stop' : 'og-start' });
  await render();
});
$('mode-head').addEventListener('click', () => void chrome.storage.local.set({ pointer: 'head' }));
$('mode-eyes').addEventListener('click', () => void chrome.storage.local.set({ pointer: 'eyes' }));
$('recentre').addEventListener('click', () => void chrome.storage.local.set({ recentreAt: Date.now() }));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-range]'))
  b.addEventListener('click', () => void chrome.storage.local.set({ headRange: b.dataset.range }));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-grid]'))
  b.addEventListener('click', () => void chrome.storage.local.set({ grid: b.dataset.grid }));
$('camera').addEventListener('click', async () => {
  const { showCamera } = await chrome.storage.local.get('showCamera');
  await chrome.storage.local.set({ showCamera: showCamera === false });
});
$('calibrate').addEventListener('click', () => void chrome.runtime.sendMessage({ type: 'og-open-app' }));
for (const [id, d] of [
  ['dwell-dec', -100],
  ['dwell-inc', 100],
] as const) {
  $(id).addEventListener('click', async () => {
    const { dwellMs = 1000 } = await chrome.storage.local.get('dwellMs');
    await chrome.storage.local.set({ dwellMs: Math.min(3000, Math.max(400, (dwellMs as number) + d)) });
  });
}
chrome.storage.onChanged.addListener(() => void render());
void render();
