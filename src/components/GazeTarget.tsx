import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { gaze, gazeUi } from '../gaze/engine';
import { useStore } from '../lib/store';

export interface GazeTargetProps {
  id: string;
  /** Plain-language label (also used for metrics and screen readers). */
  label: string;
  onSelect: () => void;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: 'default' | 'primary' | 'danger' | 'quiet';
  dwellMs?: number;
  /** Stays selectable while tracking is paused (only the Pause tile). */
  pauseSafe?: boolean;
  disabled?: boolean;
}

/**
 * A large tile selectable by gaze (dwell / blink / head pointer) or by a carer's click.
 * Draws a progress ring that fills around the tile border while it is being dwelled on.
 */
export function GazeTarget({
  id,
  label,
  onSelect,
  children,
  className = '',
  style,
  variant = 'default',
  dwellMs,
  pauseSafe,
  disabled,
}: GazeTargetProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const cb = useRef(onSelect);
  cb.current = onSelect;

  useEffect(() => {
    if (!ref.current) return;
    return gaze.register({
      id,
      el: ref.current,
      label,
      onSelect: () => cb.current(),
      dwellMs,
      pauseSafe,
    });
  }, [id, label, dwellMs, pauseSafe]);

  const hovered = useStore(gazeUi, (s) => s.hovered === id);
  const progress = useStore(gazeUi, (s) => (s.dwellId === id ? s.progress : 0));
  const pulse = useStore(gazeUi, (s) => (s.pulseId === id ? s.pulseAt : 0));

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      data-hover={hovered && !disabled ? 'true' : 'false'}
      data-variant={variant}
      onClick={() => !disabled && gaze.clickSelect(id)}
      className={`gaze-tile ${className}`}
      style={style}
    >
      {children ?? <span className="px-3 text-center font-bold">{label}</span>}
      {progress > 0 && !disabled && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <rect
            x="3"
            y="3"
            style={{ width: 'calc(100% - 6px)', height: 'calc(100% - 6px)' }}
            rx="22"
            pathLength={100}
            fill="none"
            stroke="rgb(var(--amber))"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${progress * 100} 100`}
          />
        </svg>
      )}
      {pulse > 0 && <span key={pulse} className="og-pulse pointer-events-none absolute inset-0 rounded-3xl" />}
    </button>
  );
}
