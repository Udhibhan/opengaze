// The gaze engine: features -> calibrated model -> drift correction -> smoothing -> snapping -> dwell/blink.
// Owns the registry of on-screen gaze targets and fires their onSelect.

import { tracker, type TrackerFrame } from './tracker';
import { predict, type RidgeModel } from './ridge';
import { GazeSmoother } from './oneEuro';
import { Snapper, centre, type Rect } from './snap';
import { DriftCorrector } from './drift';
import { LongBlinkDetector } from './blink';
import type { AccuracyReport } from './accuracy';
import type { HeadPose } from './features';
import { createStore } from '../lib/store';
import { settings, smootherParams } from '../lib/settings';
import { selectTick } from '../lib/sound';

export type Status = 'off' | 'uncalibrated' | 'tracking' | 'paused' | 'face-lost' | 'head-out';
export type Distance = 'ok' | 'far' | 'close' | null;

export interface GazeUi {
  status: Status;
  cameraOn: boolean;
  calibrated: boolean;
  hovered: string | null;
  dwellId: string | null;
  progress: number; // 0..1 for dwellId
  paused: boolean;
  lowLight: boolean;
  distance: Distance;
  headHint: string;
  accuracy: AccuracyReport | null;
  fps: number;
  pulseId: string | null; // last selected (for the select animation)
  pulseAt: number;
}

export interface CursorInfo {
  raw: [number, number] | null; // model output (after drift), before smoothing
  smooth: [number, number] | null;
  display: [number, number] | null; // what the user sees (magnetised)
  snapId: string | null;
  visible: boolean;
  frame: TrackerFrame | null;
  bias: [number, number];
}

export interface SelectEvent {
  id: string;
  label: string;
  t: number;
  via: 'dwell' | 'blink' | 'click';
  /** Distance (px) between the drift-corrected gaze estimate and the selected target's centre. */
  residualPx?: number;
}

export interface HeadRef {
  mean: HeadPose;
}

interface TargetReg {
  id: string;
  el: HTMLElement;
  label: string;
  onSelect: () => void;
  dwellMs?: number;
  pauseSafe?: boolean;
  /** Can be selected again without looking away first (keyboard keys, steppers). */
  repeatable?: boolean;
}

const HEAD_LIMITS = { yaw: 0.24, pitch: 0.2, tx: 6, ty: 5, tz: 14 };

export const gazeUi = createStore<GazeUi>({
  status: 'off',
  cameraOn: false,
  calibrated: false,
  hovered: null,
  dwellId: null,
  progress: 0,
  paused: false,
  lowLight: false,
  distance: null,
  headHint: '',
  accuracy: null,
  fps: 0,
  pulseId: null,
  pulseAt: 0,
});

class GazeEngine {
  model: RidgeModel | null = null;
  headRef: HeadRef | null = null;
  smoother = new GazeSmoother();
  snapper = new Snapper();
  drift = new DriftCorrector();
  blink = new LongBlinkDetector();
  calibrating = false;

  private targets = new Map<string, TargetReg>();
  private cursorListeners = new Set<(c: CursorInfo) => void>();
  private selectListeners = new Set<(e: SelectEvent) => void>();
  private lastT = 0;
  private lostSince: number | null = null;
  private headOutSince: number | null = null;
  private dwellId: string | null = null;
  private progressMs = 0;
  private graceSince: number | null = null;
  private cooldownUntil = 0;
  /** Last selected non-repeatable target: it can't fire again until the gaze leaves it. */
  private lockedId: string | null = null;
  private lockLeftAt: number | null = null;
  private history: { t: number; x: number; y: number }[] = [];
  private mouse: [number, number] | null = null;
  private headNeutral: { x: number; y: number } | null = null;
  private lastFrame: TrackerFrame | null = null;
  private smooth: [number, number] | null = null;
  private mouseRaf = 0;

  constructor() {
    tracker.on((fr) => {
      if (settings.get().selection !== 'mouse') this.step(fr.t, fr);
      else this.lastFrame = fr;
    });
    window.addEventListener('mousemove', (e) => (this.mouse = [e.clientX, e.clientY]), { passive: true });
    settings.subscribe(() => this.applySettings());
    this.applySettings();
    this.restore();
  }

