"use client";
// Photo capture button — 1-tap: มือถือเด้งเมนูให้เลือก "ถ่ายรูป / เลือกจากคลังภาพ" เอง
// (เอา capture="environment" ออก · CEO 2026-07-20 อยากแนบรูปเก่าได้ ไม่ใช่ถ่ายอย่างเดียว)
// client-side resize to JPEG (iOS Safari รองรับ 100% · WebP encode ทำไม่ได้บน iOS<17 → เด้งเป็น PNG ก้อนใหญ่), upload to R2.
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
const QUALITY = 0.8; // JPEG คุณภาพเริ่มต้น (1080px q0.8 ≈ 150–300KB · ต่ำกว่าเพดาน server 500KB)
const TARGET_BYTES = 480 * 1024; // เป้าขนาดหลังย่อ (ต่ำกว่า server cap 500KB เผื่อ margin)
const MAX_ATTEMPTS = 4; // ครั้งแรก + retry อีก 3 (รวม backoff 1s,2s,4s)
const BASE_DELAY_MS = 1000;

type UploadState = "idle" | "captured" | "uploading" | "done" | "retry";

export function PhotoCaptureButton({
  label,
  value,
  onChange,
  onCaptured,
  onUploadStatus,
  orgId,
  machineCode,
  eventScopeId,
  phase,
  compact = false,
  slim = false,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  // แจ้งฟอร์มว่า "ถ่ายรูปแล้ว" ทันที (นับเป็นมีรูป · ปลดล็อก gate ก่อน upload เสร็จ). optional กัน call site เก่าพัง.
  onCaptured?: () => void;
  // แจ้งสถานะอัปโหลดจริง (กำลังอัป / error) ให้ฟอร์มพ่อแม่ล็อกปุ่มบันทึกระหว่างอัป — บังคับทุก call site ต้องรับ
  // (เดิม optional → มีแค่ 1/12 จุดต่อสายจริง ที่เหลือกดบันทึกก่อนอัปเสร็จได้ = รูปหายเงียบ 2026-08-15)
  onUploadStatus: (status: { uploading: boolean; error: string | null }) => void;
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
  // compact = ไอคอนกล้องเล็ก (46px) วางในบรรทัดเดียวกับช่องกรอก (เช่น มิเตอร์) — logic เหมือนเดิมทุกอย่าง
  compact?: boolean;
  // slim = ปุ่มบรรทัดเดียว ~44px (รูปก่อน/หลังเติม ตาม mockup) — logic เหมือนเดิมทุกอย่าง
  slim?: boolean;
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
          const ext =
            item.blob.type === "image/png"
              ? "png"
              : item.blob.type === "image/webp"
                ? "webp"
                : "jpg";
          fd.append("photo", item.blob, `photo.${ext}`);
          fd.append("orgId", item.orgId);
          fd.append("machineCode", item.machineCode);
          fd.append("eventScopeId", item.eventScopeId);
          fd.append("phase", item.phase);
          const res = await fetch("/api/clawfleet/upload", { method: "POST", body: fd });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            // 4xx (ยกเว้น 408 timeout / 429 rate-limit) = ปัญหาถาวร (รูปใหญ่/ฟอร์แมตผิด/สิทธิ์) →
            // retry ไม่ช่วย · ต้องหยุดแล้วบอกพนักงานให้ถ่ายใหม่ (ไม่หลอกว่า "รอเน็ต")
            const permanent =
              res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
            const err = new Error(text || `อัพไม่สำเร็จ (${res.status})`) as Error & {
              permanent?: boolean;
            };
            err.permanent = permanent;
            throw err;
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
          // ปัญหาถาวร (4xx) → หยุด retry ทันที · เอางานออกจากคิว (กัน flush วนไม่จบ) · แจ้งให้ถ่ายใหม่
          if ((e as { permanent?: boolean })?.permanent) {
            if (runRef.current === myRun) {
              const raw = (e as Error).message || "";
              const friendly = /ใหญ่|500KB|resize/i.test(raw)
                ? "รูปใหญ่เกินไป · แตะถ่ายใหม่"
                : /รองรับ|ฟอร์แมต|JPEG|PNG|WebP|format/i.test(raw)
                  ? "ไฟล์รูปไม่รองรับ · แตะถ่ายใหม่"
                  : "อัปรูปไม่สำเร็จ · แตะถ่ายใหม่";
              void queue.remove(item.id);
              pendingRef.current = null;
              queueIdRef.current = null;
              setStateSafe("idle");
              setErrorSafe(friendly);
            }
            return;
          }
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

  // แจ้งสถานะจริงให้ฟอร์มพ่อแม่ทุกครั้งที่เปลี่ยน — "uploading" นับเฉพาะ attempt แรกที่กำลังส่งจริง
  // (ไม่รวม "retry" ที่รอเน็ตกลับมา เพราะอาจค้างไม่มีกำหนด · ไม่ควรบล็อกฟอร์มทั้งก้อนตอนนั้น)
  useEffect(() => {
    onUploadStatus?.({ uploading: state === "uploading", error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, error]);

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
      const resized = await resizeToJpeg(file);
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

  // ── compact: ไอคอนกล้องเล็ก 46px (วางในแถวเดียวกับช่องกรอกเลข เช่น มิเตอร์) ──
  // logic ถ่าย/คิว/อัปโหลดเหมือนปุ่มใหญ่ทุกอย่าง — ต่างแค่ visual shell
  if (compact) {
    const tone = hasPhoto
      ? isRetry
        ? { bd: "#FCD9A8", bg: "#FEF6EA", fg: "#B45309" }
        : { bd: "#A7E3C0", bg: "#EAF7EF", fg: "#15803D" }
      : error
        ? { bd: "#F3B4B4", bg: "#FDECEC", fg: "#DC2626" }
        : { bd: "#E3E6EA", bg: "#F6F7FA", fg: "#7A828C" };
    return (
      <>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          aria-label={label}
          title={hasPhoto ? "ถ่ายแล้ว · แตะเพื่อถ่ายใหม่" : error ? error : label}
          onClick={() => ref.current?.click()}
          className="co-tap"
          style={{
            width: 46,
            height: 46,
            flex: "0 0 46px",
            borderRadius: 11,
            border: `1.5px solid ${tone.bd}`,
            background: tone.bg,
            color: tone.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {isBusy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isRetry ? (
            <RefreshCw className="h-5 w-5" strokeWidth={2.4} />
          ) : hasPhoto ? (
            <Check className="h-5 w-5" strokeWidth={2.6} />
          ) : (
            <Camera className="h-5 w-5" />
          )}
        </button>
      </>
    );
  }

  // ── slim: ปุ่มบรรทัดเดียว ~44px (mockup "ถ่ายก่อนเติม" → "ก่อนเติม ✓") — logic ถ่าย/คิว/อัปโหลดเดิมทุกอย่าง ──
  // ว่าง = เส้นประเทา · ถ่ายแล้ว = ขอบเขียวทึบ · retry = amber · แตะซ้ำ = ถ่ายใหม่ (ไม่ใช่ toggle ลบ)
  if (slim) {
    const tone = hasPhoto
      ? isRetry
        ? { bd: "1.5px solid #F0D8AE", bg: "#FFFBF3", fg: "#B45309" }
        : { bd: "1.5px solid #BFE6CB", bg: "#F2FBF5", fg: "#15803D" }
      : error
        ? { bd: "1.5px dashed #F3B4B4", bg: "#FDECEC", fg: "#DC2626" }
        : { bd: "1.5px dashed #C9CFD8", bg: "#FAFBFC", fg: "#6B7280" };
    return (
      <>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          title={error ? error : hasPhoto ? "ถ่ายแล้ว · แตะเพื่อถ่ายใหม่" : label}
          onClick={() => ref.current?.click()}
          className="co-tap"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            width: "100%", minHeight: 44, padding: "12px 8px", borderRadius: 11,
            border: tone.bd, background: tone.bg, color: tone.fg,
            fontSize: 12, fontWeight: 700, cursor: "pointer", lineHeight: 1.2,
          }}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" style={{ flex: "0 0 16px" }} />
          ) : isRetry ? (
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} style={{ flex: "0 0 16px" }} />
          ) : (
            <Camera className="h-4 w-4" strokeWidth={1.9} style={{ flex: "0 0 16px" }} />
          )}
          {/* error = สาเหตุจริงแทนป้ายชื่อคงที่ (2026-08-15 · เดิม slim ไม่เคยโชว์เหตุผลที่ล้มเหลว พนักงานเห็นแค่กรอบแดงเงียบ ๆ) */}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {error ? error : isBusy ? "กำลังอัปโหลด…" : label}
          </span>
        </button>
      </>
    );
  }

  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
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

// ย่อรูป → เข้ารหัสเป็น JPEG (ไม่ใช่ WebP)
// ⚠️ เหตุผล: Safari บน iPhone (iOS < 17) เข้ารหัส WebP ผ่าน canvas ไม่ได้ — ตามสเปก HTML มันจะเงียบ ๆ
//    คืนไฟล์เป็น PNG แทน (ก้อนใหญ่ 1–3 MB) → ทะลุเพดาน server 500KB → ถูกปฏิเสธทุกใบ → อัปไม่ขึ้นบน iOS.
//    JPEG canvas.toBlob รองรับทุกเบราว์เซอร์ (iOS + Android) → แก้ปัญหา iOS อัปรูปไม่ได้.
//    เข้ารหัสหลายรอบไล่ลดคุณภาพจน "ขนาดจริง" ต่ำกว่าเพดาน (verify ทุกครั้ง ไม่เดา).
async function resizeToJpeg(file: File): Promise<Blob> {
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
  if (!width || !height) throw new Error("อ่านขนาดรูปไม่ได้");
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
  // พื้นขาวก่อนวาด: กันรูปต้นฉบับที่โปร่งใส (PNG alpha) กลายเป็นพื้นดำเมื่อแปลงเป็น JPEG
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // ไล่ลดคุณภาพจนขนาดจริงต่ำกว่าเป้า (server cap 500KB · เผื่อ margin เหลือ 480KB)
  let last: Blob | null = null;
  for (const q of [QUALITY, 0.6, 0.45, 0.3]) {
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", q),
    );
    if (!blob) continue;
    last = blob;
    if (blob.size <= TARGET_BYTES) return blob;
  }
  if (last) return last; // ยังเกินอยู่ (รูปใหญ่ผิดปกติ) — คืนก้อนเล็กสุดที่ได้ · server เป็นด่านสุดท้าย
  throw new Error("encode JPEG ไม่สำเร็จ");
}
