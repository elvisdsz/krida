export function fitCanvasToVideo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  signal?: AbortSignal,
): void {
  const sync = () => {
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
    }
    if (canvas.height !== video.videoHeight) {
      canvas.height = video.videoHeight;
    }
  };
  video.addEventListener("resize", sync, { signal });
  sync();
}
