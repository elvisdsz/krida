import { TrackerResult } from "../engine/VisionEngine";

/**
 * Contract for all 2D canvas-based apps.
 *
 * Implement this interface to create a new interactive experience.
 * An app is registered with {@link RenderLoop} and receives an `updateTracker`
 * callback every frame with up-to-date tracking results.
 *
 * @example
 * ```ts
 * class PointerApp implements App {
 *     name = "Pointer";
 *     ctx = (document.getElementById("canvas") as HTMLCanvasElement).getContext("2d")!;
 *
 *     updateTracker(result: TrackerResult): void {
 *         if (!result.hand || result.hand.landmarks.length === 0) return;
 *         const tip = result.hand.landmarks[0][8]; // index finger tip
 *         this.ctx.beginPath();
 *         this.ctx.arc(tip.x * this.ctx.canvas.width, tip.y * this.ctx.canvas.height, 20, 0, Math.PI * 2);
 *         this.ctx.fill();
 *     }
 * }
 * ```
 */
interface App {
    /** Display name of this app. */
    name: string;

    /**
     * Optional hook called when this app becomes active in a running loop.
     *
     * Called by {@link RenderLoop.start} and when swapping apps with
     * {@link RenderLoop.setApp} while the loop is running.
     */
    onStart?(): void;

    /**
     * Optional hook called when this app is detached from the loop.
     *
     * Called by {@link RenderLoop.stop}, {@link RenderLoop.destroy}, and before
     * replacing the active app via {@link RenderLoop.setApp}.
     */
    onStop?(): void;

    /**
     * Called by the active FrameLoop, once per loop frame.
     * 
     * @param trackerResult Latest tracking results from the engine. `hand` and/or `pose` will be `undefined` if the respective model was not enabled.
     */
    updateTracker(trackerResult: TrackerResult): void;
}

export default App;
