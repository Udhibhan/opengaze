import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Bell,
  Keyboard as KeyboardIcon,
  Mic,
  MicOff,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { GazeTarget } from '../components/GazeTarget';
import { TopBar } from '../components/TopBar';
import { gazeUi } from '../gaze/engine';
import { suggestReplies, type SuggestResult } from '../lib/api';
import { addPartner, conversation, say } from '../lib/conversation';
import { go } from '../lib/app';
import { useLayout } from '../lib/layout';
import { listening, listenSupported, onHeard, setListening } from '../lib/speech';
import { useStore } from '../lib/store';
import { QUICK_PHRASES } from '../lib/phrases';
import { attentionChime } from '../lib/sound';
import { markAiSelection } from '../lib/metrics';
import { settings } from '../lib/settings';

const LOCK_MS = 2000;

export function Talk() {
  const layout = useLayout();
  const lastPartner = useStore(conversation, (s) => s.lastPartner);
  const mic = useStore(listening, (s) => s);
  const reduced = useStore(settings, (s) => s.reducedMotion);
  const [shown, setShown] = useState<SuggestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState('');
  const pending = useRef<SuggestResult | null>(null);
  const lastReplyGaze = useRef(0);
  const reqId = useRef(0);

  // Suggestion tiles never change under the user's gaze: hold new ones until the user has
  // looked away from the reply tiles for 2 s (or has just selected one).
  const offer = useCallback((r: SuggestResult) => {
    const hovered = gazeUi.get().hovered;
    if ((hovered && hovered.startsWith('reply-')) || performance.now() - lastReplyGaze.current < LOCK_MS)
      pending.current = r;
    else setShown(r);
  }, []);

  useEffect(
    () =>
      gazeUi.subscribe(() => {
        const h = gazeUi.get().hovered;
        if (h && h.startsWith('reply-')) lastReplyGaze.current = performance.now();
      }),
    [],
  );
  useEffect(() => {
    const iv = setInterval(() => {
      if (!pending.current) return;
      const h = gazeUi.get().hovered;
      if (!(h && h.startsWith('reply-')) && performance.now() - lastReplyGaze.current >= LOCK_MS) {
        setShown(pending.current);
        pending.current = null;
      }
    }, 250);
    return () => clearInterval(iv);
  }, []);

  const request = useCallback(
    async (partner: string) => {
      const id = ++reqId.current;
      setLoading(true);
      const r = await suggestReplies(partner, conversation.get().turns);
      if (id !== reqId.current) return;
      setLoading(false);
      offer(r);
    },
    [offer],
  );

  // Initial suggestions (openers, or replies to the last thing said before navigating here).
  useEffect(() => {
    void request(conversation.get().lastPartner);
  }, [request]);

  useEffect(
    () =>
      onHeard((text) => {
        addPartner(text);
        void request(text);
      }),
    [request],
  );

  const speakReply = (text: string) => {
    if (shown?.source === 'claude' || shown?.source === 'cache') markAiSelection();
    say(text);
    // After a selection the lock is released immediately.
    lastReplyGaze.current = 0;
    if (pending.current) {
      setShown(pending.current);
      pending.current = null;
    }
  };

  const replies = shown?.replies ?? [];
  const sourceLabel =
    shown?.source === 'claude' || shown?.source === 'cache'
      ? 'Suggested by Claude'
      : shown
        ? 'Offline suggestions'
        : '';

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <TopBar>
        <div className="truncate text-lg text-muted">{layout.tuned && 'Target size tuned to your accuracy.'}</div>
      </TopBar>

      {/* Partner transcript */}
      <section className="flex items-stretch gap-4">
        <div
          className="flex min-w-0 flex-1 flex-col justify-center rounded-3xl border-2 border-line bg-panel px-6 py-3"
          aria-live="polite"
        >
          <div className="text-base text-muted">They said</div>
          <div className="truncate text-3xl font-bold">
            {mic.interim ? (
              <span className="text-muted">{mic.interim}…</span>
            ) : (
              lastPartner || <span className="text-muted">Nothing yet</span>
            )}
          </div>
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim()) return;
              addPartner(typed);
              void request(typed);
              setTyped('');
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Carer: type what the partner said and press Enter"
              className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-1 text-base"
              aria-label="Type what the conversation partner said"
            />
          </form>
        </div>
        {listenSupported && (
          <GazeTarget
            id="mic"
            label={mic.on ? 'Stop listening' : 'Listen to partner'}
            onSelect={() => setListening(!mic.on)}
            variant={mic.on ? 'primary' : 'default'}
            className="w-[190px] shrink-0"
            style={{ minHeight: 120 }}
          >
            <span className="flex flex-col items-center gap-1 px-2 text-center text-lg font-bold">
              {mic.on ? <Mic size={32} className="text-amber" aria-hidden /> : <MicOff size={32} aria-hidden />}
              {mic.on ? 'Listening' : 'Mic off'}
              <span className="text-xs font-normal text-muted">Chrome may send audio to Google to transcribe</span>
            </span>
          </GazeTarget>
        )}
      </section>
      {mic.error && <div className="text-lg text-danger">{mic.error}</div>}

      {/* Replies + side column */}
      <section className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2 text-base text-muted">
            <Sparkles size={18} aria-hidden /> {loading ? 'Thinking of replies…' : sourceLabel}
          </div>
          <div
            className="grid min-h-0 flex-1 gap-4"
            style={{
              gridTemplateColumns: `repeat(${layout.replyCols}, minmax(0, 1fr))`,
              gridAutoRows: 'minmax(120px, 1fr)',
            }}
          >
            {replies.map((r, i) => (
              <motion.div
                key={`${r}-${i}`}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: reduced ? 0 : i * 0.04 }}
                className="flex"
              >
                <GazeTarget id={`reply-${i}`} label={r} onSelect={() => speakReply(r)} className="w-full">
                  <span className="px-4 text-center text-[1.7rem] font-bold leading-tight">{r}</span>
                </GazeTarget>
              </motion.div>
            ))}
            <GazeTarget
              id="reply-more"
              label="Different replies"
              onSelect={() => void request(lastPartner)}
              variant="quiet"
            >
              <span className="flex flex-col items-center gap-2 text-xl font-bold text-muted">
                <RefreshCw size={30} aria-hidden /> Different replies
              </span>
            </GazeTarget>
          </div>
        </div>

        <nav className="flex w-[210px] shrink-0 flex-col gap-4" aria-label="Main">
          <GazeTarget
            id="help"
            label="Help"
            variant="danger"
            onSelect={async () => {
              await attentionChime();
              say('I need help.');
            }}
            className="flex-1"
            style={{ minHeight: 120 }}
          >
            <span className="flex flex-col items-center gap-1 text-2xl font-bold">
              <Bell size={36} aria-hidden /> Help
            </span>
          </GazeTarget>
          <GazeTarget
            id="nav-keyboard"
            label="Keyboard"
            onSelect={() => go('keyboard')}
            className="flex-1"
            style={{ minHeight: 120 }}
          >
            <span className="flex flex-col items-center gap-1 text-xl font-bold">
              <KeyboardIcon size={32} aria-hidden /> Keyboard
            </span>
          </GazeTarget>
          <GazeTarget
            id="nav-measure"
            label="Measure"
            onSelect={() => go('measure')}
            className="flex-1"
            style={{ minHeight: 120 }}
          >
            <span className="flex flex-col items-center gap-1 text-xl font-bold">
              <BarChart3 size={32} aria-hidden /> Measure
            </span>
          </GazeTarget>
          <GazeTarget
            id="nav-settings"
            label="Settings"
            onSelect={() => go('settings')}
            className="flex-1"
            style={{ minHeight: 120 }}
          >
            <span className="flex flex-col items-center gap-1 text-xl font-bold">
              <SettingsIcon size={32} aria-hidden /> Settings
            </span>
          </GazeTarget>
        </nav>
      </section>

      {/* Quick phrases */}
      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${QUICK_PHRASES.length}, minmax(0, 1fr))` }}
        aria-label="Quick phrases"
      >
        {QUICK_PHRASES.map((p) => (
          <GazeTarget
            key={p}
            id={`quick-${p}`}
            label={p}
            onSelect={() => say(p)}
            variant={p.startsWith("I'm in pain") || p.startsWith('Please call') ? 'danger' : 'default'}
            style={{ height: Math.max(120, Math.min(layout.minTile, 150)) }}
          >
            <span className="px-2 text-center text-2xl font-bold leading-tight">{p}</span>
          </GazeTarget>
        ))}
      </section>
    </div>
  );
}
