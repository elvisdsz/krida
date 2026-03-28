import { EngineRuntime } from "../dist/index.mjs";

const WASM_PATH =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const HAND_LANDMARKER_MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_LANDMARKER_MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const video  = document.getElementById("webcam");
const canvas = document.getElementById("canvas");
const status = document.getElementById("status");

// Landmark indices for all five fingertips (MediaPipe hand model)
const FINGERTIPS = [4, 8, 12, 16, 20];

const pointerApp = {
    name: "Pointer",
    draw(ctx, trackerResult) {
        for (const hand of trackerResult.hand?.landmarks || []) {
            for (const i of FINGERTIPS) {
                const { x, y } = hand[i];
                ctx.beginPath();
                ctx.arc(x * canvas.width, y * canvas.height, 12, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 120, 0, 0.85)";
                ctx.fill();
            }
        }
    },
};

const runtime = new EngineRuntime();

async function main() {
    await runtime.start({
        video,
        canvas,
        app: pointerApp,
        visionEngineOptions: {
            handLandmarkerEnabled: true,
            poseLandmarkerEnabled: true,
            visionTaskFilesetPath: WASM_PATH,
            handLandmarkerModelPath: HAND_LANDMARKER_MODEL_PATH,
            poseLandmarkerModelPath: POSE_LANDMARKER_MODEL_PATH,
        },
        loopOptions: {
            debugView: true,
        },
    });

    status.textContent = "Ready - show your hand!";
}

main().catch(err => {
    status.textContent = `Error: ${err.message}`;
    console.error(err);
});
