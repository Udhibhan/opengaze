import { Pause, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { gaze, gazeUi } from '../gaze/engine';
import { useStore } from '../lib/store';
import { StatusPill } from './StatusPill';
import { GazeTarget } from './GazeTarget';
import { CameraPreview } from './CameraPreview';
import { settings } from '../lib/settings';

/** Status pill on the left, optional centre content, and the Pause tile in the top-right corner. */
export function TopBar({ children }: { children?: ReactNode }) {
  const paused = useStore(gazeUi, (s) => s.paused);
  const showCamera = useStore(settings, (s) => s.showCamera);
  return (
    <div className="flex items-stretch justify-between gap-4">
      <div className="flex items-center">
        <StatusPill />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
      {showCamera && <CameraPreview width={190} />}
      <PauseTile paused={paused} />
    </div>
  );
}

export function PauseTile({ paused }: { paused: boolean }) {
  return (
    <GazeTarget
      id="pause"
      label={paused ? 'Resume tracking' : 'Pause tracking'}
      onSelect={() => gaze.togglePause()}
      dwellMs={2000}
      pauseSafe
      variant={paused ? 'primary' : 'quiet'}
      className="h-[120px] w-[170px] shrink-0"
    >
      <span className="flex flex-col items-center gap-1 text-lg font-bold">
        {paused ? <Play size={30} aria-hidden /> : <Pause size={30} aria-hidden />}
        {paused ? 'Resume' : 'Pause'}
        <span className="text-sm font-normal text-muted">look for 2 s</span>
      </span>
    </GazeTarget>
  );
}
