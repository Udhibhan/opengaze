import { useEffect, useState } from 'react';
import { Download, MessageSquare, Play } from 'lucide-react';
import { GazeTarget } from '../components/GazeTarget';
import { TopBar } from '../components/TopBar';
import { gaze, gazeUi } from '../gaze/engine';
import { pxToDeg } from '../gaze/accuracy';
import { median } from '../gaze/stats';
import { useStore } from '../lib/store';
import { costPerConversation, liveWpm, metrics, selectionsPerMinute } from '../lib/metrics';
import { bench, benchSummary, startBench } from '../lib/bench';
import { go } from '../lib/app';
import { settings } from '../lib/settings';
import { serverHealth } from '../lib/api';
import { MODEL_ID, PRICING_USD_PER_MTOK } from '../../config/pricing';

const BASELINE_WPM = { low: 8, high: 10 };

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-3xl border-2 border-line bg-panel p-4">
      <div className="text-base text-muted">{label}</div>
      <div className="text-4xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-base text-muted">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number | null; max: number; tone: string }) {
  return (
    <div className="grid grid-cols-[230px_1fr_90px] items-center gap-3">
      <div className="text-lg">{label}</div>
      <div className="h-8 overflow-hidden rounded-full bg-panel2">
        {value !== null && (
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
        )}
      </div>
      <div className="text-right text-xl font-bold tabular-nums">{value === null ? '—' : value.toFixed(1)}</div>
    </div>
  );
}

