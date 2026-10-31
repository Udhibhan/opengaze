import { createStore } from './store';

export type SelectionMethod = 'dwell' | 'blink' | 'head' | 'mouse';
export type Theme = 'dark' | 'light';

export interface Settings {
  selection: SelectionMethod;
  dwellMs: number;
  /** Multiplier on the automatically tuned target size (1 = auto). */
  targetScale: number;
  /** 1 (most responsive) .. 5 (most stable). */
  smoothing: number;
  voiceURI: string;
  speechRate: number;
  highContrast: boolean;
  reducedMotion: boolean;
  theme: Theme;
  sound: boolean;
  viewingDistanceCm: number;
  screenDiagonalIn: number;
  name: string;
  aboutMe: string;
  useAI: boolean;
  /** Small live camera view with a centring guide on every screen. */
  showCamera: boolean;
  /** One-time migration flag: calmer eye-gaze defaults. */
  calmDefaults?: boolean;
}

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_SETTINGS: Settings = {
  selection: 'dwell',
  dwellMs: 1200,
  targetScale: 1,
  smoothing: 4,
  voiceURI: '',
  speechRate: 1,
  highContrast: false,
  reducedMotion: !!prefersReduced,
  theme: 'dark',
  sound: true,
  viewingDistanceCm: 60,
  screenDiagonalIn: 14,
  name: '',
  aboutMe: '',
  useAI: true,
  calmDefaults: true,
  showCamera: true,
};

// Settings (including the optional name / "about me") stay on this device in localStorage.
// Camera frames, gaze data and transcripts are never persisted.
const KEY = 'opengaze.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Calmer eye-gaze defaults: bump older saved settings once (users can still lower them).
      if (!saved.calmDefaults) {
        saved.dwellMs = Math.max(saved.dwellMs ?? 1200, 1200);
        saved.smoothing = Math.max(saved.smoothing ?? 4, 4);
        saved.calmDefaults = true;
      }
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS;
}

export const settings = createStore<Settings>(load(), (s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
});

/** One Euro parameters for a smoothing level. */
export function smootherParams(level: number) {
  const l = Math.min(5, Math.max(1, level));
  return {
    minCutoff: [1.6, 1.0, 0.6, 0.35, 0.2][l - 1],
    beta: [0.012, 0.007, 0.004, 0.0025, 0.0015][l - 1],
  };
}
