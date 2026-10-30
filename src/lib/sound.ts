// Tiny Web Audio cues (synthesised, no audio assets): a soft select tick and an attention chime.
import { settings } from './settings';

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export function selectTick() {
  if (!settings.get().sound) return;
  tone(880, 0, 0.09, 0.08);
  tone(1320, 0.04, 0.08, 0.05);
}

/** Three rising, bell-like notes — distinct and attention-getting, but not alarming. */
export function attentionChime(): Promise<void> {
  [660, 880, 1100].forEach((f, i) => {
    tone(f, i * 0.22, 0.6, 0.22, 'triangle');
    tone(f * 2, i * 0.22, 0.4, 0.05);
  });
  return new Promise((r) => setTimeout(r, 900));
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockAudio() {
  ac();
}
