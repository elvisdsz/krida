# Krida Sandbox

A minimal hand-tracking sandbox that draws orange dots on your fingertips and a debug skeleton overlay.

## How to run

From the **project root**:

```sh
npm run build
npx serve .
```

Then open [http://localhost:3000/sandbox/](http://localhost:3000/sandbox/) in your browser.

> The sandbox loads the MediaPipe WASM runtime and hand-landmarker model from CDN on first load, so an internet connection is required.
