import {
    HandLandmarker,
    FilesetResolver,
    HandLandmarkerResult,
    NormalizedLandmark,
    GestureRecognizer,
    GestureRecognizerResult,
} from "@mediapipe/tasks-vision";
import LandmarkFilter from "../filters/LandmarkFilter";
import EMAFilter from "../filters/EMAFilter";

export interface HandTrackerResult extends HandLandmarkerResult {
    startTimeMs: number;
}

/** Default values for {@link EngineOptions}. */
export const EngineDefaults = {
    /** EMA smoothing factor for landmarks. (0, 1]. Lower = smoother. */
    smoothingAlpha: 0.35,
    /** Path to directory containing MediaPipe vision task WASM files. */
    visionTaskFilesetPath: "/models/tasks-vision-wasm",
    /** Path to the hand landmarker model file. */
    handLandmarkerModelPath: "/models/hand_landmarker.task",
    /** Path to the gesture recognizer model file. */
    gestureRecognizerModelPath: "/models/gesture_recognizer.task",
    /** Maximum number of hands to detect. */
    numHands: 2,
} as const satisfies Partial<EngineOptions>;

export interface EngineOptions {
    /** Path to directory containing MediaPipe vision task WASM files. Default: {@link EngineDefaults.visionTaskFilesetPath} */
    visionTaskFilesetPath?: string;
    /** Enable the hand landmark detector. */
    handLandmarkerEnabled?: boolean;
    /** Enable the gesture recognizer. */
    gestureRecognizerEnabled?: boolean;
    /** Path to the hand landmarker model file (.task). Default: {@link EngineDefaults.handLandmarkerModelPath} */
    handLandmarkerModelPath?: string;
    /** Path to the gesture recognizer model file (.task). Default: {@link EngineDefaults.gestureRecognizerModelPath} */
    gestureRecognizerModelPath?: string;
    /** EMA smoothing factor for landmarks. (0, 1]. Lower = smoother. Default: {@link EngineDefaults.smoothingAlpha} */
    smoothingAlpha?: number;
    /** Maximum number of hands to detect (1 or 2). Default: {@link EngineDefaults.numHands} */
    numHands?: number;
}

export class Engine {

    private handLandmarker: HandLandmarker | null = null;
    private gestureRecognizer: GestureRecognizer | null = null;

    private lastVideoTime: number = -1;
    private lastResult: HandTrackerResult | null = null;

    /** Per-hand landmark filters (index matches hand index in results). */
    private landmarkFilters: LandmarkFilter[] = [];
    private smoothingAlpha: number = EngineDefaults.smoothingAlpha;

    /**
     * Initialize the engine and load the requested MediaPipe models.
     * Must be called before {@link getResults} or {@link getGestures}.
     */
    init = async (options: EngineOptions): Promise<void> => {
        this.smoothingAlpha = options.smoothingAlpha ?? EngineDefaults.smoothingAlpha;

        if (this.handLandmarker == null || this.gestureRecognizer == null) {
            const vision = await FilesetResolver.forVisionTasks(
                options.visionTaskFilesetPath ?? EngineDefaults.visionTaskFilesetPath
            );

            if (options.handLandmarkerEnabled) {
                await this.loadHandLandmarker(vision, options);
            }

            if (options.gestureRecognizerEnabled) {
                await this.loadGestureRecognizer(vision, options);
            }
        }
    };

    private loadHandLandmarker = async (visionTaskFileset: any, options: EngineOptions): Promise<void> => {
        this.handLandmarker = await HandLandmarker.createFromOptions(
            visionTaskFileset,
            {
                baseOptions: {
                    modelAssetPath: options.handLandmarkerModelPath ?? EngineDefaults.handLandmarkerModelPath,
                },
                numHands: options.numHands ?? EngineDefaults.numHands,
                runningMode: "VIDEO",
            }
        );
    };

    private loadGestureRecognizer = async (visionTaskFileset: any, options: EngineOptions): Promise<void> => {
        this.gestureRecognizer = await GestureRecognizer.createFromOptions(
            visionTaskFileset,
            {
                baseOptions: {
                    modelAssetPath: options.gestureRecognizerModelPath ?? EngineDefaults.gestureRecognizerModelPath,
                },
                runningMode: "VIDEO",
            }
        );
    };

    /**
     * Detect hand landmarks for the current video frame.
     * Results are cached per video frame; calling multiple times with the same frame is free.
     *
     * @returns Detected landmarks (smoothed), or `null` if the model is not yet loaded.
     */
    getResults = async (video: HTMLVideoElement, startTimeMs: number): Promise<HandTrackerResult | null> => {
        if (this.handLandmarker == null) {
            console.warn("Engine: Hand Landmarker model not loaded. Call init() with handLandmarkerEnabled: true.");
            return null;
        }

        if (this.lastVideoTime === video.currentTime) {
            return this.lastResult;
        }
        this.lastVideoTime = video.currentTime;

        const result = this.handLandmarker.detectForVideo(video, startTimeMs);

        const smoothedLandmarks = this.filterLandmarks(result.landmarks);

        this.lastResult = {
            ...result,
            landmarks: smoothedLandmarks,
            startTimeMs,
        } as HandTrackerResult;

        return this.lastResult;
    };

    /**
     * Recognize gestures for the current video frame.
     *
     * @returns Recognized gestures, or `null` if the model is not yet loaded.
     */
    getGestures = async (video: HTMLVideoElement, startTimeMs: number): Promise<GestureRecognizerResult | null> => {
        if (this.gestureRecognizer == null) {
            console.warn("Engine: Gesture Recognizer model not loaded. Call init() with gestureRecognizerEnabled: true.");
            return null;
        }
        return this.gestureRecognizer.recognizeForVideo(video, startTimeMs);
    };

    /**
     * Filter landmarks for all detected hands using per-hand EMA filters.
     * Resets filters for hands that are no longer present.
     */
    private filterLandmarks(rawLandmarks: NormalizedLandmark[][]): NormalizedLandmark[][] {
        const numHands = rawLandmarks.length;

        while (this.landmarkFilters.length < numHands) {
            this.landmarkFilters.push(new EMAFilter(this.smoothingAlpha));
        }

        for (let i = numHands; i < this.landmarkFilters.length; i++) {
            this.landmarkFilters[i].reset();
        }

        return rawLandmarks.map((hand, i) => this.landmarkFilters[i].filter(hand));
    }
}

/** Convenience singleton. For multiple independent instances, instantiate {@link Engine} directly. */
export const engine = new Engine();
export default engine;