  // ---------- public API ----------

  async startCamera() {
    await tracker.start();
    gazeUi.set({ cameraOn: true });
  }

  register(t: TargetReg) {
    this.targets.set(t.id, t);
    return () => {
      if (this.targets.get(t.id) === t) this.targets.delete(t.id);
    };
  }

  onCursor(fn: (c: CursorInfo) => void) {
    this.cursorListeners.add(fn);
    return () => {
      this.cursorListeners.delete(fn);
    };
  }

  onSelect(fn: (e: SelectEvent) => void) {
    this.selectListeners.add(fn);
    return () => {
      this.selectListeners.delete(fn);
    };
  }

  setCalibration(model: RidgeModel, headRef: HeadRef, accuracy: AccuracyReport | null) {
    this.model = model;
    this.headRef = headRef;
    this.drift.reset();
    this.smoother.reset();
    this.snapper.reset();
    gazeUi.set({ calibrated: true, accuracy });
    this.persist();
  }

  setAccuracy(accuracy: AccuracyReport) {
    gazeUi.set({ accuracy });
    this.persist();
  }

  setSnapPad(pad: number) {
    this.snapper.opts = { ...this.snapper.opts, pad, stickyPx: Math.max(24, pad) };
    this.smoother.configure({ saccadePx: Math.max(140, pad * 3) });
  }

  togglePause() {
    gazeUi.set({ paused: !gazeUi.get().paused });
    this.resetDwell();
  }

  recentreHead() {
    const f = this.lastFrame?.f;
    if (f) this.headNeutral = { ...f.nose };
  }

  /** Called when a carer clicks a target with the mouse/touch. */
  clickSelect(id: string) {
    const reg = this.targets.get(id);
    if (!reg) return;
    this.fire(reg, 'click', performance.now());
  }

  get biasPx(): [number, number] {
    return [this.drift.bx, this.drift.by];
  }

  // ---------- frame pipeline ----------

  private applySettings() {
    const s = settings.get();
    this.smoother.configure(smootherParams(s.smoothing));
    if (s.selection === 'mouse') {
      if (!this.mouseRaf) {
        const tick = (t: number) => {
          this.mouseRaf = requestAnimationFrame(tick);
          if (settings.get().selection === 'mouse') this.step(t, this.lastFrame);
        };
        this.mouseRaf = requestAnimationFrame(tick);
      }
    } else if (this.mouseRaf) {
      cancelAnimationFrame(this.mouseRaf);
      this.mouseRaf = 0;
    }
    if (s.selection === 'head' && !this.headNeutral) this.recentreHead();
  }

  private resetDwell() {
    this.dwellId = null;
    this.progressMs = 0;
    this.graceSince = null;
  }

  private headPoint(f: NonNullable<TrackerFrame['f']>): [number, number] {
    if (!this.headNeutral) this.headNeutral = { ...f.nose };
    const W = window.innerWidth;
    const H = window.innerHeight;
    const gain = 6;
    return [
      W / 2 - (f.nose.x - this.headNeutral.x) * gain * W,
      H / 2 + (f.nose.y - this.headNeutral.y) * gain * 1.4 * H,
    ];
  }

  private headOutside(h: HeadPose): string {
    if (!this.headRef) return '';
    const m = this.headRef.mean;
    if (h.tz - m.tz < -HEAD_LIMITS.tz) return 'Move a little closer to the screen';
    if (h.tz - m.tz > HEAD_LIMITS.tz) return 'Move back a little';
    if (Math.abs(h.yaw - m.yaw) > HEAD_LIMITS.yaw || Math.abs(h.tx - m.tx) > HEAD_LIMITS.tx)
      return 'Gently turn back to face the screen';
    if (Math.abs(h.pitch - m.pitch) > HEAD_LIMITS.pitch || Math.abs(h.ty - m.ty) > HEAD_LIMITS.ty)
      return 'Gently tilt your head back to centre';
    return '';
  }

