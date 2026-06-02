"use client";

// LedgerLine LIFF capture flow (mobile, in-LINE).
//
//   take/upload photo
//     → presign + PUT to R2        (POST /api/ledger/r2/presign)
//     → AI parse the receipt        (POST /api/ledger/ocr)
//     → show read-back fields, edit  (local state)
//     → confirm → create DRAFT row   (POST /api/ledger/expenses, status=draft)
//
// GOLDEN RULE: this never auto-posts. Even "บันทึก" here writes status=draft for
// an accountant to finalise in the web review pane. We surface confidence so the
// staffer knows which fields the AI was unsure about.
//
// All backend calls are by fetch to the /api/ledger/* routes (Partition B). We do
// NOT import server code here (keeps the surface self-contained per the contract).
// Each call degrades gracefully if a route isn't deployed yet, so the build is
// never blocked.

import { useRef, useState } from "react";

type Phase = "capture" | "parsing" | "review" | "saving" | "done" | "error";

interface ParsedFields {
  vendor: string;
  vendorTaxId: string;
  docDate: string; // YYYY-MM-DD
  subtotal: string; // kept as strings for controlled inputs
  vat: string;
  total: string;
  paymentMethod: string;
  suggestedCategory: string;
  confidence: Record<string, number | undefined>;
}

