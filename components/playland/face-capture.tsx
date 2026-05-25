"use client";

// Face capture via webcam · client-only · returns dataURL (base64 JPEG ~200KB)
// Compression: render to 480x480 canvas · JPEG quality 0.85
// Per memory ceo-prefers-multi-pane-workspace: big preview + obvious retake button

import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, CheckCircle2 } from "lucide-react";

interface Props {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
}

export function FaceCapture({ value, onChange, label = "ถ่ายรูปหน้า" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (value) return; // already captured · skip starting camera
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (e) {
        setError("ไม่สามารถเปิดกล้องได้ — กรุณาอนุญาตการเข้าถึงกล้องใน browser");
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [value]);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const size = 480;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Cover square crop
    const min = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - min) / 2;
    const sy = (video.videoHeight - min) / 2;
    ctx.drawImage(video, sx, sy, min, min, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onChange(dataUrl);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function retake() {
    onChange(null);
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginBottom: 6, fontWeight: 600, letterSpacing: 0.02 }}>{label}</div>
      <div style={{ position: "relative", width: "100%", maxWidth: 360, aspectRatio: "1/1", background: "#1c1917", borderRadius: 12, overflow: "hidden", border: "1px solid var(--pl-line)" }}>
        {value ? (
          <>
            <img src={value} alt="captured" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", top: 8, right: 8, background: "var(--pl-ok)", color: "white", borderRadius: 999, padding: "2px 8px", fontSize: 11, display: "flex", gap: 4, alignItems: "center" }}>
              <CheckCircle2 size={12} /> ถ่ายแล้ว
            </div>
          </>
        ) : error ? (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#fca5a5", padding: 20, textAlign: "center", fontSize: 13 }}>{error}</div>
        ) : (
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
        )}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {value ? (
          <button type="button" className="pl-btn" onClick={retake}>
            <RotateCcw size={14} /> ถ่ายใหม่
          </button>
        ) : (
          <button type="button" className="pl-btn pl-btn-primary" onClick={capture} disabled={!ready}>
            <Camera size={14} /> ถ่ายเลย
          </button>
        )}
      </div>
    </div>
  );
}
