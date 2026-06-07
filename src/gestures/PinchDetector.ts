import { HandTrackerResult } from "../engine/VisionEngine";
import { GestureDetector, GestureOptions, GestureReading } from "./GestureDetector";

export class PinchDetector extends GestureDetector<HandTrackerResult> {

    private static readonly MAX_DISTANCE = 0.10;
    private static readonly DEFAULTS = {
        activateAt: 0.5,
        deactivateAt: 0.3,
        holdFrames: 2,
    } as const satisfies Required<Omit<GestureOptions, "name">>;

    constructor(options: GestureOptions = {}) {
        super("pinch", PinchDetector.DEFAULTS, options);
    }

    protected detect(trackerResult: HandTrackerResult): GestureReading {
        if (trackerResult.landmarks.length === 0) {
            return { confidence: 0, position: null };
        }
        const landmarks = trackerResult.landmarks[0]; // Only consider the first detected hand. TODO: Support multiple hands.
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const distance = Math.sqrt(
            (thumbTip.x - indexTip.x) ** 2 +
            (thumbTip.y - indexTip.y) ** 2 +
            (thumbTip.z - indexTip.z) ** 2
        );
        return {
            confidence: 1 - Math.min(distance / PinchDetector.MAX_DISTANCE, 1),
            position: {
                x: (thumbTip.x + indexTip.x) / 2,
                y: (thumbTip.y + indexTip.y) / 2,
                z: (thumbTip.z + indexTip.z) / 2,
            },
        };
    }
}
