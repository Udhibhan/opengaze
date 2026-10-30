import { Minus, Plus } from 'lucide-react';
import { GazeTarget } from './GazeTarget';

/** Gaze-friendly numeric setting: big − / + tiles instead of a tiny slider. */
export function Stepper({
  id,
  label,
  value,
  unit = '',
  step,
  min,
  max,
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  unit?: string;
  step: number;
  min: number;
  max: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const shown = format ? format(value) : `${value}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="rounded-3xl border-2 border-line bg-panel p-3">
      <div className="mb-2 px-1 text-lg text-muted">{label}</div>
      <div className="grid grid-cols-[1fr_1.2fr_1fr] items-center gap-2">
        <GazeTarget
          id={`${id}-dec`}
          label={`Decrease ${label}`}
          onSelect={() => onChange(round(Math.max(min, value - step)))}
          disabled={value <= min}
          className="h-[120px]"
        >
          <span className="flex flex-col items-center text-lg font-bold">
            <Minus size={34} aria-hidden /> Less
          </span>
        </GazeTarget>
        <div className="text-center text-3xl font-bold" aria-live="polite">
          {shown}
        </div>
        <GazeTarget
          id={`${id}-inc`}
          label={`Increase ${label}`}
          onSelect={() => onChange(round(Math.min(max, value + step)))}
          disabled={value >= max}
          className="h-[120px]"
        >
          <span className="flex flex-col items-center text-lg font-bold">
            <Plus size={34} aria-hidden /> More
          </span>
        </GazeTarget>
      </div>
    </div>
  );
}
