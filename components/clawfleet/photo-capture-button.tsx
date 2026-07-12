"use client";
// Photo capture button — 1-tap camera, client-side resize to ~150KB WebP, upload to R2.
// No npm dep — uses canvas API.
//
// ทนเน็ตตก + ทนการปิดแอป (field-app · พนักงานอยู่หน้าตู้ 7-11 สัญญาณอ่อน):
//  - ถ่ายปุ๊บ → เก็บ blob ลง IndexedDB (คิวรูป) ทันที + โชว์ "✓ ถ่ายแล้ว (กำลังส่ง…)" (optimistic)
//    · onCaptured() แจ้งฟอร์มว่า "มีรูปแล้ว" → gate photoRequired ผ่านทันทีที่ถ่าย (ไม่รอ upload สำเร็จ)
//    เพราะ blob รอดข้ามการปิด/เปิดแอป (IndexedDB) + retry เอง.
//  - upload วิ่งเบื้องหลัง · ล้ม → retry 4 ครั้ง exponential backoff (1s,2s,4s) + retry เมื่อกลับมา online
//    + flush คิวที่ค้างตอน mount (รวมรูปที่ค้างจาก session ก่อนที่ปิดแอปไป).
//  - สำเร็จ → ลบออกจากคิว + onChange(url) (url จริงจาก R2) เหมือนเดิม.
//  - Fallback graceful: ถ้า IndexedDB ใช้ไม่ได้ (private mode) → คิวเป็น no-op → fall back
//    เป็น in-memory (pendingRef) เดิม · ไม่พัง · cleanup online-listener กัน leak.

