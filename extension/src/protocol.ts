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
  eyeRatio?: number; // outer eye-corner distance / video width
}

export type ControlMsg =
  | { type: 'og-start' }
  | { type: 'og-stop' }
  | { type: 'og-open-app' }
  | { type: 'og-offscreen'; ok: boolean; error?: string };

export const GAZE_PORT = 'og-gaze';
