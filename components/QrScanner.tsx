"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Rear-camera QR scanner (getUserMedia + jsQR). Calls onResult once with the decoded text.
 * Camera access needs a secure context: https:// or http://localhost.
 */
export default function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const callback = useRef(onResult);
  callback.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function tick() {
      const video = videoRef.current;
      if (!done.current && video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        // Downscale for speed; QR codes on a phone screen decode fine at this size
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          done.current = true;
          callback.current(code.data);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    }

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("Camera needs a secure connection (https or localhost). Paste the payment link below instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(tick);
      } catch (err: any) {
        setError(
          err?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, or paste the link below."
            : "Could not open the camera. Paste the payment link below instead.",
        );
      }
    })();

    return () => {
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <>
      <div className="scanner">
        <video ref={videoRef} playsInline muted />
        <div className="frame" aria-hidden />
      </div>
      {error && <div className="alert warn" style={{ margin: "0 var(--gutter)" }}>{error}</div>}
    </>
  );
}
