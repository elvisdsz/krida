# Krida Sandbox

A minimal hand-tracking sandbox for manual testing.

It runs the hand landmarker on GPU with a `PinchDetector` attached, and draws a
single dot at the midpoint between the thumb and index fingertip - green while
the pinch is inactive and orange once it activates. Pose tracking is disabled.

`debugView` is on, so the library also injects its own overlay canvas showing the
hand skeleton and numbered landmark indices.

A HUD in the bottom-left refreshes once a second with the measured FPS and mean
hand/pose inference times. **Copy Snapshot** puts the full `PerformanceMonitor`
snapshot on the clipboard as JSON.

## How to run

From the **project root**:

```sh
npm run build
npx serve .
```

Then open [http://localhost:3000/sandbox/](http://localhost:3000/sandbox/) in the browser.

Append `?run=<label>` to tag a run — the label appears in the HUD and in the
exported snapshot, which is handy when comparing several runs.

> The sandbox loads the MediaPipe WASM runtime and hand-landmarker model from CDN
> on first load, so an internet connection is required.
