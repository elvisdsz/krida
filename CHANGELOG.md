# Changelog

## Unreleased

### Breaking

- `FrameLoop` is renamed `FrameProcessor`, `FrameLoopOptions` to `FrameProcessorOptions`, and the `frameLoopOptions` option on `Session.start()` to `frameProcessorOptions`.
- `FrameLoop.start(video, callback)` is replaced by `FrameProcessor.bind(video, onResult?)` followed by `FrameProcessor.startLoop()`. `startLoop()` throws if the processor has not been bound.
- `FrameLoop.stop()` is now `FrameProcessor.stopLoop()`. It keeps the binding, so `startLoop()` resumes the loop, while `destroy()` releases it. Previously `stop()` cleared the callback, which then had to be passed again.
- `FrameLoop.isRunning` is now `FrameProcessor.isLooping`.
- `Session.isRunning` is replaced by `Session.isActive`.

### Added

- `frameMode` option on `Session.start()`: `"looped"` (default) or `"manual"`, where the host schedules updates.
- `Session.update(timestampMs?)` and `FrameProcessor.update(timestampMs?)` process at most one new video frame and return the `TrackerResult`, or `null` if the video has not advanced or the frame arrives faster than `targetFPS`. `Session.update()` also returns `null` if the session is not active.
- `scenes` is now optional on `Session.start()`.
- `SessionFrameMode` type export.

### Fixed

- `Session.destroy()` removes the debug overlay canvas it created, and `start()` no longer mutates the caller's `frameProcessorOptions`.

## 0.2.0 - 2026-08-31

Substantial API rework. Breaking for anyone on 0.1.0.

### Breaking

- `App` is replaced by the `Scene` interface. Implement `updateTracker(result)` instead of `draw()`, plus optional `onStart` / `onStop` lifecycle hooks.
- `RenderLoop` is replaced by `FrameLoop`, which decouples tracking from drawing. `renderLoopOptions` is now `frameLoopOptions`.
- `Session.start()` takes `scenes: Scene[]` instead of a single `app`, and no longer takes a `canvas` — scenes own their own rendering.
- `EMAFilter` and `LandmarkFilter` are now named exports instead of default exports.
- `EMAFilter` requires an explicit `alpha`; the previous default was removed.

### Added

- `Scene` interface. A session can drive several scenes at once.
- Gesture detection: `GestureDetector`, `GestureMap`, `PinchDetector`, and the `GestureState`, `GestureOptions`, and `GestureReading` types.
- `fitCanvasToVideo` helper that keeps canvas drawing resolution matched to the video's intrinsic size.
- `debugView` option on `Session.start()`, which draws landmark connections and indices onto an injected overlay canvas.
- `performanceMonitor` option on `Session.start()`, receiving session-wide and per-frame metrics.

## 0.1.0 and earlier

Released before this changelog was kept.
