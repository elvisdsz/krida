# Krida

[![CI](https://img.shields.io/github/actions/workflow/status/elvisdsz/krida/ci.yml?branch=main&label=CI)](https://github.com/elvisdsz/krida/actions/workflows/ci.yml)
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

**`Session`** — top-level orchestrator. Acquires the webcam, initializes `VisionEngine` and `FrameProcessor`, forwards each frame's results to every managed scene, and manages cleanup on page hide/unload.

**`VisionEngine`** — runs tracking inference each frame, caches per-frame results, smooths landmark output via built-in filtering, and applies any configured gesture detectors.

**`FrameProcessor`** — passes video frames to the engine and hands each `TrackerResult` to its callback, in a loop or on demand via `update()`. Supports an FPS cap for the loop and an optional debug overlay canvas.

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

`updateTracker()` fires at most once per camera frame; frames where the video has not advanced, or arrive faster than `targetFPS`, are skipped.

---

### Session

```ts
new Session(options?: SessionOptions)
session.start(options: SessionStartOptions): Promise<void>
session.destroy(): void
session.addScene(...scenes: Scene[]): void
session.removeScene(scene: Scene): boolean
session.update(timestampMs?: number): TrackerResult | null
session.isActive: boolean
```

`SessionOptions.autoCleanupOnPageLifecycle` (default: `true`) automatically calls `destroy()` when the page is hidden or unloaded.

`SessionStartOptions`:

- `video` — the `<video>` element that receives webcam frames (required)
- `scenes` — array of `Scene` instances to drive (can be omitted, e.g. to use the result returned by `session.update()` instead, or to add scenes later via `addScene()`)
- `visionEngineOptions` — engine initialization options (required)
- `frameMode` — `"looped"` (default) lets the session schedule updates with `requestAnimationFrame`; `"manual"` lets the host schedule updates by calling `session.update()`
- `frameProcessorOptions` — options forwarded to the internal `FrameProcessor`
- `debugView` — `true` to overlay landmark connections and labels (default: `false`)
- `mediaStreamConstraints` — constraints for `getUserMedia` (default: `{ video: true }`)
- `performanceMonitor` — a `PerformanceMonitor` to receive session and per-frame metrics

Use `frameMode: "manual"` when another render loop owns scheduling. Call `session.update(timestampMs)` from that loop; it processes at most one new video frame and returns `null` if the session is not active or no new video frame is available. It throws if the session is active but `frameMode` is not `"manual"`. `timestampMs` must be in milliseconds and monotonic. `performance.now()` and a `requestAnimationFrame` callback's timestamp work. A seconds-based elapsed-time value, such as three.js's `Clock.getElapsedTime()`, does not.

`addScene()` throws if the session is not active; pass scenes via `start()` instead of adding them beforehand. `destroy()` is safe to call multiple times and calls `onStop()` on every active scene.

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

### FrameProcessor

```ts
new FrameProcessor(visionEngine, options?: FrameProcessorOptions, monitor?: PerformanceMonitor | null)
processor.bind(video: HTMLVideoElement, onResult?: (result: TrackerResult) => void): void
processor.startLoop(): void
processor.update(timestampMs?: number): TrackerResult | null
processor.stopLoop(): void
processor.destroy(): void
processor.debugCanvas: HTMLCanvasElement | null   // setter only
processor.isLooping: boolean
```

`FrameProcessorOptions`:

- `targetFPS` — cap the frame processing rate for both `startLoop()` and `update()`. `null` for uncapped (default: `30`)
- `debugCanvas` — canvas to draw landmark connections, dots, and index labels onto (default: `null`, disabled)

Call `bind()` before `startLoop()`, or call `update()` to process frames from an external scheduler. `stopLoop()` keeps the binding, so `startLoop()` resumes the loop. `destroy()` stops the loop and releases the binding but leaves the `VisionEngine` intact, so a shared engine can outlive the processor.

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
