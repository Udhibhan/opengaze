import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Eye, Hand, Lightbulb, MousePointer2, Ruler, ScanFace, User } from 'lucide-react';
import { gaze, gazeUi } from '../gaze/engine';
import { tracker } from '../gaze/tracker';
import { settings, type SelectionMethod } from '../lib/settings';
import { useStore } from '../lib/store';
import { app, go } from '../lib/app';
import { getVoices, onVoicesChanged, speak } from '../lib/speech';
import { unlockAudio } from '../lib/sound';

interface FaceCheck {
  face: boolean;
  centred: boolean;
  distance: 'ok' | 'far' | 'close' | null;
  bright: number;
}

const METHODS: { id: SelectionMethod; title: string; desc: string; icon: typeof Eye }[] = [
  {
    id: 'dwell',
    title: 'Look and hold (dwell)',
    desc: 'Look at a tile; it is selected after a short hold.',
    icon: Eye,
  },
  {
    id: 'blink',
    title: 'Long blink',
    desc: 'Look at a tile, then close both eyes for about half a second.',
    icon: ScanFace,
  },
  {
    id: 'head',
    title: 'Head pointer',
    desc: 'Point with your nose, dwell to select. For users with head control.',
    icon: User,
  },
  {
    id: 'mouse',
    title: 'Mouse (carer / testing)',
    desc: 'Pointer follows the mouse; dwell still selects.',
    icon: MousePointer2,
  },
];

