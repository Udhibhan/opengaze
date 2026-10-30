// Head pointer: the cursor follows small head turns and tilts. We measure the nose tip relative to the
// eye corners (in eye-distance units), which changes with head rotation but not when the user leans or
// shifts in the chair. No eye calibration needed: just a "centre" pose.

export interface Tilt {
  x: number;
  y: number;
}

/** Tilt (in eye-distance units) that moves the cursor from the centre to the screen edge. */
export const HEAD_RANGES = { small: 0.1, medium: 0.15, large: 0.22 } as const;
export type HeadRange = keyof typeof HEAD_RANGES;

/** Maps a tilt to a screen point. Turning toward the user's left moves the cursor left; tilting down moves it down. */
export function headToScreen(t: Tilt, neutral: Tilt, range: number, W: number, H: number): [number, number] {
  // Vertical head movement is naturally smaller than horizontal, so it gets a shorter range.
  const nx = (t.x - neutral.x) / range;
  const ny = (t.y - neutral.y) / (range * 0.65);
  return [W / 2 - (nx * W) / 2, H / 2 + (ny * H) / 2];
}

/**
 * Soft dead zone ("rubber band"): the output only moves once the input is more than `px` away, then trails it
 * by `px`. Removes the shimmer of a held-still pointer without adding lag to real movements.
 */
export class Steady {
  private p: [number, number] | null = null;
  constructor(public px = 6) {}
  reset() {
    this.p = null;
  }
  update(x: number, y: number): [number, number] {
    if (!this.p) return (this.p = [x, y]);
    const dx = x - this.p[0];
    const dy = y - this.p[1];
    const d = Math.hypot(dx, dy);
    if (d > this.px) {
      const k = (d - this.px) / d;
      this.p = [this.p[0] + dx * k, this.p[1] + dy * k];
    }
    return this.p;
  }
}

/** Collects a robust (median) neutral pose over a short still period. */
export class NeutralCapture {
  private xs: number[] = [];
  private ys: number[] = [];
  constructor(public frames = 20) {}
  add(t: Tilt): Tilt | null {
    this.xs.push(t.x);
    this.ys.push(t.y);
    if (this.xs.length < this.frames) return null;
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
    return { x: med(this.xs), y: med(this.ys) };
  }
  get progress() {
    return this.xs.length / this.frames;
  }
}
