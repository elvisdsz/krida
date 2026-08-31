# Krida

[![npm version](https://img.shields.io/npm/v/krida.svg)](https://www.npmjs.com/package/krida)
[![license](https://img.shields.io/npm/l/krida.svg)](LICENSE)

An engine for building interactive experiences with real-time camera-based tracking.

> **Status:** Pre-1.0. The API may change between releases.

## Overview

Implement `Scene`, pass a `<video>` element to `Session`, and receive per-frame tracking data in your `updateTracker()` callback. Session manages webcam setup, model loading, and cleanup. Tracking currently runs on MediaPipe models; additional backend support is planned.

## Installation

```sh
npm install krida @mediapipe/tasks-vision
```

> **Note:** MediaPipe model files and WASM bundle must be served. See [`sandbox/`](sandbox/) for a CDN-based example.

## Quick Start

```ts
import { Session, fitCanvasToVideo, type Scene, type TrackerResult } from "krida";

// Get references to the HTML elements.
const video = document.querySelector("video") as HTMLVideoElement;
const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// Keep the canvas drawing resolution matched to the camera's intrinsic size.
fitCanvasToVideo(canvas, video);

// Define a scene.
const pointerScene: Scene = {
  updateTracker(result: TrackerResult) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const hand of result.hand?.landmarks ?? []) {
      const tip = hand[8]; // index finger tip
      ctx.fillRect(tip.x * canvas.width, tip.y * canvas.height, 4, 4);
    }
  },
};

// Create and start a Krida session with the scene.
const session = new Session();
await session.start({
  video,
  scenes: [pointerScene],
  visionEngineOptions: {
    handLandmarkerEnabled: true,
    visionTaskFilesetPath: "/models/tasks-vision-wasm",
    handLandmarkerModelPath: "/models/hand_landmarker.task",
  },
});
```

Minimal HTML:

<!-- prettier-ignore -->
```html
<video autoplay playsinline muted></video>
<canvas></canvas>
```

> **Note:** Landmark coordinates are normalized to `[0, 1]`, so multiply by your canvas dimensions when drawing.

Krida runs in the browser and uses `getUserMedia()`, so camera access requires a secure context such as `https://` or `http://localhost`.

## Core Concepts

**`Scene`** — the interface you implement. Provide an `updateTracker(trackerResult)` method called once per processed frame, and optional `onStart` / `onStop` lifecycle hooks. A session can run several scenes at once.

**`Session`** — top-level orchestrator. Acquires the webcam, initializes `VisionEngine` and `FrameLoop`, forwards each frame's results to every managed scene, and manages cleanup on page hide/unload.

**`VisionEngine`** — runs tracking inference each frame, caches per-frame results, smooths landmark output via built-in filtering, and applies any configured gesture detectors.

**`FrameLoop`** — `requestAnimationFrame` loop that polls the engine and hands each `TrackerResult` to its callback. Supports a configurable FPS cap and an optional debug overlay canvas.

## API Reference

### Scene Interface

```ts
interface Scene {
  updateTracker(result: TrackerResult): void;
  onStart?(): void;
  onStop?(): void;
}
```

`TrackerResult.hand` contains per-hand `landmarks` arrays (normalized `{x, y, z}` points). `TrackerResult.pose` contains pose landmark data. Both may be `undefined` if the respective tracker is disabled.

`updateTracker()` fires at most once per camera frame (frames where the video has not advanced are skipped) and never more often than the loop's `targetFPS`.

---

### Session

```ts
new Session(options?: SessionOptions)
session.start(options: SessionStartOptions): Promise<void>
session.destroy(): void
session.addScene(...scenes: Scene[]): void
session.removeScene(scene: Scene): boolean
session.isRunning: boolean
```

`SessionOptions.autoCleanupOnPageLifecycle` (default: `true`) automatically calls `destroy()` when the page is hidden or unloaded.

`SessionStartOptions`:

- `video` — the `<video>` element that receives webcam frames (required)
- `scenes` — array of `Scene` instances to drive (required)
- `visionEngineOptions` — engine initialization options (required)
- `frameLoopOptions` — options forwarded to the internal `FrameLoop`
- `debugView` — `true` to overlay landmark connections and labels (default: `false`)
- `mediaStreamConstraints` — constraints for `getUserMedia` (default: `{ video: true }`)
- `performanceMonitor` — a `PerformanceMonitor` to receive session and per-frame metrics

`addScene()` throws if the session is not running; pass scenes via `start()` instead of adding them beforehand. `destroy()` is safe to call multiple times and calls `onStop()` on every active scene.

With `debugView: true`, Krida creates its own absolutely-positioned overlay canvas and appends it to the video's parent element, so give that parent `position: relative`.

---

### VisionEngine

Created internally by `Session`, or directly via `VisionEngine.create(options)`.

Key options:

- `handLandmarkerEnabled` / `poseLandmarkerEnabled` — at least one must be `true`
- `visionTaskFilesetPath` — path to the MediaPipe WASM bundle (default: `"/models/tasks-vision-wasm"`)
- `handLandmarkerModelPath` / `poseLandmarkerModelPath` — `.task` model file paths (defaults: `"/models/hand_landmarker.task"`, `"/models/pose_landmarker.task"`)
- `delegate` — inference backend: `"CPU"` or `"GPU"` (default: `"CPU"`; GPU requires WebGL2)
- `smoothingAlpha` — EMA smoothing factor `(0, 1]`; lower = smoother (default: `0.35`)
- `numHands` — max hands to detect, `1` or `2` (default: `2`); only used by hand landmarker
- `handGestureDetectors` / `poseGestureDetectors` — gesture detectors to run on each frame's results

Defaults are exported as `VisionEngineDefaults`.

---

### FrameLoop

```ts
new FrameLoop(visionEngine, options?: FrameLoopOptions, monitor?: PerformanceMonitor | null)
loop.start(video: HTMLVideoElement, callback?: (result: TrackerResult) => void): void
loop.stop(): void
loop.destroy(): void
loop.debugCanvas: HTMLCanvasElement | null   // setter only
loop.isRunning: boolean
```

`FrameLoopOptions`:

- `targetFPS` — cap the frame processing rate; `null` for uncapped (default: `30`)
- `debugCanvas` — canvas to draw landmark connections, dots, and index labels onto (default: `null`, disabled)

`stop()` clears the tracker callback, so pass it again when restarting via `start()`. `destroy()` stops the loop but leaves the `VisionEngine` intact, so a shared engine can outlive the loop.

Prefer `debugView: true` on `session.start()` unless you want to supply and position the overlay canvas yourself.

---

### Gestures

Attach detectors to the engine, then read their state off the tracker result:

```ts
import { PinchDetector } from "krida";

await session.start({
  video,
  scenes: [pointerScene],
  visionEngineOptions: {
    handLandmarkerEnabled: true,
    handGestureDetectors: [new PinchDetector()],
  },
});

// Inside pointerScene:
updateTracker(result) {
  const pinch = result.hand?.gestures?.get("pinch");
  if (pinch?.justActivated) {
    console.log("pinched at", pinch.position);
  }
}
```

`result.hand.gestures` is a `GestureMap`: `get(name)`, `active()`, `justActivated()`, `justDeactivated()`, and iterable as `[name, state]` pairs.

Each `GestureState` carries `confidence`, `isActive`, `justActivated`, `justDeactivated`, `activeSince`, and `position`.

Every detector accepts `GestureOptions` to tune its activation state machine: `name`, `activateAt`, `deactivateAt` (must not exceed `activateAt`), and `holdFrames`. Subclass `GestureDetector` to add your own.

---

### PerformanceMonitor

```ts
new PerformanceMonitor(options?: PerformanceMonitorOptions)
monitor.snapshot(): PerformanceSnapshot
```

Pass a `PerformanceMonitor` instance to `session.start()`. Call `snapshot()` at any time to get metrics such as `actualFPS`, `frameTime`, `handInference`, `poseInference`, model init timings, and more.

---

### fitCanvasToVideo

```ts
fitCanvasToVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement, signal?: AbortSignal): void
```

Sets the canvas drawing resolution (`canvas.width` / `canvas.height`) to the video's intrinsic dimensions and keeps them in sync on `resize`. Does not affect the canvas CSS layout size. Pass an `AbortSignal` to detach the listener.

## Examples

See [`sandbox/`](sandbox/) for a minimal working implementation with hand-tracking, pose-tracking, debug overlay, performance monitor, and CDN-hosted models.

## License

[MIT](LICENSE)
