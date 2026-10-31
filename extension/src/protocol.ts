// Messages between the offscreen sensor page, the service worker, the popup and content scripts.
import type { HeadPose } from '../../src/gaze/features';

/** One camera frame's gaze features, streamed from the offscreen page to content scripts (~30/s). */
export interface FrameMsg {
  type: 'frame';
  t: number;
  face: boolean;
  v?: number[];
  head?: HeadPose;
  blinkL?: number;
  blinkR?: number;
  nose?: { x: number; y: number };
  /** Head turn/tilt (nose relative to eyes, eye-distance units) for the head pointer. */
  tilt?: { x: number; y: number };
  eyeRatio?: number; // outer eye-corner distance / video width
}

/** Small JPEG camera thumbnail (~10/s) so the user can see how to centre themselves. Only sent on request. */
export interface PreviewMsg {
  type: 'preview';
  url: string;
}

/** Content script -> sensor: ask for (or stop) camera thumbnails. */
export interface WantPreviewMsg {
  type: 'want-preview';
  on: boolean;
}

export type ControlMsg =
  | { type: 'og-start' }
  | { type: 'og-stop' }
  | { type: 'og-open-app' }
  | { type: 'og-offscreen'; ok: boolean; error?: string };

export const GAZE_PORT = 'og-gaze';
