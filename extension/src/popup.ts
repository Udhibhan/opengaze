// Toolbar popup: carer-facing start/stop, calibration and dwell time.
import type { StoredCalibration } from '../../src/lib/extensionBridge';

const $ = (id: string) => document.getElementById(id)!;

async function render() {
  const s = (await chrome.storage.local.get(['enabled', 'calibration', 'camera', 'dwellMs'])) as {
    enabled?: boolean;
    calibration?: StoredCalibration;
    camera?: { ok: boolean; error: string };
    dwellMs?: number;
  };
  const lines: string[] = [];
  if (!s.calibration)
    lines.push('<span class="warn">Not calibrated yet.</span> Open setup to allow the camera and calibrate.');
  else if (s.calibration.accuracy)
    lines.push(
      `Calibrated: <b class="ok">${s.calibration.accuracy.grade}</b> (${s.calibration.accuracy.meanDeg.toFixed(1)}°, ±${Math.round(s.calibration.accuracy.p95Px)} px)`,
    );
  else lines.push('Calibrated (not validated).');
  if (s.enabled) {
    if (s.camera && !s.camera.ok)
      lines.push(`<span class="bad">Camera unavailable</span>: ${s.camera.error}. Open setup and allow the camera.`);
    else lines.push('<span class="ok">● Eye control is on</span>');
  } else lines.push('Eye control is off.');
  $('status').innerHTML = lines.join('<br>');
  $('toggle').textContent = s.enabled ? 'Stop eye control' : 'Start eye control';
  ($('toggle') as HTMLButtonElement).disabled = !s.calibration;
  $('dwell').textContent = `${((s.dwellMs ?? 900) / 1000).toFixed(1)} s dwell`;
}

$('toggle').addEventListener('click', async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.runtime.sendMessage({ type: enabled ? 'og-stop' : 'og-start' });
  await render();
});
$('calibrate').addEventListener('click', () => void chrome.runtime.sendMessage({ type: 'og-open-app' }));
for (const [id, d] of [
  ['dwell-dec', -100],
  ['dwell-inc', 100],
] as const) {
  $(id).addEventListener('click', async () => {
    const { dwellMs = 900 } = await chrome.storage.local.get('dwellMs');
    await chrome.storage.local.set({ dwellMs: Math.min(3000, Math.max(400, (dwellMs as number) + d)) });
  });
}
chrome.storage.onChanged.addListener(() => void render());
void render();
