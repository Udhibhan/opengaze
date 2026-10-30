import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, MessageSquare, RotateCcw } from 'lucide-react';
import { GazeTarget } from '../components/GazeTarget';
import { Stepper } from '../components/Stepper';
import { TopBar } from '../components/TopBar';
import { gaze } from '../gaze/engine';
import { settings, type SelectionMethod, type Settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { go } from '../lib/app';
import { getVoices, onVoicesChanged, speak } from '../lib/speech';

function Toggle({
  id,
  label,
  on,
  onChange,
}: {
  id: string;
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <GazeTarget
      id={id}
      label={`${label}: ${on ? 'on' : 'off'}`}
      onSelect={() => onChange(!on)}
      variant={on ? 'primary' : 'default'}
      style={{ minHeight: 120 }}
    >
      <span className="flex flex-col items-center gap-1 text-xl font-bold">
        {label}
        <span className={on ? 'text-amber' : 'text-muted'}>{on ? 'On' : 'Off'}</span>
      </span>
    </GazeTarget>
  );
}

const METHODS: { id: SelectionMethod; label: string }[] = [
  { id: 'dwell', label: 'Dwell' },
  { id: 'blink', label: 'Long blink' },
  { id: 'head', label: 'Head pointer' },
  { id: 'mouse', label: 'Mouse' },
];

export function SettingsScreen() {
  const s = useStore(settings, (x) => x);
  const [page, setPage] = useState<0 | 1>(0);
  const [voices, setVoices] = useState(getVoices());
  useEffect(() => onVoicesChanged(() => setVoices(getVoices())), []);
  const set = (p: Partial<Settings>) => settings.set(p);

  const vIdx = Math.max(
    0,
    voices.findIndex((v) => v.voiceURI === s.voiceURI),
  );
  const cycleVoice = (d: number) => {
    if (!voices.length) return;
    const v = voices[(vIdx + d + voices.length) % voices.length];
    set({ voiceURI: v.voiceURI });
    void speak('This is my voice.');
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <TopBar>
        <h1 className="text-3xl font-bold">Settings</h1>
      </TopBar>

      <div className="grid grid-cols-3 gap-4" style={{ height: 120 }}>
        <GazeTarget
          id="set-page-0"
          label="Selection and tracking"
          onSelect={() => setPage(0)}
          variant={page === 0 ? 'primary' : 'default'}
        >
          <span className="text-xl font-bold">Selection &amp; tracking</span>
        </GazeTarget>
        <GazeTarget
          id="set-page-1"
          label="Voice and display"
          onSelect={() => setPage(1)}
          variant={page === 1 ? 'primary' : 'default'}
        >
          <span className="text-xl font-bold">Voice &amp; display</span>
        </GazeTarget>
        <GazeTarget id="set-back" label="Back to Talk" onSelect={() => go('talk')} variant="quiet">
          <span className="flex items-center gap-2 text-xl font-bold">
            <MessageSquare size={28} aria-hidden /> Back to Talk
          </span>
        </GazeTarget>
      </div>

      {page === 0 ? (
        <div className="grid min-h-0 flex-1 auto-rows-min gap-4 overflow-y-auto lg:grid-cols-3">
          <div className="grid grid-cols-4 gap-3 lg:col-span-3">
            {METHODS.map((m) => (
              <GazeTarget
                key={m.id}
                id={`set-method-${m.id}`}
                label={`Select by ${m.label}`}
                onSelect={() => set({ selection: m.id })}
                variant={s.selection === m.id ? 'primary' : 'default'}
                style={{ height: 120 }}
              >
                <span className="flex flex-col items-center text-xl font-bold">
                  <span className="text-base font-normal text-muted">Select by</span>
                  {m.label}
                </span>
              </GazeTarget>
            ))}
          </div>
          <Stepper
            id="set-dwell"
            label="Dwell time"
            value={s.dwellMs}
            step={100}
            min={300}
            max={3000}
            format={(v) => `${(v / 1000).toFixed(1)} s`}
            onChange={(v) => set({ dwellMs: v })}
          />
          <Stepper
            id="set-size"
            label="Target size"
            value={s.targetScale}
            step={0.1}
            min={0.7}
            max={1.6}
            format={(v) => (Math.abs(v - 1) < 0.01 ? 'Auto' : `Auto ×${v.toFixed(1)}`)}
            onChange={(v) => set({ targetScale: v })}
          />
          <Stepper
            id="set-smooth"
            label="Smoothing"
            value={s.smoothing}
            step={1}
            min={1}
            max={5}
            format={(v) => ['Fastest', 'Fast', 'Balanced', 'Steady', 'Steadiest'][v - 1]}
            onChange={(v) => set({ smoothing: v })}
          />
          <GazeTarget id="set-recal" label="Recalibrate" onSelect={() => go('calibrate')} style={{ minHeight: 120 }}>
            <span className="flex flex-col items-center gap-1 text-xl font-bold">
              <RotateCcw size={30} aria-hidden /> Recalibrate
            </span>
          </GazeTarget>
          <GazeTarget
            id="set-recentre"
            label="Re-centre head pointer"
            onSelect={() => gaze.recentreHead()}
            style={{ minHeight: 120 }}
            disabled={s.selection !== 'head'}
          >
            <span className="flex flex-col items-center gap-1 text-xl font-bold">
              <Crosshair size={30} aria-hidden /> Re-centre head pointer
            </span>
          </GazeTarget>
          <Stepper
            id="set-dist"
            label="Viewing distance"
            value={s.viewingDistanceCm}
            unit="cm"
            step={5}
            min={30}
            max={120}
            onChange={(v) => set({ viewingDistanceCm: v })}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min gap-4 overflow-y-auto lg:grid-cols-3">
          <div className="rounded-3xl border-2 border-line bg-panel p-3 lg:col-span-2">
            <div className="mb-2 px-1 text-lg text-muted">Voice</div>
            <div className="grid grid-cols-[1fr_2fr_1fr] items-center gap-3">
              <GazeTarget
                id="set-voice-prev"
                label="Previous voice"
                onSelect={() => cycleVoice(-1)}
                style={{ height: 120 }}
              >
                <ChevronLeft size={40} aria-hidden />
              </GazeTarget>
              <div className="truncate text-center text-2xl font-bold">{voices[vIdx]?.name ?? 'System default'}</div>
              <GazeTarget id="set-voice-next" label="Next voice" onSelect={() => cycleVoice(1)} style={{ height: 120 }}>
                <ChevronRight size={40} aria-hidden />
              </GazeTarget>
            </div>
          </div>
          <Stepper
            id="set-rate"
            label="Speech rate"
            value={s.speechRate}
            step={0.1}
            min={0.6}
            max={1.6}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) => set({ speechRate: v })}
          />
          <Toggle
            id="set-theme"
            label="Light theme"
            on={s.theme === 'light'}
            onChange={(v) => set({ theme: v ? 'light' : 'dark' })}
          />
          <Toggle id="set-hc" label="High contrast" on={s.highContrast} onChange={(v) => set({ highContrast: v })} />
          <Toggle
            id="set-motion"
            label="Reduced motion"
            on={s.reducedMotion}
            onChange={(v) => set({ reducedMotion: v })}
          />
          <Toggle id="set-camera" label="Camera view" on={s.showCamera} onChange={(v) => set({ showCamera: v })} />
          <Toggle id="set-sound" label="Selection sound" on={s.sound} onChange={(v) => set({ sound: v })} />
          <Toggle id="set-ai" label="Claude suggestions" on={s.useAI} onChange={(v) => set({ useAI: v })} />
        </div>
      )}
    </div>
  );
}
