import { HandTrackerResult } from "../engine/Engine";

/**
 * Contract for all 2D canvas-based apps.
 *
 * Implement this interface to create a new interactive experience.
 * An app is registered with {@link EngineLoop} and receives a draw callback
 * every frame with up-to-date hand tracking results.
 *
 * @example
 * ```ts
 * class PointerApp implements App {
 *     name = "Pointer";
 *
 *     draw(ctx: CanvasRenderingContext2D, result: HandTrackerResult): void {
 *         if (result.landmarks.length === 0) return;
 *         const tip = result.landmarks[0][8]; // index finger tip
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
     * Called once per rendered frame.
     *
     * @param ctx           2D canvas rendering context. Cleared before each call unless `autoClear` is disabled on the loop.
     * @param trackerResult Latest hand tracking results for this frame.
     */
    draw(ctx: CanvasRenderingContext2D, trackerResult: HandTrackerResult): void;
}

export default App;
