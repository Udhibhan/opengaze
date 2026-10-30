import { AnimatePresence, motion } from 'framer-motion';
import { gazeUi } from '../gaze/engine';
import { useStore } from '../lib/store';
import { settings } from '../lib/settings';

/** Calm, non-alarming notices: face lost, head out of range, low light, distance. */
export function Banners() {
  const status = useStore(gazeUi, (s) => s.status);
  const headHint = useStore(gazeUi, (s) => s.headHint);
  const lowLight = useStore(gazeUi, (s) => s.lowLight);
  const distance = useStore(gazeUi, (s) => s.distance);
  const mode = useStore(settings, (s) => s.selection);
  if (mode === 'mouse') return null;

  let msg = '';
  let sub = '';
  if (status === 'face-lost') {
    msg = "I can't see your face right now";
    sub = 'Nothing will be selected. Tracking resumes as soon as you are back in view.';
  } else if (status === 'head-out') {
    msg = headHint;
    sub = 'Selections are paused until your head is back where it was during calibration.';
  } else if (distance === 'far') {
    msg = 'Move a little closer to the screen';
  } else if (distance === 'close') {
    msg = 'Move a little further from the screen';
  } else if (lowLight) {
    msg = 'It is quite dark';
    sub = 'Tip: turn on a light in front of you (not behind you) for better tracking.';
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <AnimatePresence>
        {msg && (
          <motion.div
            key={msg}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="w-[min(760px,92vw)] rounded-3xl border-2 border-amber/70 bg-panel/95 px-8 py-5 text-center shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <div className="text-2xl font-bold">{msg}</div>
            {sub && <div className="mt-1 text-lg text-muted">{sub}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
