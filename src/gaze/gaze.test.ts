import { describe, expect, it } from 'vitest';
import { fitRidge, fitWithCV, predict, solveSPD, N_FEATURES } from './ridge';
import { madInlierIndices, median, percentile } from './stats';
import { GazeSmoother, OneEuro } from './oneEuro';
import { Snapper } from './snap';
import { DriftCorrector } from './drift';
import { LongBlinkDetector } from './blink';
import { adaptiveLayout, buildReport, degToPx, gradeFor, pxToDeg } from './accuracy';
import { eyeFeatures, EYE_A, headPoseFromMatrix } from './features';

// Deterministic PRNG so tests are stable.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function synthFeatures(sx: number, sy: number, r: () => number, noise = 0.002): number[] {
  // Iris offset roughly linear in screen position with mild curvature; head almost still.
  const ix = (sx - 720) / 9000 + 0.00001 * ((sx - 720) / 100) ** 2 + (r() - 0.5) * noise;
  const iy = (sy - 450) / 12000 + (r() - 0.5) * noise;
  const v = Array(N_FEATURES).fill(0);
  v[0] = ix;
  v[1] = iy;
  v[2] = ix * 4 + (r() - 0.5) * 0.02;
  v[3] = -iy * 4 + (r() - 0.5) * 0.02;
  v[4] = (r() - 0.5) * 0.01;
  v[5] = (r() - 0.5) * 0.01;
  v[9] = -60 + (r() - 0.5);
  v[10] = 0.28 - iy * 0.5;
  return v;
}

describe('stats', () => {
  it('median / percentile', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentile([0, 10], 95)).toBeCloseTo(9.5);
  });
  it('MAD rejects outliers', () => {
    const rows = [[1], [1.1], [0.9], [1.05], [0.95], [50]];
    expect(madInlierIndices(rows)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('ridge regression', () => {
  it('solveSPD solves a small system', () => {
    const x = solveSPD(
      [
        [4, 1],
        [1, 3],
      ],
      [[1], [2]],
    );
    expect(4 * x[0][0] + x[1][0]).toBeCloseTo(1);
    expect(x[0][0] + 3 * x[1][0]).toBeCloseTo(2);
  });

  it('recovers a 9-point calibration and generalises to unseen points', () => {
    const r = rng(42);
    const X: number[][] = [];
    const Y: number[][] = [];
    const G: number[] = [];
    const pts = [0.1, 0.5, 0.9].flatMap((fy) => [0.1, 0.5, 0.9].map((fx) => [fx * 1440, fy * 900]));
    pts.forEach(([sx, sy], gi) => {
      for (let k = 0; k < 25; k++) {
        X.push(synthFeatures(sx, sy, r));
        Y.push([sx, sy]);
        G.push(gi);
      }
    });
    const rep = fitWithCV(X, Y, G);
    expect(rep.cvError.length).toBeGreaterThan(3);
    // Validation points not in the calibration set.
    const errs: number[] = [];
    for (const [sx, sy] of [
      [360, 225],
      [1080, 225],
      [720, 450],
      [360, 675],
      [1080, 675],
    ]) {
      for (let k = 0; k < 20; k++) {
        const [px, py] = predict(rep.model, synthFeatures(sx, sy, r));
        errs.push(Math.hypot(px - sx, py - sy));
      }
    }
    const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(meanErr).toBeLessThan(60);
  });

  it('larger lambda shrinks toward the mean', () => {
    const r = rng(1);
    const X = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => synthFeatures(i * 180, i * 110, r));
    const Y = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i * 180, i * 110]);
    const loose = fitRidge(X, Y, 1e-4);
    const tight = fitRidge(X, Y, 1e4);
    const [lx] = predict(loose, X[0]);
    const [tx] = predict(tight, X[0]);
    expect(Math.abs(tx - 630)).toBeLessThan(Math.abs(lx - 630));
  });
});

describe('smoothing', () => {
  it('One Euro reduces jitter on a fixation', () => {
    const f = new OneEuro(0.6, 0.004);
    const r = rng(7);
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const y = f.filter(500 + (r() - 0.5) * 60, 1 / 30);
      if (i > 30) maxDev = Math.max(maxDev, Math.abs(y - 500));
    }
    expect(maxDev).toBeLessThan(15);
  });
  it('saccade snaps quickly', () => {
    const s = new GazeSmoother();
    for (let i = 0; i < 30; i++) s.update(200, 200, 1 / 30);
    s.update(1200, 700, 1 / 30);
    const [x] = s.update(1200, 700, 1 / 30);
    expect(x).toBeGreaterThan(1150);
  });
});

