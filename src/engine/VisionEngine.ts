import {
    HandLandmarker,
    PoseLandmarker,
    FilesetResolver,
    HandLandmarkerResult,
    PoseLandmarkerResult,
    NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import LandmarkFilter from "../filters/LandmarkFilter";
import EMAFilter from "../filters/EMAFilter";
import type { PerformanceMonitor } from "../perf/PerformanceMonitor";

export interface HandTrackerResult extends HandLandmarkerResult {
    startTimeMs: number;
}

export interface PoseTrackerResult extends PoseLandmarkerResult {
    startTimeMs: number;
}

export interface TrackerResult {
    hand?: HandTrackerResult;
    pose?: PoseTrackerResult;
}

/** Default values for {@link VisionEngineOptions}. */
export const VisionEngineDefaults = {
    /** EMA smoothing factor for landmarks. (0, 1]. Lower = smoother. */
    smoothingAlpha: 0.35,
    /** Path to directory containing MediaPipe vision task WASM files. */
    visionTaskFilesetPath: "/models/tasks-vision-wasm",
    /** Path to the hand landmarker model file. */
    handLandmarkerModelPath: "/models/hand_landmarker.task",
    /** Path to the pose landmarker model file. */
    poseLandmarkerModelPath: "/models/pose_landmarker.task",
    /** Maximum number of hands to detect. */
    numHands: 2,
} as const satisfies Partial<VisionEngineOptions>;

export interface VisionEngineOptions {
    /** Path to directory containing MediaPipe vision task WASM files. Default: {@link VisionEngineDefaults.visionTaskFilesetPath} */
    visionTaskFilesetPath?: string;
    /** Enable the hand landmark detector. */
    handLandmarkerEnabled?: boolean;
    /** Enable the pose landmarker. */
    poseLandmarkerEnabled?: boolean;
    /** Path to the hand landmarker model file (.task). Default: {@link VisionEngineDefaults.handLandmarkerModelPath} */
    handLandmarkerModelPath?: string;
    /** Path to the pose landmarker model file (.task). Default: {@link VisionEngineDefaults.poseLandmarkerModelPath} */
    poseLandmarkerModelPath?: string;
    /** EMA smoothing factor for landmarks. (0, 1]. Lower = smoother. Default: {@link VisionEngineDefaults.smoothingAlpha} */
    smoothingAlpha?: number;
    /** Maximum number of hands to detect (1 or 2). Default: {@link VisionEngineDefaults.numHands} */
    numHands?: number;
}

export class VisionEngine {

    private _handLandmarker: HandLandmarker | null = null;
    private _poseLandmarker: PoseLandmarker | null = null;
    private _isDestroyed: boolean = false;

    private _lastHandFrameVideoTime: number = -1;
    private _lastPoseFrameVideoTime: number = -1;
    private _lastHandStartTimeMs: number = -1;
    private _lastPoseStartTimeMs: number = -1;
    private _lastHandResult: HandTrackerResult | null = null;
    private _lastPoseResult: PoseTrackerResult | null = null;

    /** Per-hand landmark filters (index matches hand index in results). */
    private _handLandmarkFilters: LandmarkFilter[] = [];
    /** Per-pose landmark filters (index matches pose index in results). */
    private _poseLandmarkFilters: LandmarkFilter[] = [];

    private _smoothingAlpha: number = VisionEngineDefaults.smoothingAlpha;

    private constructor() {}

    /**
     * Create and initialize a new VisionEngine with the given options.
     *
     * Loads the requested MediaPipe models and returns a fully initialized instance
     * ready for use with {@link getTrackerResult}. The returned instance has no
     * invalid intermediate state — it is either fully ready or this method throws.
     *
     * @throws If neither `handLandmarkerEnabled` nor `poseLandmarkerEnabled` is `true`.
     * @throws If any model fails to load.
     */
    static async create(
        options: VisionEngineOptions,
        performanceMonitor: PerformanceMonitor | null = null
    ): Promise<VisionEngine> {

        if (!options.handLandmarkerEnabled && !options.poseLandmarkerEnabled) {
            throw new Error("VisionEngine: At least one of handLandmarkerEnabled or poseLandmarkerEnabled must be true.");
        }

        const engine = new VisionEngine();
        engine._smoothingAlpha = options.smoothingAlpha ?? VisionEngineDefaults.smoothingAlpha;

        const createStart = performance.now();
        try {
            const wasmStart = performance.now();
            const vision = await FilesetResolver.forVisionTasks(
                options.visionTaskFilesetPath ?? VisionEngineDefaults.visionTaskFilesetPath
            );
            performanceMonitor?.recordWasmFilesetInit(performance.now() - wasmStart);

            if (options.handLandmarkerEnabled) {
                const { downloadMs, loadMs } = await engine.loadHandLandmarker(vision, options);
                performanceMonitor?.recordHandModelInit(downloadMs, loadMs);
            }

            if (options.poseLandmarkerEnabled) {
                const { downloadMs, loadMs } = await engine.loadPoseLandmarker(vision, options);
                performanceMonitor?.recordPoseModelInit(downloadMs, loadMs);
            }
        } catch (error) {
            engine.destroy();
            throw error;
        }
        performanceMonitor?.recordEngineInit(performance.now() - createStart);

        return engine;
    }

    /**
     * Ensure timestamps are strictly increasing.
     *
     * Callers may provide timestamps from non-monotonic clocks (for example,
     * media timeline time that moves backward on seek/replay). This guard keeps
     * the detector stable by coercing each timestamp above the previous value.
     * So a timestamp equal to or less than the previous value is incremented by 1.
     */
    private static getMonotonicStartTimeMs(startTimeMs: number, previousStartTimeMs: number): number {
        if (startTimeMs > previousStartTimeMs) {
            return startTimeMs;
        }

        return previousStartTimeMs + 1;
    }

    private closeTask(name: string, closeFn?: () => void): void {
        if (!closeFn) return;
        try {
            closeFn();
        } catch (error) {
            console.warn(`VisionEngine: failed to close ${name}.`, error);
        }
    }

    /**
     * Release all engine-owned resources.
     * Safe to call multiple times.
     */
    destroy = (): void => {
        if (this._isDestroyed) {
            return;
        }

        this._isDestroyed = true;

        const handLandmarker = this._handLandmarker;
        const poseLandmarker = this._poseLandmarker;

        this._handLandmarker = null;
        this._poseLandmarker = null;

        this.closeTask("hand landmarker", handLandmarker?.close?.bind(handLandmarker));
        this.closeTask("pose landmarker", poseLandmarker?.close?.bind(poseLandmarker));
    };

    private loadHandLandmarker = async (
        visionTaskFileset: any,
        options: VisionEngineOptions
    ): Promise<{ downloadMs: number; loadMs: number }> => {
        const url = options.handLandmarkerModelPath ?? VisionEngineDefaults.handLandmarkerModelPath;

        const d0 = performance.now();
        const buffer = await fetchModelBuffer(url);
        const downloadMs = performance.now() - d0;

        const l0 = performance.now();
        this._handLandmarker = await HandLandmarker.createFromOptions(
            visionTaskFileset,
            {
                baseOptions: { modelAssetBuffer: buffer },
                numHands: options.numHands ?? VisionEngineDefaults.numHands,
                runningMode: "VIDEO",
            }
        );
        const loadMs = performance.now() - l0;

        return { downloadMs, loadMs };
    };

    private loadPoseLandmarker = async (
        visionTaskFileset: any,
        options: VisionEngineOptions
    ): Promise<{ downloadMs: number; loadMs: number }> => {
        const url = options.poseLandmarkerModelPath ?? VisionEngineDefaults.poseLandmarkerModelPath;

        const d0 = performance.now();
        const buffer = await fetchModelBuffer(url);
        const downloadMs = performance.now() - d0;

        const l0 = performance.now();
        this._poseLandmarker = await PoseLandmarker.createFromOptions(
            visionTaskFileset,
            {
                baseOptions: { modelAssetBuffer: buffer },
                runningMode: "VIDEO",
            }
        );
        const loadMs = performance.now() - l0;

        return { downloadMs, loadMs };
    };

    /**
     * Detect tracking landmarks for the current video frame.
     * Results are cached per video frame; calling multiple times with the same frame is free.
     * 
     * @param video The video element containing the current frame to process.
     * @param startTimeMs Timestamp in milliseconds for the current frame.
     * `performance.now()` is preferred but `video.currentTime` is also a valid source.
     * If a non-monotonic value is provided (for example from playback timeline time),
     * VisionEngine will internally coerce it to remain strictly increasing.
     * @param performanceMonitor Optional performance monitor used to record
     * hand and pose inference/filter timings for newly processed frames.
     * Pass `null` to disable instrumentation.
     *
     * @returns Tracking result for the frame. `hand` and/or `pose` will be `undefined` if the respective model was not enabled.
     * @throws If called after {@link destroy}; a destroyed engine instance must not be reused.
     */
    getTrackerResult = (
        video: HTMLVideoElement,
        startTimeMs: number,
        performanceMonitor: PerformanceMonitor | null = null
    ): TrackerResult => {
        if (this._isDestroyed) {
            throw new Error("VisionEngine: getTrackerResult called after destroy(). Create a new VisionEngine instance.");
        }

        const handResult = this.getHandResult(video, startTimeMs, performanceMonitor);
        const poseResult = this.getPoseResult(video, startTimeMs, performanceMonitor);

        return {
            hand: handResult ?? undefined,
            pose: poseResult ?? undefined,
        };
    };

    /**
     * Detect hand landmarks for the current video frame.
     * Results are cached per video frame; calling multiple times with the same frame is free.
     * 
     * @param video The video element containing the current frame to process.
     * @param startTimeMs Timestamp in milliseconds for the current frame. A monotonic
     * source (for example `performance.now()`) is recommended.
     * @param performanceMonitor Optional performance monitor used to record
     * hand inference and filtering timings for newly processed frames.
     * 
     * @returns Detected landmarks (smoothed), or `null` if the hand landmarker was not enabled or the engine has been destroyed.
     */
    private getHandResult = (
        video: HTMLVideoElement,
        startTimeMs: number,
        performanceMonitor: PerformanceMonitor | null
    ): HandTrackerResult | null => {
        if (this._handLandmarker == null) {
            return null;
        }

        if (this._lastHandFrameVideoTime === video.currentTime) {
            return this._lastHandResult;
        }
        this._lastHandFrameVideoTime = video.currentTime;

        const normalizedStartTimeMs = VisionEngine.getMonotonicStartTimeMs(startTimeMs, this._lastHandStartTimeMs);
        this._lastHandStartTimeMs = normalizedStartTimeMs;

        const t0 = performance.now();
        const result = this._handLandmarker.detectForVideo(video, normalizedStartTimeMs);
        performanceMonitor?.recordHandInference(performance.now() - t0);

        const tf0 = performance.now();
        const smoothedLandmarks = this.filterLandmarks(result.landmarks, this._handLandmarkFilters);
        performanceMonitor?.recordHandFilter(performance.now() - tf0);

        this._lastHandResult = {
            ...result,
            landmarks: smoothedLandmarks,
            startTimeMs: normalizedStartTimeMs,
        } as HandTrackerResult;

        return this._lastHandResult;
    };

    /**
     * Detect pose landmarks for the current video frame.
     * Results are cached per video frame; calling multiple times with the same frame is free.
     * 
     * @param video The video element containing the current frame to process.
     * @param startTimeMs Timestamp in milliseconds for the current frame. A monotonic
     * source (for example `performance.now()`) is recommended.
     * @param performanceMonitor Optional performance monitor used to record
     * pose inference and filtering timings for newly processed frames.
     * 
     * @returns Detected landmarks (smoothed), or `null` if the pose landmarker was not enabled or the engine has been destroyed.
     */
    private getPoseResult = (
        video: HTMLVideoElement,
        startTimeMs: number,
        performanceMonitor: PerformanceMonitor | null
    ): PoseTrackerResult | null => {
        if (this._poseLandmarker == null) {
            return null;
        }

        if (this._lastPoseFrameVideoTime === video.currentTime) {
            return this._lastPoseResult;
        }
        this._lastPoseFrameVideoTime = video.currentTime;

        const normalizedStartTimeMs = VisionEngine.getMonotonicStartTimeMs(startTimeMs, this._lastPoseStartTimeMs);
        this._lastPoseStartTimeMs = normalizedStartTimeMs;

        const t0 = performance.now();
        const result = this._poseLandmarker.detectForVideo(video, normalizedStartTimeMs);
        performanceMonitor?.recordPoseInference(performance.now() - t0);

        const tf0 = performance.now();
        const smoothedLandmarks = this.filterLandmarks(result.landmarks, this._poseLandmarkFilters);
        performanceMonitor?.recordPoseFilter(performance.now() - tf0);

        this._lastPoseResult = {
            ...result,
            landmarks: smoothedLandmarks,
            startTimeMs: normalizedStartTimeMs,
        } as PoseTrackerResult;

        return this._lastPoseResult;
    };

    /**
     * Filter landmarks using EMA filters from the provided filter array.
     * Grows the filter array as needed and resets filters for indices no longer present.
     */
    private filterLandmarks(rawLandmarks: NormalizedLandmark[][], landmarkFilters: LandmarkFilter[]): NormalizedLandmark[][] {
        const count = rawLandmarks.length;

        while (landmarkFilters.length < count) {
            landmarkFilters.push(new EMAFilter(this._smoothingAlpha));
        }

        for (let i = count; i < landmarkFilters.length; i++) {
            landmarkFilters[i].reset();
        }

        return rawLandmarks.map((landmarks, i) => landmarkFilters[i].filter(landmarks));
    }
}

async function fetchModelBuffer(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`VisionEngine: failed to fetch model from ${res.url || url}: ${res.status} ${res.statusText}`);
    }
    return new Uint8Array(await res.arrayBuffer());
}
