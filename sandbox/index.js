import { engine, EngineLoop } from "../dist/index.mjs";

const WASM_PATH =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const video  = document.getElementById("webcam");
const canvas = document.getElementById("canvas");
const status = document.getElementById("status");

// Landmark indices for all five fingertips (MediaPipe hand model)
const FINGERTIPS = [4, 8, 12, 16, 20];

const pointerApp = {
    name: "Pointer",
    draw(ctx, result) {
        for (const hand of result.landmarks) {
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

async function main() {
    // 1. Open webcam
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await new Promise(resolve => video.addEventListener("loadeddata", resolve, { once: true }));

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;

    // 2. Load the hand-landmarker model
    await engine.init({
        handLandmarkerEnabled: true,
        visionTaskFilesetPath: WASM_PATH,
        handLandmarkerModelPath: MODEL_PATH,
    });

    status.textContent = "Ready - show your hand!";

    // 3. Start the render loop
    //    debugView draws the green skeleton + red landmark dots automatically
    const loop = new EngineLoop(engine, { debugView: true });
    loop.start(video, canvas, pointerApp);
}

main().catch(err => {
    status.textContent = `Error: ${err.message}`;
    console.error(err);
});
