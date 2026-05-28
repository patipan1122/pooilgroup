"use client";
// Photo capture button — 1-tap camera, client-side resize to ~150KB WebP, upload to R2.
// No npm dep — uses canvas API.

import { useRef, useState } from "react";
import { Camera, Check, Loader2, X } from "lucide-react";

const MAX_DIMENSION = 1080;
const QUALITY = 0.75;

export function PhotoCaptureButton({
  label,
  value,
  onChange,
  orgId,
  machineCode,
  eventScopeId,
  phase,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  orgId: string;
  machineCode: string;
  eventScopeId: string;
  phase: "meter_before" | "cash" | "meter_after" | "stock";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const resized = await resizeToWebp(file);
      const fd = new FormData();
      fd.append("photo", resized, "photo.webp");
      fd.append("orgId", orgId);
      fd.append("machineCode", machineCode);
      fd.append("eventScopeId", eventScopeId);
      fd.append("phase", phase);
      const res = await fetch("/api/clawfleet/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `อัพไม่สำเร็จ (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      onChange(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={`flex h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs transition ${
          value
            ? "border-emerald-300 bg-emerald-50/40 text-emerald-700"
            : error
              ? "border-red-300 bg-red-50/40 text-red-700"
              : "border-zinc-300 bg-zinc-50/40 text-zinc-600 hover:border-blue-400"
        }`}
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : value ? (
          <>
            <Check className="h-6 w-6" />
            <span>{label}</span>
            <span className="text-[10px] text-emerald-600">แตะเพื่อถ่ายใหม่</span>
          </>
        ) : error ? (
          <>
            <X className="h-6 w-6" />
            <span>{label}</span>
            <span className="text-[10px] text-red-600">ลองอีก</span>
          </>
        ) : (
          <>
            <Camera className="h-6 w-6" />
            <span>{label}</span>
          </>
        )}
      </button>
      {error && (
        <p className="mt-1 truncate text-[10px] text-red-600">{error}</p>
      )}
    </div>
  );
}

async function resizeToWebp(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width >= height) {
      height = Math.round((height * MAX_DIMENSION) / width);
      width = MAX_DIMENSION;
    } else {
      width = Math.round((width * MAX_DIMENSION) / height);
      height = MAX_DIMENSION;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas ไม่รองรับ");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/webp", QUALITY),
  );
  if (!blob) throw new Error("encode WebP ไม่สำเร็จ");
  if (blob.size > 500 * 1024) {
    // fallback: re-encode lower quality
    const b2 = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/webp", 0.5),
    );
    if (!b2) throw new Error("compress ไม่สำเร็จ");
    return b2;
  }
  return blob;
}
