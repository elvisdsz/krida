export interface MetricStats {
    count: number;
    min: number;
    max: number;
    mean: number;
    p95: number;
    p99: number;
}

/**
 * Model initialization timings, split into fetch and load phases.
 *
 * Obtained by fetching the `.task` file explicitly and handing the resulting
 * buffer to MediaPipe via `modelAssetBuffer`. This prevents MediaPipe from
 * overlapping fetch with parse/GPU-upload internally, so the sum of
 * `downloadMs + loadMs` is typically a few ms slower than handing MediaPipe
 * the URL directly - a small wall-time cost for an observable split.
 *
 * `downloadMs` on a warm HTTP cache is usually single-digit ms; cold
 * downloads dominate when the model is served remotely.
 */
export interface ModelInitMetric {
    /** Time spent fetching the model bytes over the network (or from cache). */
    downloadMs: number;
    /** Time spent parsing the model and uploading weights to the GPU. */
    loadMs: number;
}

export interface CameraAcquireMetric {
    /** Total milliseconds from just before getUserMedia until the video element had data. */
    ms: number;
    /**
     * True if the permission state was not "granted" before the call, so the measurement
     * may include user reaction time to the permission prompt. False means the number is
     * pure machine time and safe to aggregate across sessions.
     */
    includedPermissionPrompt: boolean;
}

export interface PerformanceSnapshot {
    label: string;
    capturedAt: string;
    windowSize: number;
    cameraAcquire: CameraAcquireMetric | null;
    /**
     * Time for FilesetResolver.forVisionTasks to resolve: WASM fetch + compile + instantiate,
     * combined. Streaming instantiation overlaps fetch and compile so the number cannot be
     * linearly decomposed. Affected by both the HTTP cache and the browser's WASM module cache.
     */
    wasmFilesetInitMs: number | null;
    /** Hand landmarker initialization. See {@link ModelInitMetric}. */
    handModelInit: ModelInitMetric | null;
    /** Pose landmarker initialization. See {@link ModelInitMetric}. */
    poseModelInit: ModelInitMetric | null;
    /**
     * Umbrella total of VisionEngine.create() wall time, roughly equal to
     * `wasmFilesetInitMs` + the sum of enabled model inits. Published for convenience so
     * consumers don't have to sum components.
     */
    engineInitMs: number | null;
    actualFPS: number;
    frameTime: MetricStats;
    handInference: MetricStats | null;
    poseInference: MetricStats | null;
    handFilter: MetricStats | null;
    poseFilter: MetricStats | null;
}

export interface PerformanceMonitorOptions {
    /** Human-readable label for this run */
    label?: string;
    /** Max number of frames to retain per metric series. Must be a positive integer. Default: 300 (~10s at 30fps). */
    windowSize?: number;
}

