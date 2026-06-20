import { HandTrackerResult } from "../engine/VisionEngine";
import { GestureDetector, GestureOptions, GestureReading } from "./GestureDetector";
import { distance3D, centroid3D } from "../math/vector3D";
import { clamp } from "../math/utils";

export class PinchDetector extends GestureDetector<HandTrackerResult> {

    private static readonly PINCH_MIN_DIST = 0.03; // 3 cm
    private static readonly PINCH_MAX_DIST = 0.10; // 10 cm

    private static readonly DEFAULTS = {
        activateAt: 0.8,
        deactivateAt: 0.65,
        holdFrames: 2,
    } as const satisfies Required<Omit<GestureOptions, "name">>;

    constructor(options: GestureOptions = {}) {
        super("pinch", PinchDetector.DEFAULTS, options);
    }

    protected detect(trackerResult: HandTrackerResult): GestureReading {
        if (trackerResult.worldLandmarks.length === 0 || trackerResult.landmarks.length === 0) {
            return { confidence: 0, position: null };
        }

        // World space landmarks for pinch distance calculation
        const wLandmarks = trackerResult.worldLandmarks[0]; // Only consider the first detected hand
        const thumbTipWL = wLandmarks[4];
        const indexTipWL = wLandmarks[8];

        const pinchDist = distance3D(thumbTipWL, indexTipWL);
        const confidence = clamp(
            (PinchDetector.PINCH_MAX_DIST - pinchDist) / (PinchDetector.PINCH_MAX_DIST - PinchDetector.PINCH_MIN_DIST),
            0,
            1
        );

        // Image space landmarks for position estimation
        const iLandmarks = trackerResult.landmarks[0]; // Only consider the first detected hand
        const thumbTipIL = iLandmarks[4];
        const indexTipIL = iLandmarks[8];
        const mid = centroid3D([thumbTipIL, indexTipIL]);

        return {
            confidence,
            position: mid,
        };
    }
}
