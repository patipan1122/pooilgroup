"use client";

// LedgerUploadProvider — งานอัปโหลดใบเสร็จ "ทำงานเบื้องหลัง" ระดับ LedgerLine ทั้งโมดูล
//
// ทำไมต้องอยู่ที่ layout ไม่ใช่ในหน้า:
//   หน้า /ledger/expenses เป็น force-dynamic + มี loading.tsx → ทุกครั้งที่กดเปลี่ยน
//   filter หรือเลือกใบ หน้าถูก "สร้างใหม่ทั้งหน้า" (Suspense fallback swap) → ถ้าตัวคุม
//   งานอัปโหลดอยู่ในหน้า มันจะถูกล้างทิ้ง → ป้ายหาย + งานอ่าน AI ที่ค้างตายกลางคัน.
//   layout ของ /ledger ไม่ถูก unmount เวลาเปลี่ยน searchParams (เหมือน FAB ในแถบล่าง
//   ที่อยู่รอดข้ามหน้า) → ยกงานมาไว้ที่นี่ = เปลี่ยน filter/เลือกใบ/ไปหน้าอื่นในเมนู
//   LedgerLine แล้วงานไม่ตาย ป้ายไม่หาย.
//
// แต่ละไฟล์เดินสายเดิม (ไม่แตะ logic): presign → PUT R2 → OCR (ล้มเหลว=ข้าม) → create draft.
// *** ห้าม auto-post *** — ทุกใบเป็น "ร่าง" จนกว่าบัญชีจะกดยืนยันเอง.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Camera,
  FileText,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronDown,
} from "lucide-react";
import type { ParsedReceipt } from "@/lib/ledger/types";

// PDF ใหญ่กว่ารูป → เผื่อถึง 15MB (รูปทั่วไปไม่กี่ MB)
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT_FILES = "image/*,application/pdf";

type FileStatus = "ok" | "dup" | "fail";
interface FileResult {
  name: string;
  status: FileStatus;
  id?: string;
  docCode?: string | null;
  error?: string;
}
interface Job {
  total: number;
  done: number;
  current: string; // ชื่อไฟล์ที่กำลังทำ
  results: FileResult[];
  finished: boolean;
}

/** company/branch/filter ที่ "หยุดภาพไว้ตอนเริ่มงาน" — งานที่วิ่งอยู่ไม่สนใจว่าผู้ใช้
 *  จะเปลี่ยน filter/บริษัทระหว่างทางแล้ว (ไม่งั้นสร้างใบผิดบริษัท). */
export interface LedgerUploadScope {
  companyId: string;
  branchId?: string | null;
  baseParams: string;
}

interface LedgerUploadContextValue {
  /** เปิดเมนูเลือก (ถ่ายรูป/เลือกไฟล์) พร้อม snapshot scope ปัจจุบัน */
  openSheet: (scope: LedgerUploadScope) => void;
  /** กำลังอ่านใบเสร็จอยู่ (ปุ่มควร disabled) */
  busy: boolean;
  done: number;
  total: number;
}

const LedgerUploadContext = createContext<LedgerUploadContextValue | null>(null);

