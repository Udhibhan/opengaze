// Per-frame gaze features from a MediaPipe FaceLandmarker result. Pure functions, unit-tested.
//
// Landmark indices (MediaPipe face mesh with refined iris, 478 points):
//   eye A (image-left in an unmirrored camera frame): corners 33 / 133, lids 159 / 145, iris 468–472
//   eye B (image-right):                                corners 362 / 263, lids 386 / 374, iris 473–477

export interface P2 {
  x: number;
  y: number;
}
export interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
}

export const EYE_A = { left: 33, right: 133, upper: 159, lower: 145, iris: [468, 469, 470, 471, 472] };
export const EYE_B = { left: 362, right: 263, upper: 386, lower: 374, iris: [473, 474, 475, 476, 477] };
export const NOSE_TIP = 1;

/** How far the head may move from its calibrated pose (rad / cm) before selections pause. */
export const HEAD_LIMITS = { yaw: 0.24, pitch: 0.2, tx: 6, ty: 5, tz: 14 };
export const IRIS_POINTS = [...EYE_A.iris, ...EYE_B.iris];

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface EyeFeatures {
  ix: number; // iris along the corner-to-corner axis, in eye widths, 0 = eye centre
  iy: number; // iris perpendicular to that axis, in eye widths
  gap: number; // lid aperture / eye width
  width: number; // eye width in image px (aspect-corrected)
  weight: number; // 0.05..1 reliability from openness
}

export interface FrameFeatures {
  vector: number[]; // see FEATURE_NAMES in ridge.ts
  eyes: [EyeFeatures, EyeFeatures];
  head: HeadPose;
  blinkL: number;
  blinkR: number;
  nose: P2; // normalised image coords
  /** Nose tip relative to the eye-corner midpoint, in eye-distance units (head turn/tilt, translation-free). */
  tilt: P2;
  eyeDistPx: number; // outer-corner distance in video px
}

/** Converts a normalised landmark to isotropic coordinates (both axes in units of frame height). */
function iso(l: LandmarkLike, aspect: number): P2 {
  return { x: l.x * aspect, y: l.y };
}

export function eyeFeatures(lm: LandmarkLike[], eye: typeof EYE_A, aspect: number, videoH: number): EyeFeatures {
  const a = iso(lm[eye.left], aspect);
  const b = iso(lm[eye.right], aspect);
  const up = iso(lm[eye.upper], aspect);
  const lo = iso(lm[eye.lower], aspect);
  let cx = 0;
  let cy = 0;
  for (const i of eye.iris) {
    const p = iso(lm[i], aspect);
    cx += p.x;
    cy += p.y;
  }
  cx /= eye.iris.length;
  cy /= eye.iris.length;

  const w = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
  const ux = (b.x - a.x) / w;
  const uy = (b.y - a.y) / w;
  // Perpendicular pointing "down" in image space.
  const vx = -uy;
  const vy = ux;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const ix = ((cx - mx) * ux + (cy - my) * uy) / w;
  const iy = ((cx - mx) * vx + (cy - my) * vy) / w;
  const gap = ((lo.x - up.x) * vx + (lo.y - up.y) * vy) / w;
  // Open eyes have gap ~0.25–0.35; closed ~0.05. Map to a reliability weight.
  const weight = Math.min(1, Math.max(0.05, (gap - 0.08) / 0.15));
  return { ix, iy, gap, width: w * videoH, weight };
}

/** Extracts yaw/pitch/roll (rad) and translation from a column-major 4x4 transform. */
export function headPoseFromMatrix(data: ArrayLike<number> | undefined): HeadPose {
  if (!data || data.length < 16) return { yaw: 0, pitch: 0, roll: 0, tx: 0, ty: 0, tz: 0 };
  const R = (r: number, c: number) => data[c * 4 + r];
  const pitch = Math.atan2(R(2, 1), R(2, 2));
  const yaw = Math.asin(Math.max(-1, Math.min(1, -R(2, 0))));
  const roll = Math.atan2(R(1, 0), R(0, 0));
  return { yaw, pitch, roll, tx: data[12], ty: data[13], tz: data[14] };
}

export type BlendshapeMap = Record<string, number>;

export function blendshapeMap(cats: { categoryName: string; score: number }[] | undefined): BlendshapeMap {
  const m: BlendshapeMap = {};
  if (cats) for (const c of cats) m[c.categoryName] = c.score;
  return m;
}

export function extractFeatures(
  lm: LandmarkLike[],
  bs: BlendshapeMap,
  matrix: ArrayLike<number> | undefined,
  videoW: number,
  videoH: number,
): FrameFeatures | null {
  if (!lm || lm.length < 478) return null;
  const aspect = videoW / videoH;
  const A = eyeFeatures(lm, EYE_A, aspect, videoH);
  const B = eyeFeatures(lm, EYE_B, aspect, videoH);
  const wsum = A.weight + B.weight;
  const avg = (k: 'ix' | 'iy' | 'gap') => (A[k] * A.weight + B[k] * B.weight) / wsum;

  const g = (k: string) => bs[k] ?? 0;
  // "toward subject's left" on both eyes is consistent whichever way the L/R labels are mirrored.
  const hL = g('eyeLookOutLeft') - g('eyeLookInLeft');
  const hR = g('eyeLookInRight') - g('eyeLookOutRight');
  const vL = g('eyeLookUpLeft') - g('eyeLookDownLeft');
  const vR = g('eyeLookUpRight') - g('eyeLookDownRight');
  const blinkL = g('eyeBlinkLeft');
  const blinkR = g('eyeBlinkRight');
  // Weight blendshape eyes by (1 - blink) as well.
  const oL = Math.max(0.05, 1 - blinkL);
  const oR = Math.max(0.05, 1 - blinkR);
  const lookH = (hL * oL + hR * oR) / (oL + oR);
  const lookV = (vL * oL + vR * oR) / (oL + oR);

  const head = headPoseFromMatrix(matrix);
  const vector = [
    avg('ix'),
    avg('iy'),
    lookH,
    lookV,
    head.yaw,
    head.pitch,
    head.roll,
    head.tx,
    head.ty,
    head.tz,
    avg('gap'),
  ];
  const oa = lm[EYE_A.left];
  const ob = lm[EYE_B.right];
  const eyeDistPx = Math.hypot((ob.x - oa.x) * videoW, (ob.y - oa.y) * videoH);
  const midX = ((oa.x + ob.x) / 2) * videoW;
  const midY = ((oa.y + ob.y) / 2) * videoH;
  const tilt = {
    x: (lm[NOSE_TIP].x * videoW - midX) / (eyeDistPx || 1),
    y: (lm[NOSE_TIP].y * videoH - midY) / (eyeDistPx || 1),
  };
  return {
    vector,
    eyes: [A, B],
    head,
    blinkL,
    blinkR,
    nose: { x: lm[NOSE_TIP].x, y: lm[NOSE_TIP].y },
    eyeDistPx,
    tilt,
  };
}