const EMPTY: ParsedFields = {
  vendor: "",
  vendorTaxId: "",
  docDate: "",
  subtotal: "",
  vat: "",
  total: "",
  paymentMethod: "",
  suggestedCategory: "",
  confidence: {},
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function num(s: string): number {
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Lightweight client-side Recheck mirror (the authoritative one runs server-side
// in lib/ledger/recheck.ts). Catches the obvious "subtotal + vat ≠ total" case so
// the staffer sees the mismatch before saving.
function mathMismatch(f: ParsedFields): boolean {
  const sub = num(f.subtotal);
  const vat = num(f.vat);
  const total = num(f.total);
  if (total <= 0) return false;
  if (sub <= 0 && vat <= 0) return false; // not enough data to check
  return Math.abs(sub + vat - total) > 1;
}

function confColor(c?: number): string {
  if (c == null) return "text-zinc-400";
  if (c >= 0.85) return "text-emerald-600";
  if (c >= 0.6) return "text-amber-600";
  return "text-rose-600";
}
function confLabel(c?: number): string | null {
  if (c == null) return null;
  if (c >= 0.85) return "มั่นใจ";
  if (c >= 0.6) return "ตรวจ";
  return "เช็ก!";
}

export function LedgerCaptureApp() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [preview, setPreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ParsedFields>(EMPTY);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const draftId = useRef<string>(newUuid());

  function set<K extends keyof ParsedFields>(key: K, value: ParsedFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setPhase("capture");
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    setImageUrl(null);
    setFields(EMPTY);
    setSavedCode(null);
    setErrMsg("");
    draftId.current = newUuid();
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setErrMsg("รูปใหญ่เกินไป · ต้องไม่เกิน 12MB");
      setPhase("error");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setPhase("parsing");
    setErrMsg("");
    try {
      // 1) presign + upload to R2.
      let uploadedUrl: string | null = null;
      try {
        const ps = await fetch("/api/ledger/r2/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: file.type,
            draftId: draftId.current,
            source: "line",
          }),
        });
        if (ps.ok) {
          const data = (await ps.json()) as {
            url?: string;
            publicUrl?: string;
          };
          if (data.url) {
            const put = await fetch(data.url, {
              method: "PUT",
              body: file,
              headers: { "Content-Type": file.type },
            });
            if (put.ok) uploadedUrl = data.publicUrl ?? null;
          }
        }
      } catch {
        // R2 presign not available yet → continue with OCR via multipart only.
      }
      setImageUrl(uploadedUrl);

      // 2) AI parse — send the already-uploaded URL when we have one, else the
      // raw file as multipart (the OCR route accepts either; Partition B).
      let ocrRes: Response;
      if (uploadedUrl) {
        ocrRes = await fetch("/api/ledger/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: uploadedUrl, source: "line" }),
        });
      } else {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("source", "line");
        ocrRes = await fetch("/api/ledger/ocr", { method: "POST", body: fd });
      }

      if (!ocrRes.ok) {
        // OCR unavailable → let the staffer key it in manually (no dead end).
        setFields({ ...EMPTY, docDate: todayISO() });
        setPhase("review");
        return;
      }

      const parsed = (await ocrRes.json()) as {
        vendor?: string | null;
        vendor_tax_id?: string | null;
        doc_date?: string | null;
        subtotal?: number | null;
        vat?: number | null;
        total?: number | null;
        payment_method?: string | null;
        suggested_category?: string | null;
        confidence?: Record<string, number> | null;
      };

      setFields({
        vendor: parsed.vendor ?? "",
        vendorTaxId: parsed.vendor_tax_id ?? "",
        docDate: parsed.doc_date ?? todayISO(),
        subtotal: parsed.subtotal != null ? String(parsed.subtotal) : "",
        vat: parsed.vat != null ? String(parsed.vat) : "",
        total: parsed.total != null ? String(parsed.total) : "",
        paymentMethod: parsed.payment_method ?? "",
        suggestedCategory: parsed.suggested_category ?? "",
        confidence: parsed.confidence ?? {},
      });
      setPhase("review");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "อ่านใบเสร็จไม่สำเร็จ");
      setPhase("error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onConfirm() {
    if (num(fields.total) <= 0) {
      setErrMsg("กรอกยอดรวมก่อนบันทึก");
      setPhase("error");
      return;
    }
    setPhase("saving");
    setErrMsg("");
    try {
      const res = await fetch("/api/ledger/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "line",
          status: "draft", // golden rule — never auto-post from the field
          vendor: fields.vendor || null,
          vendorTaxId: fields.vendorTaxId || null,
          docDate: fields.docDate || null,
          subtotal: num(fields.subtotal),
          vat: num(fields.vat),
          total: num(fields.total),
          paymentMethod: fields.paymentMethod || null,
          suggestedCategory: fields.suggestedCategory || null,
          originalUrl: imageUrl,
          thumbUrl: imageUrl,
          ocrConfidence: fields.confidence,
          draftId: draftId.current,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      }
      const j = (await res.json().catch(() => ({}))) as { docCode?: string };
      setSavedCode(j.docCode ?? null);
      setPhase("done");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setPhase("error");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 px-4 pb-32 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-zinc-900">📸 ถ่ายใบเสร็จ</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          ถ่ายรูป · AI อ่านให้ · คุณตรวจแล้วบันทึก (บัญชียืนยันทีหลัง)
        </p>
      </header>

      {/* Receipt preview */}
      {preview && (
        <div className="mb-4 overflow-hidden rounded-2xl ring-1 ring-zinc-200 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="ใบเสร็จ"
            className="max-h-64 w-full object-contain bg-zinc-100"
          />
        </div>
      )}

      {/* Phase: capture */}
      {phase === "capture" && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 active:bg-blue-100"
          >
            <span className="text-4xl">📷</span>
            <span className="text-base font-semibold">แตะเพื่อถ่าย / เลือกรูป</span>
            <span className="text-xs text-blue-600/80">รองรับใบเสร็จ · บิล · สลิป</span>
          </button>
        </div>
      )}

      {/* Phase: parsing */}
      {phase === "parsing" && (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <div className="size-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm font-medium text-zinc-700">AI กำลังอ่านใบเสร็จ...</p>
          <p className="text-xs text-zinc-400">สักครู่ · อย่าเพิ่งปิดหน้านี้</p>
        </div>
      )}

      {/* Phase: review (edit fields) */}
      {phase === "review" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200 space-y-4">
            <Field label="ยอดรวม (บาท)" conf={fields.confidence.total}>
              <input
                inputMode="decimal"
                value={fields.total}
                onChange={(e) => set("total", e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-lg font-bold tabular-nums outline-none focus:border-blue-500"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="ยอดก่อน VAT">
                <input
                  inputMode="decimal"
                  value={fields.subtotal}
                  onChange={(e) => set("subtotal", e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm tabular-nums outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="VAT">
                <input
                  inputMode="decimal"
                  value={fields.vat}
                  onChange={(e) => set("vat", e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm tabular-nums outline-none focus:border-blue-500"
                />
              </Field>
            </div>

            {mathMismatch(fields) && (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                ⚠️ ยอดก่อน VAT + VAT ไม่เท่ากับยอดรวม · ตรวจอีกครั้ง
              </div>
            )}

            <Field label="ร้านค้า / ผู้ขาย" conf={fields.confidence.vendor}>
              <input
                value={fields.vendor}
                onChange={(e) => set("vendor", e.target.value)}
                placeholder="ชื่อร้าน"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="วันที่" conf={fields.confidence.doc_date}>
                <input
                  type="date"
                  value={fields.docDate}
                  onChange={(e) => set("docDate", e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="เลขภาษี 13 หลัก">
                <input
                  inputMode="numeric"
                  value={fields.vendorTaxId}
                  onChange={(e) =>
                    set("vendorTaxId", e.target.value.replace(/\D/g, "").slice(0, 13))
                  }
                  placeholder="0000000000000"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm tabular-nums outline-none focus:border-blue-500"
                />
              </Field>
            </div>

            <Field label="หมวด (AI แนะนำ · แก้ได้)">
              <input
                value={fields.suggestedCategory}
                onChange={(e) => set("suggestedCategory", e.target.value)}
                placeholder="เช่น ค่าน้ำมัน/ขนส่ง"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </Field>
          </div>

          <p className="px-1 text-center text-xs text-zinc-400">
            บันทึกเป็น “ฉบับร่าง” · ฝ่ายบัญชียืนยันทีหลัง
          </p>
        </div>
      )}

      {/* Phase: saving */}
      {phase === "saving" && (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <div className="size-12 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <p className="text-sm font-medium text-zinc-700">กำลังบันทึก...</p>
        </div>
      )}

      {/* Phase: done */}
      {phase === "done" && (
        <div className="space-y-5 py-8 text-center">
          <div className="relative inline-flex">
            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-30" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl text-white">
              ✓
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-900">บันทึกแล้ว</h2>
            <p className="mt-1 px-4 text-sm text-zinc-500">
              ส่งให้ฝ่ายบัญชีตรวจ · ยอด ฿{num(fields.total).toLocaleString("th-TH")}
            </p>
          </div>
          {savedCode && (
            <div className="mx-auto inline-block rounded-2xl bg-white px-6 py-4 ring-1 ring-zinc-200">
              <div className="text-[11px] font-medium text-zinc-500">เลขเอกสาร</div>
              <div className="mt-0.5 font-mono text-lg font-bold tracking-wider text-zinc-900">
                {savedCode}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700"
          >
            ถ่ายใบเสร็จอื่น
          </button>
        </div>
      )}

      {/* Phase: error */}
      {phase === "error" && (
        <div className="space-y-4 py-8 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-100 text-2xl">
            ⚠️
          </div>
          <p className="text-base font-semibold text-zinc-800">เกิดข้อผิดพลาด</p>
          <p className="break-words rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left text-xs text-zinc-700">
            {errMsg}
          </p>
          <div className="space-y-2">
            {preview && (
              <button
                type="button"
                onClick={() => setPhase("review")}
                className="h-11 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white active:bg-zinc-800"
              >
                กรอกเอง
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 active:bg-zinc-50"
            >
              เริ่มใหม่
            </button>
          </div>
        </div>
      )}

      {/* Sticky confirm bar (review phase) */}
      {phase === "review" && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-md gap-2">
            <button
              type="button"
              onClick={reset}
              className="h-12 flex-1 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 active:bg-zinc-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="h-12 flex-[2] rounded-xl bg-blue-600 text-base font-semibold text-white shadow-lg active:bg-blue-700"
            >
              บันทึก (ร่าง)
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}

function Field({
  label,
  conf,
  children,
}: {
  label: string;
  conf?: number;
  children: React.ReactNode;
}) {
  const lbl = confLabel(conf);
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        {lbl && (
          <span className={`text-[11px] font-semibold ${confColor(conf)}`}>
            {lbl}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
