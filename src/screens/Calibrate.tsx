import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { gaze, gazeUi } from '../gaze/engine';
import { buildReport, pxPerCm, pxToDeg, type AccuracyReport } from '../gaze/accuracy';
import {
  calibrationPoints,
  collect,
  fitCalibration,
  validationSamples,
  VALIDATION_POINTS,
  type CalibrationResult,
  type Sample,
} from '../gaze/calibration';
import { app, go } from '../lib/app';
import { settings } from '../lib/settings';
import { useStore } from '../lib/store';
import { GazeTarget } from '../components/GazeTarget';
import { Stepper } from '../components/Stepper';
import { selectTick } from '../lib/sound';
import { CameraPreview } from '../components/CameraPreview';

type Phase = 'countdown' | 'calibrate' | 'fitting' | 'validate' | 'result' | 'failed';

const FRAMES_PER_POINT = 25;
const FRAMES_PER_VALIDATION = 20;

export function Calibrate() {
  const nPoints = useStore(app, (s) => s.calibPoints);
  const viewingDistanceCm = useStore(settings, (s) => s.viewingDistanceCm);
  const diag = useStore(settings, (s) => s.screenDiagonalIn);
  const [phase, setPhase] = useState<Phase>('countdown');
  const [count, setCount] = useState(3);
  const [idx, setIdx] = useState(0);
  const [pt, setPt] = useState<[number, number]>([window.innerWidth / 2, window.innerHeight / 2]);
  const [frames, setFrames] = useState(0);
  const [faceOk, setFaceOk] = useState(true);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [valRaw, setValRaw] = useState<{ tx: number; ty: number; px: number; py: number }[][]>([]);
  const [runId, setRunId] = useState(0);

  const total = phase === 'validate' ? VALIDATION_POINTS.length : nPoints;

  // Main sequence.
  useEffect(() => {
    const signal = { cancelled: false };
    gaze.calibrating = true; // hide cursor + disable selection during the run
    const W = window.innerWidth;
    const H = window.innerHeight;

    async function run() {
      setPhase('countdown');
      for (let c = 5; c > 0; c--) {
        setCount(c);
        await new Promise((r) => setTimeout(r, 800));
        if (signal.cancelled) return;
      }
      // ---- calibration ----
      setPhase('calibrate');
      const pts = calibrationPoints(nPoints);
      const perPoint: { x: number; y: number; samples: Sample[] }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0] * W;
        const y = pts[i][1] * H;
        setIdx(i);
        setPt([x, y]);
        setFrames(0);
        const samples = await collect(performance.now(), FRAMES_PER_POINT, signal, (n, ok) => {
          setFrames(n);
          setFaceOk(ok);
        });
        if (signal.cancelled) return;
        selectTick();
        perPoint.push({ x, y, samples });
      }
      setPhase('fitting');
      await new Promise((r) => setTimeout(r, 50));
      const res = fitCalibration(perPoint);
      if (!res) {
        setPhase('failed');
        return;
      }
      setResult(res);
      gaze.setCalibration(res.model, res.headRef, null);

      // ---- validation ----
      setPhase('validate');
      const val: { tx: number; ty: number; px: number; py: number }[][] = [];
      for (let i = 0; i < VALIDATION_POINTS.length; i++) {
        const x = VALIDATION_POINTS[i][0] * W;
        const y = VALIDATION_POINTS[i][1] * H;
        setIdx(i);
        setPt([x, y]);
        setFrames(0);
        const samples = await collect(performance.now(), FRAMES_PER_VALIDATION, signal, (n, ok) => {
          setFrames(n);
          setFaceOk(ok);
        });
        if (signal.cancelled) return;
        selectTick();
        val.push(validationSamples(res.model, x, y, samples));
      }
      setValRaw(val);
      setPhase('result');
      gaze.calibrating = false;
    }
    void run();
    return () => {
      signal.cancelled = true;
      gaze.calibrating = false;
    };
  }, [nPoints, runId]);

  const ppcm = pxPerCm(window.screen.width, window.screen.height, diag);
  const report: AccuracyReport | null = useMemo(
    () => (valRaw.length ? buildReport(valRaw, viewingDistanceCm, ppcm) : null),
    [valRaw, viewingDistanceCm, ppcm],
  );

  useEffect(() => {
    if (report) gaze.setAccuracy(report);
  }, [report]);

  if (phase === 'result' && report) {
    return <Result report={report} result={result} onRecalibrate={() => setRunId((r) => r + 1)} />;
  }

  if (phase === 'failed') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <h1 className="text-4xl font-bold">We couldn’t see your eyes clearly enough</h1>
        <p className="max-w-2xl text-xl text-muted">
          Check that your face is well lit from the front, inside the camera view, and about an arm’s length away.
        </p>
        <div className="flex gap-4">
          <button
            className="rounded-2xl bg-amber px-8 py-4 text-2xl font-bold text-[#1b1200]"
            onClick={() => setRunId((r) => r + 1)}
          >
            Try again
          </button>
          <button className="rounded-2xl border-2 border-line px-8 py-4 text-2xl font-bold" onClick={() => go('setup')}>
            Back to setup
          </button>
        </div>
      </div>
    );
  }

  const progress =
    phase === 'calibrate' || phase === 'validate'
      ? Math.min(1, frames / (phase === 'validate' ? FRAMES_PER_VALIDATION : FRAMES_PER_POINT))
      : 0;

  return (
    <div className="relative h-full cursor-none bg-bg">
      <div className="pointer-events-none absolute inset-x-0 top-6 text-center">
        <div className="text-2xl font-bold">
          {phase === 'countdown' && 'Get comfortable, then follow the dot with your eyes'}
          {phase === 'calibrate' && `Look at the centre of the dot · ${idx + 1} of ${total}`}
          {phase === 'fitting' && 'Fitting your personal gaze model…'}
          {phase === 'validate' && `Checking accuracy · ${idx + 1} of ${total}`}
        </div>
        <div className="mt-1 text-lg text-muted">
          {faceOk
            ? 'Keep your head still and just move your eyes.'
            : 'I can’t see your face — please move back into view.'}
        </div>
      </div>

      {phase === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            key={count}
            initial={{ scale: 1.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-9xl font-bold text-amber"
          >
            {count}
          </motion.div>
          <div className="absolute bottom-10">
            <CameraPreview width={360} showHint centre />
          </div>
        </div>
      )}

      {(phase === 'calibrate' || phase === 'validate') && (
        <motion.div
          className="pointer-events-none absolute left-0 top-0"
          animate={{ x: pt[0], y: pt[1] }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        >
          <motion.div
            key={`${phase}-${idx}`}
            initial={{ scale: 1 }}
            animate={{ scale: 0.32 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute -left-[36px] -top-[36px] h-[72px] w-[72px] rounded-full border-4 border-amber"
            style={{ boxShadow: '0 0 30px rgb(var(--amber) / 0.5)' }}
          />
          <div
            className={`absolute -left-[7px] -top-[7px] h-[14px] w-[14px] rounded-full ${phase === 'validate' ? 'bg-ok' : 'bg-amber'}`}
          />
          <svg className="absolute -left-[30px] -top-[30px]" width="60" height="60" aria-hidden>
            <circle cx="30" cy="30" r="26" fill="none" stroke="rgb(var(--ink) / 0.25)" strokeWidth="3" />
            <circle
              cx="30"
              cy="30"
              r="26"
              fill="none"
              stroke="rgb(var(--ink))"
              strokeWidth="3"
              pathLength={100}
              strokeDasharray={`${progress * 100} 100`}
              transform="rotate(-90 30 30)"
            />
          </svg>
        </motion.div>
      )}
    </div>
  );
}

function errColour(px: number, p95: number) {
  const r = Math.min(1, px / Math.max(1, p95 * 1.2));
  return r < 0.4 ? 'rgb(var(--ok))' : r < 0.75 ? 'rgb(var(--amber))' : 'rgb(var(--danger))';
}

function Result({
  report,
  result,
  onRecalibrate,
}: {
  report: AccuracyReport;
  result: CalibrationResult | null;
  onRecalibrate: () => void;
}) {
  const distance = useStore(settings, (s) => s.viewingDistanceCm);
  const diag = useStore(settings, (s) => s.screenDiagonalIn);
  const accuracy = useStore(gazeUi, (s) => s.accuracy);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const mapW = 420;
  const mapH = (mapW * H) / W;
  const k = mapW / W;
  const grade = report.grade;
  const gradeTone =
    grade === 'Excellent' || grade === 'Good' ? 'text-ok' : grade === 'Fair' ? 'text-amber' : 'text-danger';
  const p95Deg = pxToDeg(report.p95Px, report.pxPerCm, distance);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1fr_auto]">
        <section>
          <p className="text-xl text-muted">Calibration accuracy</p>
          <h1 className={`text-7xl font-bold ${gradeTone}`}>{grade}</h1>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-xl">
            <div className="rounded-2xl border-2 border-line bg-panel p-4">
              <dt className="text-muted">Mean error</dt>
              <dd className="text-3xl font-bold">
                {report.meanPx.toFixed(0)} px · {report.meanDeg.toFixed(2)}°
              </dd>
            </div>
            <div className="rounded-2xl border-2 border-line bg-panel p-4">
              <dt className="text-muted">95th percentile</dt>
              <dd className="text-3xl font-bold">
                {report.p95Px.toFixed(0)} px · {p95Deg.toFixed(2)}°
              </dd>
            </div>
            <div className="rounded-2xl border-2 border-line bg-panel p-4">
              <dt className="text-muted">Frames used</dt>
              <dd className="text-2xl font-bold">
                {result ? `${result.kept} of ${result.total}` : '—'}
                <span className="ml-2 text-base font-normal text-muted">(outliers removed)</span>
              </dd>
            </div>
            <div className="rounded-2xl border-2 border-line bg-panel p-4">
              <dt className="text-muted">Model regularisation</dt>
              <dd className="text-2xl font-bold">λ = {result?.fit.lambda ?? '—'}</dd>
            </div>
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stepper
              id="cal-dist"
              label="Viewing distance"
              value={distance}
              unit="cm"
              step={5}
              min={30}
              max={120}
              onChange={(v) => settings.set({ viewingDistanceCm: v })}
            />
            <Stepper
              id="cal-diag"
              label="Screen size"
              value={diag}
              unit="in"
              step={1}
              min={10}
              max={34}
              onChange={(v) => settings.set({ screenDiagonalIn: v })}
            />
          </div>
          <p className="mt-3 text-base text-muted">
            Degrees assume the viewing distance and screen size above. Infrared trackers typically reach about 0.5°; a
            webcam typically reaches 1.5–4°. Target sizes on every screen are now tuned to your measured 95th-percentile
            error{accuracy ? ` (${accuracy.p95Px.toFixed(0)} px)` : ''}.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-lg text-muted">Error at each validation point</p>
            <svg
              width={mapW}
              height={mapH}
              className="rounded-2xl border-2 border-line bg-panel"
              role="img"
              aria-label="Accuracy heatmap"
            >
              {report.points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.tx * k}
                    cy={p.ty * k}
                    r={Math.max(6, p.p95Px * k)}
                    fill={errColour(p.meanPx, report.p95Px)}
                    opacity={0.22}
                  />
                  <circle
                    cx={p.tx * k}
                    cy={p.ty * k}
                    r={Math.max(4, p.meanPx * k)}
                    fill={errColour(p.meanPx, report.p95Px)}
                    opacity={0.5}
                  />
                  <line
                    x1={p.tx * k}
                    y1={p.ty * k}
                    x2={p.mx * k}
                    y2={p.my * k}
                    stroke="rgb(var(--ink))"
                    strokeWidth={2}
                  />
                  <circle cx={p.mx * k} cy={p.my * k} r={3.5} fill="rgb(var(--ink))" />
                  <path
                    d={`M${p.tx * k - 6},${p.ty * k}h12M${p.tx * k},${p.ty * k - 6}v12`}
                    stroke="rgb(var(--ink))"
                    strokeWidth={2}
                  />
                  <text x={p.tx * k + 10} y={p.ty * k - 10} fill="rgb(var(--ink))" fontSize="13">
                    {p.meanPx.toFixed(0)}px
                  </text>
                </g>
              ))}
            </svg>
            <p className="mt-1 text-sm text-muted">
              + target · ● mean gaze · inner disc mean error · outer disc 95th percentile
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <GazeTarget
              id="cal-recal"
              label="Recalibrate"
              onSelect={onRecalibrate}
              className="h-[130px] text-2xl"
              variant={grade === 'Recalibrate' ? 'primary' : 'default'}
            />
            <GazeTarget
              id="cal-continue"
              label="Start talking"
              onSelect={() => go('talk')}
              className="h-[130px] text-2xl"
              variant={grade === 'Recalibrate' ? 'default' : 'primary'}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