export function useLedgerUpload(): LedgerUploadContextValue {
  const ctx = useContext(LedgerUploadContext);
  if (!ctx) throw new Error("useLedgerUpload must be used within <LedgerUploadProvider>");
  return ctx;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function isAcceptable(file: File): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

export function LedgerUploadProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  // scope ปัจจุบัน (จากปุ่ม/FAB) → runJob จะ snapshot ตอนเริ่มงาน
  const scopeRef = useRef<LedgerUploadScope | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [flash, setFlash] = useState<string | null>(null); // error สั้น ๆ (ไฟล์ไม่รองรับ ฯลฯ)

  const busy = !!job && !job.finished;

  // อ่านสถานะ busy จาก ref เพื่อให้ openSheet เป็นฟังก์ชันคงที่ (ปุ่ม/FAB ไม่ต้อง re-register listener ทุกครั้งที่ progress ขยับ)
  const jobRef = useRef<Job | null>(null);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const openSheet = useCallback((scope: LedgerUploadScope) => {
    const cur = jobRef.current;
    if (cur && !cur.finished) return; // กำลังทำงานอยู่ → กันเริ่มงานซ้อน
    if (!scope.companyId) return;
    scopeRef.current = scope;
    setSheetOpen(true);
  }, []);

  // flash หายเองใน 4 วิ
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  function pickCamera() {
    setSheetOpen(false);
    setFlash(null);
    cameraRef.current?.click();
  }
  function pickFiles() {
    setSheetOpen(false);
    setFlash(null);
    filesRef.current?.click();
  }

  // ── ประมวลผลทีละไฟล์ (ใช้ scope ที่ snapshot ไว้ ไม่ใช่ค่าปัจจุบันบนจอ) ──────
  async function processOne(file: File, scope: LedgerUploadScope): Promise<FileResult> {
    const name = file.name || "ไฟล์";
    try {
      const bytes = await file.arrayBuffer();
      const sha = await sha256Hex(bytes);
      const contentType =
        file.type || (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");

      // 1) presign
      const presignRes = await fetch("/api/ledger/r2/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: scope.companyId, contentType }),
      });
      if (!presignRes.ok) throw new Error("ขอที่อัปโหลดไม่สำเร็จ");
      const { url, publicUrl } = (await presignRes.json()) as {
        url: string;
        publicUrl: string;
      };

      // 2) PUT → R2
      const put = await fetch(url, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: file,
      });
      if (!put.ok) throw new Error("อัปโหลดไฟล์ไม่สำเร็จ");

      // 3) OCR — non-fatal (PDF/รูปที่อ่านไม่ออก → ร่างเปล่าให้กรอกเอง)
      // ใช้ ParsedReceipt (SSoT) ตรง ๆ — ห้ามเขียน type มือ ไม่งั้น field ใหม่จะหลุด
      // ตอน "บันทึก" เหมือนบั๊กเดิม (สินค้า/หมวด/VAT หายทั้งที่ AI อ่านได้). Partial
      // เพราะ OCR ล้มเหลว → คงเป็น {} แล้วกรอกเอง.
      let parsed: Partial<ParsedReceipt> = {};
      try {
        const ocrRes = await fetch("/api/ledger/ocr", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageUrl: publicUrl }),
        });
        if (ocrRes.ok) {
          const json = (await ocrRes.json()) as { parsed?: typeof parsed };
          if (json.parsed) parsed = json.parsed;
        }
      } catch {
        /* ignore — fall through to a blank draft */
      }

      // 4) create draft (status=draft — never auto-post)
      const createRes = await fetch("/api/ledger/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: scope.companyId,
          branchId: scope.branchId || null,
          source: "web",
          vendor: parsed.vendor ?? null,
          vendorTaxId: parsed.vendorTaxId ?? null,
          docDate: parsed.docDate ?? null,
          subtotal: parsed.subtotal ?? 0,
          vat: parsed.vat ?? 0,
          wht: parsed.wht ?? 0,
          total: parsed.total ?? 0,
          paymentMethod: parsed.paymentMethod ?? null,
          purchaseType: parsed.purchaseType ?? null,
          // ── ส่งให้ครบเท่าฝั่ง LINE/อีเมล ── เดิมเว็บทิ้ง 8 field นี้ → ตอนบันทึก
          // สินค้า (items)/หมวดที่ AI แนะนำ/เลขใบ/ประเภทเอกสาร หายหมด (บั๊ก 2026-07-24).
          items: parsed.items ?? [],
          docType: parsed.docType ?? undefined,
          vendorDocNumber: parsed.vendorDocNumber ?? null,
          vendorAddress: parsed.vendorAddress ?? null,
          buyerTaxIdOnDoc: parsed.buyerTaxIdOnDoc ?? null,
          discount: parsed.discount ?? 0,
          suggestedCategoryName: parsed.suggestedCategory ?? null,
          rawText: parsed.raw ?? null,
          originalUrl: publicUrl,
          thumbUrl: publicUrl,
          sha256: sha,
          ocrModel: parsed.ocrModel ?? null,
          ocrConfidence: parsed.confidence ?? null,
        }),
      });
      if (!createRes.ok) {
        const j = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "บันทึกร่างไม่สำเร็จ");
      }
      const created = (await createRes.json()) as {
        id: string;
        duplicate?: boolean;
        docCode?: string | null;
      };
      return {
        name,
        status: created.duplicate ? "dup" : "ok",
        id: created.id,
        docCode: created.docCode ?? null,
      };
    } catch (e) {
      return { name, status: "fail", error: e instanceof Error ? e.message : "ล้มเหลว" };
    }
  }

  async function runJob(files: File[]) {
    const scope = scopeRef.current;
    if (!scope || files.length === 0) return;

    const valid = files.filter((f) => isAcceptable(f) && f.size <= MAX_BYTES);
    const rejected = files.length - valid.length;

    if (valid.length === 0) {
      setFlash(
        rejected > 0
          ? "ไฟล์ไม่รองรับ หรือใหญ่เกิน 15MB (รับเฉพาะรูปภาพและ PDF)"
          : "ไม่พบไฟล์",
      );
      return;
    }
    setFlash(null);

    const results: FileResult[] = [];
    setMinimized(false);
    setJob({ total: valid.length, done: 0, current: valid[0].name, results: [], finished: false });

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      setJob((j) => (j ? { ...j, current: file.name || "ไฟล์", done: i } : j));
      const r = await processOne(file, scope);
      results.push(r);
      setJob((j) => (j ? { ...j, done: i + 1, results: [...results] } : j));
    }

    const okOnes = results.filter((r) => r.status === "ok");

    // ไฟล์เดียว + สำเร็จ (ไม่ซ้ำ) → เปิดใบนั้นให้ตรวจทันที (พฤติกรรมเดิม)
    // ใช้ baseParams ที่ snapshot ไว้ + path คงที่ /ledger/expenses (provider อยู่ layout ไม่ผูก pathname)
    if (valid.length === 1 && okOnes.length === 1 && okOnes[0].id) {
      setJob(null);
      const sp = new URLSearchParams(scope.baseParams);
      sp.set("selected", okOnes[0].id);
      router.push(`/ledger/expenses?${sp.toString()}`);
      router.refresh();
      return;
    }

    // หลายไฟล์ (หรือมีล้มเหลว/ซ้ำ) → โชว์สรุป + รีเฟรชรายการให้เห็นร่างใหม่
    // กางป้ายสรุปให้เห็นเสมอ ต่อให้ผู้ใช้ย่อไว้ตอนกำลังทำงาน
    setMinimized(false);
    setJob((j) => (j ? { ...j, finished: true } : j));
    if (okOnes.length > 0 || results.some((r) => r.status === "dup")) router.refresh();
  }

  function closeSummary() {
    setJob(null);
  }

  const okCount = job?.results.filter((r) => r.status === "ok").length ?? 0;
  const dupCount = job?.results.filter((r) => r.status === "dup").length ?? 0;
  const failCount = job?.results.filter((r) => r.status === "fail").length ?? 0;
  const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <LedgerUploadContext.Provider
      value={{ openSheet, busy, done: job?.done ?? 0, total: job?.total ?? 0 }}
    >
      {children}

      {/* hidden inputs — อยู่ที่ layout → กล้อง/ตัวเลือกไฟล์คงอยู่ข้ามการเปลี่ยน filter/หน้า */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          // อ่านไฟล์ออกมาก่อน "แล้วค่อย" ล้าง input — ถ้าล้างก่อน FileList จะว่างทันที (บั๊กเดิม)
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void runJob(files);
        }}
        aria-label="ถ่ายรูปใบเสร็จ"
        tabIndex={-1}
      />
      <input
        ref={filesRef}
        type="file"
        accept={ACCEPT_FILES}
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void runJob(files);
        }}
        aria-label="เลือกรูปหรือไฟล์ PDF ใบเสร็จ"
        tabIndex={-1}
      />

      {/* ── เมนูเลือก (ถ่ายรูป / เลือกไฟล์) — bottom sheet ─────────────────── */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-[70]"
          role="dialog"
          aria-modal="true"
          aria-label="เพิ่มใบเสร็จ"
        >
          <button
            type="button"
            aria-label="ปิด"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/40 animate-fade-in"
          />
          <div
            className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-3xl border-t border-zinc-200 bg-white p-4 shadow-xl animate-slide-up-soft sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[26rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:animate-scale-in"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">เพิ่มใบเสร็จ</h2>
                <p className="text-xs text-zinc-500">เลือกวิธีเพิ่มใบเสร็จ</p>
              </div>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setSheetOpen(false)}
                className="press grid size-10 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 active:bg-zinc-100"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={pickCamera}
                className="press flex w-full items-center gap-3 rounded-2xl border border-zinc-200 p-3.5 text-left transition hover:border-[var(--color-brand-200)] hover:bg-[var(--color-brand-50)] active:bg-zinc-50"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
                  <Camera className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900">ถ่ายรูป</span>
                  <span className="block text-xs text-zinc-500">เปิดกล้อง ถ่ายใบเสร็จทีละใบ</span>
                </span>
              </button>

              <button
                type="button"
                onClick={pickFiles}
                className="press flex w-full items-center gap-3 rounded-2xl border border-zinc-200 p-3.5 text-left transition hover:border-zinc-300 hover:bg-zinc-50 active:bg-zinc-50"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <FileText className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900">เลือกรูป / ไฟล์</span>
                  <span className="block text-xs text-zinc-500">
                    เลือกหลายไฟล์พร้อมกัน · รองรับรูปภาพและ PDF
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── error สั้น ๆ (ไฟล์ไม่รองรับ) — toast ลอยมุมล่างขวา ไม่บังจอ ───────── */}
      {flash && !job && (
        <div
          className="fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[80] flex justify-end lg:right-6 lg:bottom-6"
          role="alert"
        >
          <div className="flex max-w-[min(20rem,calc(100vw-1.5rem))] items-center gap-2 rounded-2xl border border-rose-200 bg-white px-3.5 py-2.5 text-xs font-medium text-rose-700 shadow-xl animate-scale-in">
            <AlertTriangle className="size-4 shrink-0 text-rose-500" aria-hidden />
            <span>{flash}</span>
          </div>
        </div>
      )}

      {/* ── ป้ายความคืบหน้า / สรุปผล — ลอยมุมล่างขวา ทำงานเบื้องหลัง ────────────
          ไม่มีแผ่นดำทับจอ (ไม่ใช่ modal) → คลิกทะลุไปกดใช้งานหน้าต่อได้
          z-[80] อยู่เหนือแถบเมนูล่างมือถือ (z-40) · มือถือดันขึ้นเหนือแถบ 64px */}
      {job && (
        <div
          className="fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[80] flex justify-end lg:right-6 lg:bottom-6"
          role="status"
          aria-live="polite"
          aria-label={job.finished ? "สรุปการอัปโหลด" : "กำลังอัปโหลดเบื้องหลัง"}
        >
          {!job.finished && minimized ? (
            /* ── ย่อ: ป้ายกลมเล็ก กดเพื่อกาง ─────────────────────────────── */
            <button
              type="button"
              onClick={() => setMinimized(false)}
              className="press flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-2 pl-3 pr-3.5 shadow-lg"
              aria-label={`กำลังอ่านใบเสร็จ ${job.done} จาก ${job.total} ใบ · กดเพื่อขยาย`}
            >
              <Loader2 className="size-4 animate-spin text-[var(--color-brand-600)]" aria-hidden />
              <span className="text-sm font-bold tabular-nums text-zinc-900">
                {job.done}/{job.total}
              </span>
              <span className="text-xs font-medium tabular-nums text-zinc-400">{pct}%</span>
            </button>
          ) : !job.finished ? (
            /* ── กำลังทำงาน: การ์ดเล็กมุมล่างขวา + ปุ่มย่อ ────────────────── */
            <div className="w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-xl animate-scale-in">
              <div className="mb-2 flex items-start gap-2">
                <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-[var(--color-brand-600)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-zinc-900">กำลังอ่านใบเสร็จ</h2>
                  <p className="text-xs text-zinc-500">ทำงานเบื้องหลัง · กดใช้งานต่อได้</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label="ย่อ"
                  className="press -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 active:bg-zinc-100"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xl font-bold tabular-nums text-zinc-900">
                  {job.done}
                  <span className="text-sm font-medium text-zinc-500"> / {job.total}</span>
                </span>
                <span className="text-xs font-semibold tabular-nums text-zinc-500">{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-[var(--color-brand-600)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 truncate text-xs text-zinc-400">{job.current}</p>
            </div>
          ) : (
            /* ── เสร็จ: สรุปผล มุมล่างขวา ปิดได้ ไม่บังจอ ─────────────────── */
            <div className="w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-xl animate-scale-in">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="size-5" aria-hidden />
                </span>
                <h2 className="min-w-0 flex-1 text-sm font-bold text-zinc-900">
                  {okCount > 0 ? `เพิ่ม ${okCount} ใบ (ร่าง) แล้ว` : "เสร็จสิ้น"}
                </h2>
                <button
                  type="button"
                  onClick={closeSummary}
                  aria-label="ปิด"
                  className="press -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 active:bg-zinc-100"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {okCount > 0 && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    สำเร็จ {okCount}
                  </span>
                )}
                {dupCount > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    ซ้ำ (ข้าม) {dupCount}
                  </span>
                )}
                {failCount > 0 && (
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                    ล้มเหลว {failCount}
                  </span>
                )}
              </div>

              {failCount > 0 && (
                <ul className="mb-3 max-h-32 space-y-1 overflow-y-auto rounded-xl bg-zinc-50 p-2.5 text-xs text-zinc-600">
                  {job.results
                    .filter((r) => r.status === "fail")
                    .map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-500" aria-hidden />
                        <span className="min-w-0">
                          <span className="font-medium text-zinc-700">{r.name}</span> ({r.error})
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              <p className="mb-3 text-xs text-zinc-500">
                ทุกใบบันทึกเป็น “ร่าง” · เปิดในรายการเพื่อตรวจและยืนยัน
              </p>

              <button
                type="button"
                onClick={closeSummary}
                className="press h-11 w-full rounded-xl bg-[var(--color-brand-600)] text-sm font-semibold text-white transition hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-700)]"
              >
                เสร็จ
              </button>
            </div>
          )}
        </div>
      )}
    </LedgerUploadContext.Provider>
  );
}