import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, RefreshCw } from "lucide-react";
import {
  getPhotoQueue,
  newQueueId,
  type PhotoQueue,
  type QueuedPhoto,
} from "@/lib/clawfleet/photo-queue";

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
  phase:
    | "meter_before"
    | "cash"
    | "meter_after"
    | "stock"
    | "prize_meter"
    | "stock_after"
    // bigfeature (N1/N4) — baseline capture + machine self-photo + 4-meter snapshot + goods-receipt/stock-count
    | "machine"
    | "money_meter_top"
    | "money_meter_bottom"
    | "doll_meter_top"
    | "doll_meter_bottom"
    | "baseline_stock"
    | "goods_receipt"
    | "stock_count"
    // N1b — รูปสินค้าใหม่ที่เพิ่มตอนตั้งค่าตู้ครั้งแรก (ตุ๊กตาเก่าในตู้)
    | "product_setup";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>(value ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  // id ของงานในคิว IndexedDB ที่รอบนี้กำลังส่ง (null = ไม่มีงานค้างของ instance นี้)
  const queueIdRef = useRef<string | null>(null);
  // fallback in-memory blob เผื่อ IndexedDB ใช้ไม่ได้ (private mode) — retry online ใช้ตัวนี้
  const pendingRef = useRef<Blob | null>(null);
  // คิวรูป (IndexedDB จริง หรือ no-op) — เปิดครั้งเดียวต่อ instance
  const queueRef = useRef<PhotoQueue | null>(null);
  // token กันการอัปรอบเก่าที่ยังค้างมาเขียนทับรอบใหม่ (ถ่ายซ้ำระหว่าง retry)
  const runRef = useRef(0);
  // มี upload กำลังวิ่งอยู่ไหม (กัน flush ซ้ำจาก online/mount ยิง POST ซ้อน → R2 orphan file · RULE I idempotency)
  const uploadingRef = useRef(false);
  // ยังทำงานอยู่ไหม (กัน setState หลัง unmount)
  const aliveRef = useRef(true);

  function getQueue(): PhotoQueue {
    if (!queueRef.current) queueRef.current = getPhotoQueue();
    return queueRef.current;
  }

  const safeSet = <T,>(setter: (v: T) => void) => (v: T) => {
    if (aliveRef.current) setter(v);
  };
  const setStateSafe = safeSet(setState);
  const setErrorSafe = safeSet(setError);

  // อัปโหลด 1 งานในคิว (ครบ retry+backoff). myRun กันรอบเก่าเขียนทับรอบใหม่.
  // qid = id ในคิว IndexedDB (ลบออกเมื่อสำเร็จ). blob = ตัวที่ส่งจริง.
  async function uploadWithRetry(item: QueuedPhoto, myRun: number) {
    const queue = getQueue();
    // in-flight guard: กันไม่ให้ flush ซ้ำ (online/mount) ยิง upload ซ้อนตอนอันเก่ายังค้าง
    uploadingRef.current = true;
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (runRef.current !== myRun) return; // มีการถ่ายใหม่แล้ว → ทิ้งรอบนี้
        try {
          const fd = new FormData();
          fd.append("photo", item.blob, "photo.webp");
          fd.append("orgId", item.orgId);
          fd.append("machineCode", item.machineCode);
          fd.append("eventScopeId", item.eventScopeId);
          fd.append("phase", item.phase);
          const res = await fetch("/api/clawfleet/upload", { method: "POST", body: fd });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `อัพไม่สำเร็จ (${res.status})`);
          }
          const { url } = (await res.json()) as { url: string };
          // อัปสำเร็จ → ลบงานออกจากคิว (รอดแล้ว ไม่ต้อง flush ซ้ำ)
          await queue.remove(item.id);
          if (runRef.current !== myRun) return; // ถ่ายใหม่ระหว่างรอ → อย่าเขียนทับ
          pendingRef.current = null;
          queueIdRef.current = null;
          setErrorSafe(null);
          setStateSafe("done");
          onChange(url); // url จริง → เข้า state ฟอร์ม (ใช้ตอน submit)
          return;
        } catch (e) {
          // เก็บ error ดิบไว้ใน console เท่านั้น · พนักงานเห็นข้อความเป็นมิตร
          console.error(`[photo-capture] upload attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e);
          // บันทึกจำนวนครั้งที่พยายามลงคิว (ไว้ debug · no-op ถ้า fallback)
          void queue.update(item.id, { attempts: item.attempts + attempt });
          if (attempt < MAX_ATTEMPTS) {
            setStateSafe("retry");
            const delay = BASE_DELAY_MS * 2 ** (attempt - 1); // 1s,2s,4s
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      // หมด retry แล้วยังไม่ผ่าน → คางานไว้ในคิว IndexedDB · รอ event "online" หรือเปิดแอปใหม่มา flush ต่อ
      if (runRef.current === myRun) {
        setStateSafe("retry"); // "ถ่ายแล้ว · จะส่งเมื่อเน็ตกลับมา"
        setErrorSafe(null);
      }
    } finally {
      // ปลด in-flight เสมอ (สำเร็จ/ล้ม/ถ่ายซ้ำ) → รอบถัดไป flush ได้
      uploadingRef.current = false;
    }
  }

  // flush คิวที่ค้าง (รูปที่ยังไม่ขึ้น R2 จาก session นี้หรือ session ก่อนที่ปิดแอปไป)
  // เลือกเฉพาะงานที่ match บริบทของปุ่มนี้ (org+machine+event+phase) · หยิบชิ้นล่าสุดมาส่ง
  async function flushQueue() {
    if (value) return; // ได้ url จริงแล้ว → ไม่ต้อง flush
    if (uploadingRef.current) return; // มี upload วิ่งอยู่แล้ว → กัน POST ซ้อน (R2 orphan)
    const queue = getQueue();
    if (!queue.available) {
      // fallback in-memory: retry จาก pendingRef ที่ยังคาอยู่ (ไม่ข้าม session ได้ แต่ไม่พัง)
      if (pendingRef.current) {
        const blob = pendingRef.current;
        const myRun = ++runRef.current;
        setStateSafe("uploading");
        void uploadWithRetry(
          {
            id: queueIdRef.current ?? newQueueId(),
            blob,
            orgId,
            machineCode,
            eventScopeId,
            phase,
            label,
            createdAt: Date.now(),
            attempts: 0,
          },
          myRun,
        );
      }
      return;
    }
    const items = await queue.all();
    const mine = items
      .filter(
        (it) =>
          it.orgId === orgId &&
          it.machineCode === machineCode &&
          it.eventScopeId === eventScopeId &&
          it.phase === phase &&
          it.label === label,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    if (mine.length === 0) return;
    const latest = mine[0];
    // ล้างชิ้นเก่าซ้ำซ้อน (ถ่ายหลายรอบก่อนปิดแอป) เหลือชิ้นล่าสุดชิ้นเดียว
    for (const stale of mine.slice(1)) {
      await queue.remove(stale.id);
    }
    queueIdRef.current = latest.id;
    pendingRef.current = latest.blob;
    const myRun = ++runRef.current;
    if (!aliveRef.current) return;
    setStateSafe("uploading");
    void uploadWithRetry(latest, myRun);
  }

  // mount: เปิดคิว + flush งานค้าง · + retry เมื่อกลับมา online · cleanup listener
  useEffect(() => {
    aliveRef.current = true;
    void flushQueue();
    function onOnline() {
      void flushQueue();
    }
    window.addEventListener("online", onOnline);
    return () => {
      aliveRef.current = false;
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, orgId, machineCode, eventScopeId, phase, label]);

  async function handleFile(file: File) {
    setErrorSafe(null);
    const myRun = ++runRef.current;
    try {
      const resized = await resizeToWebp(file);
      if (runRef.current !== myRun) return; // ถ่ายซ้ำระหว่าง resize → ทิ้งรอบเก่า
      const queue = getQueue();
      const id = newQueueId();
      const item: QueuedPhoto = {
        id,
        blob: resized,
        orgId,
        machineCode,
        eventScopeId,
        phase,
        label,
        createdAt: Date.now(),
        attempts: 0,
      };
      // ถ้ามีงานเก่าของปุ่มนี้ค้างอยู่ (ถ่ายซ้ำ) → ลบทิ้ง เหลือชิ้นใหม่
      if (queueIdRef.current) void queue.remove(queueIdRef.current);
      // เก็บลง IndexedDB ทันที (รอดข้ามการปิด/เปิดแอป) — ก่อนพยายามอัป
      await queue.enqueue(item);
      queueIdRef.current = id;
      pendingRef.current = resized; // fallback in-memory เผื่อ IDB no-op
      // optimistic: นับเป็น "มีรูป" ทันที (ปลดล็อก gate ก่อน upload เสร็จ)
      setStateSafe("captured");
      onCaptured?.();
      setStateSafe("uploading");
      await uploadWithRetry(item, myRun);
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
