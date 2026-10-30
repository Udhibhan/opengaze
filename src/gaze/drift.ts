// Implicit drift correction: every confirmed selection is evidence that the user was looking at that
// target's centre. We nudge a bounded, slowly-decaying bias so accuracy doesn't degrade over a session.

export interface DriftOptions {
  /** Learning rate per selection (0..1). */
  rate: number;
  /** Maximum correction magnitude in px. */
  maxPx: number;
  /** Bias halves every this many seconds without new evidence. */
  halfLifeS: number;
  /** Ignore selections whose residual exceeds this (probably not looking at the centre). */
  maxResidualPx: number;
}

export const DEFAULT_DRIFT: DriftOptions = { rate: 0.25, maxPx: 140, halfLifeS: 180, maxResidualPx: 260 };

export class DriftCorrector {
  bx = 0;
  by = 0;
  samples = 0;
  constructor(public opts: DriftOptions = DEFAULT_DRIFT) {}

  reset() {
    this.bx = this.by = 0;
    this.samples = 0;
  }

  /** Apply decay for elapsed time dt (s). */
  decay(dt: number) {
    if (dt <= 0) return;
    const k = Math.pow(0.5, dt / this.opts.halfLifeS);
    this.bx *= k;
    this.by *= k;
  }

  /** Corrected point = model prediction + bias. */
  apply(x: number, y: number): [number, number] {
    return [x + this.bx, y + this.by];
  }

  /**
   * @param rawX,rawY the uncorrected (model) gaze estimate around the moment of selection
   * @param cx,cy the selected target's centre
   * @returns true if the observation was used
   */
  observe(rawX: number, rawY: number, cx: number, cy: number): boolean {
    const rx = cx - (rawX + this.bx);
    const ry = cy - (rawY + this.by);
    if (Math.hypot(rx, ry) > this.opts.maxResidualPx) return false;
    this.bx += this.opts.rate * rx;
    this.by += this.opts.rate * ry;
    const m = Math.hypot(this.bx, this.by);
    if (m > this.opts.maxPx) {
      this.bx *= this.opts.maxPx / m;
      this.by *= this.opts.maxPx / m;
    }
    this.samples++;
    return true;
  }
}
