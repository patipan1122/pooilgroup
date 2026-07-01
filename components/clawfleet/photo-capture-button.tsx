"use client";
// Photo capture button — 1-tap camera, client-side resize to ~150KB WebP, upload to R2.
// No npm dep — uses canvas API.
//
// ทนเน็ตตก (field-app · พนักงานอยู่หน้าตู้ 7-11 สัญญาณอ่อน):
//  - ถ่ายปุ๊บ → โชว์ "✓ ถ่ายแล้ว (กำลังส่ง…)" ทันที (optimistic) · onCaptured() แจ้งฟอร์มว่า "มีรูปแล้ว"
//    → gate photoRequired ผ่านทันทีที่ถ่าย (ไม่รอ upload สำเร็จ) เพราะรูปเก็บอยู่ในหน่วยความจำ + retry เอง.
//  - upload วิ่งเบื้องหลัง · ล้ม → retry 4 ครั้ง exponential backoff (1s,2s,4s,8s) + retry เมื่อกลับมา online.
//  - สำเร็จ → onChange(url) (url จริงจาก R2) เหมือนเดิม.
//  - เก็บ blob ในหน่วยความจำเท่านั้น (ห้าม IndexedDB) · cleanup online-listener กัน leak.

import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, RefreshCw } from "lucide-react";

const MAX_DIMENSION = 1080;
const QUALITY = 0.75;
const MAX_ATTEMPTS = 4; // ครั้งแรก + retry อีก 3 (รวม backoff 1s,2s,4s)
const BASE_DELAY_MS = 1000;

type UploadState = "idle" | "captured" | "uploading" | "done" | "retry";

