import type App from "../app/App";
import { VisionEngine, type VisionEngineOptions } from "../engine/VisionEngine";
import { FrameLoop, type FrameLoopOptions } from "../loop/FrameLoop";
import type { PerformanceMonitor } from "../perf/PerformanceMonitor";

export interface SessionOptions {
    /** Automatically cleanup when the page is hidden or unloaded. Default: true. */
    autoCleanupOnPageLifecycle?: boolean;
}

export interface SessionStartOptions {
    /** Video element that receives webcam frames. */
    video: HTMLVideoElement;
    /** App that receives per-frame tracker results. */
    app: App;
    /** VisionEngine initialization options. */
    visionEngineOptions: VisionEngineOptions;
    /** FrameLoop options used to construct FrameLoop. */
    frameLoopOptions?: FrameLoopOptions;
    /** Enable visual debug view. */
    debugView?: boolean;
    /** Media constraints for getUserMedia. Default: { video: true }. */
    mediaStreamConstraints?: MediaStreamConstraints;
    /**
     * Optional performance monitor. Receives session-wide metrics (camera acquire,
     * engine init) as well as per-frame metrics from the underlying FrameLoop.
     */
    performanceMonitor?: PerformanceMonitor;
}

/**
 * High-level session that manages camera, VisionEngine, and FrameLoop lifecycles.
 *
 * Usage:
 * ```ts
 * const kridaSession = new Session();
 * await kridaSession.start({
 *   video,
 *   app,
 *   visionEngineOptions: { handLandmarkerEnabled: true, poseLandmarkerEnabled: true },
 * });
 *
 * // Later:
 * kridaSession.destroy();
 * ```
 */
export class Session {

    private _visionEngine: VisionEngine | null = null;
    private readonly _autoCleanupOnPageLifecycle: boolean;

    private _frameLoop: FrameLoop | null = null;
    private _video: HTMLVideoElement | null = null;
    private _stream: MediaStream | null = null;
    private _startupAbortController: AbortController | null = null;

    private _lifecycleListenersRegistered: boolean = false;

    private readonly _onPageLifecycle = (): void => {
        this.destroy();
    };

    constructor(options: SessionOptions = {}) {
        this._autoCleanupOnPageLifecycle = options.autoCleanupOnPageLifecycle ?? true;
    }

    /** Returns true when a loop exists and is currently running. */
    get isRunning(): boolean {
        return this._frameLoop?.isRunning ?? false;
    }

    /**
     * Acquire the camera, initialize the {@link VisionEngine}, start the
     * {@link FrameLoop}, and invoke the app's `onStart` hook.
     * Any previously running session is destroyed first.
     */
    start = async (options: SessionStartOptions): Promise<void> => {
        this.destroy();

        const startupAbortController = new AbortController();
        this._startupAbortController = startupAbortController;
        const { signal } = startupAbortController;

        this._video = options.video;

        if (this._autoCleanupOnPageLifecycle) {
            this.registerLifecycleListeners();
        }

        const monitor = options.performanceMonitor ?? null;

        let stream: MediaStream | null = null;
        let visionEngine: VisionEngine | null = null;
        try {
            const includedPermissionPrompt = monitor !== null
                ? await this.cameraPermissionWillPrompt()
                : false;
            this.throwIfAborted(signal);
            const cameraStart = performance.now();

            stream = await navigator.mediaDevices.getUserMedia(
                options.mediaStreamConstraints ?? { video: true }
            );
            this.throwIfAborted(signal);

            this._video.srcObject = stream;
            await this.waitForVideoData(this._video, signal);

            monitor?.recordCameraAcquire(performance.now() - cameraStart, includedPermissionPrompt);

            this.throwIfAborted(signal);
            visionEngine = await VisionEngine.create(options.visionEngineOptions, monitor);
            this.throwIfAborted(signal);

            // Commit all acquired resources — only reached if this call won the race.
            this._stream = stream;
            stream = null;
            this._visionEngine = visionEngine;
            visionEngine = null;

            let frameLoopOptions: FrameLoopOptions | undefined = options.frameLoopOptions;

            // Create a debugCanvas if required but an existing one was not provided via frameLoopOptions.
            if (options.debugView && !frameLoopOptions?.debugCanvas) {
                // Ensure frameLoopOptions exists
                frameLoopOptions ??= {};

                const debugCanvas: HTMLCanvasElement = document.createElement('canvas');
                Object.assign(debugCanvas.style, {
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                });
                this._video.parentElement?.appendChild(debugCanvas);
                frameLoopOptions.debugCanvas = debugCanvas;
            }

            this._frameLoop = new FrameLoop(this._visionEngine, frameLoopOptions, monitor);
            this._frameLoop.start(this._video, options.app.updateTracker.bind(options.app));

            options.app.onStart?.();
        } catch (error) {
            visionEngine?.destroy();
            if (stream) {
                for (const track of stream.getTracks()) {
                    track.stop();
                }
            }
            if (this._startupAbortController === startupAbortController) {
                this.destroy();
            }
            throw error;
        } finally {
            if (this._startupAbortController === startupAbortController) {
                this._startupAbortController = null;
            }
        }
    };

