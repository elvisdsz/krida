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

    private initialized: boolean = false;

    private handLandmarker: HandLandmarker | null = null;
    private poseLandmarker: PoseLandmarker | null = null;

    private lastVideoTime: number = -1;
    private lastPoseVideoTime: number = -1;
    private lastHandResult: HandTrackerResult | null = null;
    private lastPoseResult: PoseTrackerResult | null = null;

    /** Per-hand landmark filters (index matches hand index in results). */
    private handLandmarkFilters: LandmarkFilter[] = [];
    /** Per-pose landmark filters (index matches pose index in results). */
    private poseLandmarkFilters: LandmarkFilter[] = [];

    private smoothingAlpha: number = VisionEngineDefaults.smoothingAlpha;

    private resetState = (): void => {
        this.lastVideoTime = -1;
        this.lastPoseVideoTime = -1;
        this.lastHandResult = null;
        this.lastPoseResult = null;
        this.handLandmarkFilters.length = 0;
        this.poseLandmarkFilters.length = 0;
    };

    private closeTask = (name: string, closeFn?: () => void): void => {
        if (!closeFn) return;
        try {
            closeFn();
        } catch (error) {
            console.warn(`VisionEngine: failed to close ${name}.`, error);
        }
    };

    /**
     * Initialize the engine and load the requested MediaPipe models.
     * Must be called before calling {@link getTrackerResult}.
     */
    init = async (options: VisionEngineOptions): Promise<void> => {

        if (this.initialized) {
            console.warn("VisionEngine is already initialized. Ignoring duplicate init call.");
            return;
        }

        this.initialized = true;
        this.resetState();

        this.smoothingAlpha = options.smoothingAlpha ?? VisionEngineDefaults.smoothingAlpha;

        try {
            const vision = await FilesetResolver.forVisionTasks(
                options.visionTaskFilesetPath ?? VisionEngineDefaults.visionTaskFilesetPath
            );

            if (options.handLandmarkerEnabled) {
                await this.loadHandLandmarker(vision, options);
            }

            if (options.poseLandmarkerEnabled) {
                await this.loadPoseLandmarker(vision, options);
            }
        } catch (error) {
            this.destroy();
            throw error;
        }
    };

    /**
     * Release all engine-owned resources and reset state.
     * Safe to call multiple times.
     */
    destroy = (): void => {
        const handLandmarker = this.handLandmarker;
        const poseLandmarker = this.poseLandmarker;

        this.handLandmarker = null;
        this.poseLandmarker = null;
        this.initialized = false;
        this.resetState();

        this.closeTask("hand landmarker", handLandmarker?.close?.bind(handLandmarker));
        this.closeTask("pose landmarker", poseLandmarker?.close?.bind(poseLandmarker));
    };

    private loadHandLandmarker = async (visionTaskFileset: any, options: VisionEngineOptions): Promise<void> => {
        this.handLandmarker = await HandLandmarker.createFromOptions(
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
        this.poseLandmarker = await PoseLandmarker.createFromOptions(
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
     * @param startTimeMs The timestamp (in milliseconds) corresponding to the current video frame. This should be consistent across calls for the same frame to ensure proper caching. Typically, this would be `video.currentTime * 1000`.
     *
     * @returns Tracking result for the frame. `hand` and/or `pose` will be `undefined` if the respective model was not enabled.
     */
    getTrackerResult = async (video: HTMLVideoElement, startTimeMs: number): Promise<TrackerResult> => {

        const [handResult, poseResult] = await Promise.all([
            this.getHandResult(video, startTimeMs),
            this.getPoseResult(video, startTimeMs),
        ]);

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
     * @param startTimeMs The timestamp (in milliseconds) corresponding to the current video frame. This should be consistent across calls for the same frame to ensure proper caching. Typically, this would be `video.currentTime * 1000`.
     * 
     * @returns Detected landmarks (smoothed), or `null` if the model is not yet loaded.
     */
    private getHandResult = async (video: HTMLVideoElement, startTimeMs: number): Promise<HandTrackerResult | null> => {
        if (this.handLandmarker == null) {
            return null;
        }

        if (this.lastVideoTime === video.currentTime) {
            return this.lastHandResult;
        }
        this.lastVideoTime = video.currentTime;

        const result = this.handLandmarker.detectForVideo(video, startTimeMs);

        const smoothedLandmarks = this.filterLandmarks(result.landmarks, this.handLandmarkFilters);

        this.lastHandResult = {
            ...result,
            landmarks: smoothedLandmarks,
            startTimeMs,
        } as HandTrackerResult;

        return this.lastHandResult;
    };

    /**
     * Detect pose landmarks for the current video frame.
     * Results are cached per video frame; calling multiple times with the same frame is free.
     * 
     * @param video The video element containing the current frame to process.
     * @param startTimeMs The timestamp (in milliseconds) corresponding to the current video frame. This should be consistent across calls for the same frame to ensure proper caching. Typically, this would be `video.currentTime * 1000`.
     * 
     * @returns Detected landmarks (smoothed), or `null` if the model is not yet loaded.
     */
    private getPoseResult = async (video: HTMLVideoElement, startTimeMs: number): Promise<PoseTrackerResult | null> => {
        if (this.poseLandmarker == null) {
            return null;
        }

        if (this.lastPoseVideoTime === video.currentTime) {
            return this.lastPoseResult;
        }
        this.lastPoseVideoTime = video.currentTime;

        const result = this.poseLandmarker.detectForVideo(video, startTimeMs);

        const smoothedLandmarks = this.filterLandmarks(result.landmarks, this.poseLandmarkFilters);

        this.lastPoseResult = {
            ...result,
            landmarks: smoothedLandmarks,
            startTimeMs,
        } as PoseTrackerResult;

        return this.lastPoseResult;
    };

    /**
     * Filter landmarks using EMA filters from the provided filter array.
     * Grows the filter array as needed and resets filters for indices no longer present.
     */
    private filterLandmarks(rawLandmarks: NormalizedLandmark[][], landmarkFilters: LandmarkFilter[]): NormalizedLandmark[][] {
        const count = rawLandmarks.length;

        while (landmarkFilters.length < count) {
            landmarkFilters.push(new EMAFilter(this.smoothingAlpha));
        }

        for (let i = count; i < landmarkFilters.length; i++) {
            landmarkFilters[i].reset();
        }

        return rawLandmarks.map((landmarks, i) => landmarkFilters[i].filter(landmarks));
    }
}
