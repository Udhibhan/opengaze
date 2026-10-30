import { useEffect } from 'react';
import { app } from './lib/app';
import { settings } from './lib/settings';
import { useStore } from './lib/store';
import { useLayout } from './lib/layout';
import { gaze } from './gaze/engine';
import { GazeCursor } from './components/GazeCursor';
import { DebugOverlay } from './components/DebugOverlay';
import { Banners } from './components/Banners';
import { Setup } from './screens/Setup';
import { Calibrate } from './screens/Calibrate';
import { Talk } from './screens/Talk';
import { Keyboard } from './screens/Keyboard';
import { Measure } from './screens/Measure';
import { SettingsScreen } from './screens/Settings';
import { startMetrics } from './lib/metrics';

export default function App() {
  const screen = useStore(app, (s) => s.screen);
  const debug = useStore(app, (s) => s.debug);
  const theme = useStore(settings, (s) => s.theme);
  const hc = useStore(settings, (s) => s.highContrast);
  const reduced = useStore(settings, (s) => s.reducedMotion);
  const layout = useLayout();

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.contrast = hc ? 'high' : 'normal';
    el.dataset.motion = reduced ? 'reduced' : 'full';
  }, [theme, hc, reduced]);

  useEffect(() => gaze.setSnapPad(layout.snapPad), [layout.snapPad]);
  useEffect(() => startMetrics(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'd' || e.key === 'D') app.set({ debug: !app.get().debug });
      if (e.key === 'Escape') app.set({ screen: 'setup' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="h-full">
      {screen === 'setup' && <Setup />}
      {screen === 'calibrate' && <Calibrate />}
      {screen === 'talk' && <Talk />}
      {screen === 'keyboard' && <Keyboard />}
      {screen === 'measure' && <Measure />}
      {screen === 'settings' && <SettingsScreen />}
      {screen !== 'setup' && <Banners />}
      <GazeCursor />
      {debug && <DebugOverlay />}
    </main>
  );
}
