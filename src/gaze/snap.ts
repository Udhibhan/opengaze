// Magnetic snapping with hysteresis: when gaze is within a target's padded bounds, the cursor attaches
// to the nearest target centre, and it doesn't flicker between neighbours.

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function centre(r: Rect): [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2];
}

function inside(r: Rect, px: number, py: number, pad: number): boolean {
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
}

/** Distance from a point to a rect's edge (0 when inside), normalised so big and small tiles compete fairly. */
function rectDistance(r: Rect, px: number, py: number): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export interface SnapOptions {
  /** Extra px around each target that still counts as "on" it (derived from measured accuracy). */
  pad: number;
  /** Extra px the current target keeps beyond `pad` before releasing (hysteresis). */
  stickyPx: number;
  /** A challenger must be this much closer (ratio of centre distances) to steal the snap. */
  switchRatio: number;
}

export const DEFAULT_SNAP: SnapOptions = { pad: 40, stickyPx: 40, switchRatio: 0.6 };

export class Snapper {
  current: string | null = null;
  constructor(public opts: SnapOptions = DEFAULT_SNAP) {}

  reset() {
    this.current = null;
  }

  /** Returns the snapped target id (or null). */
  update(targets: Rect[], px: number, py: number): string | null {
    const { pad, stickyPx, switchRatio } = this.opts;
    const cur = this.current ? targets.find((t) => t.id === this.current) : undefined;

    // Best candidate: the target that contains the point (with padding), closest by edge, then centre.
    let best: Rect | undefined;
    let bestScore = Infinity;
    for (const t of targets) {
      if (!inside(t, px, py, pad)) continue;
      const [cx, cy] = centre(t);
      const score = rectDistance(t, px, py) * 4 + Math.hypot(px - cx, py - cy) / Math.max(1, Math.min(t.w, t.h));
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }

    if (cur && inside(cur, px, py, pad + stickyPx)) {
      // Stay unless the gaze is clearly inside a different target and much nearer its centre.
      if (best && best.id !== cur.id && rectDistance(best, px, py) === 0) {
        const [bx, by] = centre(best);
        const [cx, cy] = centre(cur);
        const dBest = Math.hypot(px - bx, py - by);
        const dCur = Math.hypot(px - cx, py - cy);
        if (rectDistance(cur, px, py) > 0 || dBest < dCur * switchRatio) {
          this.current = best.id;
        }
      }
      return this.current;
    }
    this.current = best ? best.id : null;
    return this.current;
  }
}
