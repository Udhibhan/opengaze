// Calibration data collection + model fitting (UI-independent).
import { tracker, type TrackerFrame } from './tracker';
import { fitWithCV, predict, type FitReport, type RidgeModel } from './ridge';
import { madInlierIndices, mean } from './stats';
import type { HeadPose } from './features';
import type { HeadRef } from './engine';

export interface Sample {
  vector: number[];
  head: HeadPose;
  nose: { x: number; y: number };
}

export const SETTLE_MS = 600;

/** 9-point grid (optionally 13 with inner diagonal points), as fractions of the viewport. */
export function calibrationPoints(n: 9 | 13): [number, number][] {
  const g = [0.07, 0.5, 0.93];
  const pts: [number, number][] = [];
  // Serpentine order keeps eye movements short and predictable.
  g.forEach((fy, r) => (r % 2 ? [...g].reverse() : g).forEach((fx) => pts.push([fx, fy])));
  if (n === 13) pts.push([0.28, 0.28], [0.72, 0.28], [0.72, 0.72], [0.28, 0.72]);
  return pts;
}

export const VALIDATION_POINTS: [number, number][] = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.75, 0.75],
  [0.25, 0.75],
];

function usable(fr: TrackerFrame): boolean {
  const f = fr.f;
  if (!f) return false;
  if (Math.max(f.blinkL, f.blinkR) > 0.45) return false;
  return Math.max(f.eyes[0].weight, f.eyes[1].weight) > 0.3;
}

/**
 * Collects `need` usable frames starting SETTLE_MS after `shownAt`. Resolves early (with what it has)
 * after `timeoutMs`; returns an empty array if cancelled.
 */
export function collect(
  shownAt: number,
  need: number,
  signal: { cancelled: boolean },
  onProgress?: (n: number, faceOk: boolean) => void,
  timeoutMs = 5000,
): Promise<Sample[]> {
  return new Promise((resolve) => {
    const out: Sample[] = [];
    let lastFace = 0;
    const off = tracker.on((fr) => {
      if (signal.cancelled) {
        off();
        resolve([]);
        return;
      }
      if (fr.f) lastFace = fr.t;
      const faceOk = fr.t - lastFace < 400;
      const elapsed = fr.t - shownAt;
      if (elapsed >= SETTLE_MS && usable(fr)) {
        out.push({ vector: fr.f!.vector.slice(), head: { ...fr.f!.head }, nose: { ...fr.f!.nose } });
        onProgress?.(out.length, faceOk);
      } else onProgress?.(out.length, faceOk);
      // Wait longer if the face is missing; never hang forever.
      const limit = faceOk ? timeoutMs : timeoutMs * 2.5;
      if (out.length >= need || (elapsed > limit && out.length >= 6) || elapsed > timeoutMs * 3) {
        off();
        resolve(out);
      }
    });
  });
}

const EYE_COLS = [0, 1, 2, 3, 10];

export interface CalibrationResult {
  fit: FitReport;
  model: RidgeModel;
  headRef: HeadRef;
  kept: number;
  total: number;
}

export function fitCalibration(perPoint: { x: number; y: number; samples: Sample[] }[]): CalibrationResult | null {
  const X: number[][] = [];
  const Y: number[][] = [];
  const G: number[] = [];
  const heads: HeadPose[] = [];
  const noses: { x: number; y: number }[] = [];
  let total = 0;
  perPoint.forEach((p, gi) => {
    total += p.samples.length;
    if (p.samples.length < 5) return;
    // Reject outlier frames (saccades, partial blinks, glances away) by MAD on the eye features.
    const keep = madInlierIndices(
      p.samples.map((s) => EYE_COLS.map((c) => s.vector[c])),
      3,
    );
    for (const i of keep) {
      X.push(p.samples[i].vector);
      Y.push([p.x, p.y]);
      G.push(gi);
      heads.push(p.samples[i].head);
      noses.push(p.samples[i].nose);
    }
  });
  if (new Set(G).size < 5) return null;
  const fit = fitWithCV(X, Y, G);
  const m = (k: keyof HeadPose) => mean(heads.map((h) => h[k]));
  return {
    fit,
    model: fit.model,
    headRef: {
      mean: { yaw: m('yaw'), pitch: m('pitch'), roll: m('roll'), tx: m('tx'), ty: m('ty'), tz: m('tz') },
      nose: { x: mean(noses.map((n) => n.x)), y: mean(noses.map((n) => n.y)) },
    },
    kept: X.length,
    total,
  };
}

export function validationSamples(model: RidgeModel, x: number, y: number, samples: Sample[]) {
  return samples.map((s) => {
    const [px, py] = predict(model, s.vector);
    return { tx: x, ty: y, px, py };
  });
}
