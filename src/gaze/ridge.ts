// Second-order polynomial ridge regression: gaze features -> screen (x, y).
// Pure TypeScript, no dependencies, unit-tested in ridge.test.ts.

import { mean, std } from './stats';

/** Raw per-frame feature vector layout (see features.ts). */
export const FEATURE_NAMES = [
  'irisX', // 0  eye-local iris x (openness-weighted mean of both eyes)
  'irisY', // 1  eye-local iris y
  'lookH', // 2  blendshape horizontal look (out - in)
  'lookV', // 3  blendshape vertical look (up - down)
  'yaw', //   4  head yaw (rad)
  'pitch', // 5  head pitch (rad)
  'roll', //  6  head roll (rad)
  'tx', //    7  head translation x (cm)
  'ty', //    8  head translation y (cm)
  'tz', //    9  head translation z (cm)
  'lidGap', // 10 eyelid aperture / eye width (lids follow vertical gaze)
] as const;
export const N_FEATURES = FEATURE_NAMES.length;

/**
 * Minimum standardisation scale per feature. Head-pose features barely vary during calibration, and
 * dividing by a near-zero empirical std would make tiny head movements explode at run time.
 */
const SCALE_FLOOR = [0.01, 0.01, 0.03, 0.03, 0.05, 0.05, 0.05, 1.0, 1.0, 2.0, 0.01];

const EYE = [0, 1, 2, 3];

/** Expands standardised features into polynomial terms (no intercept; handled by centring). */
export function expand(z: number[]): number[] {
  const out = z.slice(); // 11 linear terms
  // Full second order on the eye features (where the gaze signal lives): 4 squares + 6 crosses.
  for (let i = 0; i < EYE.length; i++) {
    for (let j = i; j < EYE.length; j++) out.push(z[EYE[i]] * z[EYE[j]]);
  }
  // Eye-in-head x head-pose interactions: lets the model compensate small head rotations.
  out.push(z[0] * z[4], z[1] * z[5]);
  return out;
}

export interface RidgeModel {
  featMean: number[];
  featScale: number[];
  termMean: number[];
  w: number[][]; // [term][0=x,1=y]
  b: [number, number];
  lambda: number;
}

function standardiser(X: number[][]) {
  const featMean: number[] = [];
  const featScale: number[] = [];
  for (let d = 0; d < N_FEATURES; d++) {
    const col = X.map((r) => r[d]);
    featMean.push(mean(col));
    featScale.push(Math.max(std(col), SCALE_FLOOR[d] ?? 1e-3));
  }
  return { featMean, featScale };
}

function standardise(x: number[], m: number[], s: number[]): number[] {
  return x.map((v, d) => (v - m[d]) / s[d]);
}

/** Solves A w = b for symmetric positive-definite A (Cholesky). Mutates nothing. */
export function solveSPD(A: number[][], bs: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][j] = s / L[j][j];
    }
  }
  // bs is [n][m]: solve for each column.
  const m = bs[0].length;
  const out: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let c = 0; c < m; c++) {
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = bs[i][c];
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * out[k][c];
      out[i][c] = s / L[i][i];
    }
  }
  return out;
}

/** Fits ridge regression with a fixed lambda. X: raw features, Y: [x, y] screen targets. */
export function fitRidge(X: number[][], Y: number[][], lambda: number): RidgeModel {
  const { featMean, featScale } = standardiser(X);
  const T = X.map((x) => expand(standardise(x, featMean, featScale)));
  const p = T[0].length;
  const n = T.length;
  const termMean = Array.from({ length: p }, (_, j) => mean(T.map((t) => t[j])));
  const yMean: [number, number] = [mean(Y.map((y) => y[0])), mean(Y.map((y) => y[1]))];

  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const B: number[][] = Array.from({ length: p }, () => [0, 0]);
  for (let r = 0; r < n; r++) {
    const t = T[r];
    const tc = t.map((v, j) => v - termMean[j]);
    const yc0 = Y[r][0] - yMean[0];
    const yc1 = Y[r][1] - yMean[1];
    for (let i = 0; i < p; i++) {
      B[i][0] += tc[i] * yc0;
      B[i][1] += tc[i] * yc1;
      for (let j = i; j < p; j++) A[i][j] += tc[i] * tc[j];
    }
  }
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < i; j++) A[i][j] = A[j][i];
    A[i][i] += lambda * n; // scale by n so lambda is independent of sample count
  }
  const w = solveSPD(A, B);
  return { featMean, featScale, termMean, w, b: yMean, lambda };
}

export function predict(model: RidgeModel, x: number[]): [number, number] {
  const t = expand(standardise(x, model.featMean, model.featScale));
  let px = model.b[0];
  let py = model.b[1];
  for (let i = 0; i < t.length; i++) {
    const tc = t[i] - model.termMean[i];
    px += tc * model.w[i][0];
    py += tc * model.w[i][1];
  }
  return [px, py];
}

export const LAMBDA_GRID = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1, 3];

export interface FitReport {
  model: RidgeModel;
  lambda: number;
  /** Mean held-out error (px) for each lambda tried. */
  cvError: { lambda: number; error: number }[];
}

/**
 * Chooses lambda on held-out frames: leave-one-calibration-point-out cross-validation
 * (frames from the same point are correlated, so holding out whole points is the honest split),
 * then refits on all frames with the winning lambda.
 */
export function fitWithCV(X: number[][], Y: number[][], groups: number[], lambdas = LAMBDA_GRID): FitReport {
  const ids = [...new Set(groups)];
  const cvError: { lambda: number; error: number }[] = [];
  if (ids.length >= 4) {
    for (const lambda of lambdas) {
      let errSum = 0;
      let count = 0;
      for (const g of ids) {
        const trX: number[][] = [];
        const trY: number[][] = [];
        const teX: number[][] = [];
        const teY: number[][] = [];
        groups.forEach((gg, i) => {
          if (gg === g) {
            teX.push(X[i]);
            teY.push(Y[i]);
          } else {
            trX.push(X[i]);
            trY.push(Y[i]);
          }
        });
        const m = fitRidge(trX, trY, lambda);
        teX.forEach((x, i) => {
          const [px, py] = predict(m, x);
          errSum += Math.hypot(px - teY[i][0], py - teY[i][1]);
          count++;
        });
      }
      cvError.push({ lambda, error: errSum / Math.max(1, count) });
    }
  }
  const best = cvError.length ? cvError.reduce((a, b) => (b.error < a.error ? b : a)).lambda : 0.1;
  return { model: fitRidge(X, Y, best), lambda: best, cvError };
}
