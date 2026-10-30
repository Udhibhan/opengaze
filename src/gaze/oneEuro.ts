// One Euro filter (Casiez, Roussel & Vogel, CHI 2012) re-implemented from the paper's description,
// plus a saccade-aware 2D wrapper: stable during fixations, snaps quickly on big eye jumps.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(
    public minCutoff = 1.0,
    public beta = 0.007,
    public dCutoff = 1.0,
  ) {}

  reset(value: number | null = null) {
    this.x = value;
    this.dx = 0;
  }

  filter(value: number, dt: number): number {
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export interface SmootherOptions {
  minCutoff: number;
  beta: number;
  /** Jump (px) between raw sample and filtered estimate that counts as a saccade. */
  saccadePx: number;
  /** Consecutive frames beyond saccadePx needed to snap (rejects single-frame noise spikes). */
  saccadeFrames: number;
}

export const DEFAULT_SMOOTHER: SmootherOptions = {
  minCutoff: 0.6,
  beta: 0.004,
  saccadePx: 180,
  saccadeFrames: 2,
};

export class GazeSmoother {
  private fx: OneEuro;
  private fy: OneEuro;
  private far = 0;
  private last: [number, number] | null = null;
  lastWasSaccade = false;

  constructor(public opts: SmootherOptions = DEFAULT_SMOOTHER) {
    this.fx = new OneEuro(opts.minCutoff, opts.beta);
    this.fy = new OneEuro(opts.minCutoff, opts.beta);
  }

  configure(opts: Partial<SmootherOptions>) {
    this.opts = { ...this.opts, ...opts };
    this.fx.minCutoff = this.fy.minCutoff = this.opts.minCutoff;
    this.fx.beta = this.fy.beta = this.opts.beta;
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.far = 0;
    this.last = null;
  }

  /** dt in seconds. Returns the smoothed point. */
  update(x: number, y: number, dt: number): [number, number] {
    this.lastWasSaccade = false;
    if (this.last) {
      const jump = Math.hypot(x - this.last[0], y - this.last[1]);
      this.far = jump > this.opts.saccadePx ? this.far + 1 : 0;
      if (this.far >= this.opts.saccadeFrames) {
        // Saccade: restart the filter at the new location instead of gliding slowly across the screen.
        this.fx.reset(x);
        this.fy.reset(y);
        this.far = 0;
        this.lastWasSaccade = true;
      }
    }
    this.last = [this.fx.filter(x, dt), this.fy.filter(y, dt)];
    return this.last;
  }
}
