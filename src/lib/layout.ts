import { useEffect, useState } from 'react';
import { adaptiveLayout, type AdaptiveLayout } from '../gaze/accuracy';
import { gazeUi } from '../gaze/engine';
import { settings } from './settings';
import { useStore } from './store';

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

/** Target sizes and grid density tuned to the measured accuracy (and the user's override). */
export function useLayout(): AdaptiveLayout & { tuned: boolean } {
  const p95 = useStore(gazeUi, (s) => s.accuracy?.p95Px ?? null);
  const scale = useStore(settings, (s) => s.targetScale);
  const mode = useStore(settings, (s) => s.selection);
  const { w, h } = useViewport();
  // Mouse / head pointer are precise enough for the dense layout unless the user scales up.
  const effective = mode === 'mouse' ? 80 : mode === 'head' ? 150 : p95;
  const base = adaptiveLayout(effective ? effective * scale : null, w, h);
  let { replyCols, keyCols } = base;
  if (scale >= 1.3) {
    replyCols = Math.max(2, replyCols - 1);
    keyCols = Math.max(5, keyCols - 1);
  } else if (scale <= 0.8) {
    replyCols = Math.min(3, replyCols + 1);
    keyCols = Math.min(9, keyCols + 1);
  }
  return { ...base, minTile: Math.max(120, Math.round(base.minTile)), replyCols, keyCols, tuned: p95 !== null };
}