function computeStats(samples: number[]): MetricStats {
    const count = samples.length;
    if (count === 0) {
        return { count: 0, min: 0, max: 0, mean: 0, p95: 0, p99: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    const percentile = (p: number): number => sorted[Math.floor(p * (count - 1))];

    return {
        count,
        min: sorted[0],
        max: sorted[count - 1],
        mean: sum / count,
        p95: percentile(0.95),
        p99: percentile(0.99),
    };
}

class MetricSeries {
    private readonly _samples: number[];
    private readonly _cap: number;
    private _nextIndex: number = 0;
    private _count: number = 0;

    constructor(cap: number) {
        this._cap = cap;
        this._samples = new Array(cap);
    }

    record(value: number): void {
        this._samples[this._nextIndex] = value;
        this._nextIndex = (this._nextIndex + 1) % this._cap;
        if (this._count < this._cap) {
            this._count += 1;
        }
    }

    get count(): number {
        return this._count;
    }

    stats(): MetricStats {
        return computeStats(this.collectSamples());
    }

    reset(): void {
        this._nextIndex = 0;
        this._count = 0;
    }

    private collectSamples(): number[] {
        if (this._count === 0) {
            return [];
        }

        if (this._count < this._cap) {
            return this._samples.slice(0, this._count);
        }

        return [
            ...this._samples.slice(this._nextIndex),
            ...this._samples.slice(0, this._nextIndex),
        ];
    }
}

export class PerformanceMonitor {

    readonly label: string;
    readonly windowSize: number;

    private readonly _frameTime: MetricSeries;
    private readonly _handInference: MetricSeries;
    private readonly _poseInference: MetricSeries;
    private readonly _handFilter: MetricSeries;
    private readonly _poseFilter: MetricSeries;

    private _cameraAcquire: CameraAcquireMetric | null = null;
    private _wasmFilesetInitMs: number | null = null;
    private _handModelInit: ModelInitMetric | null = null;
    private _poseModelInit: ModelInitMetric | null = null;
    private _engineInitMs: number | null = null;

    constructor(options: PerformanceMonitorOptions = {}) {
        this.label = options.label ?? "unnamed";
        const windowSize = options.windowSize ?? 300;
        if (!Number.isInteger(windowSize) || windowSize <= 0) {
            throw new Error(`PerformanceMonitor windowSize must be a positive integer, got ${windowSize}`);
        }
        this.windowSize = windowSize;

        this._frameTime = new MetricSeries(this.windowSize);
        this._handInference = new MetricSeries(this.windowSize);
        this._poseInference = new MetricSeries(this.windowSize);
        this._handFilter = new MetricSeries(this.windowSize);
        this._poseFilter = new MetricSeries(this.windowSize);
    }

    recordFrameTime(ms: number): void {
        this._frameTime.record(ms);
    }

    recordHandInference(ms: number): void {
        this._handInference.record(ms);
    }

    recordPoseInference(ms: number): void {
        this._poseInference.record(ms);
    }

    recordHandFilter(ms: number): void {
        this._handFilter.record(ms);
    }

    recordPoseFilter(ms: number): void {
        this._poseFilter.record(ms);
    }

    recordCameraAcquire(ms: number, includedPermissionPrompt: boolean): void {
        this._cameraAcquire = { ms, includedPermissionPrompt };
    }

    recordWasmFilesetInit(ms: number): void {
        this._wasmFilesetInitMs = ms;
    }

    recordHandModelInit(downloadMs: number, loadMs: number): void {
        this._handModelInit = { downloadMs, loadMs };
    }

    recordPoseModelInit(downloadMs: number, loadMs: number): void {
        this._poseModelInit = { downloadMs, loadMs };
    }

    recordEngineInit(ms: number): void {
        this._engineInitMs = ms;
    }

    /** Compute and return an aggregated snapshot of all metrics collected so far. */
    snapshot(): PerformanceSnapshot {
        const frameTimeStats = this._frameTime.stats();
        const actualFPS = frameTimeStats.mean > 0 ? 1000 / frameTimeStats.mean : 0;

        return {
            label: this.label,
            capturedAt: new Date().toISOString(),
            windowSize: this.windowSize,
            cameraAcquire: this._cameraAcquire,
            wasmFilesetInitMs: this._wasmFilesetInitMs,
            handModelInit: this._handModelInit,
            poseModelInit: this._poseModelInit,
            engineInitMs: this._engineInitMs,
            actualFPS,
            frameTime: frameTimeStats,
            handInference: this._handInference.count > 0 ? this._handInference.stats() : null,
            poseInference: this._poseInference.count > 0 ? this._poseInference.stats() : null,
            handFilter: this._handFilter.count > 0 ? this._handFilter.stats() : null,
            poseFilter: this._poseFilter.count > 0 ? this._poseFilter.stats() : null,
        };
    }

    /** Reset all collected metrics. */
    reset(): void {
        this._frameTime.reset();
        this._handInference.reset();
        this._poseInference.reset();
        this._handFilter.reset();
        this._poseFilter.reset();
        this._cameraAcquire = null;
        this._wasmFilesetInitMs = null;
        this._handModelInit = null;
        this._poseModelInit = null;
        this._engineInitMs = null;
    }
}