    /**
     * Stop rendering and release all session-owned resources.
     * Safe to call multiple times.
     */
    destroy = (): void => {
        this._startupAbortController?.abort();
        this._startupAbortController = null;

        // TODO: Call App.onStop()

        this._frameLoop?.destroy();
        this._frameLoop = null;

        this._visionEngine?.destroy();
        this._visionEngine = null;

        if (this._stream) {
            for (const track of this._stream.getTracks()) {
                track.stop();
            }
            this._stream = null;
        }

        if (this._video && this._video.srcObject) {
            this._video.srcObject = null;
        }

        this._video = null;

        this.unregisterLifecycleListeners();
    };

    private waitForVideoData = async (video: HTMLVideoElement, signal: AbortSignal): Promise<void> => {
        if (video.readyState >= 2) {
            return;
        }

        this.throwIfAborted(signal);

        await new Promise<void>((resolve, reject) => {
            const onLoadedData = (): void => {
                cleanup();
                resolve();
            };
            const onError = (): void => {
                cleanup();
                reject(new Error("Video element failed to load stream data"));
            };
            const onAbort = (): void => {
                cleanup();
                reject(new Error("Session start aborted"));
            };

            const cleanup = (): void => {
                video.removeEventListener("loadeddata", onLoadedData);
                video.removeEventListener("error", onError);
                signal.removeEventListener("abort", onAbort);
            };

            video.addEventListener("loadeddata", onLoadedData, { once: true });
            video.addEventListener("error", onError, { once: true });
            signal.addEventListener("abort", onAbort, { once: true });
        });
    };

    private async cameraPermissionWillPrompt(): Promise<boolean> {
        // Conservative default: if we cannot determine state, assume the call
        // may prompt so consumers do not treat the number as pure machine time.
        if (!navigator.permissions?.query) {
            return true;
        }
        try {
            const status = await navigator.permissions.query({ name: "camera" as PermissionName });
            return status.state !== "granted";
        } catch {
            return true;
        }
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw new Error("Session start aborted");
        }
    }

    private registerLifecycleListeners(): void {
        if (this._lifecycleListenersRegistered) {
            return;
        }

        window.addEventListener("pagehide", this._onPageLifecycle);
        window.addEventListener("beforeunload", this._onPageLifecycle);
        this._lifecycleListenersRegistered = true;
    }

    private unregisterLifecycleListeners(): void {
        if (!this._lifecycleListenersRegistered) {
            return;
        }

        window.removeEventListener("pagehide", this._onPageLifecycle);
        window.removeEventListener("beforeunload", this._onPageLifecycle);
        this._lifecycleListenersRegistered = false;
    }
}

export default Session;