/** Carer-facing setup: camera, position guide, checks, selection method and personalisation. */
export function Setup() {
  const s = useStore(settings, (x) => x);
  const cameraOn = useStore(gazeUi, (x) => x.cameraOn);
  const calibrated = useStore(gazeUi, (x) => x.calibrated);
  const calibPoints = useStore(app, (x) => x.calibPoints);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(false);
  const [check, setCheck] = useState<FaceCheck>({ face: false, centred: false, distance: null, bright: 128 });
  const [voices, setVoices] = useState(getVoices());
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => onVoicesChanged(() => setVoices(getVoices())), []);

  useEffect(() => {
    if (!cameraOn || !videoRef.current) return;
    videoRef.current.srcObject = tracker.video.srcObject;
    void videoRef.current.play().catch(() => {});
    let last = 0;
    return tracker.on((fr) => {
      if (fr.t - last < 200) return;
      last = fr.t;
      const f = fr.f;
      const ratio = f ? f.eyeDistPx / fr.videoW : 0;
      setCheck({
        face: !!f,
        centred: !!f && Math.abs(f.nose.x - 0.5) < 0.14 && Math.abs(f.nose.y - 0.5) < 0.17,
        distance: f ? (ratio < 0.085 ? 'far' : ratio > 0.3 ? 'close' : 'ok') : null,
        bright: fr.brightness,
      });
    });
  }, [cameraOn]);

  async function start() {
    unlockAudio();
    setStarting(true);
    setErr('');
    try {
      await gaze.startCamera();
    } catch (e) {
      setErr(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow the camera in the address bar and try again.'
          : `Could not start the camera: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setStarting(false);
    }
  }

  const good = check.face && check.centred && check.distance === 'ok';
  const lightOk = check.bright >= 55;

  const Item = ({ ok, label, hint, icon: Icon }: { ok: boolean; label: string; hint: string; icon: typeof Eye }) => (
    <li className="flex items-start gap-3">
      <Icon className={ok ? 'mt-1 shrink-0 text-ok' : 'mt-1 shrink-0 text-amber'} size={26} aria-hidden />
      <div>
        <div className="font-bold">
          {label}: <span className={ok ? 'text-ok' : 'text-amber'}>{ok ? 'Good' : 'Check'}</span>
        </div>
        {!ok && <div className="text-base text-muted">{hint}</div>}
      </div>
    </li>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-5xl font-bold tracking-tight">
              Open<span className="text-amber">Gaze</span>
            </h1>
            <p className="mt-2 max-w-2xl text-xl text-muted">
              Free eye-gaze communication with any webcam. Setup is for the carer; everything after calibration works by
              eye alone.
            </p>
          </div>
          <p className="max-w-xs text-right text-base text-muted">
            Camera frames are processed on this device and never stored or uploaded.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Camera + guide */}
          <section className="rounded-3xl border-2 border-line bg-panel p-5">
            <h2 className="mb-3 flex items-center gap-2 text-2xl font-bold">
              <Camera aria-hidden /> 1. Camera and position
            </h2>
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
              {cameraOn ? (
                <>
                  <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
                  <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" aria-hidden>
                    <ellipse
                      cx="200"
                      cy="150"
                      rx="78"
                      ry="104"
                      fill="none"
                      strokeWidth="5"
                      strokeDasharray={good ? '0' : '12 10'}
                      stroke={good ? 'rgb(var(--ok))' : 'rgb(var(--amber))'}
                    />
                  </svg>
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-lg text-white">
                    {good
                      ? 'Great — hold this position.'
                      : 'Place your face inside the oval, about an arm’s length away.'}
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                  <p className="text-xl text-white/90">We need the camera to follow your eyes.</p>
                  <button
                    onClick={start}
                    disabled={starting}
                    className="rounded-2xl bg-amber px-8 py-4 text-2xl font-bold text-[#1b1200] disabled:opacity-60"
                  >
                    {starting ? 'Starting…' : 'Turn on camera'}
                  </button>
                  {err && <p className="text-lg text-danger">{err}</p>}
                </div>
              )}
            </div>
            {cameraOn && (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                <Item ok={check.face} label="Face" hint="Make sure your whole face is visible." icon={ScanFace} />
                <Item
                  ok={check.centred}
                  label="Centred"
                  hint="Move so your face is in the middle of the oval."
                  icon={CheckCircle2}
                />
                <Item
                  ok={check.distance === 'ok'}
                  label="Distance"
                  hint={check.distance === 'close' ? 'Move a little further away.' : 'Move a little closer.'}
                  icon={Ruler}
                />
                <Item
                  ok={lightOk}
                  label="Lighting"
                  hint="Add light in front of you; avoid a bright window behind."
                  icon={Lightbulb}
                />
              </ul>
            )}
          </section>

          {/* Method + personalisation */}
          <section className="flex flex-col gap-6">
            <div className="rounded-3xl border-2 border-line bg-panel p-5">
              <h2 className="mb-3 flex items-center gap-2 text-2xl font-bold">
                <Hand aria-hidden /> 2. How to select
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => settings.set({ selection: m.id })}
                    aria-pressed={s.selection === m.id}
                    className={`rounded-2xl border-2 p-4 text-left ${
                      s.selection === m.id ? 'border-amber bg-amber/15' : 'border-line bg-panel2/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-lg font-bold">
                      <m.icon size={22} aria-hidden /> {m.title}
                    </div>
                    <div className="mt-1 text-base text-muted">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border-2 border-line bg-panel p-5">
              <h2 className="mb-3 text-2xl font-bold">3. About the user</h2>
              <label className="mb-3 block">
                <span className="text-base text-muted">Name</span>
                <input
                  value={s.name}
                  onChange={(e) => settings.set({ name: e.target.value })}
                  className="mt-1 w-full rounded-xl border-2 border-line bg-bg px-4 py-2 text-xl"
                  placeholder="e.g. Sam"
                />
              </label>
              <label className="mb-3 block">
                <span className="text-base text-muted">Voice</span>
                <div className="mt-1 flex gap-2">
                  <select
                    value={s.voiceURI}
                    onChange={(e) => settings.set({ voiceURI: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border-2 border-line bg-bg px-3 py-2 text-lg"
                  >
                    <option value="">System default</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => speak(`Hello${s.name ? `, I'm ${s.name}` : ''}. This is my voice.`)}
                    className="rounded-xl border-2 border-line px-4 text-lg font-bold"
                  >
                    Test
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="text-base text-muted">
                  About me (optional, used to personalise suggested replies; stays on this device except when sent to
                  the reply service)
                </span>
                <textarea
                  value={s.aboutMe}
                  onChange={(e) => settings.set({ aboutMe: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-xl border-2 border-line bg-bg px-4 py-2 text-lg"
                  placeholder="e.g. Retired teacher, loves cricket and gardening, has a daughter called Priya, prefers tea."
                />
              </label>
            </div>
          </section>
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-end gap-4">
          {s.selection !== 'mouse' && s.selection !== 'head' && (
            <div className="flex items-center gap-2 text-lg">
              <span className="text-muted">Calibration points:</span>
              {([9, 13] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => app.set({ calibPoints: n })}
                  aria-pressed={calibPoints === n}
                  className={`rounded-xl border-2 px-4 py-2 font-bold ${calibPoints === n ? 'border-amber bg-amber/15' : 'border-line'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {calibrated && (
            <button onClick={() => go('talk')} className="rounded-2xl border-2 border-line px-6 py-4 text-xl font-bold">
              Keep current calibration
            </button>
          )}
          {s.selection === 'mouse' || s.selection === 'head' ? (
            <button
              onClick={() => {
                unlockAudio();
                if (s.selection === 'head') gaze.recentreHead();
                go('talk');
              }}
              disabled={s.selection === 'head' && !cameraOn}
              className="rounded-2xl bg-amber px-8 py-4 text-2xl font-bold text-[#1b1200] disabled:opacity-50"
            >
              Start talking
            </button>
          ) : (
            <button
              onClick={() => {
                unlockAudio();
                go('calibrate');
              }}
              disabled={!cameraOn}
              className="rounded-2xl bg-amber px-8 py-4 text-2xl font-bold text-[#1b1200] disabled:opacity-50"
            >
              Start calibration
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
