"use client";

// อัปโหลดใบเสร็จจากเว็บ (back-office) → สร้าง "ร่าง" ให้บัญชีตรวจ.
//
// กดปุ่ม (หรือกด FAB "ถ่าย" บนมือถือ) → เด้งเมนูเลือก:
//   • ถ่ายรูป          → เปิดกล้อง ทีละใบ
//   • เลือกรูป / ไฟล์   → เลือกได้ "หลายไฟล์พร้อมกัน" + รองรับ PDF (ใบกำกับ e-tax)
//
// แต่ละไฟล์เดินสายเดิม (ไม่มีปุ่มตาย):
//   1. presign        → POST /api/ledger/r2/presign   (รูป/PDF)
//   2. PUT             → อัปโหลดตรงเข้า R2
//   3. OCR             → POST /api/ledger/ocr {imageUrl}  (AI อ่านค่า · ล้มเหลว = ข้าม ไม่ค้าง)
//   4. create draft    → POST /api/ledger/expenses        (status=draft เสมอ · dedup ด้วย sha256)
//   5. ไฟล์เดียว → เปิดใบนั้นให้ตรวจ · หลายไฟล์ → สรุปผล + รีเฟรชรายการ
//
// *** ห้าม auto-post *** — ทุกใบเป็น "ร่าง" จนกว่าบัญชีจะกดยืนยันเอง.
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Upload,
  Loader2,
  Camera,
  FileText,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function UploadReceiptButton({
  companyId,
  branchId,
  baseParams,
  hideTriggerOnMobile = false,
}: {
  companyId: string;
  branchId?: string | null;
  /** company/branch/filter params to preserve when we navigate to the new draft */
  baseParams: string;
  /** Hide the visible trigger button on phones (the bottom-nav camera FAB fires
   *  the same `ledger:open-upload` event) — the modal + listener stay mounted. */
  hideTriggerOnMobile?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [topErr, setTopErr] = useState<string | null>(null);

  const busy = !!job && !job.finished;

  // เปิดเมนูเลือก (เช็คบริษัทก่อน · กันกดตอนกำลังทำงาน)
  function openSheet() {
    if (busy) return;
    if (!companyId) {
      setTopErr("เลือกบริษัทก่อนอัปโหลด");
      return;
    }
    setTopErr(null);
    setSheetOpen(true);
  }

  // FAB "ถ่าย" บนมือถือ (LedgerBottomNav) ยิง event นี้เมื่ออยู่หน้า /ledger/expenses แล้ว
  // → เปิดเมนูเลือกในจังหวะเดียวกัน (กดอีกทีในเมนู = user-gesture ใหม่ → iOS/LINE ไม่บล็อก picker)
  useEffect(() => {
    const open = () => openSheet();
    window.addEventListener("ledger:open-upload", open);
    return () => window.removeEventListener("ledger:open-upload", open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, companyId]);

  function pickCamera() {
    setSheetOpen(false);
    setTopErr(null);
    cameraRef.current?.click();
  }
  function pickFiles() {
    setSheetOpen(false);
    setTopErr(null);
    filesRef.current?.click();
  }

  // ── ประมวลผลทีละไฟล์ ────────────────────────────────────────────────────
  async function processOne(file: File): Promise<FileResult> {
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
        body: JSON.stringify({ companyId, contentType }),
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
      let parsed: {
        vendor?: string | null;
        vendorTaxId?: string | null;
        docDate?: string | null;
        subtotal?: number | null;
        vat?: number | null;
        wht?: number | null;
        total?: number | null;
        paymentMethod?: string | null;
        purchaseType?: string | null;
        confidence?: Record<string, number>;
        ocrModel?: string;
      } = {};
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
          companyId,
          branchId: branchId || null,
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

  async function runJob(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList);
    const valid = all.filter((f) => isAcceptable(f) && f.size <= MAX_BYTES);
    const rejected = all.length - valid.length;

    if (valid.length === 0) {
      setTopErr(
        rejected > 0
          ? "ไฟล์ไม่รองรับ หรือใหญ่เกิน 15MB (รับเฉพาะรูปภาพและ PDF)"
          : "ไม่พบไฟล์",
      );
      return;
    }
    setTopErr(null);

    const results: FileResult[] = [];
    setJob({ total: valid.length, done: 0, current: valid[0].name, results: [], finished: false });

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      setJob((j) =>
        j ? { ...j, current: file.name || "ไฟล์", done: i } : j,
      );
      const r = await processOne(file);
      results.push(r);
      setJob((j) => (j ? { ...j, done: i + 1, results: [...results] } : j));
    }

    const okOnes = results.filter((r) => r.status === "ok");

    // ไฟล์เดียว + สำเร็จ (ไม่ซ้ำ) → เปิดใบนั้นให้ตรวจทันที (พฤติกรรมเดิม)
    if (valid.length === 1 && okOnes.length === 1 && okOnes[0].id) {
      setJob(null);
      const sp = new URLSearchParams(baseParams);
      sp.set("selected", okOnes[0].id);
      router.push(`${pathname}?${sp.toString()}`);
      router.refresh();
      return;
    }

    // หลายไฟล์ (หรือมีล้มเหลว/ซ้ำ) → โชว์สรุป + รีเฟรชรายการให้เห็นร่างใหม่
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
    <div className="flex flex-col items-end gap-1">
      {/* hidden inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const fl = e.target.files;
          e.target.value = "";
          void runJob(fl);
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
          const fl = e.target.files;
          e.target.value = "";
          void runJob(fl);
        }}
        aria-label="เลือกรูปหรือไฟล์ PDF ใบเสร็จ"
        tabIndex={-1}
      />

      <div className={hideTriggerOnMobile ? "hidden sm:block" : undefined}>
        <Button
          variant="primary"
          onClick={openSheet}
          disabled={busy || !companyId}
          aria-label="อัปโหลดใบเสร็จ"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {busy ? `กำลังทำ ${job?.done}/${job?.total}…` : "อัปโหลดใบเสร็จ"}
        </Button>
      </div>
      {topErr && (
        <p className="flex items-center gap-1 text-xs font-medium text-rose-700 animate-fade-in" role="alert">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {topErr}
        </p>
      )}

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

      {/* ── โมดัลความคืบหน้า / สรุปผล (หลายไฟล์) ───────────────────────────── */}
      {job && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={job.finished ? "สรุปการอัปโหลด" : "กำลังอัปโหลด"}
        >
          <div className="absolute inset-0 bg-black/50 animate-fade-in" />
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-5 text-left shadow-xl animate-scale-in">
            {!job.finished ? (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <Loader2 className="size-5 animate-spin text-[var(--color-brand-600)]" aria-hidden />
                  <h2 className="text-base font-bold text-zinc-900">กำลังอัปโหลด</h2>
                </div>
                <p className="mb-3 text-sm text-zinc-500">
                  AI กำลังอ่านใบเสร็จทีละใบ · อย่าเพิ่งปิดหน้านี้
                </p>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold tabular-nums text-zinc-900">
                    {job.done}
                    <span className="text-base font-medium text-zinc-500"> / {job.total}</span>
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-zinc-500">{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand-600)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 truncate text-xs text-zinc-500">{job.current}</p>
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                    <CheckCircle2 className="size-5" aria-hidden />
                  </span>
                  <h2 className="text-base font-bold text-zinc-900">
                    {okCount > 0 ? `เพิ่ม ${okCount} ใบ (ร่าง) แล้ว` : "เสร็จสิ้น"}
                  </h2>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
