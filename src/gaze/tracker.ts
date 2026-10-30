// Camera + MediaPipe FaceLandmarker loop. Every frame is processed in the browser and discarded:
// nothing is recorded, stored or uploaded.

import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { blendshapeMap, extractFeatures, type FrameFeatures } from './features';

export interface TrackerFrame {
  t: number; // performance.now() ms
  face: boolean;
  f: FrameFeatures | null;
  landmarks: NormalizedLandmark[] | null;
  fps: number;
  brightness: number; // 0..255 mean luma, updated ~1/s
  videoW: number;
  videoH: number;
}

type Listener = (fr: TrackerFrame) => void;

const BASE = import.meta.env.BASE_URL;

export class Tracker {
  video: HTMLVideoElement;
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastVideoTime = -1;
  private listeners = new Set<Listener>();
  private fpsT = 0;
  private fpsN = 0;
  fps = 0;
  brightness = 128;
  private lumaCanvas = document.createElement('canvas');
  private lastLuma = 0;
  delegate: 'GPU' | 'CPU' = 'GPU';

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.lumaCanvas.width = 32;
    this.lumaCanvas.height = 24;
  }

  get active() {
    return this.running;
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    const [stream, landmarker] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      }),
      this.landmarker ? Promise.resolve(this.landmarker) : this.createLandmarker(),
    ]);
    this.stream = stream;
    this.landmarker = landmarker;
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private async createLandmarker(): Promise<FaceLandmarker> {
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${BASE}models/face_landmarker.task`, delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('[tracker] GPU delegate unavailable, falling back to CPU', e);
      this.delegate = 'CPU';
      return FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  private loop = () => {
    if (!this.running) return;
    const v = this.video;
    const schedule = () => {
      const anyV = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (anyV.requestVideoFrameCallback) anyV.requestVideoFrameCallback(this.loop);
      else requestAnimationFrame(this.loop);
    };
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime && this.landmarker) {
      this.lastVideoTime = v.currentTime;
      const t = performance.now();
      let res;
      try {
        res = this.landmarker.detectForVideo(v, t);
      } catch (e) {
        console.error('[tracker] detect failed', e);
        schedule();
        return;
      }
      this.tickFps(t);
      this.measureBrightness(t);
      const lm = res.faceLandmarks?.[0] ?? null;
      const W = v.videoWidth;
      const H = v.videoHeight;
      const f = lm
        ? extractFeatures(
            lm,
            blendshapeMap(res.faceBlendshapes?.[0]?.categories),
            res.facialTransformationMatrixes?.[0]?.data,
            W,
            H,
          )
        : null;
      const frame: TrackerFrame = {
        t,
        face: !!f,
        f,
        landmarks: lm,
        fps: this.fps,
        brightness: this.brightness,
        videoW: W,
        videoH: H,
      };
      this.listeners.forEach((fn) => fn(frame));
    }
    schedule();
  };

  private tickFps(t: number) {
    this.fpsN++;
    if (t - this.fpsT >= 1000) {
      this.fps = (this.fpsN * 1000) / (t - this.fpsT);
      this.fpsN = 0;
      this.fpsT = t;
    }
  }

  private measureBrightness(t: number) {
    if (t - this.lastLuma < 1000) return;
    this.lastLuma = t;
    const ctx = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, 32, 24);
    const d = ctx.getImageData(0, 0, 32, 24).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    this.brightness = s / (d.length / 4);
  }
}

export const tracker = new Tracker();
