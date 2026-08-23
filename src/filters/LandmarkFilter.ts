import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Interface for landmark filters.
 *
 * A LandmarkFilter is a stateful object that processes one subject's worth of
 * landmarks per frame. Each call to {@link filter} blends the incoming raw
 * landmarks with internal state and returns the filtered result.
 *
 * Implementations must be instantiated once **per tracked subject** — the caller
 * (e.g. VisionEngine) is responsible for managing the array of filters and resetting
 * them when a subject disappears.
 */
export interface LandmarkFilter {
    /**
     * Process one frame of raw landmarks and return the filtered output.
     * The returned array must have the same length as `raw`.
     */
    filter(raw: NormalizedLandmark[]): NormalizedLandmark[];

    /** Reset internal state (e.g. when the tracked subject disappears). */
    reset(): void;
}
