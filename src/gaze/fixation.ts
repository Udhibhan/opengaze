// Fixation filter for eye gaze. Eyes move in still "fixations" separated by fast jumps (saccades), and webcam
// gaze adds a lot of per-frame noise. Rather than chasing every sample, the output sits at the robust centre of
// the current fixation, and only moves when several consecutive samples land clearly elsewhere.

export interface FixationOptions {
  /** Samples further than this (px) from the current fixation count as "elsewhere". */
  radius: number;
  /** Samples averaged for the fixation centre (~30 per second). */
  window: number;
  /** Consecutive "elsewhere" samples needed to start a new fixation (rejects blinks and single-frame noise). */
  breakFrames: number;
}

/** Fixation parameters for a smoothing level (1 fastest .. 5 steadiest) and the measured p95 error (px). */
export function fixationParams(level: number, p95: number | null): FixationOptions {
  const l = Math.min(5, Math.max(1, Math.round(level)));
  const err = p95 && isFinite(p95) ? p95 : 180;
  return {
    radius: Math.min(160, Math.max(40, err * [0.45, 0.55, 0.65, 0.75, 0.85][l - 1])),
    window: [4, 6, 8, 11, 14][l - 1],
    breakFrames: l >= 4 ? 4 : 3,
  };
}

export const DEFAULT_FIXATION: FixationOptions = { radius: 90, window: 10, breakFrames: 3 };

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class FixationFilter {
  private pts: [number, number][] = [];
  private away: [number, number][] = [];
  private out: [number, number] | null = null;
  /** True while samples agree with the current fixation (used to only count dwell when the eyes are still). */
  fixating = false;

  constructor(public opts: FixationOptions = DEFAULT_FIXATION) {}

  configure(o: Partial<FixationOptions>) {
    this.opts = { ...this.opts, ...o };
  }

  reset() {
    this.pts = [];
    this.away = [];
    this.out = null;
    this.fixating = false;
  }

  private centre(): [number, number] {
    return [median(this.pts.map((p) => p[0])), median(this.pts.map((p) => p[1]))];
  }

  update(x: number, y: number): [number, number] {
    if (!this.out) {
      this.pts = [[x, y]];
      this.out = [x, y];
      this.fixating = false;
      return this.out;
    }
    const d = Math.hypot(x - this.out[0], y - this.out[1]);
    if (d > this.opts.radius) {
      this.away.push([x, y]);
      // Only a run of consistent samples elsewhere is a real saccade.
      const last = this.away[this.away.length - 1];
      const consistent = this.away.every((p) => Math.hypot(p[0] - last[0], p[1] - last[1]) < this.opts.radius * 1.5);
      if (!consistent) this.away = [last];
      this.fixating = false;
      if (this.away.length >= this.opts.breakFrames) {
        this.pts = this.away;
        this.away = [];
        this.out = this.centre(); // new fixation: jump straight there
      }
      return this.out;
    }
    this.away = [];
    this.pts.push([x, y]);
    if (this.pts.length > this.opts.window) this.pts.shift();
    // Soft dead zone inside the fixation: the cursor holds perfectly still unless the centre really moves.
    const [cx, cy] = this.centre();
    const dz = this.opts.radius * 0.2;
    const dd = Math.hypot(cx - this.out[0], cy - this.out[1]);
    if (dd > dz) {
      const k = (dd - dz) / dd;
      this.out = [this.out[0] + (cx - this.out[0]) * k, this.out[1] + (cy - this.out[1]) * k];
    }
    this.fixating = this.pts.length >= 3;
    return this.out;
  }
}
