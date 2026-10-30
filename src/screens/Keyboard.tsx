import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Delete, Eraser, MessageSquare, Sparkles, Volume2, X } from 'lucide-react';
import { GazeTarget } from '../components/GazeTarget';
import { PauseTile } from '../components/TopBar';
import { CameraPreview } from '../components/CameraPreview';
import { settings } from '../lib/settings';
import { StatusPill } from '../components/StatusPill';
import { gazeUi } from '../gaze/engine';
import { applyWord, predictWords } from '../lib/predict';
import { completeSentence } from '../lib/api';
import { conversation, say } from '../lib/conversation';
import { go } from '../lib/app';
import { useLayout } from '../lib/layout';
import { useStore } from '../lib/store';
import { bench, benchCheck, benchSelection, BENCH_PHRASES, stopBench } from '../lib/bench';
import { markAiSelection } from '../lib/metrics';

// Letters ordered by English letter frequency so the most-used keys sit together at the top-left,
// next to the composed text and predictions (shorter eye travel).
const KEYS = 'etaoinshrdlucmwfgypbvkjxqz'.split('').concat(["'", '.', '?', ',']);

function deleteWord(t: string): string {
  const trimmed = t.trimEnd();
  const i = trimmed.lastIndexOf(' ');
  return i < 0 ? '' : trimmed.slice(0, i + 1);
}

