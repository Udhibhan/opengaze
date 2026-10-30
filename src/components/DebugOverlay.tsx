import { useEffect, useRef } from 'react';
import { gaze, gazeUi } from '../gaze/engine';
import { tracker } from '../gaze/tracker';
import { IRIS_POINTS } from '../gaze/features';
import { FEATURE_NAMES } from '../gaze/ridge';

/** Judge-facing debug view (toggle with D): face mesh, iris points, raw vs smoothed gaze, FPS, error. */
export function DebugOverlay() {
  const screenRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const sc = screenRef.current!;
    const cam = camRef.current!;
    const resize = () => {
      sc.width = window.innerWidth;
      sc.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    const trail: [number, number][] = [];
    const off = gaze.onCursor((c) => {
      const ctx = sc.getContext('2d')!;
      ctx.clearRect(0, 0, sc.width, sc.height);
      if (c.raw) {
        trail.push(c.raw);
        if (trail.length > 30) trail.shift();
      }
      ctx.fillStyle = 'rgba(255,90,90,0.35)';
      for (const [x, y] of trail) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      const dot = (p: [number, number] | null, col: string, r: number) => {
        if (!p) return;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.stroke();
      };
      dot(c.raw, '#ff5a5a', 10);
      dot(c.smooth, '#4fc3ff', 14);
      dot(c.display, '#f5b248', 20);

      // Camera preview with landmarks (mirrored so it reads like a mirror).
      const fr = c.frame;
      const v = tracker.video;
      const cctx = cam.getContext('2d')!;
      const W = cam.width;
      const H = cam.height;
      cctx.save();
      cctx.translate(W, 0);
      cctx.scale(-1, 1);
      if (v.readyState >= 2) cctx.drawImage(v, 0, 0, W, H);
      else {
        cctx.fillStyle = '#000';
        cctx.fillRect(0, 0, W, H);
      }
      if (fr?.landmarks) {
        cctx.fillStyle = 'rgba(120,222,168,0.7)';
        for (const p of fr.landmarks) cctx.fillRect(p.x * W - 0.75, p.y * H - 0.75, 1.5, 1.5);
        cctx.fillStyle = '#f5b248';
        for (const i of IRIS_POINTS) {
          const p = fr.landmarks[i];
          cctx.beginPath();
          cctx.arc(p.x * W, p.y * H, 2.2, 0, Math.PI * 2);
          cctx.fill();
        }
      }
      cctx.restore();

      const acc = gazeUi.get().accuracy;
      const f = fr?.f;
      const lines = [
        `FPS ${fr?.fps.toFixed(1) ?? '-'}  delegate ${tracker.delegate}  video ${fr?.videoW ?? 0}x${fr?.videoH ?? 0}`,
        `face ${fr?.face ? 'yes' : 'no'}  brightness ${fr?.brightness.toFixed(0) ?? '-'}  eyeDist ${f?.eyeDistPx.toFixed(0) ?? '-'}px`,
        `raw    ${c.raw ? c.raw.map((n) => n.toFixed(0)).join(', ') : '-'}`,
        `smooth ${c.smooth ? c.smooth.map((n) => n.toFixed(0)).join(', ') : '-'}  snap ${c.snapId ?? '-'}`,
        `drift bias ${c.bias.map((n) => n.toFixed(0)).join(', ')} px`,
        `error (validation) ${acc ? `${acc.meanPx.toFixed(0)}px mean / ${acc.p95Px.toFixed(0)}px p95 / ${acc.meanDeg.toFixed(2)}°` : 'not measured'}`,
        `lambda ${gaze.model?.lambda ?? '-'}`,
        f ? `blink L ${f.blinkL.toFixed(2)} R ${f.blinkR.toFixed(2)}` : '',
        ...(f ? f.vector.map((v2, i) => `${FEATURE_NAMES[i].padEnd(7)} ${v2.toFixed(4)}`) : []),
      ];
      if (textRef.current) textRef.current.textContent = lines.join('\n');
    });
    return () => {
      off();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas ref={screenRef} className="pointer-events-none fixed inset-0 z-[70]" aria-hidden />
      <div className="pointer-events-none fixed bottom-3 left-3 z-[71] flex gap-3 rounded-xl bg-black/80 p-3 text-white">
        <canvas ref={camRef} width={240} height={180} className="rounded-lg" />
        <pre ref={textRef} className="m-0 text-[11px] leading-tight" />
      </div>
      <div className="pointer-events-none fixed right-3 top-16 z-[71] rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
        <span className="text-[#ff5a5a]">● raw</span> <span className="text-[#4fc3ff]">● smoothed</span>{' '}
        <span className="text-[#f5b248]">● shown</span> · press D to hide
      </div>
    </>
  );
}
