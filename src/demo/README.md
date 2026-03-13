# Krida Demo

A minimal hand-tracking demo that draws orange dots on your fingertips and a debug skeleton overlay.

## How to run

From the **project root**:

```sh
npm run build
npx serve .
```

Then open [http://localhost:3000/src/demo/](http://localhost:3000/src/demo/) in your browser.

> The demo loads the MediaPipe WASM runtime and hand-landmarker model from CDN on first load, so an internet connection is required.
