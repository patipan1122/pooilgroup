"use client";

// Selfie identity check for the maid onboarding flow (CEO 2026-09-22).
//
// Camera handling is modelled on components/playland/face-capture.tsx — same
// 3-tier input ladder (live webcam → phone native camera → pick a file) and the
// same getUserMedia error classification, because those are the parts that took
// real device testing to get right. Two deliberate differences:
//   1. Playland's component is styled with `--pl-*` vars + `.pl-btn`, which only
//      exist inside app/(admin)/playland/playland.css — importing it here would
//      render unstyled. This one uses the same Tailwind idiom as IdCardUpload.
//   2. Playland throws the photo away after a face-match; here the photo IS the
//      record, so it uploads to R2 and exposes the URL through a hidden input
//      (same presign route + plain-form contract as IdCardUpload).
//
// PDPA: the resulting R2 object is sensitive personal data (a face). It is
// gated behind the explicit sensitive-data consent checkbox on the form.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, Upload } from "lucide-react";

interface Props {
  /** hidden-input name → carries the uploaded R2 url on a plain form submit */
  name?: string;
  label?: string;
  initialUrl?: string | null;
  onChange?: (url: string | null) => void;
}

type CameraError = {
  kind: "denied" | "no-camera" | "in-use" | "no-support" | "other";
  detail: string;
};

function classifyError(e: unknown): CameraError {
  const err = e as { name?: string; message?: string };
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
    return { kind: "denied", detail: "กล้องถูกปิดไว้ — กดไอคอนรูปกุญแจข้างช่องที่อยู่เว็บ แล้วเลือกอนุญาตกล้อง" };
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
    return { kind: "no-camera", detail: "ไม่พบกล้องในเครื่องนี้ — ใช้ปุ่มอัปโหลดรูปแทนได้เลย" };
  }
  if (err?.name === "NotReadableError") {
    return { kind: "in-use", detail: "กล้องกำลังถูกแอปอื่นใช้อยู่ — ปิดแอปนั้นก่อน หรืออัปโหลดรูปแทน" };
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { kind: "no-support", detail: "เครื่องนี้เปิดกล้องในหน้าเว็บไม่ได้ — ใช้ปุ่มอัปโหลดรูปแทน" };
  }
  return { kind: "other", detail: err?.message ?? "เปิดกล้องไม่สำเร็จ — ใช้ปุ่มอัปโหลดรูปแทนได้" };
}

/** Center-crop any image file to a square JPEG dataURL (keeps uploads small). */
function fileToSquareDataUrl(file: File, size = 480, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("ประมวลรูปไม่สำเร็จ"));
        const min = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(
          img,
          (img.naturalWidth - min) / 2,
          (img.naturalHeight - min) / 2,
          min,
          min,
          0,
          0,
          size,
          size,
        );
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพ"));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
  const presign = await fetch("/api/r2/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
  });
  if (!presign.ok) {
    const j = (await presign.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "ขอลิงก์อัปโหลดรูปไม่สำเร็จ");
  }
  const { uploadUrl, publicUrl } = (await presign.json()) as {
    uploadUrl: string;
    publicUrl: string;
  };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error("อัปโหลดรูปไม่สำเร็จ");
  return publicUrl;
}

