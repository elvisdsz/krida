import { DrawingUtils, HandLandmarker, type NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import { VisionEngine, type HandTrackerResult, type PoseTrackerResult, type TrackerResult } from "../engine/VisionEngine";
import type { App } from "../app/App";
import type { PerformanceMonitor } from "../perf/PerformanceMonitor";

export interface RenderLoopOptions {
    /**
     * Target frames per second. Set to `null` for uncapped rendering.
     * Default: `30`
     */
    targetFPS?: number | null;
    /**
     * Render debug overlays: landmark connections, dots, and index labels.
     * Default: `false`
     */
    debugView?: boolean;
    /**
     * Clear the canvas before each frame. Set to `false` if inter-frame canvas persistence is needed.
     * Default: `true`
     */
    autoClear?: boolean;
}

/**
 * Framework-agnostic render loop.
 *
 * Drives a `requestAnimationFrame` loop, polls the {@link VisionEngine} for
 * tracking results each frame, and delegates drawing to a {@link App}.
 *
 * Usage:
 * ```ts
 * const visionEngine = await VisionEngine.create({ handLandmarkerEnabled: true, ... });
 *
 * const loop = new RenderLoop(visionEngine, { targetFPS: 30 });
 * loop.start(videoElement, canvasElement, myApp);
 *
 * // Later:
 * loop.destroy();
 * visionEngine.destroy();
 * ```
 */
export class RenderLoop {

    private _frameId: number | null = null;
    private _lastFrameTime: number = 0;
    private _lastVideoTime: number = -1;
    private readonly _frameInterval: number | null;
    private _debugView: boolean;
    private _autoClear: boolean;
    private _drawingUtils: DrawingUtils | null = null;
    private _app: App | null = null;
    private readonly _visionEngine: VisionEngine;
    private readonly _monitor: PerformanceMonitor | null;
    private _lastAcceptedFrameTime: number = 0;

    constructor(
        visionEngine: VisionEngine,
        options: RenderLoopOptions = {},
        monitor: PerformanceMonitor | null = null
    ) {
        this._visionEngine = visionEngine;
        const targetFPS = options.targetFPS !== undefined ? options.targetFPS : 30;
        this._frameInterval = targetFPS !== null ? 1000 / targetFPS : null;
        this._debugView = options.debugView ?? false;
        this._autoClear = options.autoClear ?? true;
        this._monitor = monitor;
    }

    /**
     * Start the render loop.
     * Automatically stops any previously running loop before starting.
     *
     * @param video  The `<video>` element providing the webcam stream.
     * @param canvas The `<canvas>` element to draw onto.
     * @param app    The {@link App} that receives each frame's tracking results.
     */
    start(video: HTMLVideoElement, canvas: HTMLCanvasElement, app: App): void {
        this.stop();
        this._lastFrameTime = 0;
        this._lastVideoTime = -1;
        this._lastAcceptedFrameTime = 0;
        this._app = app;

        try {
            this._app.onStart?.();
        } catch (error) {
            this._app = null;
            this._drawingUtils = null;
            throw error;
        }

        const drawFrame = (currentTime: number) => {
            const delta = currentTime - this._lastFrameTime;
            if (this._frameInterval == null || delta >= this._frameInterval) {
                this.renderFrame(video, canvas, currentTime);
                this._lastFrameTime = currentTime;
            }
            this._frameId = requestAnimationFrame(drawFrame);
        };

        this._frameId = requestAnimationFrame(drawFrame);
    }

    /**
     * Stop the render loop. Safe to call when already stopped.
     *
     * @throws If the active app's `onStop` throws. Loop state is fully cleared
     * before the throw propagates, so the loop is safe to restart via
     * {@link start} afterwards.
     */
    stop(): void {
        const app = this._frameId !== null ? this._app : null;

        if (this._frameId !== null) {
            cancelAnimationFrame(this._frameId);
            this._frameId = null;
        }

        this._app = null;
        this._drawingUtils = null;

        app?.onStop?.();
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

    /**
     * Swap the active app without restarting the loop.
     *
     * @throws If either the outgoing app's `onStop` or the incoming app's
     * `onStart` throws. In that case the loop is stopped entirely and must be
     * restarted via {@link start} before it will produce frames again.
     */
    setApp(app: App): void {
        const isRunning = this.isRunning;

        if (isRunning) {
            try {
                this._app?.onStop?.();
            } catch (error) {
                this._app = null;
                this.stop();
                throw error;
            }
        }

        this._app = app;

        if (!isRunning) {
            return;
        }

        try {
            this._app.onStart?.();
        } catch (error) {
            this._app = null;
            this.stop();
            throw error;
        }
    }

    /** Returns `true` if debug view is enabled. */
    get debugView(): boolean {
        return this._debugView;
    }
    
    /** Toggle debug landmark overlay without restarting the loop. */
    set debugView(enabled: boolean) {
        this._debugView = enabled;
    }

    /** `true` if auto-clearing the canvas before each frame is enabled. */
    get autoClear(): boolean {
        return this._autoClear;
    }

    /** Toggle canvas auto-clear without restarting the loop. */
    set autoClear(enabled: boolean) {
        this._autoClear = enabled;
    }

    /** `true` while the loop is running. */
    get isRunning(): boolean {
        return this._frameId !== null;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private renderFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, currentTime: number): void {
        const ctx = canvas.getContext("2d");
        if (!ctx || !this._app) return;

        if (this._autoClear) ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Skip if the video hasn't advanced to a new frame
        if (this._lastVideoTime === video.currentTime) return;
        this._lastVideoTime = video.currentTime;

        if (this._lastAcceptedFrameTime > 0) {
            this._monitor?.recordFrameTime(currentTime - this._lastAcceptedFrameTime);
        }
        this._lastAcceptedFrameTime = currentTime;

        const frameStart = performance.now();

        const trackerResult: TrackerResult = this._visionEngine.getTrackerResult(video, frameStart, this._monitor);

        this._app.updateTracker(trackerResult);

        if (this._debugView && (trackerResult.hand || trackerResult.pose)) {
            this.drawDebugFrame(ctx, canvas, trackerResult);
        }
    }

    private drawDebugFrame(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        result: TrackerResult
    ): void {
        if (result.hand) {
            this.drawDebugHandsFrame(ctx, canvas, result.hand);
        }
        if (result.pose) {
            this.drawDebugPoseFrame(ctx, canvas, result.pose);
        }
    }

    private drawDebugHandsFrame(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        result: HandTrackerResult
    ): void {
        this._drawingUtils ??= new DrawingUtils(ctx);
        const drawingUtils = this._drawingUtils;

        for (const landmarks of result.landmarks) {
            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
                color: "#00FF00",
                lineWidth: 5,
            });
            drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 2 });

            this.drawLandmarkLabels(ctx, canvas, landmarks);
        }
    }

    private drawDebugPoseFrame(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        result: PoseTrackerResult
    ): void {
        this._drawingUtils ??= new DrawingUtils(ctx);
        const drawingUtils = this._drawingUtils;

        for (const landmarks of result.landmarks) {
            drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
                color: "#9755b1",
                lineWidth: 5,
            });
            drawingUtils.drawLandmarks(landmarks, { color: "#3033d8", lineWidth: 2 });

            this.drawLandmarkLabels(ctx, canvas, landmarks);
        }
    }

    private drawLandmarkLabels(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        landmarks: NormalizedLandmark[]
    ): void {
        ctx.fillStyle = "blue";
        ctx.font = "12px Arial";
        for (let i = 0; i < landmarks.length; i++) {
            const x = landmarks[i].x * canvas.width;
            const y = landmarks[i].y * canvas.height;
            ctx.fillText(i.toString(), x, y);
        }
    }
}
