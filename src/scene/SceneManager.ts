import type { TrackerResult } from "../engine/VisionEngine";
import type Scene from "./Scene";

/**
 * Internal manager class that keeps track of loaded scenes and provides
 * methods to update these scenes and call their lifecycle hooks.
 */
class SceneManager {
  #scenes: Scene[] = [];
  #started: boolean = false;
  #failedScenes = new WeakSet<Scene>();

  /**
   * Adds a scene to managed scenes and calls their `onStart` on each only if
   * the manager has already been started.
   *
   * Skipped, if a given scene is already in the managed list.
   */
  addScene = (...scenes: Scene[]): void => {
    for (const scene of scenes) {
      if (this.#scenes.includes(scene)) continue;
      this.#scenes.push(scene);
      if (this.#started) {
        this.#safeCall(scene, "onStart");
      }
    }
  };

  /**
   * Removes specified scene from managed scenes.
   *
   * Returns `true` if scene was found and removed.
   */
  removeScene = (scene: Scene): boolean => {
    const index = this.#scenes.indexOf(scene);
    if (index === -1) return false;
    this.#scenes.splice(index, 1);
    this.#failedScenes.delete(scene);
    if (this.#started) this.#safeCall(scene, "onStop");
    return true;
  };

  /** Removes all scenes from managed scenes and calls their `onStop` hook. */
  removeAllScenes = (): void => {
    if (this.#started) {
      this.onStopAll();
    }
    this.#scenes.length = 0;
    this.#failedScenes = new WeakSet<Scene>();
  };

  /** Call `onStart()` method of all managed scenes. */
  onStartAll = (): void => {
    this.#failedScenes = new WeakSet<Scene>();
    this.#started = true;
    for (const scene of [...this.#scenes]) {
      this.#safeCall(scene, "onStart");
    }
  };

  /** Call `onStop()` method of all managed scenes. */
  onStopAll = (): void => {
    for (const scene of [...this.#scenes]) {
      this.#safeCall(scene, "onStop");
    }
    this.#started = false;
  };

  #safeCall = (scene: Scene, hook: "onStart" | "onStop"): void => {
    try {
      scene[hook]?.();
    } catch (error) {
      console.error(`Scene.${hook} threw:`, error);
    }
  };

  /** Fanout received `trackerResult` to every managed scene's `updateTracker()` */
  updateTrackerAll = (trackerResult: TrackerResult): void => {
    for (const scene of this.#scenes) {
      try {
        scene.updateTracker(trackerResult);
      } catch (error) {
        if (!this.#failedScenes.has(scene)) {
          this.#failedScenes.add(scene);
          console.error(
            "Scene.updateTracker threw (further errors from this scene suppressed):",
            error,
          );
        }
      }
    }
  };
}

export default SceneManager;
