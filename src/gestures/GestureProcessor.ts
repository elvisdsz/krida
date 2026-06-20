import { GestureDetector, GestureState } from "./GestureDetector";
import { GestureMap } from "./GestureMap";

export class GestureProcessor<TResult extends { startTimeMs: number }> {
    private gestureDetectors: GestureDetector<TResult>[];

    constructor(gestureDetectors: GestureDetector<TResult>[]) {
        // validate gesture name uniqueness to prevent overwrites in GestureMap during runtime
        const seen = new Set<string>();
        for (const detector of gestureDetectors) {
            if (seen.has(detector.name)) {
                throw new Error(`GestureProcessor: duplicate gesture name "${detector.name}" — give each detector a unique GestureOptions.name.`);
            }
            seen.add(detector.name);
        }
        this.gestureDetectors = gestureDetectors;
    }

    process(trackerResult: TResult): GestureMap {
        const gestureEntries: Array<[string, GestureState]> = [];
        for (const detector of this.gestureDetectors) {
            const gestureState = detector.update(trackerResult);
            gestureEntries.push([detector.name, gestureState]);
        }
        return new GestureMap(gestureEntries);
    }
}
