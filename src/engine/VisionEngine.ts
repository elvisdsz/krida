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

    private _lastVideoTime: number = -1;
    private _lastPoseVideoTime: number = -1;
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
    static async create(options: VisionEngineOptions): Promise<VisionEngine> {

        if (!options.handLandmarkerEnabled && !options.poseLandmarkerEnabled) {
            throw new Error("VisionEngine: At least one of handLandmarkerEnabled or poseLandmarkerEnabled must be true.");
        }

        const engine = new VisionEngine();
        engine._smoothingAlpha = options.smoothingAlpha ?? VisionEngineDefaults.smoothingAlpha;

        try {
            const vision = await FilesetResolver.forVisionTasks(
                options.visionTaskFilesetPath ?? VisionEngineDefaults.visionTaskFilesetPath
            );

            if (options.handLandmarkerEnabled) {
                await engine.loadHandLandmarker(vision, options);
            }

            if (options.poseLandmarkerEnabled) {
                await engine.loadPoseLandmarker(vision, options);
            }
        } catch (error) {
            engine.destroy();
            throw error;
        }

        return engine;
    }

    private resetState(): void {
        this._lastVideoTime = -1;
        this._lastPoseVideoTime = -1;
        this._lastHandStartTimeMs = -1;
        this._lastPoseStartTimeMs = -1;
        this._lastHandResult = null;
        this._lastPoseResult = null;
        this._handLandmarkFilters.length = 0;
        this._poseLandmarkFilters.length = 0;
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
     * Release all engine-owned resources and reset state.
     * Safe to call multiple times.
     */
    destroy = (): void => {
        const handLandmarker = this._handLandmarker;
        const poseLandmarker = this._poseLandmarker;

        this._handLandmarker = null;
        this._poseLandmarker = null;
        this.resetState();

        this.closeTask("hand landmarker", handLandmarker?.close?.bind(handLandmarker));
        this.closeTask("pose landmarker", poseLandmarker?.close?.bind(poseLandmarker));
    };

    private loadHandLandmarker = async (visionTaskFileset: any, options: VisionEngineOptions): Promise<void> => {
        this._handLandmarker = await HandLandmarker.createFromOptions(
            visionTaskFileset,
            {
                baseOptions: {
                    modelAssetPath: options.handLandmarkerModelPath ?? VisionEngineDefaults.handLandmarkerModelPath,
                },
                numHands: options.numHands ?? VisionEngineDefaults.numHands,
                runningMode: "VIDEO",
            }
        );
    };

    private loadPoseLandmarker = async (visionTaskFileset: any, options: VisionEngineOptions): Promise<void> => {
        this._poseLandmarker = await PoseLandmarker.createFromOptions(
            visionTaskFileset,
            {
                baseOptions: {
                    modelAssetPath: options.poseLandmarkerModelPath ?? VisionEngineDefaults.poseLandmarkerModelPath,
                },
                runningMode: "VIDEO",
            }
        );
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
     *
     * @returns Tracking result for the frame. `hand` and/or `pose` will be `undefined` if the respective model was not enabled.
     */
    getTrackerResult = (video: HTMLVideoElement, startTimeMs: number): TrackerResult => {

        const handResult = this.getHandResult(video, startTimeMs);
        const poseResult = this.getPoseResult(video, startTimeMs);

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
     * 
     * @returns Detected landmarks (smoothed), or `null` if the hand landmarker was not enabled or the engine has been destroyed.
     */
    private getHandResult = (video: HTMLVideoElement, startTimeMs: number): HandTrackerResult | null => {
        if (this._handLandmarker == null) {
            return null;
        }

        if (this._lastVideoTime === video.currentTime) {
            return this._lastHandResult;
        }
        this._lastVideoTime = video.currentTime;

        const normalizedStartTimeMs = this.getMonotonicStartTimeMs(startTimeMs, this._lastHandStartTimeMs);
        this._lastHandStartTimeMs = normalizedStartTimeMs;

        const result = this._handLandmarker.detectForVideo(video, normalizedStartTimeMs);

        const smoothedLandmarks = this.filterLandmarks(result.landmarks, this._handLandmarkFilters);

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
     * 
     * @returns Detected landmarks (smoothed), or `null` if the pose landmarker was not enabled or the engine has been destroyed.
     */
    private getPoseResult = (video: HTMLVideoElement, startTimeMs: number): PoseTrackerResult | null => {
        if (this._poseLandmarker == null) {
            return null;
        }

        if (this._lastPoseVideoTime === video.currentTime) {
            return this._lastPoseResult;
        }
        this._lastPoseVideoTime = video.currentTime;

        const normalizedStartTimeMs = this.getMonotonicStartTimeMs(startTimeMs, this._lastPoseStartTimeMs);
        this._lastPoseStartTimeMs = normalizedStartTimeMs;

        const result = this._poseLandmarker.detectForVideo(video, normalizedStartTimeMs);

        const smoothedLandmarks = this.filterLandmarks(result.landmarks, this._poseLandmarkFilters);

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