export function Measure() {
  const m = useStore(metrics, (s) => s);
  const acc = useStore(gazeUi, (s) => s.accuracy);
  const b = useStore(bench, (s) => s);
  const dist = useStore(settings, (s) => s.viewingDistanceCm);
  const [, tick] = useState(0);
  const [ai, setAi] = useState<{ ai: boolean; model: string } | null>(null);

  useEffect(() => {
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    void serverHealth().then(setAi);
    return () => clearInterval(iv);
  }, []);

  const summary = benchSummary(b.trials);
  const wpm = liveWpm(m);
  const spm = selectionsPerMinute(m);
  const liveErr = m.residuals.length ? median(m.residuals) : null;
  const bias = gaze.biasPx;
  const perReq = costPerConversation(m);
  const price = PRICING_USD_PER_MTOK[MODEL_ID];
  const maxWpm = Math.max(12, summary.keyboard?.wpm ?? 0, summary.ai?.wpm ?? 0, wpm) * 1.1;

  const exportJson = () => {
    const data = {
      app: 'OpenGaze',
      exportedAt: new Date().toISOString(),
      note: 'No camera frames, gaze traces or transcripts are included.',
      selectionMethod: settings.get().selection,
      dwellMs: settings.get().dwellMs,
      accuracy: acc && {
        grade: acc.grade,
        meanPx: +acc.meanPx.toFixed(1),
        p95Px: +acc.p95Px.toFixed(1),
        meanDeg: +acc.meanDeg.toFixed(2),
        p95Deg: +acc.p95Deg.toFixed(2),
        viewingDistanceCm: acc.viewingDistanceCm,
        pxPerCm: +acc.pxPerCm.toFixed(2),
        points: acc.points.map((p) => ({
          x: Math.round(p.tx),
          y: Math.round(p.ty),
          meanPx: +p.meanPx.toFixed(1),
          p95Px: +p.p95Px.toFixed(1),
          n: p.n,
        })),
      },
      liveGazeErrorMedianPx: liveErr && +liveErr.toFixed(1),
      driftBiasPx: bias.map((v) => +v.toFixed(1)),
      session: {
        selections: m.selections,
        selectionsPerMinute: +spm.toFixed(2),
        wordsSpoken: m.wordsSpoken,
        utterances: m.utterances,
        liveWpm: +wpm.toFixed(2),
        aiSelections: m.aiSelections,
      },
      cost: {
        model: MODEL_ID,
        pricingUsdPerMTok: price,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        requests: m.requests,
        cachedRequests: m.cachedRequests,
        sessionUsd: +m.costUsd.toFixed(6),
        perReplyRequestUsd: +perReq.toFixed(6),
      },
      benchmark: {
        phrases: 'MacKenzie & Soukoreff (2003) phrase set, 5 phrases',
        trials: b.trials.map((t) => ({ ...t, ms: Math.round(t.ms), wpm: +t.wpm.toFixed(2) })),
        summary,
        publishedBaselineWpm: BASELINE_WPM,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `opengaze-results-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <TopBar>
        <h1 className="text-3xl font-bold">Measure</h1>
      </TopBar>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <Card
              label="Words per minute (live)"
              value={wpm ? wpm.toFixed(1) : '—'}
              sub={`${m.wordsSpoken} words in ${m.utterances} utterances`}
            />
            <Card label="Selections per minute" value={spm ? spm.toFixed(1) : '—'} sub={`${m.selections} selections`} />
            <Card
              label="Gaze error (validation)"
              value={acc ? `${acc.meanDeg.toFixed(2)}°` : '—'}
              sub={
                acc
                  ? `${acc.meanPx.toFixed(0)} px mean · ${acc.p95Px.toFixed(0)} px p95 · ${acc.grade}`
                  : 'Calibrate to measure'
              }
            />
            <Card
              label="Gaze error (live, at selections)"
              value={liveErr !== null ? `${liveErr.toFixed(0)} px` : '—'}
              sub={
                liveErr !== null && acc
                  ? `${pxToDeg(liveErr, acc.pxPerCm, dist).toFixed(2)}° · drift correction ${Math.hypot(bias[0], bias[1]).toFixed(0)} px`
                  : 'Make some selections by gaze'
              }
            />
            <Card
              label="Session API cost"
              value={`$${m.costUsd.toFixed(4)}`}
              sub={`${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out tokens · ${m.requests} requests (${m.cachedRequests} cached)`}
            />
            <Card
              label="Cost per reply request"
              value={perReq ? `$${perReq.toFixed(5)}` : '$0'}
              sub={`${MODEL_ID}: $${price.input}/$${price.output} per M tokens${ai && !ai.ai ? ' · offline mode = $0' : ''}`}
            />
          </div>

          <section className="rounded-3xl border-2 border-line bg-panel p-5">
            <h2 className="mb-1 text-2xl font-bold">Benchmark: copy 5 phrases</h2>
            <p className="mb-4 text-lg text-muted">
              First with the keyboard only, then again with word prediction and Claude sentence completion. Compared
              with the 8–10 words per minute typically published for eye-gaze AAC users.
            </p>
            <div className="flex flex-col gap-3">
              <Bar label="Keyboard only" value={summary.keyboard?.wpm ?? null} max={maxWpm} tone="bg-muted" />
              <Bar label="With AI suggestions" value={summary.ai?.wpm ?? null} max={maxWpm} tone="bg-amber" />
              <Bar
                label="Typical eye-gaze AAC (published)"
                value={(BASELINE_WPM.low + BASELINE_WPM.high) / 2}
                max={maxWpm}
                tone="bg-line"
              />
              <Bar label="Live conversation (this session)" value={wpm || null} max={maxWpm} tone="bg-ok" />
            </div>
            {summary.keyboard && summary.ai && (
              <p className="mt-4 text-xl">
                AI suggestions changed speed by{' '}
                <b className="text-amber">
                  {(((summary.ai.wpm - summary.keyboard.wpm) / summary.keyboard.wpm) * 100).toFixed(0)}%
                </b>{' '}
                and selections per character from {summary.keyboard.selectionsPerChar.toFixed(2)} to{' '}
                {summary.ai.selectionsPerChar.toFixed(2)}.
              </p>
            )}
            {b.active && (
              <p className="mt-3 text-lg text-amber">
                Benchmark in progress ({b.mode === 'keyboard' ? 'keyboard only' : 'with AI'}).
              </p>
            )}
          </section>
        </div>

        <div className="grid grid-rows-3 gap-4">
          <GazeTarget
            id="bench-start"
            label={b.active ? 'Continue benchmark' : 'Start benchmark'}
            variant="primary"
            onSelect={() => {
              if (!b.active) startBench('keyboard');
              go('keyboard');
            }}
          >
            <span className="flex flex-col items-center gap-2 text-2xl font-bold">
              <Play size={36} aria-hidden /> {b.active ? 'Continue benchmark' : 'Start benchmark'}
            </span>
          </GazeTarget>
          <GazeTarget id="export" label="Export results as JSON" onSelect={exportJson}>
            <span className="flex flex-col items-center gap-2 text-2xl font-bold">
              <Download size={36} aria-hidden /> Export results (JSON)
            </span>
          </GazeTarget>
          <GazeTarget id="measure-back" label="Back to Talk" onSelect={() => go('talk')} variant="quiet">
            <span className="flex flex-col items-center gap-2 text-2xl font-bold">
              <MessageSquare size={36} aria-hidden /> Back to Talk
            </span>
          </GazeTarget>
        </div>
      </div>
    </div>
  );
}
