// Small, dependency-free statistics helpers used by calibration and validation.

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Linear-interpolated percentile, p in [0, 100]. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((u, v) => u - v);
  const idx = (Math.min(100, Math.max(0, p)) / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** Median absolute deviation, scaled to be a consistent estimator of sigma for normal data. */
export function mad(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Rejects rows that are outliers in ANY column, using a robust z-score (|x - median| / MAD).
 * Columns with ~zero spread are ignored. Returns the indices of the rows kept.
 */
export function madInlierIndices(rows: number[][], threshold = 3): number[] {
  if (rows.length < 4) return rows.map((_, i) => i);
  const dims = rows[0].length;
  const meds: number[] = [];
  const mads: number[] = [];
  for (let d = 0; d < dims; d++) {
    const col = rows.map((r) => r[d]);
    meds.push(median(col));
    mads.push(mad(col));
  }
  const keep: number[] = [];
  rows.forEach((r, i) => {
    for (let d = 0; d < dims; d++) {
      if (mads[d] < 1e-9) continue;
      if (Math.abs(r[d] - meds[d]) / mads[d] > threshold) return;
    }
    keep.push(i);
  });
  // Never throw away more than half the data: fall back to everything if the filter was too aggressive.
  return keep.length >= rows.length / 2 ? keep : rows.map((_, i) => i);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