export function PhotoCaptureButton({
  label,
  value,
  onChange,
  onCaptured,
  orgId,
  machineCode,
  eventScopeId,
  phase,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  // แจ้งฟอร์มว่า "ถ่ายรูปแล้ว" ทันที (นับเป็นมีรูป · ปลดล็อก gate ก่อน upload เสร็จ). optional กัน call site เก่าพัง.
  onCaptured?: () => void;
  orgId: string;
  machineCode: string;
  eventScopeId: string;
  phase: "meter_before" | "cash" | "meter_after" | "stock" | "prize_meter" | "stock_after";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>(value ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  // blob ที่รอส่ง (เก็บในหน่วยความจำเท่านั้น) — retry เมื่อ online ใช้ตัวนี้
  const pendingRef = useRef<Blob | null>(null);
  // token กันการอัปรอบเก่าที่ยังค้างมาเขียนทับรอบใหม่ (ถ่ายซ้ำระหว่าง retry)
  const runRef = useRef(0);
  // ยังทำงานอยู่ไหม (กัน setState หลัง unmount)
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const safeSet = <T,>(setter: (v: T) => void) => (v: T) => {
    if (aliveRef.current) setter(v);
  };
  const setStateSafe = safeSet(setState);
  const setErrorSafe = safeSet(setError);

  // อัปโหลด 1 รอบ (ครบ retry+backoff) สำหรับ blob ที่ให้มา. myRun กันรอบเก่าเขียนทับรอบใหม่.
  async function uploadWithRetry(blob: Blob, myRun: number) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (runRef.current !== myRun) return; // มีการถ่ายใหม่แล้ว → ทิ้งรอบนี้
      try {
        const fd = new FormData();
        fd.append("photo", blob, "photo.webp");
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
        if (runRef.current !== myRun) return; // ถ่ายใหม่ระหว่างรอ → อย่าเขียนทับ
        pendingRef.current = null;
        setErrorSafe(null);
        setStateSafe("done");
        onChange(url); // url จริง → เข้า state ฟอร์ม (ใช้ตอน submit)
        return;
      } catch (e) {
        // เก็บ error ดิบไว้ใน console เท่านั้น · พนักงานเห็นข้อความเป็นมิตร
        console.error(`[photo-capture] upload attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e);
        if (attempt < MAX_ATTEMPTS) {
          setStateSafe("retry");
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1); // 1s,2s,4s
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    // หมด retry แล้วยังไม่ผ่าน → คา blob ไว้ใน pendingRef · รอ event "online" มา retry ต่อ
    if (runRef.current === myRun) {
      setStateSafe("retry"); // "ถ่ายแล้ว · จะส่งเมื่อเน็ตกลับมา"
      setErrorSafe(null);
    }
  }

  // retry อัตโนมัติเมื่อกลับมา online (มี blob ค้าง + ยังไม่ได้ url)
  useEffect(() => {
    function onOnline() {
      if (pendingRef.current && !value) {
        const blob = pendingRef.current;
        const myRun = ++runRef.current;
        setStateSafe("uploading");
        void uploadWithRetry(blob, myRun);
      }
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, orgId, machineCode, eventScopeId, phase]);

  async function handleFile(file: File) {
    setErrorSafe(null);
    const myRun = ++runRef.current;
    try {
      const resized = await resizeToWebp(file);
      if (runRef.current !== myRun) return; // ถ่ายซ้ำระหว่าง resize → ทิ้งรอบเก่า
      pendingRef.current = resized;
      // optimistic: นับเป็น "มีรูป" ทันที (ปลดล็อก gate ก่อน upload เสร็จ) — รูปเก็บใน memory + retry เอง
      setStateSafe("captured");
      onCaptured?.();
      setStateSafe("uploading");
      await uploadWithRetry(resized, myRun);
    } catch (e) {
      // resize/encode ล้ม (รูปเสีย) — อันนี้ retry ไม่ช่วย → บอกให้ถ่ายใหม่
      console.error("[photo-capture] resize failed:", e);
      if (runRef.current === myRun) {
        pendingRef.current = null;
        setStateSafe("idle");
        setErrorSafe("รูปมีปัญหา · แตะถ่ายใหม่");
      }
    }
  }

  // มีรูปแล้วไหม (ถ่ายแล้วนับทันที ไม่ต้องรอ upload) → ใช้เลือกสไตล์ปุ่ม
  const hasPhoto = !!value || state === "captured" || state === "uploading" || state === "retry" || state === "done";
  const isBusy = state === "uploading";
  const isRetry = state === "retry";

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
        className={`co-tap flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-3 text-center text-xs font-medium leading-tight transition ${
          hasPhoto
            ? isRetry
              ? "border-amber-300 bg-amber-50/60 text-amber-700"
              : "border-emerald-300 bg-emerald-50/60 text-emerald-700"
            : error
              ? "border-red-300 bg-red-50/50 text-red-700"
              : "border-zinc-300 bg-zinc-50/50 text-zinc-600 hover:border-indigo-400 hover:bg-indigo-50/30"
        }`}
      >
        {hasPhoto ? (
          <>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                isRetry ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {isBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isRetry ? (
                <RefreshCw className="h-5 w-5" strokeWidth={2.4} />
              ) : (
                <Check className="h-5 w-5" strokeWidth={2.6} />
              )}
            </span>
            <span>{label}</span>
            <span className={`text-[10px] ${isRetry ? "text-amber-600" : "text-emerald-600"}`}>
              {isBusy
                ? "✓ ถ่ายแล้ว (กำลังส่ง…)"
                : isRetry
                  ? "✓ ถ่ายแล้ว · จะส่งเมื่อเน็ตกลับมา"
                  : "ถ่ายแล้ว · แตะเพื่อถ่ายใหม่"}
            </span>
          </>
        ) : error ? (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Camera className="h-5 w-5" />
            </span>
            <span>{label}</span>
            <span className="text-[10px] text-red-600">{error}</span>
          </>
        ) : (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <Camera className="h-5 w-5" />
            </span>
            <span>{label}</span>
          </>
        )}
      </button>
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
