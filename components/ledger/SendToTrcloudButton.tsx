"use client";

// Per-receipt "ส่งเข้า TRCloud" button (detail pane header). Pushes ONE confirmed
// expense INTO TRCloud as an AP via the sendExpenseToTrcloud server action (which
// runs vendor + SKU search-before-create then ap/create). Idempotent: once a row
// shows a TRCloud doc no. it renders the "ส่งแล้ว" badge instead of the button.
//
// ใบเสนอราคา (quotation): CEO decision 2026-06-09 = ส่งได้ แต่ "เตือนก่อนส่ง".
// กดปุ่มแล้วเด้ง confirm ก่อน 1 ครั้ง + หลังส่งโชว์หมายเหตุว่าภาษีซื้อขอคืนไม่ได้.
import { useState, useTransition } from "react";
import { CloudUpload, Loader2, CloudCheck, RefreshCw } from "lucide-react";
import { sendExpenseToTrcloud } from "@/app/(admin)/ledger/_actions";

export function SendToTrcloudButton({
  expenseId,
  status,
  docType,
  trcloudDocId,
  trcloudDocNo,
  trcloudError,
  compact = false,
}: {
  expenseId: string;
  status: string;
  docType?: string | null;
  trcloudDocId: string | null;
  trcloudDocNo: string | null;
  trcloudError: string | null;
  /** Icon-only compact variant for sticky footer — same logic, no text. */
  compact?: boolean;
}) {
  const sendable = status === "confirmed" || status === "locked";
  const isQuotation = docType === "quotation";
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(
    trcloudDocId ? trcloudDocNo ?? "ส่งแล้ว" : null,
  );
  const [err, setErr] = useState<string | null>(trcloudError);
  const [warn, setWarn] = useState<string | null>(null);

  if (sent) {
    if (compact) {
      return (
        <span
          title={`ส่ง TRCloud แล้ว${sent !== "ส่งแล้ว" ? ` · ${sent}` : ""}${warn ? `\n⚠️ ${warn}` : ""}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-50 px-3 text-sm font-semibold text-blue-700"
        >
          <CloudCheck className="size-4 shrink-0" />
          ส่งแล้ว
        </span>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1 animate-fade-in">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700"
          title="ส่งเข้า TRCloud แล้ว"
        >
          <CloudCheck className="size-3.5" aria-hidden />
          ส่ง TRCloud แล้ว{sent !== "ส่งแล้ว" ? <span className="tabular-nums"> · {sent}</span> : ""}
        </span>
        {warn && <span className="max-w-[16rem] text-right text-[11px] leading-snug text-amber-700">{warn}</span>}
      </div>
    );
  }

  function run() {
    // เตือนก่อนส่งถ้าเป็นใบเสนอราคา — ผู้ใช้ยืนยันเองว่าจะส่งทั้งที่ขอคืน VAT ไม่ได้.
    if (isQuotation) {
      const ok = window.confirm(
        "เอกสารนี้เป็น “ใบเสนอราคา” ไม่ใช่ใบกำกับภาษี/ใบเสร็จตัวจริง\n\n" +
          "ส่งเข้า TRCloud ได้ แต่ภาษีซื้อ (VAT) จะขอคืนไม่ได้จนกว่าจะมีใบจริงมาแทนที่\n\n" +
          "ยืนยันส่งเข้า TRCloud เลยไหม?",
      );
      if (!ok) return;
    }
    setErr(null);
    setWarn(null);
    start(async () => {
      const res = await sendExpenseToTrcloud(expenseId);
      if (res.ok) {
        setSent(res.docNo ?? "ส่งแล้ว");
        if (res.warning) setWarn(res.warning);
      } else setErr(res.error ?? "ส่งไม่สำเร็จ");
    });
  }

  // Compact variant for sticky footer — with text label.
  if (compact) {
    const titleText = !sendable
      ? "ยืนยันรายการก่อนจึงส่งได้"
      : err
        ? `ส่งไม่สำเร็จ: ${err} (กดเพื่อลองอีกครั้ง)`
        : isQuotation
          ? "ส่งเข้า TRCloud (ใบเสนอราคา — ขอคืน VAT ไม่ได้)"
          : "ส่งเข้า TRCloud";
    return (
      <button
        onClick={run}
        disabled={pending || !sendable}
        title={titleText}
        aria-label={titleText}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : err ? (
          <RefreshCw className="size-4 shrink-0" />
        ) : (
          <CloudUpload className="size-4 shrink-0" />
        )}
        {pending ? "กำลังส่ง…" : err ? "ลองอีกครั้ง" : "ส่ง TRCloud"}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={pending || !sendable}
        title={sendable ? "ส่งใบนี้เข้า TRCloud (ใบกำกับภาษีซื้อ AP)" : "ยืนยันรายการก่อนจึงส่งได้"}
        className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : err ? (
          <RefreshCw className="size-4" aria-hidden />
        ) : (
          <CloudUpload className="size-4" aria-hidden />
        )}
        {err ? "ลองส่งอีกครั้ง" : "ส่งเข้า TRCloud"}
      </button>
      {isQuotation && !err && (
        <span className="max-w-[16rem] text-right text-[11px] leading-snug text-amber-700">
          ใบเสนอราคา (ส่งได้ แต่ขอคืน VAT ไม่ได้)
        </span>
      )}
      {err && <span className="max-w-[16rem] text-right text-[11px] leading-snug text-rose-700">{err}</span>}
    </div>
  );
}
