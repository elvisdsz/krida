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
 * loop.bind(videoElement, (trackerResult) => { console.log(trackerResult); });
 * loop.start();
 *
 * // Later:
 * loop.destroy();
 * visionEngine.destroy();
 * ```
 */
export class FrameLoop {
  private _video: HTMLVideoElement | null = null;
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
   * Bind the video and result callback, replacing any previous binding. Stops a
   * running loop, so call {@link start} afterwards to resume, or drive it with
   * {@link update}.
   *
   * @param video     The `<video>` element providing the webcam stream.
   * @param onResult  Receives the {@link TrackerResult} for every processed frame.
   */
  bind(video: HTMLVideoElement, onResult?: (result: TrackerResult) => void): void {
    this.unbind();
    this._video = video;
    this._trackerCallback = onResult ?? null;
    this._lastFrameTime = 0;
    this._lastVideoTime = -1;
    this._lastAcceptedFrameTime = 0;
    this._abortController = new AbortController();

    if (this._debugCanvasCtx) {
      fitCanvasToVideo(this._debugCanvasCtx.canvas, video, this._abortController.signal);
    }
  }

  /**
   * Start the frame loop.
   * Has no effect when called on an already running loop.
   *
   * @throws If the loop isn't yet configured using `bind`.
   */
  start(): void {
    if (this._frameId !== null) {
      return;
    }

    if (this._video === null) {
      throw new Error("FrameLoop cannot be started without being configured first.");
    }

    const makeFrame = (currentTime: number) => {
      const delta = currentTime - this._lastFrameTime;
      if (this._frameInterval == null || delta >= this._frameInterval) {
        this.update(currentTime);
        this._lastFrameTime = currentTime;
      }
      this._frameId = requestAnimationFrame(makeFrame);
    };

    this._frameId = requestAnimationFrame(makeFrame);
  }

  /**
   * Process at most one new video frame and return its {@link TrackerResult}, or
   * `null` if the loop isn't bound or the video hasn't advanced. Ignores `targetFPS`.
   *
   * @param timestampMs  Frame time in ms. Should be monotonic, in the `performance.now()`
   * timebase. Default: `performance.now()`.
   */
  update(timestampMs = performance.now()): TrackerResult | null {
    if (this._video === null) {
      return null;
    }
    return this.processFrame(this._video, timestampMs);
  }

  /**
   * Stop the frame loop. Safe to call when already stopped.
   *
   * Keeps the bound video and tracker callback, so {@link start} resumes the loop.
   */
  stop(): void {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  /**
   * Release loop-owned resources.
   * Does not destroy the engine so shared engine instances can outlive the loop.
   */
  destroy(): void {
    this.unbind();
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

  private unbind(): void {
    this.stop();
    this._abortController?.abort();
    this._abortController = null;
    this._trackerCallback = null;
    this._drawingUtils = null;
    this._video = null;
  }

  private processFrame(video: HTMLVideoElement, currentTime: number): TrackerResult | null {
    // Skip if the video hasn't advanced to a new frame
    if (this._lastVideoTime === video.currentTime) {
      return null;
    }
    this._lastVideoTime = video.currentTime;

    if (this._lastAcceptedFrameTime > 0) {
      this._monitor?.recordFrameTime(currentTime - this._lastAcceptedFrameTime);
    }
    this._lastAcceptedFrameTime = currentTime;

    const trackerResult: TrackerResult = this._visionEngine.getTrackerResult(
      video,
      currentTime,
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

    return trackerResult;
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
