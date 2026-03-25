import type App from "../app/App";
import { Engine, type EngineOptions } from "./Engine";
import { EngineLoop, type EngineLoopOptions } from "./EngineLoop";

export interface EngineRuntimeOptions {
    /** Existing engine instance to use. Defaults to a new Engine instance. Note: EngineRuntime takes ownership and will call destroy() on it during cleanup. */
    engine?: Engine;
    /** Automatically cleanup when the page is hidden or unloaded. Default: true. */
    autoCleanupOnPageLifecycle?: boolean;
}

export interface EngineRuntimeStartOptions {
    /** Video element that receives webcam frames. */
    video: HTMLVideoElement;
    /** Canvas element used for app rendering. */
    canvas: HTMLCanvasElement;
    /** App that receives per-frame tracker results. */
    app: App;
    /** Engine initialization options. */
    engineOptions: EngineOptions;
    /** Loop options used to construct EngineLoop. */
    loopOptions?: EngineLoopOptions;
    /** Media constraints for getUserMedia. Default: { video: true }. */
    mediaStreamConstraints?: MediaStreamConstraints;
}

/**
 * High-level runtime that manages camera, Engine, and EngineLoop lifecycles.
 *
 * Usage:
 * ```ts
 * const runtime = new EngineRuntime();
 * await runtime.start({
 *   video,
 *   canvas,
 *   app,
 *   engineOptions: { handLandmarkerEnabled: true, poseLandmarkerEnabled: true },
 * });
 *
 * // Later:
 * runtime.destroy();
 * ```
 */
export class EngineRuntime {

    private readonly engine: Engine;
    private readonly autoCleanupOnPageLifecycle: boolean;

    private loop: EngineLoop | null = null;
    private video: HTMLVideoElement | null = null;
    private stream: MediaStream | null = null;
    private startupAbortController: AbortController | null = null;

    private lifecycleListenersRegistered: boolean = false;

    private readonly onPageLifecycle = (): void => {
        this.destroy();
    };

    constructor(options: EngineRuntimeOptions = {}) {
        this.engine = options.engine ?? new Engine();
        this.autoCleanupOnPageLifecycle = options.autoCleanupOnPageLifecycle ?? true;
    }

    /** Access to the underlying engine instance for advanced scenarios. */
    get trackerEngine(): Engine {
        return this.engine;
    }

    /** Returns true when a loop exists and is currently running. */
    get isRunning(): boolean {
        return this.loop?.isRunning ?? false;
    }

    /**
     * Start camera streaming, initialize the engine, and begin rendering.
     * Any previously running runtime session is destroyed first.
     */
    start = async (options: EngineRuntimeStartOptions): Promise<void> => {
        this.destroy();

        const startupAbortController = new AbortController();
        this.startupAbortController = startupAbortController;
        const { signal } = startupAbortController;

        this.video = options.video;

        if (this.autoCleanupOnPageLifecycle) {
            this.registerLifecycleListeners();
        }

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(
                options.mediaStreamConstraints ?? { video: true }
            );
            this.throwIfAborted(signal);

            this.video.srcObject = this.stream;
            await this.waitForVideoData(this.video, signal);

            options.canvas.width = this.video.videoWidth;
            options.canvas.height = this.video.videoHeight;

            await this.engine.init(options.engineOptions);
            this.throwIfAborted(signal);

            this.loop = new EngineLoop(this.engine, options.loopOptions);
            this.loop.start(this.video, options.canvas, options.app);
        } catch (error) {
            this.destroy();
            throw error;
        } finally {
            if (this.startupAbortController === startupAbortController) {
                this.startupAbortController = null;
            }
        }
    };

    /**
     * Stop rendering and release all runtime-owned resources.
     * Safe to call multiple times.
     */
    destroy = (): void => {
        this.startupAbortController?.abort();
        this.startupAbortController = null;

        this.loop?.destroy();
        this.loop = null;

        this.engine.destroy();

        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.stop();
            }
            this.stream = null;
        }

        if (this.video && this.video.srcObject) {
            this.video.srcObject = null;
        }

        this.video = null;

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
                reject(new Error("EngineRuntime start aborted"));
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
            throw new Error("EngineRuntime start aborted");
        }
    }

    private registerLifecycleListeners(): void {
        if (this.lifecycleListenersRegistered) {
            return;
        }

        window.addEventListener("pagehide", this.onPageLifecycle);
        window.addEventListener("beforeunload", this.onPageLifecycle);
        this.lifecycleListenersRegistered = true;
    }

    private unregisterLifecycleListeners(): void {
        if (!this.lifecycleListenersRegistered) {
            return;
        }

        window.removeEventListener("pagehide", this.onPageLifecycle);
        window.removeEventListener("beforeunload", this.onPageLifecycle);
        this.lifecycleListenersRegistered = false;
    }
}

export default EngineRuntime;
