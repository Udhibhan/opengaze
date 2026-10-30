// Long deliberate blink detector: both eyes closed for minMs..maxMs, then reopened, fires once.
// Natural blinks (~100-300 ms) are ignored; very long closures (resting eyes) are ignored too.

export interface BlinkOptions {
  threshold: number; // blendshape eyeBlink score counted as "closed"
  minMs: number;
  maxMs: number;
}

export const DEFAULT_BLINK: BlinkOptions = { threshold: 0.55, minMs: 400, maxMs: 700 };

export class LongBlinkDetector {
  private closedSince: number | null = null;
  /** True while the eyes are currently closed (any duration) — used to freeze the cursor. */
  closed = false;
  constructor(public opts: BlinkOptions = DEFAULT_BLINK) {}

  reset() {
    this.closedSince = null;
    this.closed = false;
  }

  /** Returns true exactly once, on the frame the eyes reopen after a deliberate blink. */
  update(blinkL: number, blinkR: number, tMs: number): boolean {
    const isClosed = Math.min(blinkL, blinkR) > this.opts.threshold;
    this.closed = isClosed;
    if (isClosed) {
      if (this.closedSince === null) this.closedSince = tMs;
      return false;
    }
    if (this.closedSince === null) return false;
    const dur = tMs - this.closedSince;
    this.closedSince = null;
    return dur >= this.opts.minMs && dur <= this.opts.maxMs;
  }

  /** How far through a potential deliberate blink we are (0..1), for UI feedback. */
  progress(tMs: number): number {
    if (this.closedSince === null) return 0;
    return Math.min(1, (tMs - this.closedSince) / this.opts.minMs);
  }
}
