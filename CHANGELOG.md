# Changelog

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
