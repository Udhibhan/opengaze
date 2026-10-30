import { useEffect, useRef, useState } from 'react';
import { tracker } from '../gaze/tracker';
import { gaze, gazeUi } from '../gaze/engine';
import { useStore } from '../lib/store';

export interface FaceGuide {
  face: boolean;
  nose: { x: number; y: number } | null; // normalised camera coords (unmirrored)
  distance: 'ok' | 'far' | 'close' | null;
  centred: boolean;
  hint: string;
}

/** Live face-position check, shared by the setup screen and the in-app camera preview. Updates ~10x/s. */
export function useFaceGuide(centre = false): FaceGuide {
  const [g, setG] = useState<FaceGuide>({ face: false, nose: null, distance: null, centred: false, hint: '' });
  useEffect(() => {
    let last = 0;
    return tracker.on((fr) => {
      if (fr.t - last < 100) return;
      last = fr.t;
      const f = fr.f;
      if (!f) {
        setG({ face: false, nose: null, distance: null, centred: false, hint: 'Move into the camera view' });
        return;
      }
      const home = (!centre && gaze.headRef?.nose) || { x: 0.5, y: 0.5 };
      const dx = f.nose.x - home.x; // + = toward the image right = the user's left
      const dy = f.nose.y - home.y;
      const ratio = f.eyeDistPx / fr.videoW;
      const distance = ratio < 0.085 ? 'far' : ratio > 0.3 ? 'close' : 'ok';
      const centred = Math.abs(dx) < 0.07 && Math.abs(dy) < 0.08;
      let hint = '';
      if (distance === 'far') hint = 'Move a little closer';
      else if (distance === 'close') hint = 'Move back a little';
      // The preview is mirrored, so "move left" means the user's own left.
      else if (Math.abs(dx) >= 0.07) hint = dx > 0 ? 'Move a little to your right' : 'Move a little to your left';
      else if (Math.abs(dy) >= 0.08) hint = dy > 0 ? 'Move up a little' : 'Move down a little';
      setG({ face: true, nose: f.nose, distance, centred, hint });
    });
  }, [centre]);
  return g;
}

/**
 * Mirrored live camera view with a guide oval at the "home" position (where the face was during calibration,
 * or the centre before calibrating). The oval turns green when the face is centred at a good distance.
 */
export function CameraPreview({
  width = 168,
  showHint = false,
  centre = false,
}: {
  width?: number;
  showHint?: boolean;
  /** Guide toward the frame centre instead of the calibrated home position (used before calibrating). */
  centre?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraOn = useStore(gazeUi, (s) => s.cameraOn);
  const headOut = useStore(gazeUi, (s) => s.status === 'head-out');
  const g = useFaceGuide(centre);
  const vw = tracker.video.videoWidth || 1280;
  const vh = tracker.video.videoHeight || 720;
  const height = Math.round((width * vh) / vw);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cameraOn) return;
    v.srcObject = tracker.video.srcObject;
    void v.play().catch(() => {});
  }, [cameraOn]);

  if (!cameraOn) return null;
  const good = g.face && g.centred && g.distance === 'ok' && !headOut;
  const home = (!centre && gaze.headRef?.nose) || { x: 0.5, y: 0.5 };
  const tone = good ? 'rgb(var(--ok))' : 'rgb(var(--amber))';
  // Oval sized for a face at a comfortable distance (~60 cm on a typical laptop webcam).
  const rx = 0.1 * vw;
  const ry = 0.25 * vh;

  return (
    <div className="flex flex-col items-center gap-1" aria-label="Camera view with centring guide">
      <div
        className="relative overflow-hidden rounded-2xl border-2 bg-black"
        style={{ width, height, borderColor: tone }}
      >
        {/* Video and overlay are mirrored together so landmark coordinates map directly. */}
        <div className="absolute inset-0 -scale-x-100">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <svg viewBox={`0 0 ${vw} ${vh}`} className="absolute inset-0 h-full w-full" aria-hidden>
            <ellipse
              cx={home.x * vw}
              cy={home.y * vh}
              rx={rx}
              ry={ry}
              fill="none"
              stroke={tone}
              strokeWidth={vw / 110}
              strokeDasharray={good ? undefined : `${vw / 45} ${vw / 70}`}
            />
            <path
              d={`M${home.x * vw - vw / 50},${home.y * vh}h${vw / 25}M${home.x * vw},${home.y * vh - vw / 50}v${vw / 25}`}
              stroke={tone}
              strokeWidth={vw / 220}
            />
            {g.nose && <circle cx={g.nose.x * vw} cy={g.nose.y * vh} r={vw / 70} fill={tone} />}
          </svg>
        </div>
      </div>
      {showHint && (
        <div className="text-center text-lg font-bold" style={{ color: tone }}>
          {good ? 'Good position' : g.hint || 'Line your face up with the oval'}
        </div>
      )}
    </div>
  );
}
