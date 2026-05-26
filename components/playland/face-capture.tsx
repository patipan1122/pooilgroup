"use client";

// Face capture · 3 input modes (in priority order):
//   1. Live webcam (getUserMedia)
//   2. Phone native camera (input type=file capture=user · iOS/Android shortcut)
//   3. Upload existing image file (laptop without webcam · or after denial)
// All paths produce same 480x480 JPEG ~200KB base64 dataURL.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, CheckCircle2, Upload, AlertTriangle, ShieldQuestion } from "lucide-react";

interface Props {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
}

type CameraError = {
  kind: "denied" | "no-camera" | "in-use" | "no-support" | "other";
  detail: string;
};

function classifyError(e: unknown): CameraError {
  const err = e as { name?: string; message?: string };
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
    return { kind: "denied", detail: "กล้องถูกบล็อก · เปิด permission ใน browser/macOS" };
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
    return { kind: "no-camera", detail: "ไม่พบกล้องในเครื่องนี้" };
  }
  if (err?.name === "NotReadableError") {
    return { kind: "in-use", detail: "กล้องถูกใช้โดยแอปอื่น · ปิด Zoom/Meet ก่อน" };
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { kind: "no-support", detail: "browser นี้ไม่รองรับกล้อง" };
  }
  return { kind: "other", detail: err?.message ?? "unknown error" };
}

function fileToCroppedDataUrl(file: File, size = 480, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas ctx"));
        const min = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - min) / 2;
        const sy = (img.naturalHeight - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("image decode"));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function FaceCapture({ value, onChange, label = "ถ่ายรูปหน้า" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<CameraError | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"webcam" | "upload">("webcam");
  const [cameraStarted, setCameraStarted] = useState(false); // user-gesture gate

  // Cleanup on unmount or value capture
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Stop stream when a photo is captured (don't keep camera on)
  useEffect(() => {
    if (value && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraStarted(false);
      setReady(false);
    }
  }, [value]);

  // User-gesture-driven camera start · permission prompt only fires after click
  // (Browsers may silently fail useEffect-triggered getUserMedia · be explicit)
  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError({ kind: "no-support", detail: "browser นี้ไม่รองรับกล้อง" });
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
        setCameraStarted(true);
      }
    } catch (e) {
      const classified = classifyError(e);
      setError(classified);
      setCameraStarted(false);
      console.warn("[face-capture] getUserMedia failed", classified.kind, e);
    }
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const size = 480;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
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
    setReady(false);
    setCameraStarted(false);
    // Don't auto-restart · user clicks "เปิดกล้อง" again (consistent UX)
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8_000_000) {
      setError({ kind: "other", detail: "ไฟล์ใหญ่เกิน 8MB" });
      return;
    }
    try {
      const dataUrl = await fileToCroppedDataUrl(file);
      onChange(dataUrl);
      setError(null);
    } catch (err) {
      setError({ kind: "other", detail: err instanceof Error ? err.message : "ประมวลรูปไม่ได้" });
    }
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
        ) : error && mode === "webcam" ? (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#fde68a", padding: 24, textAlign: "center", gap: 10 }}>
            <AlertTriangle size={32} color="#fbbf24" />
            <div style={{ fontWeight: 600, fontSize: 14 }}>{error.detail}</div>
            {error.kind === "denied" && (
              <div style={{ fontSize: 12, color: "#fef3c7", lineHeight: 1.5, maxWidth: 280 }}>
                <b>Chrome:</b> กดไอคอน 🔒 ข้าง URL → "Camera" → Allow<br />
                <b>macOS:</b> System Settings → Privacy → Camera → ✓ Chrome
              </div>
            )}
          </div>
        ) : mode === "upload" ? (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#a8a29e", padding: 24, textAlign: "center", gap: 10 }}>
            <Upload size={32} opacity={0.6} />
            <div style={{ fontSize: 13 }}>กดปุ่ม "เลือกรูป" ด้านล่าง<br />(มือถือจะเปิดกล้องในตัว · laptop เลือกไฟล์)</div>
          </div>
        ) : mode === "webcam" && !cameraStarted ? (
          // Pre-permission state · explicit user gesture to trigger browser prompt
          <button
            type="button"
            onClick={startCamera}
            style={{
              display: "grid", placeItems: "center", height: "100%", width: "100%",
              border: "none", cursor: "pointer", color: "#e7e5e4",
              background: "linear-gradient(135deg, #292524 0%, #1c1917 100%)",
              gap: 12, padding: 24, textAlign: "center",
            }}
          >
            <div style={{ display: "inline-flex", padding: 16, borderRadius: 999, background: "rgba(245,158,11,0.18)", color: "#fbbf24" }}>
              <ShieldQuestion size={36} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>ขออนุญาตเปิดกล้อง</div>
            <div style={{ fontSize: 12, color: "#a8a29e", maxWidth: 240, lineHeight: 1.5 }}>
              กดที่นี่ · browser จะถามให้อนุญาต<br />หรือใช้ "อัปโหลด" ด้านล่างก็ได้
            </div>
          </button>
        ) : (
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
        )}
      </div>

      {/* Hidden file input · `capture="user"` makes mobile open front camera directly */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={onFilePicked}
        style={{ display: "none" }}
      />

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {value ? (
          <button type="button" className="pl-btn" onClick={retake}>
            <RotateCcw size={14} /> ถ่ายใหม่
          </button>
        ) : mode === "webcam" && !error ? (
          cameraStarted ? (
            <>
              <button type="button" className="pl-btn pl-btn-primary" onClick={capture} disabled={!ready}>
                <Camera size={14} /> ถ่ายเลย
              </button>
              <button type="button" className="pl-btn pl-btn-sm" onClick={() => { setMode("upload"); setError(null); }}>
                <Upload size={12} /> หรืออัปโหลด
              </button>
            </>
          ) : (
            <button type="button" className="pl-btn pl-btn-sm" onClick={() => { setMode("upload"); setError(null); }}>
              <Upload size={12} /> หรืออัปโหลดรูปจากเครื่อง
            </button>
          )
        ) : (
          <>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> เลือกรูป
            </button>
            <button type="button" className="pl-btn pl-btn-sm" onClick={() => { setMode("webcam"); setError(null); setCameraStarted(false); }}>
              <Camera size={12} /> ลองกล้องอีกครั้ง
            </button>
          </>
        )}
      </div>
    </div>
  );
}