export function SelfieCapture({
  name = "selfie",
  label = "รูปถ่ายหน้าตรง (เซลฟี่)",
  initialUrl = null,
  onChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [url, setUrl] = useState<string | null>(initialUrl);
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [ready, setReady] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setReady(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(classifyError(new Error("no getUserMedia")).detail);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      }
    } catch (e) {
      setError(classifyError(e).detail);
      stopCamera();
    }
  }, [stopCamera]);

  /** Shared tail for both capture paths: show it, upload it, expose the URL. */
  const acceptDataUrl = useCallback(
    async (dataUrl: string) => {
      setPreview(dataUrl);
      setUploading(true);
      setError(null);
      try {
        const publicUrl = await uploadDataUrl(dataUrl);
        setUrl(publicUrl);
        onChange?.(publicUrl);
      } catch (err) {
        setPreview(null);
        setError(err instanceof Error ? err.message : "อัปโหลดรูปไม่สำเร็จ");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

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
    ctx.drawImage(
      video,
      (video.videoWidth - min) / 2,
      (video.videoHeight - min) / 2,
      min,
      min,
      0,
      0,
      size,
      size,
    );
    stopCamera();
    void acceptDataUrl(canvas.toDataURL("image/jpeg", 0.85));
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputResetSafe(fileRef)) fileRef.current!.value = "";
    if (!file) return;
    if (file.size > 8_000_000) {
      setError("ไฟล์ใหญ่เกิน 8MB — ลองถ่ายใหม่หรือเลือกรูปที่เล็กกว่านี้");
      return;
    }
    setError(null);
    try {
      void acceptDataUrl(await fileToSquareDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "ประมวลรูปไม่สำเร็จ");
    }
  }

  function retake() {
    setUrl(null);
    setPreview(null);
    setError(null);
    onChange?.(null);
  }

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-zinc-800">{label}</span>
      <input type="hidden" name={`${name}ImageUrl`} value={url ?? ""} />

      {/* คำอธิบายภาษาไทยก่อน browser จะเด้งถามขออนุญาตกล้อง — ป๊อปอัพของ
          เบราว์เซอร์เป็นภาษาอังกฤษ คนที่ไม่คุ้นมักกดปฏิเสธเพราะไม่เข้าใจ */}
      {!preview && !cameraOn && (
        <p className="text-xs leading-relaxed text-zinc-500">
          ถ่ายรูปหน้าตรงไว้ยืนยันว่าเป็นตัวคุณจริง ใช้ครั้งเดียวตอนทำสัญญา
          <br />
          กดปุ่มแล้วเครื่องจะถามขออนุญาตเปิดกล้อง — กด “อนุญาต” ได้เลย
          หรือถ้าไม่สะดวกใช้ปุ่ม “เลือกรูปจากเครื่อง” ก็ได้
        </p>
      )}

      <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="รูปเซลฟี่" className="size-full object-cover" />
            {uploading ? (
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-zinc-900/75 py-1.5 text-xs font-medium text-white">
                <Loader2 className="size-3.5 animate-spin" /> กำลังอัปโหลด…
              </span>
            ) : url ? (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">
                <CheckCircle2 className="size-3" /> ถ่ายแล้ว
              </span>
            ) : null}
          </>
        ) : cameraOn ? (
          <video
            ref={videoRef}
            muted
            playsInline
            className="size-full -scale-x-100 object-cover"
          />
        ) : (
          <button
            type="button"
            onClick={startCamera}
            className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-zinc-500 hover:bg-zinc-50"
          >
            <Camera className="size-8 text-zinc-400" aria-hidden />
            <span className="text-sm font-medium text-zinc-700">เปิดกล้องถ่ายเซลฟี่</span>
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={onFilePicked}
        className="hidden"
      />

      <div className="flex flex-wrap gap-2 pt-0.5">
        {preview ? (
          <button
            type="button"
            onClick={retake}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 active:bg-zinc-50 disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" /> ถ่ายใหม่
          </button>
        ) : cameraOn ? (
          <>
            <button
              type="button"
              onClick={capture}
              disabled={!ready}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              <Camera className="size-4" /> ถ่ายเลย
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex items-center rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 active:bg-zinc-50"
            >
              ปิดกล้อง
            </button>
          </>
        ) : null}

        {/* ปุ่มอัปโหลดต้องเห็นตั้งแต่แรกเสมอ ไม่ต้องรอให้กล้องพังก่อน */}
        {!preview && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 active:bg-zinc-50"
          >
            <Upload className="size-3.5" /> เลือกรูปจากเครื่อง
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
    </div>
  );
}

/** Guard so clearing the file input never throws on an unmounted ref. */
function inputResetSafe(ref: React.RefObject<HTMLInputElement | null>): boolean {
  return ref.current !== null;
}
