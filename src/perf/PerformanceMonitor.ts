export interface MetricStats {
    count: number;
    min: number;
    max: number;
    mean: number;
    p95: number;
    p99: number;
}

export interface PerformanceSnapshot {
    label: string;
    capturedAt: string;
    windowSize: number;
    startupTimeMs: number | null;
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
    /** Max number of frames to retain per metric series. Default: 300 (~10s at 30fps). */
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
    private readonly _samples: number[] = [];
    private readonly _cap: number;

    constructor(cap: number) {
        this._cap = cap;
    }

    record(value: number): void {
        this._samples.push(value);
        if (this._samples.length > this._cap) {
            this._samples.shift();
        }
    }

    get count(): number {
        return this._samples.length;
    }

    stats(): MetricStats {
        return computeStats(this._samples);
    }

    reset(): void {
        this._samples.length = 0;
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

    private _startupTimeMs: number | null = null;

    constructor(options: PerformanceMonitorOptions = {}) {
        this.label = options.label ?? "unnamed";
        this.windowSize = options.windowSize ?? 300;

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

    recordStartupTime(ms: number): void {
        this._startupTimeMs = ms;
    }

    /** Compute and return an aggregated snapshot of all metrics collected so far. */
    snapshot(): PerformanceSnapshot {
        const frameTimeStats = this._frameTime.stats();
        const actualFPS = frameTimeStats.mean > 0 ? 1000 / frameTimeStats.mean : 0;

        return {
            label: this.label,
            capturedAt: new Date().toISOString(),
            windowSize: this.windowSize,
            startupTimeMs: this._startupTimeMs,
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
        this._startupTimeMs = null;
    }
}
