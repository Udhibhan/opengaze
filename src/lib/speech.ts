// Speech out (Web Speech API speechSynthesis) and speech in (SpeechRecognition, Chrome).
import { createStore } from './store';
import { settings } from './settings';

// ---------- speech out ----------

export function getVoices(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
}

export function onVoicesChanged(fn: () => void) {
  if (typeof speechSynthesis === 'undefined') return () => {};
  speechSynthesis.addEventListener('voiceschanged', fn);
  return () => speechSynthesis.removeEventListener('voiceschanged', fn);
}

export const speaking = createStore({ active: false, text: '' });
const spokenListeners = new Set<(text: string) => void>();
export function onSpoken(fn: (text: string) => void) {
  spokenListeners.add(fn);
  return () => {
    spokenListeners.delete(fn);
  };
}

export function speak(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return Promise.resolve();
  spokenListeners.forEach((fn) => fn(clean));
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const s = settings.get();
  const v = getVoices().find((x) => x.voiceURI === s.voiceURI);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.rate = s.speechRate;
  return new Promise((resolve) => {
    const done = () => {
      speaking.set({ active: false, text: '' });
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    speaking.set({ active: true, text: clean });
    speechSynthesis.speak(u);
    // Safety net: some engines never fire onend.
    setTimeout(() => speaking.get().active && speaking.get().text === clean && done(), 1500 + clean.length * 120);
  });
}

// ---------- speech in (conversation partner) ----------

type SR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const SRClass: (new () => SR) | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR })
        .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition)
    : undefined;

export const listenSupported = !!SRClass;

export const listening = createStore({ on: false, interim: '', error: '' });

let rec: SR | null = null;
const finalListeners = new Set<(text: string) => void>();
export function onHeard(fn: (text: string) => void) {
  finalListeners.add(fn);
  return () => {
    finalListeners.delete(fn);
  };
}

function startRec() {
  if (!SRClass || rec) return;
  rec = new SRClass();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-GB';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript.trim();
      if (r.isFinal) {
        if (text) finalListeners.forEach((fn) => fn(text));
      } else interim += text + ' ';
    }
    listening.set({ interim: interim.trim() });
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      listening.set({ on: false, error: 'Microphone permission was denied.' });
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      listening.set({ error: `Speech recognition: ${e.error}` });
    }
  };
  rec.onend = () => {
    rec = null;
    // Chrome stops after silence; keep listening while the mic is on and we're not talking.
    if (listening.get().on && !speaking.get().active) setTimeout(startRec, 250);
  };
  try {
    rec.start();
  } catch {
    rec = null;
  }
}

function stopRec() {
  const r = rec;
  rec = null;
  try {
    r?.abort();
  } catch {
    /* ignore */
  }
}

export function setListening(on: boolean) {
  listening.set({ on, interim: '', error: on ? '' : listening.get().error });
  if (on && !speaking.get().active) startRec();
  else stopRec();
}

// Don't transcribe our own synthesised voice: pause recognition while speaking.
speaking.subscribe(() => {
  if (!listening.get().on) return;
  if (speaking.get().active) stopRec();
  else setTimeout(() => listening.get().on && !speaking.get().active && startRec(), 300);
});