  private visibleRects(paused: boolean): Rect[] {
    const out: Rect[] = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const t of this.targets.values()) {
      if (paused && !t.pauseSafe) continue;
      if (!t.el.isConnected || t.el.getAttribute('aria-disabled') === 'true') continue;
      const r = t.el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) continue;
      out.push({ id: t.id, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }

  private step(t: number, frame: TrackerFrame | null) {
    const s = settings.get();
    const ui = gazeUi.get();
    if (frame) this.lastFrame = frame;
    const dt = this.lastT ? Math.min(0.2, Math.max(0.001, (t - this.lastT) / 1000)) : 1 / 30;
    this.lastT = t;
    this.drift.decay(dt);

    const usesFace = s.selection !== 'mouse';
    const f = frame?.f ?? null;

    // Face lost: freeze the cursor and stop dwelling after a short grace period.
    let faceLost = false;
    if (usesFace && !f) {
      this.lostSince ??= t;
      faceLost = t - this.lostSince > 300;
    } else this.lostSince = null;

    // Blink tracking (also used to freeze the cursor while the eyes are closed).
    let blinkFired = false;
    if (f) blinkFired = this.blink.update(f.blinkL, f.blinkR, t);
    const eyesClosed = usesFace && this.blink.closed;

    // Head movement guard (only matters for eye-gaze modes).
    let headHint = '';
    if (f && (s.selection === 'dwell' || s.selection === 'blink')) {
      const h = this.headOutside(f.head);
      if (h) {
        this.headOutSince ??= t;
        if (t - this.headOutSince > 400) headHint = h;
      } else this.headOutSince = null;
    }

    // Raw point.
    let raw: [number, number] | null = null;
    const needsModel = s.selection === 'dwell' || s.selection === 'blink';
    if (s.selection === 'mouse') raw = this.mouse;
    else if (f && s.selection === 'head') raw = this.headPoint(f);
    else if (f && this.model && !eyesClosed) {
      const [px, py] = predict(this.model, f.vector);
      this.history.push({ t, x: px, y: py });
      while (this.history.length && t - this.history[0].t > 400) this.history.shift();
      raw = this.drift.apply(px, py);
    }

    if (raw && !eyesClosed && !faceLost) {
      // Keep the estimate on screen (with a margin) so edge tiles are reachable but outliers can't fly off.
      const W = window.innerWidth;
      const H = window.innerHeight;
      raw = [Math.min(W + 40, Math.max(-40, raw[0])), Math.min(H + 40, Math.max(-40, raw[1]))];
      this.smooth = this.smoother.update(raw[0], raw[1], dt);
    }

    const paused = ui.paused;
    const blocked = faceLost || !!headHint || (needsModel && !this.model) || this.calibrating;
    let snapId: string | null = null;
    let display: [number, number] | null = this.smooth;
    if (this.smooth && !blocked) {
      const rects = this.visibleRects(paused);
      snapId = this.snapper.update(rects, this.smooth[0], this.smooth[1]);
      if (snapId) {
        const r = rects.find((q) => q.id === snapId)!;
        const [cx, cy] = centre(r);
        // Magnetic pull: the cursor visibly attaches toward the target centre.
        display = [this.smooth[0] + (cx - this.smooth[0]) * 0.65, this.smooth[1] + (cy - this.smooth[1]) * 0.65];
      }
    } else this.snapper.reset();

    // Midas-touch protection: a just-selected tile stays locked until the gaze has left it for 250 ms.
    if (this.lockedId) {
      if (snapId === this.lockedId) this.lockLeftAt = null;
      else if ((this.lockLeftAt ??= t) && t - this.lockLeftAt > 250) this.lockedId = null;
    }
    const lockedHere = !!snapId && snapId === this.lockedId;

    // Selection.
    if (blocked || t < this.cooldownUntil || lockedHere) {
      if (blocked) this.resetDwell();
      else this.progressMs = 0;
    } else if (s.selection === 'blink') {
      this.dwellId = snapId;
      this.progressMs = snapId ? this.blink.progress(t) * 1000 : 0;
      if (blinkFired && snapId) this.select(snapId, 'blink', t);
    } else {
      if (snapId && snapId === this.dwellId) {
        if (!eyesClosed) this.progressMs += dt * 1000;
        this.graceSince = null;
      } else if (this.dwellId && (this.graceSince ??= t) && t - this.graceSince < 160) {
        // brief glitch off the target: hold progress
      } else {
        this.dwellId = snapId;
        this.progressMs = 0;
        this.graceSince = null;
      }
      const reg = this.dwellId ? this.targets.get(this.dwellId) : undefined;
      const need = reg?.dwellMs ?? s.dwellMs;
      if (reg && this.progressMs >= need) this.select(reg.id, 'dwell', t);
    }

    const reg = this.dwellId ? this.targets.get(this.dwellId) : undefined;
    const need = s.selection === 'blink' ? 1000 : (reg?.dwellMs ?? s.dwellMs);
    const progress = this.dwellId ? Math.min(1, this.progressMs / need) : 0;

    // Environment checks.
    let distance: Distance = null;
    if (f && frame) {
      const ratio = f.eyeDistPx / frame.videoW;
      distance = ratio < 0.085 ? 'far' : ratio > 0.3 ? 'close' : 'ok';
    }
    const lowLight = !!frame && tracker.active && frame.brightness < 55;

    const status: Status =
      usesFace && !tracker.active
        ? 'off'
        : faceLost
          ? 'face-lost'
          : paused
            ? 'paused'
            : headHint
              ? 'head-out'
              : needsModel && !this.model
                ? 'uncalibrated'
                : 'tracking';

    const next: Partial<GazeUi> = {
      status,
      hovered: snapId,
      dwellId: this.dwellId,
      progress,
      lowLight,
      distance,
      headHint,
      fps: Math.round(frame?.fps ?? 0),
    };
    if ((Object.keys(next) as (keyof GazeUi)[]).some((k) => next[k] !== ui[k])) gazeUi.set(next);

    const info: CursorInfo = {
      raw,
      smooth: this.smooth,
      display,
      snapId,
      visible: !!display && !blocked && !this.calibrating,
      frame: this.lastFrame,
      bias: [this.drift.bx, this.drift.by],
    };
    this.cursorListeners.forEach((fn) => fn(info));
  }

  private select(id: string, via: 'dwell' | 'blink', t: number) {
    const reg = this.targets.get(id);
    if (!reg) return;
    // Implicit drift correction: assume the user was looking at the selected target's centre.
    let residualPx: number | undefined;
    if (this.model && (settings.get().selection === 'dwell' || settings.get().selection === 'blink')) {
      const recent = this.history.filter((h) => t - h.t < 350);
      if (recent.length >= 3) {
        const r = reg.el.getBoundingClientRect();
        const mx = recent.reduce((a, h) => a + h.x, 0) / recent.length;
        const my = recent.reduce((a, h) => a + h.y, 0) / recent.length;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        residualPx = Math.hypot(mx + this.drift.bx - cx, my + this.drift.by - cy);
        this.drift.observe(mx, my, cx, cy);
      }
    }
    this.fire(reg, via, t, residualPx);
  }

  private fire(reg: TargetReg, via: SelectEvent['via'], t: number, residualPx?: number) {
    this.cooldownUntil = t + 450;
    this.lockedId = reg.repeatable ? null : reg.id;
    this.lockLeftAt = null;
    this.resetDwell();
    selectTick();
    if (navigator.vibrate) navigator.vibrate(30);
    gazeUi.set({ pulseId: reg.id, pulseAt: t, progress: 0, dwellId: null });
    const ev: SelectEvent = { id: reg.id, label: reg.label, t, via, residualPx };
    this.selectListeners.forEach((fn) => fn(ev));
    reg.onSelect();
  }

  // Calibration survives a page reload within the same tab session (no camera data is stored).
  private persist() {
    try {
      sessionStorage.setItem(
        'opengaze.calibration',
        JSON.stringify({ model: this.model, headRef: this.headRef, accuracy: gazeUi.get().accuracy }),
      );
    } catch {
      /* ignore */
    }
  }

  private restore() {
    try {
      const raw = sessionStorage.getItem('opengaze.calibration');
      if (!raw) return;
      const { model, headRef, accuracy } = JSON.parse(raw);
      if (model && headRef) {
        this.model = model;
        this.headRef = headRef;
        gazeUi.set({ calibrated: true, accuracy: accuracy ?? null });
      }
    } catch {
      /* ignore */
    }
  }
}

export const gaze = new GazeEngine();
