// Client for the local Claude proxy (server/). The browser never sees the API key.
// Every call has a local fallback, so the app always works offline.
import { fallbackReplies } from './phrases';
import { predictWords } from './predict';
import { recordUsage } from './metrics';
import { settings } from './settings';

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface SuggestResult {
  replies: string[];
  source: 'claude' | 'cache' | 'fallback' | 'offline';
  latencyMs: number;
}

export interface Turn {
  who: 'partner' | 'me';
  text: string;
}

const kindOf = (source: string): 'paid' | 'cached' | 'offline' =>
  source === 'claude' ? 'paid' : source === 'cache' ? 'cached' : 'offline';

/** Empty for same-origin (local proxy / Vercel); set VITE_API_BASE when the app runs inside the extension. */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function suggestReplies(partner: string, history: Turn[]): Promise<SuggestResult> {
  const t0 = performance.now();
  const s = settings.get();
  if (!s.useAI) return { replies: fallbackReplies(partner), source: 'offline', latencyMs: 0 };
  try {
    const res = await post<{ replies: string[]; source: SuggestResult['source']; usage?: Usage; model?: string }>(
      '/api/suggest',
      { partner, history: history.slice(-8), name: s.name, aboutMe: s.aboutMe },
      4000,
    );
    if (res.usage) recordUsage(res.model ?? '', res.usage, kindOf(res.source));
    const replies =
      Array.isArray(res.replies) && res.replies.length ? res.replies.slice(0, 6) : fallbackReplies(partner);
    return { replies, source: res.source, latencyMs: performance.now() - t0 };
  } catch {
    return { replies: fallbackReplies(partner), source: 'offline', latencyMs: performance.now() - t0 };
  }
}

export async function completeSentence(
  text: string,
  partner: string,
  history: Turn[],
): Promise<{ completions: string[]; source: string }> {
  const s = settings.get();
  const local = () => {
    const w = predictWords(text, 3);
    return w.map((x) => `${text.replace(/\S*$/, '')}${x}`.trim());
  };
  if (!s.useAI || !text.trim()) return { completions: local(), source: 'offline' };
  try {
    const res = await post<{ completions: string[]; source: string; usage?: Usage; model?: string }>(
      '/api/complete',
      { text, partner, history: history.slice(-6), name: s.name, aboutMe: s.aboutMe },
      4000,
    );
    if (res.usage) recordUsage(res.model ?? '', res.usage, kindOf(res.source));
    return { completions: res.completions?.length ? res.completions.slice(0, 3) : local(), source: res.source };
  } catch {
    return { completions: local(), source: 'offline' };
  }
}

export async function serverHealth(): Promise<{ ok: boolean; ai: boolean; model: string }> {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    return await r.json();
  } catch {
    return { ok: false, ai: false, model: '' };
  }
}
