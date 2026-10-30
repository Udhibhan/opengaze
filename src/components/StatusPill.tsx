import { gazeUi, type Status } from '../gaze/engine';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';

const LABEL: Record<Status, string> = {
  off: 'Camera off',
  uncalibrated: 'Not calibrated',
  tracking: 'Tracking',
  paused: 'Paused',
  'face-lost': 'Face lost',
  'head-out': 'Re-centre head',
};
const ICON: Record<Status, string> = {
  off: '○',
  uncalibrated: '◌',
  tracking: '●',
  paused: '‖',
  'face-lost': '⚠',
  'head-out': '↺',
};

export function StatusPill() {
  const status = useStore(gazeUi, (s) => s.status);
  const grade = useStore(gazeUi, (s) => s.accuracy?.grade ?? null);
  const deg = useStore(gazeUi, (s) => s.accuracy?.meanDeg ?? null);
  const mode = useStore(settings, (s) => s.selection);
  const tone =
    status === 'tracking'
      ? 'text-ok border-ok/60'
      : status === 'paused'
        ? 'text-amber border-amber/60'
        : 'text-danger border-danger/60';
  return (
    <div className="flex items-center gap-2 text-lg" role="status" aria-live="polite">
      <span className={`flex items-center gap-2 rounded-full border-2 bg-panel px-4 py-1.5 font-bold ${tone}`}>
        <span aria-hidden>{ICON[status]}</span>
        {LABEL[status]}
      </span>
      {mode === 'mouse' || mode === 'head' ? (
        <span className="rounded-full border-2 border-line bg-panel px-4 py-1.5 text-muted">
          {mode === 'mouse' ? 'Mouse mode' : 'Head pointer'}
        </span>
      ) : (
        grade && (
          <span className="rounded-full border-2 border-line bg-panel px-4 py-1.5 text-muted">
            Accuracy: <b className="text-ink">{grade}</b>
            {deg !== null && isFinite(deg) && <> · {deg.toFixed(1)}°</>}
          </span>
        )
      )}
    </div>
  );
}