export function Keyboard() {
  const layout = useLayout();
  const paused = useStore(gazeUi, (s) => s.paused);
  const showCamera = useStore(settings, (s) => s.showCamera);
  const b = useStore(bench, (s) => s);
  const [text, setText] = useState('');
  const [completions, setCompletions] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  const aiAllowed = !b.active || b.mode === 'ai';
  const predictions = aiAllowed ? predictWords(text, 4) : [];

  // Benchmark finished: show the results.
  const wasActive = useRef(b.active);
  useEffect(() => {
    if (wasActive.current && !b.active && b.finishedAt) go('measure');
    wasActive.current = b.active;
  }, [b.active, b.finishedAt]);

  // Benchmark: detect phrase completion.
  useEffect(() => {
    if (b.active && benchCheck(text)) {
      say(text);
      setText('');
      setCompletions(null);
    }
  }, [text, b.active]);

  const edit = (fn: (t: string) => string) => {
    benchSelection();
    setText((t) => fn(t));
  };

  const speakNow = () => {
    benchSelection();
    if (!textRef.current.trim()) return;
    say(textRef.current);
    setText('');
    setCompletions(null);
  };

  const finish = async () => {
    benchSelection();
    setThinking(true);
    const c = conversation.get();
    const r = await completeSentence(textRef.current, c.lastPartner, c.turns);
    setThinking(false);
    setCompletions(r.completions.length ? r.completions : []);
  };

  const rowsNeeded = Math.ceil(KEYS.length / layout.keyCols);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Composed text + pause */}
      <div className="flex items-stretch gap-3">
        <div className="relative flex min-w-0 flex-1 flex-col justify-center rounded-3xl border-2 border-line bg-panel px-6 py-2">
          <div className="flex items-center justify-between gap-3">
            <StatusPill />
            {b.active && (
              <div className="truncate text-lg">
                <span className="text-muted">
                  Benchmark ({b.mode === 'keyboard' ? 'keyboard only' : 'with AI'}) {b.idx + 1}/{BENCH_PHRASES.length}:
                </span>{' '}
                <b className="text-amber">{BENCH_PHRASES[b.idx]}</b>
              </div>
            )}
          </div>
          <div className="mt-1 min-h-[3rem] break-words text-[2.6rem] font-bold leading-tight" aria-live="polite">
            {text}
            <span
              className="ml-0.5 inline-block h-[0.9em] w-[3px] translate-y-[0.1em] animate-pulse bg-amber"
              aria-hidden
            />
          </div>
        </div>
        {showCamera && <CameraPreview width={190} />}
        <PauseTile paused={paused} />
      </div>

      {/* Predictions / completions row */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', height: 120 }}>
        {completions ? (
          <>
            {completions.length === 0 ? (
              <div className="col-span-4 flex items-center justify-center text-xl text-muted">
                No completions available right now.
              </div>
            ) : (
              [0, 1, 2, 3].map((i) =>
                i < 3 && completions[i] ? (
                  <GazeTarget
                    key={`comp-${i}`}
                    id={`comp-${i}`}
                    label={completions[i]}
                    variant="primary"
                    onSelect={() => {
                      benchSelection();
                      markAiSelection();
                      const c = completions[i];
                      setText(c.endsWith(' ') ? c : `${c} `);
                      setCompletions(null);
                    }}
                  >
                    <span className="px-2 text-center text-lg font-bold leading-tight">{completions[i]}</span>
                  </GazeTarget>
                ) : (
                  <div key={`comp-${i}`} />
                ),
              )
            )}
            <GazeTarget
              id="comp-close"
              label="Back to word predictions"
              onSelect={() => setCompletions(null)}
              variant="quiet"
              className="col-start-5"
            >
              <span className="flex flex-col items-center gap-1 text-lg font-bold">
                <X size={26} aria-hidden /> Back to words
              </span>
            </GazeTarget>
          </>
        ) : (
          <>
            {Array.from({ length: 4 }).map((_, i) =>
              predictions[i] ? (
                <GazeTarget
                  key={`pred-${i}`}
                  id={`pred-${i}`}
                  label={predictions[i]}
                  onSelect={() => edit((t) => applyWord(t, predictions[i]))}
                >
                  <span className="text-2xl font-bold">{predictions[i]}</span>
                </GazeTarget>
              ) : (
                <div key={`pred-${i}`} className="rounded-3xl border-2 border-dashed border-line/50" />
              ),
            )}
            {aiAllowed ? (
              <GazeTarget
                id="finish"
                label="Finish my sentence"
                onSelect={finish}
                variant="primary"
                disabled={thinking || !text.trim()}
              >
                <span className="flex flex-col items-center gap-1 text-lg font-bold">
                  <Sparkles size={26} aria-hidden /> {thinking ? 'Thinking…' : 'Finish my sentence'}
                </span>
              </GazeTarget>
            ) : (
              <div className="flex items-center justify-center rounded-3xl border-2 border-dashed border-line/50 px-3 text-center text-base text-muted">
                Predictions off for this benchmark round
              </div>
            )}
          </>
        )}
      </div>

      {/* Letters + actions */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div
          className="grid min-h-0 flex-1 gap-2"
          style={{
            gridTemplateColumns: `repeat(${layout.keyCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rowsNeeded}, minmax(0, 1fr))`,
          }}
        >
          {KEYS.map((k) => (
            <GazeTarget
              key={k}
              id={`key-${k}`}
              repeatable
              label={k === "'" ? 'apostrophe' : k}
              onSelect={() => edit((t) => t + k)}
            >
              <span className="text-[2.4rem] font-bold uppercase">{k}</span>
            </GazeTarget>
          ))}
        </div>
        <div
          className="grid w-[330px] shrink-0 grid-cols-2 gap-2"
          style={{ gridTemplateRows: 'repeat(3, minmax(0, 1fr))' }}
        >
          <GazeTarget id="kb-speak" label="Speak" variant="primary" onSelect={speakNow} disabled={!text.trim()}>
            <span className="flex flex-col items-center gap-1 text-xl font-bold">
              <Volume2 size={30} aria-hidden /> Speak
            </span>
          </GazeTarget>
          <GazeTarget id="kb-space" label="Space" onSelect={() => edit((t) => (t && !t.endsWith(' ') ? `${t} ` : t))}>
            <span className="text-xl font-bold">Space</span>
          </GazeTarget>
          <GazeTarget
            id="kb-del"
            repeatable
            label="Delete letter"
            onSelect={() => edit((t) => t.slice(0, -1))}
            disabled={!text}
          >
            <span className="flex flex-col items-center gap-1 text-lg font-bold">
              <Delete size={28} aria-hidden /> Letter
            </span>
          </GazeTarget>
          <GazeTarget id="kb-delword" repeatable label="Delete word" onSelect={() => edit(deleteWord)} disabled={!text}>
            <span className="flex flex-col items-center gap-1 text-lg font-bold">
              <Delete size={28} aria-hidden /> Word
            </span>
          </GazeTarget>
          <GazeTarget id="kb-clear" label="Clear" onSelect={() => edit(() => '')} disabled={!text}>
            <span className="flex flex-col items-center gap-1 text-lg font-bold">
              <Eraser size={28} aria-hidden /> Clear
            </span>
          </GazeTarget>
          <GazeTarget
            id="kb-back"
            label={b.active ? 'Stop benchmark' : 'Back to Talk'}
            onSelect={() => {
              if (b.active) {
                stopBench();
                go('measure');
              } else go('talk');
            }}
            variant="quiet"
          >
            <span className="flex flex-col items-center gap-1 text-lg font-bold">
              {b.active ? <ArrowLeft size={28} aria-hidden /> : <MessageSquare size={28} aria-hidden />}
              {b.active ? 'Stop test' : 'Talk'}
            </span>
          </GazeTarget>
        </div>
      </div>
    </div>
  );
}
