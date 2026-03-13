import { NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Interface for per-hand landmark filters.
 *
 * A LandmarkFilter is a stateful object that processes one hand's worth of
 * landmarks (21 points) per frame. Each call to {@link filter} blends the
 * incoming raw landmarks with internal state and returns the filtered result.
 *
 * Implementations must be instantiated once **per tracked hand** — the caller
 * (e.g. Engine) is responsible for managing the array of filters and resetting
 * them when a hand disappears.
 */
interface LandmarkFilter {
    /**
     * Process one frame of raw landmarks and return the filtered output.
     * The returned array must have the same length as `raw`.
     */
    filter(raw: NormalizedLandmark[]): NormalizedLandmark[];

    /** Reset internal state (e.g. when the tracked hand disappears). */
    reset(): void;
}

export default LandmarkFilter;
