// When OpenGaze runs as the browser extension's setup page, calibration is also saved to extension storage
// so the content script can use it on every website. Does nothing on the normal website.
import type { RidgeModel } from '../gaze/ridge';
import type { HeadRef } from '../gaze/engine';
import type { AccuracyReport } from '../gaze/accuracy';
import { viewportFrame } from '../gaze/screen';
import { settings } from './settings';

export const inExtension =
  typeof location !== 'undefined' && location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined';

export interface StoredCalibration {
  model: RidgeModel;
  headRef: HeadRef;
  accuracy: { meanPx: number; p95Px: number; meanDeg: number; grade: string } | null;
  /** Viewport frame of the page the calibration was done in (model outputs are in its CSS px). */
  frame: { left: number; top: number; scale: number };
  dpr: number;
  at: number;
}

export function saveCalibrationToExtension(model: RidgeModel, headRef: HeadRef, acc: AccuracyReport | null) {
  if (!inExtension || !chrome.storage?.local) return;
  const data: StoredCalibration = {
    model,
    headRef,
    accuracy:
      acc && isFinite(acc.meanPx)
        ? { meanPx: acc.meanPx, p95Px: acc.p95Px, meanDeg: acc.meanDeg, grade: acc.grade }
        : null,
    frame: viewportFrame(),
    dpr: window.devicePixelRatio,
    at: Date.now(),
  };
  void chrome.storage.local.set({ calibration: data, dwellMs: settings.get().dwellMs });
  // Once there's a validated calibration, start eye control for all websites.
  if (data.accuracy) void chrome.runtime.sendMessage({ type: 'og-start' }).catch(() => {});
}

if (inExtension && chrome.storage?.local) {
  settings.subscribe(() => void chrome.storage.local.set({ dwellMs: settings.get().dwellMs }));
}
