import type { GestureState } from "./GestureDetector";

export class GestureMap {
    private gestureNameMap: Map<string, GestureState>;

    constructor(gestureEntries: Array<[string, GestureState]>) {
        this.gestureNameMap = new Map();
        for (const [name, state] of gestureEntries) {
            this.gestureNameMap.set(name, state);
        }
    }

    get(name: string): GestureState | undefined {
        return this.gestureNameMap.get(name);
    }

    [Symbol.iterator](): Iterator<[string, GestureState]> {
        return this.gestureNameMap.entries();
    }

    active(): Array<[string, GestureState]> {
        const result: Array<[string, GestureState]> = [];
        for (const [name, state] of this.gestureNameMap) {
            if (state.isActive) {
                result.push([name, state]);
            }
        }
        return result;
    }

    justActivated(): Array<[string, GestureState]> {
        const result: Array<[string, GestureState]> = [];
        for (const [name, state] of this.gestureNameMap) {
            if (state.justActivated) {
                result.push([name, state]);
            }
        }
        return result;
    }

    justDeactivated(): Array<[string, GestureState]> {
        const result: Array<[string, GestureState]> = [];
        for (const [name, state] of this.gestureNameMap) {
            if (state.justDeactivated) {
                result.push([name, state]);
            }
        }
        return result;
    }
}
