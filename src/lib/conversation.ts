// The conversation transcript lives in memory only and is gone when the tab closes.
import { createStore } from './store';
import type { Turn } from './api';
import { speak } from './speech';

export const conversation = createStore<{ turns: Turn[]; lastPartner: string }>({ turns: [], lastPartner: '' });

export function addPartner(text: string) {
  const t = text.trim();
  if (!t) return;
  const c = conversation.get();
  conversation.set({ turns: [...c.turns, { who: 'partner' as const, text: t }].slice(-40), lastPartner: t });
}

/** Speak on the user's behalf and record it in the transcript. */
export function say(text: string) {
  const t = text.trim();
  if (!t) return;
  const c = conversation.get();
  conversation.set({ turns: [...c.turns, { who: 'me' as const, text: t }].slice(-40) });
  void speak(t);
}
