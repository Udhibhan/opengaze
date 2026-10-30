// Text-entry benchmark: copy 5 short phrases with the keyboard only, then with AI suggestions.
// WPM uses the standard text-entry definition: (characters / 5) per minute.
import { createStore } from './store';

// Five phrases from the MacKenzie & Soukoreff (2003) text-entry evaluation phrase set.
export const BENCH_PHRASES = [
  'my watch fell in the water',
  'time to go shopping',
  'you must be getting old',
  'the sun is shining',
  'i can see the rings on saturn',
];

export type BenchMode = 'keyboard' | 'ai';

export interface Trial {
  mode: BenchMode;
  phrase: string;
  ms: number;
  selections: number;
  wpm: number;
}

export interface BenchState {
  active: boolean;
  mode: BenchMode;
  idx: number;
  trialStart: number | null;
  trialSelections: number;
  trials: Trial[];
  finishedAt: number | null;
}

export const bench = createStore<BenchState>({
  active: false,
  mode: 'keyboard',
  idx: 0,
  trialStart: null,
  trialSelections: 0,
  trials: [],
  finishedAt: null,
});

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function wpmFor(phrase: string, ms: number): number {
  return phrase.length / 5 / Math.max(ms / 60000, 1e-6);
}

export function startBench(mode: BenchMode = 'keyboard') {
  bench.set({
    active: true,
    mode,
    idx: 0,
    trialStart: null,
    trialSelections: 0,
    trials: mode === 'keyboard' ? [] : bench.get().trials,
    finishedAt: null,
  });
}

export function benchSelection() {
  const b = bench.get();
  if (!b.active) return;
  bench.set({ trialStart: b.trialStart ?? performance.now(), trialSelections: b.trialSelections + 1 });
}

/** Call whenever the composed text changes; returns true when the current phrase is complete. */
export function benchCheck(text: string): boolean {
  const b = bench.get();
  if (!b.active || b.trialStart === null) return false;
  const phrase = BENCH_PHRASES[b.idx];
  if (norm(text) !== phrase) return false;
  const ms = performance.now() - b.trialStart;
  const trial: Trial = { mode: b.mode, phrase, ms, selections: b.trialSelections, wpm: wpmFor(phrase, ms) };
  const trials = [...b.trials, trial];
  if (b.idx + 1 < BENCH_PHRASES.length) {
    bench.set({ trials, idx: b.idx + 1, trialStart: null, trialSelections: 0 });
  } else if (b.mode === 'keyboard') {
    bench.set({ trials, mode: 'ai', idx: 0, trialStart: null, trialSelections: 0 });
  } else {
    bench.set({ trials, active: false, finishedAt: Date.now(), trialStart: null });
  }
  return true;
}

export function stopBench() {
  bench.set({ active: false, trialStart: null });
}

export function benchSummary(trials: Trial[]) {
  const by = (m: BenchMode) => trials.filter((t) => t.mode === m);
  const agg = (ts: Trial[]) => {
    if (!ts.length) return null;
    const chars = ts.reduce((a, t) => a + t.phrase.length, 0);
    const ms = ts.reduce((a, t) => a + t.ms, 0);
    return {
      n: ts.length,
      wpm: chars / 5 / (ms / 60000),
      selectionsPerChar: ts.reduce((a, t) => a + t.selections, 0) / chars,
    };
  };
  return { keyboard: agg(by('keyboard')), ai: agg(by('ai')) };
}
