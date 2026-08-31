import {
  DrawingUtils,
  HandLandmarker,
  type NormalizedLandmark,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import {
  VisionEngine,
  type HandTrackerResult,
  type PoseTrackerResult,
  type TrackerResult,
} from "../engine/VisionEngine";
import type { PerformanceMonitor } from "../perf/PerformanceMonitor";
import { fitCanvasToVideo } from "../dom/canvas";

export interface FrameLoopOptions {
  /**
   * Target frames per second. Set to `null` for uncapped rendering.
   * Default: `30`
   */
  targetFPS?: number | null;
  /**
   * Canvas to render debug overlays: landmark connections, dots, and index labels.
   * Default: `null` (no debug view). If provided, debug view is enabled.
   */
  debugCanvas?: HTMLCanvasElement | null;
}

/**
 * Per-frame timer loop.
 *
 * Drives a `requestAnimationFrame` loop, polls the {@link VisionEngine} for
 * tracking results each frame, and hands each result to the callback passed to
 * {@link start}.
 *
 * Usage:
 * ```ts
 * const visionEngine = await VisionEngine.create({ handLandmarkerEnabled: true, ... });
 *
 * const loop = new FrameLoop(visionEngine, { targetFPS: 24 });
 * loop.start(videoElement, (trackerResult) => { console.log(trackerResult); });
 *
 * // Later:
 * loop.destroy();
 * visionEngine.destroy();
 * ```
 */
export class FrameLoop {
  private _frameId: number | null = null;
  private _lastFrameTime: number = 0;
  private _lastVideoTime: number = -1;
  private readonly _frameInterval: number | null;
  private _debugCanvasCtx: CanvasRenderingContext2D | null = null;
  private _drawingUtils: DrawingUtils | null = null;
  private _trackerCallback: ((trackerResult: TrackerResult) => void) | null = null;
  private readonly _visionEngine: VisionEngine;
  private readonly _monitor: PerformanceMonitor | null;
  private _lastAcceptedFrameTime: number = 0;
  private _abortController: AbortController | null = null;

  constructor(
    visionEngine: VisionEngine,
    options: FrameLoopOptions = {},
    monitor: PerformanceMonitor | null = null,
  ) {
    this._visionEngine = visionEngine;
    const targetFPS = options.targetFPS !== undefined ? options.targetFPS : 30;
    this._frameInterval = targetFPS !== null ? 1000 / targetFPS : null;
    this.debugCanvas = options.debugCanvas ?? null;
    this._monitor = monitor;
  }

  /**
   * Start the frame loop.
   * Automatically stops any previously running loop before starting.
   *
   * @param video     The `<video>` element providing the webcam stream.
   * @param callback  Receives the {@link TrackerResult} for every processed frame.
   */
  start(video: HTMLVideoElement, callback?: (trackerResult: TrackerResult) => void): void {
    this.stop();
    this._lastFrameTime = 0;
    this._lastVideoTime = -1;
    this._lastAcceptedFrameTime = 0;
    if (callback) {
      this._trackerCallback = callback;
    }
    this._abortController = new AbortController();

    if (this._debugCanvasCtx) {
      fitCanvasToVideo(this._debugCanvasCtx.canvas, video, this._abortController.signal);
    }

    const makeFrame = (currentTime: number) => {
      const delta = currentTime - this._lastFrameTime;
      if (this._frameInterval == null || delta >= this._frameInterval) {
        this.processFrame(video, currentTime);
        this._lastFrameTime = currentTime;
      }
      this._frameId = requestAnimationFrame(makeFrame);
    };

    this._frameId = requestAnimationFrame(makeFrame);
  }

  /**
   * Stop the frame loop. Safe to call when already stopped.
   *
   * Clears the tracker callback. The loop is safe to restart via
   * {@link start} afterwards, but the callback must be passed again.
   */
  stop(): void {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }

    this._abortController?.abort();
    this._abortController = null;
    this._trackerCallback = null;
    this._drawingUtils = null;
  }

  /**
   * Release loop-owned resources.
   * Does not destroy the engine so shared engine instances can outlive the loop.
   */
  destroy(): void {
    this.stop();
    this._lastFrameTime = 0;
    this._lastVideoTime = -1;
    this._lastAcceptedFrameTime = 0;
  }

  /** Set the debug canvas. */
  set debugCanvas(canvas: HTMLCanvasElement | null) {
    const ctx = canvas?.getContext("2d");
    if (ctx) {
      this._debugCanvasCtx = ctx;
    } else {
      this._debugCanvasCtx = null;
    }
  }

  /** `true` while the loop is running. */
  get isRunning(): boolean {
    return this._frameId !== null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private processFrame(video: HTMLVideoElement, currentTime: number): void {
    // Skip if the video hasn't advanced to a new frame
    if (this._lastVideoTime === video.currentTime) return;
    this._lastVideoTime = video.currentTime;

    if (this._lastAcceptedFrameTime > 0) {
      this._monitor?.recordFrameTime(currentTime - this._lastAcceptedFrameTime);
    }
    this._lastAcceptedFrameTime = currentTime;

    const frameStart = performance.now();

    const trackerResult: TrackerResult = this._visionEngine.getTrackerResult(
      video,
      frameStart,
      this._monitor,
    );

    if (this._trackerCallback) {
      this._trackerCallback(trackerResult);
    }

    if (this._debugCanvasCtx) {
      this._debugCanvasCtx.clearRect(
        0,
        0,
        this._debugCanvasCtx.canvas.width,
        this._debugCanvasCtx.canvas.height,
      );
      if (trackerResult.hand || trackerResult.pose) {
        this.drawDebugFrame(this._debugCanvasCtx, trackerResult);
      }
    }
  }

  private drawDebugFrame(ctx: CanvasRenderingContext2D, result: TrackerResult): void {
    if (result.hand) {
      this.drawDebugHandsFrame(ctx, result.hand);
    }
    if (result.pose) {
      this.drawDebugPoseFrame(ctx, result.pose);
    }
  }

  private drawDebugHandsFrame(ctx: CanvasRenderingContext2D, result: HandTrackerResult): void {
    this._drawingUtils ??= new DrawingUtils(ctx);
    const drawingUtils = this._drawingUtils;

    for (const landmarks of result.landmarks) {
      drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
        color: "#00FF00",
        lineWidth: 5,
      });
      drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 2 });

      this.drawLandmarkLabels(ctx, landmarks);
    }
  }

  private drawDebugPoseFrame(ctx: CanvasRenderingContext2D, result: PoseTrackerResult): void {
    this._drawingUtils ??= new DrawingUtils(ctx);
    const drawingUtils = this._drawingUtils;

    for (const landmarks of result.landmarks) {
      drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: "#9755b1",
        lineWidth: 5,
      });
      drawingUtils.drawLandmarks(landmarks, { color: "#3033d8", lineWidth: 2 });

      this.drawLandmarkLabels(ctx, landmarks);
    }
  }

  private drawLandmarkLabels(ctx: CanvasRenderingContext2D, landmarks: NormalizedLandmark[]): void {
    ctx.fillStyle = "blue";
    ctx.font = "12px Arial";
    for (let i = 0; i < landmarks.length; i++) {
      const x = landmarks[i].x * ctx.canvas.width;
      const y = landmarks[i].y * ctx.canvas.height;
      ctx.fillText(i.toString(), x, y);
    }
  }
}
