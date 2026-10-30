// Turns validation errors into numbers people understand: px, visual degrees, a grade, and target sizes.

import { mean, percentile } from './stats';

export type Grade = 'Excellent' | 'Good' | 'Fair' | 'Recalibrate';

export interface PointError {
  tx: number;
  ty: number;
  /** Mean predicted position for this validation point. */
  mx: number;
  my: number;
  meanPx: number;
  p95Px: number;
  n: number;
}

export interface AccuracyReport {
  meanPx: number;
  p95Px: number;
  meanDeg: number;
  p95Deg: number;
  grade: Grade;
  points: PointError[];
  viewingDistanceCm: number;
  pxPerCm: number;
  at: number;
}

/** CSS px per cm on this screen, from the diagonal (inches). */
export function pxPerCm(screenWpx: number, screenHpx: number, diagonalIn: number): number {
  return Math.hypot(screenWpx, screenHpx) / (diagonalIn * 2.54);
}

/** Visual angle (degrees) subtended by `px` on screen at the given viewing distance. */
export function pxToDeg(px: number, ppcm: number, distanceCm: number): number {
  return (2 * Math.atan(px / ppcm / 2 / distanceCm) * 180) / Math.PI;
}

export function degToPx(deg: number, ppcm: number, distanceCm: number): number {
  return 2 * distanceCm * Math.tan((deg * Math.PI) / 180 / 2) * ppcm;
}

/** Thresholds on mean visual-angle error. Infrared trackers achieve ~0.5°; webcams realistically 1.5–4°. */
export function gradeFor(meanDeg: number): Grade {
  if (meanDeg <= 1.75) return 'Excellent';
  if (meanDeg <= 2.75) return 'Good';
  if (meanDeg <= 4.25) return 'Fair';
  return 'Recalibrate';
}

export function buildReport(
  samples: { tx: number; ty: number; px: number; py: number }[][],
  viewingDistanceCm: number,
  ppcm: number,
): AccuracyReport {
  const all: number[] = [];
  const points: PointError[] = samples
    .filter((s) => s.length)
    .map((s) => {
      const errs = s.map((p) => Math.hypot(p.px - p.tx, p.py - p.ty));
      all.push(...errs);
      return {
        tx: s[0].tx,
        ty: s[0].ty,
        mx: mean(s.map((p) => p.px)),
        my: mean(s.map((p) => p.py)),
        meanPx: mean(errs),
        p95Px: percentile(errs, 95),
        n: s.length,
      };
    });
  const meanPx = all.length ? mean(all) : Infinity;
  const p95Px = all.length ? percentile(all, 95) : Infinity;
  const meanDeg = pxToDeg(meanPx, ppcm, viewingDistanceCm);
  return {
    meanPx,
    p95Px,
    meanDeg,
    p95Deg: pxToDeg(p95Px, ppcm, viewingDistanceCm),
    grade: gradeFor(meanDeg),
    points,
    viewingDistanceCm,
    pxPerCm: ppcm,
    at: Date.now(),
  };
}

export interface AdaptiveLayout {
  /** Minimum tile edge in px (never below 120). */
  minTile: number;
  /** Columns for the reply grid on the Talk screen. */
  replyCols: number;
  /** Columns for the letter grid on the keyboard. */
  keyCols: number;
  /** Snap padding in px. */
  snapPad: number;
  tier: 'dense' | 'standard' | 'large';
}

/**
 * The measured 95th-percentile error sets target size: a tile must be big enough that 95% of gaze
 * samples aimed at its centre land on it, i.e. edge >= 2 x p95 (with snapping padding helping a bit).
 */
export function adaptiveLayout(p95Px: number | null, viewportW: number, viewportH: number): AdaptiveLayout {
  const p95 = p95Px && isFinite(p95Px) ? p95Px : 220;
  const minTile = Math.round(Math.max(120, Math.min(1.6 * p95, Math.min(viewportW, viewportH) / 2.5)));
  const snapPad = Math.round(Math.max(16, Math.min(0.5 * p95, 90)));
  if (p95 <= 110) return { minTile, replyCols: 3, keyCols: 8, snapPad, tier: 'dense' };
  if (p95 <= 190) return { minTile, replyCols: 3, keyCols: 7, snapPad, tier: 'standard' };
  return { minTile, replyCols: 2, keyCols: 6, snapPad, tier: 'large' };
}
