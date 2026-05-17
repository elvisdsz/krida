# Krida

An engine for building interactive experiences with real-time camera-based tracking.

> **Status:** v0.x — API may change between releases.

## Overview

Implement `App`, pass a `<video>` and `<canvas>` to `Session`, and receive per-frame tracking data in your `draw()` callback. Session manages webcam setup, model loading, and cleanup. Tracking currently runs on MediaPipe models; additional backend support is planned.

## Installation

```sh
npm install krida @mediapipe/tasks-vision
```

> MediaPipe model files and WASM bundle must be served — see [`sandbox/`](sandbox/) for a CDN-based example.

## Quick Start

```ts
import { Session, type App } from "krida";

const video = document.querySelector("video") as HTMLVideoElement;
const canvas = document.querySelector("canvas") as HTMLCanvasElement;

const app: App = {
  name: "My App",
  draw(ctx, result) {
    for (const hand of result.hand?.landmarks ?? []) {
      const tip = hand[8]; // index finger tip
      ctx.fillRect(tip.x * canvas.width, tip.y * canvas.height, 4, 4);
    }
  },
};

const session = new Session();
await session.start({
  video,
  canvas,
  app,
  visionEngineOptions: {
    handLandmarkerEnabled: true,
    visionTaskFilesetPath: "/models/tasks-vision-wasm",
    handLandmarkerModelPath: "/models/hand_landmarker.task",
  },
});
```

Minimal HTML:

```html
<video autoplay playsinline muted></video>
<canvas></canvas>
```

Krida runs in the browser and uses `getUserMedia()`, so camera access requires a secure context such as `https://` or `http://localhost`.

## Core Concepts

**`App`** — the interface you implement. Provide a `name`, a `draw(ctx, trackerResult)` method called each frame, and optional `onStart` / `onStop` lifecycle hooks.

**`Session`** — top-level orchestrator. Acquires the webcam, initializes `VisionEngine` and `RenderLoop`, and manages cleanup on page hide/unload.

**`VisionEngine`** — runs tracking inference each frame, caches per-frame results, and smooths landmark output via built-in filtering.

**`RenderLoop`** — render loop that calls `App.draw()` each frame with the latest tracking results. Supports a configurable FPS cap and an optional debug overlay.

## API Reference

### Session

```ts
new Session(options?: SessionOptions)
session.start(options: SessionStartOptions): Promise<void>
session.destroy(): void
```

`SessionOptions.autoCleanupOnPageLifecycle` (default: `true`) — automatically calls `destroy()` when the page is hidden or unloaded.

`SessionStartOptions` requires `video`, `canvas`, `app`, and `visionEngineOptions`. Pass `renderLoopOptions`, `mediaStreamConstraints`, or `performanceMonitor` to customize further.

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

---

### RenderLoop

```ts
new RenderLoop(visionEngine, options?: RenderLoopOptions)
```

- `targetFPS` — cap render rate; `null` for uncapped (default: `30`)
- `debugView` — overlay landmark connections and labels (default: `false`)
- `autoClear` — clear canvas before each frame (default: `true`)

---

### App Interface

```ts
interface App {
  name: string;
  draw(ctx: CanvasRenderingContext2D, result: TrackerResult): void;
  onStart?(): void;
  onStop?(): void;
}
```

`TrackerResult.hand` contains per-hand `landmarks` arrays (normalized `{x, y, z}` points). `TrackerResult.pose` contains pose landmark data. Both may be `undefined` if the respective tracker is disabled.

---

### PerformanceMonitor

```ts
new PerformanceMonitor(options?: PerformanceMonitorOptions)
monitor.snapshot(): PerformanceSnapshot
```

Pass a `PerformanceMonitor` instance to `session.start()`. Call `snapshot()` at any time to get metrics such as `actualFPS`, `frameTime`, `handInference`, `poseInference`, model init timings, and more.

## Examples

See [`sandbox/`](sandbox/) for a minimal working implementation with hand-tracking, pose-tracking, debug overlay, performance monitor, and CDN-hosted models.

## License

MIT
