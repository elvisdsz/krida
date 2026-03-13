import { DrawingUtils, HandLandmarker } from "@mediapipe/tasks-vision";
import { Engine, HandTrackerResult } from "./Engine";
import App from "../app/App";

export interface EngineLoopOptions {
    /**
     * Target frames per second. Set to `null` for uncapped rendering.
     * Default: `30`
     */
    targetFPS?: number | null;
    /**
     * Render debug overlays: hand connections, landmark dots, and index labels.
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
 * Drives a `requestAnimationFrame` loop, polls the {@link Engine} for hand
 * tracking results each frame, and delegates drawing to a {@link App}.
 *
 * Usage:
 * ```ts
 * const engine = new Engine();
 * await engine.init({ handLandmarkerEnabled: true, ... });
 *
 * const loop = new EngineLoop(engine, { targetFPS: 30 });
 * loop.start(videoElement, canvasElement, myApp);
 *
 * // Later:
 * loop.stop();
 * ```
 */
export class EngineLoop {

    private frameId: number | null = null;
    private lastFrameTime: number = 0;
    private lastVideoTime: number = -1;
    private readonly frameInterval: number | null;
    private _debugView: boolean;
    private _autoClear: boolean;
    private _drawingUtils: DrawingUtils | null = null;
    private _app: App | null = null;
    private readonly engine: Engine;

    constructor(engine: Engine, options: EngineLoopOptions = {}) {
        this.engine = engine;
        const targetFPS = options.targetFPS !== undefined ? options.targetFPS : 30;
        this.frameInterval = targetFPS !== null ? 1000 / targetFPS : null;
        this._debugView = options.debugView ?? false;
        this._autoClear = options.autoClear ?? true;
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
        this._app = app;
        this.lastVideoTime = -1;

        const drawFrame = async (currentTime: number) => {
            const delta = currentTime - this.lastFrameTime;
            if (this.frameInterval == null || delta >= this.frameInterval) {
                await this.renderFrame(video, canvas);
                this.lastFrameTime = currentTime;
            }
            this.frameId = requestAnimationFrame(drawFrame);
        };

        this.frameId = requestAnimationFrame(drawFrame);
    }

    /** Stop the render loop. Safe to call when already stopped. */
    stop(): void {
        if (this.frameId !== null) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        this._drawingUtils = null;
    }

    /** Swap the active app without restarting the loop. */
    setApp(app: App): void {
        this._app = app;
    }

    /** Toggle debug landmark overlay without restarting the loop. */
    get debugView(): boolean {
        return this._debugView;
    }

    set debugView(enabled: boolean) {
        this._debugView = enabled;
    }

    /** `true` while the loop is running. */
    get isRunning(): boolean {
        return this.frameId !== null;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async renderFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
        const ctx = canvas.getContext("2d");
        if (!ctx || !this._app) return;

        if (this._autoClear) ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Skip if the video hasn't advanced to a new frame
        if (this.lastVideoTime === video.currentTime) return;
        this.lastVideoTime = video.currentTime;

        const startTimeMs = performance.now();
        const results = await this.engine.getResults(video, startTimeMs);

        if (results) {
            this._app.draw(ctx, results);
            if (this._debugView) {
                this.drawDebugFrame(ctx, canvas, results);
            }
        }
    }

    private drawDebugFrame(
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

            for (let i = 0; i < landmarks.length; i++) {
                const x = landmarks[i].x * canvas.width;
                const y = landmarks[i].y * canvas.height;
                ctx.fillStyle = "blue";
                ctx.font = "12px Arial";
                ctx.fillText(i.toString(), x, y);
            }
        }
    }
}

export default EngineLoop;