describe('snapping', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0, w: 200, h: 200 },
    { id: 'b', x: 210, y: 0, w: 200, h: 200 },
  ];
  it('attaches to the containing target', () => {
    const s = new Snapper({ pad: 30, stickyPx: 40, switchRatio: 0.6 });
    expect(s.update(tiles, 100, 100)).toBe('a');
  });
  it('has hysteresis near the border', () => {
    const s = new Snapper({ pad: 30, stickyPx: 40, switchRatio: 0.6 });
    s.update(tiles, 100, 100);
    // Just over the edge into b's padding but not inside b: stays on a.
    expect(s.update(tiles, 207, 100)).toBe('a');
    // Clearly inside b near its centre: switches.
    expect(s.update(tiles, 310, 100)).toBe('b');
  });
  it('releases when far away', () => {
    const s = new Snapper();
    s.update(tiles, 100, 100);
    expect(s.update(tiles, 900, 900)).toBeNull();
  });
});

describe('drift correction', () => {
  it('learns a constant offset and stays bounded', () => {
    const d = new DriftCorrector({ rate: 0.3, maxPx: 100, halfLifeS: 1e9, maxResidualPx: 300 });
    for (let i = 0; i < 20; i++) d.observe(500 - 60, 500 + 40, 500, 500);
    expect(d.bx).toBeCloseTo(60, 0);
    expect(d.by).toBeCloseTo(-40, 0);
    for (let i = 0; i < 50; i++) d.observe(0, 0, 250, 0);
    expect(Math.hypot(d.bx, d.by)).toBeLessThanOrEqual(100.0001);
  });
  it('ignores implausible residuals and decays', () => {
    const d = new DriftCorrector({ rate: 0.5, maxPx: 100, halfLifeS: 10, maxResidualPx: 200 });
    expect(d.observe(0, 0, 1000, 1000)).toBe(false);
    d.observe(0, 0, 50, 0);
    const before = d.bx;
    d.decay(10);
    expect(d.bx).toBeCloseTo(before / 2);
  });
});

describe('long blink', () => {
  it('fires for a deliberate blink but not a natural one', () => {
    const b = new LongBlinkDetector();
    // natural 150 ms blink
    expect(b.update(0.9, 0.9, 0)).toBe(false);
    expect(b.update(0.1, 0.1, 150)).toBe(false);
    // deliberate 500 ms blink
    b.update(0.9, 0.9, 1000);
    b.update(0.9, 0.9, 1300);
    expect(b.update(0.1, 0.1, 1500)).toBe(true);
    // resting eyes 2 s
    b.update(0.9, 0.9, 3000);
    expect(b.update(0.1, 0.1, 5000)).toBe(false);
  });
});

describe('accuracy', () => {
  it('px <-> degrees round trip', () => {
    const px = degToPx(2, 40, 60);
    expect(pxToDeg(px, 40, 60)).toBeCloseTo(2);
  });
  it('grades', () => {
    expect(gradeFor(1)).toBe('Excellent');
    expect(gradeFor(2.5)).toBe('Good');
    expect(gradeFor(4)).toBe('Fair');
    expect(gradeFor(6)).toBe('Recalibrate');
  });
  it('report + adaptive layout', () => {
    const rep = buildReport([[{ tx: 0, ty: 0, px: 30, py: 40 }]], 60, 40);
    expect(rep.meanPx).toBe(50);
    expect(adaptiveLayout(80, 1440, 900).tier).toBe('dense');
    expect(adaptiveLayout(300, 1440, 900).replyCols).toBe(2);
    expect(adaptiveLayout(300, 1440, 900).minTile).toBeGreaterThanOrEqual(120);
  });
});

describe('features', () => {
  it('eye-local iris coordinates are 0 at the centre and positive toward the right corner', () => {
    const lm: { x: number; y: number }[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[EYE_A.left] = { x: 0.4, y: 0.5 };
    lm[EYE_A.right] = { x: 0.5, y: 0.5 };
    lm[EYE_A.upper] = { x: 0.45, y: 0.485 };
    lm[EYE_A.lower] = { x: 0.45, y: 0.515 };
    for (const i of EYE_A.iris) lm[i] = { x: 0.46, y: 0.5 };
    const f = eyeFeatures(lm, EYE_A, 1, 480);
    expect(f.ix).toBeCloseTo(0.1);
    expect(f.iy).toBeCloseTo(0);
    expect(f.gap).toBeCloseTo(0.3);
    expect(f.weight).toBe(1);
  });
  it('identity matrix gives zero pose', () => {
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, -50, 1];
    const p = headPoseFromMatrix(I);
    expect(p.yaw).toBeCloseTo(0);
    expect(p.pitch).toBeCloseTo(0);
    expect(p.tz).toBe(-50);
  });
});
