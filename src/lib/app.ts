import { createStore } from './store';

export type Screen = 'setup' | 'calibrate' | 'talk' | 'keyboard' | 'measure' | 'settings';

export const app = createStore<{ screen: Screen; debug: boolean; calibPoints: 9 | 13 }>({
  screen: 'setup',
  debug: false,
  calibPoints: 9,
});

export const go = (screen: Screen) => app.set({ screen });
