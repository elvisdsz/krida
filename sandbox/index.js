import { Session, PerformanceMonitor, PinchDetector } from "../dist/index.mjs";

const WASM_PATH =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_LANDMARKER_MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_LANDMARKER_MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const video      = document.getElementById("webcam");
const canvas     = document.getElementById("canvas");
const status     = document.getElementById("status");
const hudEl      = document.getElementById("hud");
const exportBtn  = document.getElementById("export-btn");

const params = new URLSearchParams(location.search);
const runLabel = params.get("run") ?? "sandbox";

const monitor = new PerformanceMonitor({ label: runLabel, windowSize: 300 });
let hudInterval = null;

const pointerApp = {
    name: "Pointer",
    ctx: canvas.getContext("2d"),
    onStart() {
        status.textContent = "Ready - show your hand!";
    },
    onStop() {
        status.textContent = "Session stopped.";
    },
    draw(ctx, trackerResult) { // TODO: Remove
       console.warn("draw shouldn't be called!");
    },
    updateTracker(trackerResult) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const pinch = trackerResult.hand?.gestures?.get("pinch");
        if (pinch) {
            const { x, y } = pinch.position ?? { x: 0, y: 0 };
            this.ctx.beginPath();
            this.ctx.arc(x * canvas.width, y * canvas.height, 12, 0, Math.PI * 2);
            this.ctx.fillStyle = pinch.isActive ? "rgba(255, 120, 0, 0.85)" : "rgba(17, 192, 26, 0.5)";
            this.ctx.fill();
        }
    }
};

const kridaSession = new Session();

async function main() {
    await kridaSession.start({
        video,
        app: pointerApp,
        visionEngineOptions: {
            handLandmarkerEnabled: true,
            poseLandmarkerEnabled: false,
            visionTaskFilesetPath: WASM_PATH,
            handLandmarkerModelPath: HAND_LANDMARKER_MODEL_PATH,
            poseLandmarkerModelPath: POSE_LANDMARKER_MODEL_PATH,
            delegate: "GPU",
            handGestureDetectors: [
                new PinchDetector(),
            ],
        },
        debugView: true,
        performanceMonitor: monitor,
    });

    // Live HUD - update every second
    if (hudInterval !== null) {
        clearInterval(hudInterval);
    }

    hudInterval = setInterval(() => {
        const snap    = monitor.snapshot();
        const fps     = snap.actualFPS.toFixed(1);
        const infHand = snap.handInference?.mean.toFixed(1) ?? "—";
        const infPose = snap.poseInference?.mean.toFixed(1) ?? "—";
        const inf     = `H ${infHand} / P ${infPose}`;
        hudEl.textContent = `${runLabel} | FPS: ${fps} | inference: ${inf} ms`;
    }, 1000);
}

exportBtn.addEventListener("click", (() => {
    let copyTimeout = null;
    return () => {
        const json = JSON.stringify(monitor.snapshot(), null, 2);

        const resetLabel = (text) => {
            clearTimeout(copyTimeout);
            exportBtn.textContent = text;
            copyTimeout = setTimeout(() => { exportBtn.textContent = "Copy Snapshot"; }, 2000);
        };

        if (!navigator.clipboard?.writeText) {
            resetLabel("Failed – copy manually");
            return;
        }

        navigator.clipboard.writeText(json)
            .then(() => { resetLabel("Copied!"); })
            .catch(() => { resetLabel("Failed – copy manually"); });
    };
})());

window.addEventListener("pagehide", () => clearInterval(hudInterval));

main().catch(err => {
    status.textContent = `Error: ${err.message}`;
    console.error(err);
});
