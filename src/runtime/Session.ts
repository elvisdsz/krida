import type App from "../app/App";
import { VisionEngine, type VisionEngineOptions } from "../engine/VisionEngine";
import { RenderLoop, type RenderLoopOptions } from "../render/RenderLoop";

export interface SessionOptions {
    /** Automatically cleanup when the page is hidden or unloaded. Default: true. */
    autoCleanupOnPageLifecycle?: boolean;
}

export interface SessionStartOptions {
    /** Video element that receives webcam frames. */
    video: HTMLVideoElement;
    /** Canvas element used for app rendering. */
    canvas: HTMLCanvasElement;
    /** App that receives per-frame tracker results. */
    app: App;
    /** VisionEngine initialization options. */
    visionEngineOptions: VisionEngineOptions;
    /** RenderLoop options used to construct RenderLoop. */
    renderLoopOptions?: RenderLoopOptions;
    /** Media constraints for getUserMedia. Default: { video: true }. */
    mediaStreamConstraints?: MediaStreamConstraints;
}

/**
 * High-level session that manages camera, VisionEngine, and RenderLoop lifecycles.
 *
 * Usage:
 * ```ts
 * const kridaSession = new Session();
 * await kridaSession.start({
 *   video,
 *   canvas,
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

    private _renderLoop: RenderLoop | null = null;
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
        return this._renderLoop?.isRunning ?? false;
    }

    /**
     * Start camera streaming, initialize the engine, and begin rendering.
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

        let stream: MediaStream | null = null;
        let visionEngine: VisionEngine | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia(
                options.mediaStreamConstraints ?? { video: true }
            );
            this.throwIfAborted(signal);

            this._video.srcObject = stream;
            await this.waitForVideoData(this._video, signal);

            options.canvas.width = this._video.videoWidth;
            options.canvas.height = this._video.videoHeight;

            this.throwIfAborted(signal);
            visionEngine = await VisionEngine.create(options.visionEngineOptions);
            this.throwIfAborted(signal);

            // Commit all acquired resources — only reached if this call won the race.
            this._stream = stream;
            stream = null;
            this._visionEngine = visionEngine;
            visionEngine = null;

            this._renderLoop = new RenderLoop(this._visionEngine, options.renderLoopOptions);
            this._renderLoop.start(this._video, options.canvas, options.app);
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

        this._renderLoop?.destroy();
        this._renderLoop = null;

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
