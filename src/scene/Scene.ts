import type { TrackerResult } from "../engine/VisionEngine";

/**
 * Contract for an interactive scene.
 * A scene can be any object that processes or reacts to tracking results.
 *
 * Implement this interface and pass instances in the `scenes` array to `Session.start()`,
 * which forwards every processed frame's tracking results to each scene's `updateTracker`.
 * @example
 * ```ts
 * class PointerScene implements Scene {
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
export interface Scene {
  /**
   * Optional hook called once when the session has finished starting.
   *
   * Invoked by `Session.start()` after the camera, engine, and frame loop are
   * all live, immediately before it resolves - or by `Session.addScene()` if the
   * scene is added to an already-running session.
   */
  onStart?(): void;

  /**
   * Optional hook intended for teardown of the scene when it is detached.
   *
   * Called at the beginning of `Session.destroy()` before any engine dependencies
   * are removed, or by `Session.removeScene()` when the scene is detached from a
   * running session.
   */
  onStop?(): void;

  /**
   * Called by the active `FrameLoop` once per processed frame.
   *
   * Frames where the video has not advanced to a new image are skipped, so this
   * fires at most once per camera frame and never more often than the loop's
   * configured `targetFPS`.
   *
   * @param trackerResult Latest tracking results from the engine. `hand` and/or `pose` will be `undefined` if the respective model was not enabled.
   */
  updateTracker(trackerResult: TrackerResult): void;
}
