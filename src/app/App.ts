import { TrackerResult } from "../engine/VisionEngine";

/**
 * Contract for all 2D canvas-based apps.
 *
 * Implement this interface to create a new interactive experience.
 * An app is registered with {@link RenderLoop} and receives a draw callback
 * every frame with up-to-date tracking results.
 *
 * @example
 * ```ts
 * class PointerApp implements App {
 *     name = "Pointer";
 *
 *     draw(ctx: CanvasRenderingContext2D, result: TrackerResult): void {
 *         if (!result.hand || result.hand.landmarks.length === 0) return;
 *         const tip = result.hand.landmarks[0][8]; // index finger tip
 *         ctx.beginPath();
 *         ctx.arc(tip.x * ctx.canvas.width, tip.y * ctx.canvas.height, 20, 0, Math.PI * 2);
 *         ctx.fill();
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
     * Called once per rendered frame.
     *
     * @param ctx           2D canvas rendering context. Cleared before each call unless `autoClear` is disabled on the loop.
     * @param trackerResult Latest tracking results from the engine. `hand` and/or `pose` will be `undefined` if the respective model was not enabled.
     */
    draw(ctx: CanvasRenderingContext2D, trackerResult: TrackerResult): void;
}

export default App;
