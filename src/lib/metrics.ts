// Live session metrics for the Measure screen. In memory only; nothing is uploaded.
import { createStore } from './store';
import { gaze } from '../gaze/engine';
import { onSpoken } from './speech';
import { costUsd, MODEL_ID } from '../../config/pricing';
import { learn } from './predict';

export interface Metrics {
  startedAt: number;
  selections: number;
  firstSelectAt: number | null;
  lastSelectAt: number | null;
  wordsSpoken: number;
  utterances: number;
  composeMs: number; // summed time from first selection of an utterance to speaking it
  composeStart: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
  cachedRequests: number;
  residuals: number[]; // live gaze error estimates at selection (px)
  aiSelections: number;
}

export const metrics = createStore<Metrics>({
  startedAt: Date.now(),
  selections: 0,
  firstSelectAt: null,
  lastSelectAt: null,
  wordsSpoken: 0,
  utterances: 0,
  composeMs: 0,
  composeStart: null,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  requests: 0,
  cachedRequests: 0,
  residuals: [],
  aiSelections: 0,
});

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function recordUsage(model: string, u: { input_tokens: number; output_tokens: number }, kind: string) {
  const m = metrics.get();
  const cached = kind.endsWith('cached');
  metrics.set({
    inputTokens: m.inputTokens + (cached ? 0 : u.input_tokens),
    outputTokens: m.outputTokens + (cached ? 0 : u.output_tokens),
    costUsd: m.costUsd + (cached ? 0 : costUsd(model || MODEL_ID, u.input_tokens, u.output_tokens)),
    requests: m.requests + 1,
    cachedRequests: m.cachedRequests + (cached ? 1 : 0),
  });
}

export function markAiSelection() {
  metrics.set({ aiSelections: metrics.get().aiSelections + 1 });
}

let started = false;
export function startMetrics() {
  if (started) return;
  started = true;
  gaze.onSelect((e) => {
    const m = metrics.get();
    const now = Date.now();
    const residuals = e.residualPx !== undefined ? [...m.residuals, e.residualPx].slice(-50) : m.residuals;
    metrics.set({
      selections: m.selections + 1,
      firstSelectAt: m.firstSelectAt ?? now,
      lastSelectAt: now,
      composeStart: m.composeStart ?? now,
      residuals,
    });
  });
  onSpoken((text) => {
    const m = metrics.get();
    const now = Date.now();
    const start = m.composeStart ?? now;
    learn(text);
    metrics.set({
      wordsSpoken: m.wordsSpoken + countWords(text),
      utterances: m.utterances + 1,
      // Floor at one dwell so single-tile replies don't count as 0 ms.
      composeMs: m.composeMs + Math.max(now - start, 900),
      composeStart: null,
    });
  });
}

export function liveWpm(m: Metrics): number {
  return m.composeMs > 0 ? m.wordsSpoken / (m.composeMs / 60000) : 0;
}

export function selectionsPerMinute(m: Metrics): number {
  if (!m.firstSelectAt || !m.lastSelectAt || m.selections < 2) return 0;
  return (m.selections - 1) / Math.max(1 / 60, (m.lastSelectAt - m.firstSelectAt) / 60000);
}

export function costPerConversation(m: Metrics): number {
  // A "conversation" here = one partner utterance answered = one suggestion request on average.
  const paid = m.requests - m.cachedRequests;
  return paid > 0 ? m.costUsd / paid : 0;
}
