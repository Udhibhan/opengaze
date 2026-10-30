import { useEffect, useRef } from 'react';
import { gaze } from '../gaze/engine';

/** Soft glowing dot that follows the (smoothed, magnetised) gaze. Updated outside React for 60 fps. */
export function GazeCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      gaze.onCursor((c) => {
        const el = ref.current;
        if (!el) return;
        if (!c.visible || !c.display) {
          el.style.opacity = '0';
          return;
        }
        el.style.opacity = '1';
        el.style.transform = `translate(${c.display[0]}px, ${c.display[1]}px)`;
      }),
    [],
  );
  return <div ref={ref} className="gaze-cursor" style={{ opacity: 0 }} aria-hidden />;
}
