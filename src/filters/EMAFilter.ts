import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import LandmarkFilter from "./LandmarkFilter";

/**
 * Exponential Moving Average (EMA) filter for hand landmarks.
 *
 * Each landmark component (x, y, z) is independently smoothed:
 *
 *     smoothed_t = α × raw_t + (1 − α) × smoothed_(t−1)
 *
 * - α close to 1 → minimal smoothing, fast response, more jitter.
 * - α close to 0 → heavy smoothing, slower response, less jitter.
 * 
 */
class EMAFilter implements LandmarkFilter {

    private static readonly DEFAULT_ALPHA = 0.45;

    private previous: NormalizedLandmark[] | null = null;
    private readonly alpha: number;

    constructor(alpha: number = EMAFilter.DEFAULT_ALPHA) {
        if (alpha <= 0 || alpha > 1) {
            throw new RangeError(`EMAFilter alpha must be in (0, 1]. Received: ${alpha}`);
        }
        this.alpha = alpha;
    }

    filter(raw: NormalizedLandmark[]): NormalizedLandmark[] {
        if (this.previous === null || this.previous.length !== raw.length) {
            // First frame or landmark count changed — seed with raw values
            this.previous = raw.map(l => ({ ...l }));
            return this.previous;
        }

        const a = this.alpha;
        const oneMinusA = 1 - a;

        this.previous = raw.map((l, i) => ({
            x: a * l.x + oneMinusA * this.previous![i].x,
            y: a * l.y + oneMinusA * this.previous![i].y,
            z: a * l.z + oneMinusA * this.previous![i].z,
            visibility: a * (l.visibility ?? 0) + oneMinusA * (this.previous![i].visibility ?? 0),
        }));

        return this.previous;
    }

    reset(): void {
        this.previous = null;
    }
}

export default EMAFilter;
