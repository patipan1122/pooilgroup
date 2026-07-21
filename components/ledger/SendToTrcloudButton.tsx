"use client";

// Per-receipt "ส่งเข้า TRCloud" button (detail pane header). Pushes ONE confirmed
// expense INTO TRCloud as a PO via the sendExpenseToTrcloud server action (which
// runs vendor + SKU search-before-create then po/create). Idempotent: once a row
// shows a TRCloud doc no. it renders the "ส่งแล้ว" badge instead of the button.
//
// หลังส่งเป็น PO แล้ว → มีปุ่ม "แปลงเป็น AP" (convertExpenseToAp) = สร้างใบกำกับภาษีซื้อ
// (ลงบัญชีจริง · draft ให้บัญชี approve) + ลิงก์ "เปิดใน TRCloud" (AP > PO).
//
// ใบเสนอราคา (quotation): CEO decision 2026-06-09 = ส่งได้ แต่ "เตือนก่อนส่ง".
// กดปุ่มแล้วเด้ง confirm ก่อน 1 ครั้ง + หลังส่งโชว์หมายเหตุว่าภาษีซื้อขอคืนไม่ได้.
//
// Auto-save ก่อนส่ง (CEO 2026-07-21): ถ้ามี onBeforeSend → เซฟฟอร์มที่เปิดอยู่ก่อน
// เสมอ แล้วค่อยส่ง เพื่อไม่ให้ส่งด้วยข้อมูล/สาขาเก่า (stale branch).
import { useState, useTransition } from "react";
import { CloudUpload, Loader2, CloudCheck, RefreshCw, ExternalLink, FileCheck2 } from "lucide-react";
import { sendExpenseToTrcloud, convertExpenseToAp } from "@/app/(admin)/ledger/_actions";
import { trcloudState } from "@/lib/ledger/trcloud-state";
import { trcloudDocUrl } from "@/lib/ledger/trcloud-url";

export function SendToTrcloudButton({
  expenseId,
  status,
  docType,
  trcloudDocId,
  trcloudDocNo,
  trcloudError,
  trcloudApDocId,
  trcloudApDocNo,
  trcloudApError,
  onBeforeSend,
  compact = false,
}: {
  expenseId: string;
  status: string;
  docType?: string | null;
  trcloudDocId: string | null;
  trcloudDocNo: string | null;
  trcloudError: string | null;
  /** AP (ลงบัญชีจริง) mirror ของ trcloudDoc* — set = แปลงเป็น AP แล้ว (โชว์ป้าย "AP แล้ว"). */
  trcloudApDocId?: string | null;
  trcloudApDocNo?: string | null;
  trcloudApError?: string | null;
  /** เรียกก่อนส่ง — auto-save ฟอร์มที่เปิดอยู่ก่อน (คืน false = เซฟไม่ผ่าน → ไม่ส่ง). */
  onBeforeSend?: () => Promise<boolean>;
  /** Icon-only compact variant for sticky footer — same logic, no text. */
  compact?: boolean;
}) {
  const sendable = status === "confirmed" || status === "locked";
  const isQuotation = docType === "quotation";
  const initialState = trcloudState(trcloudDocId);
  const [pending, start] = useTransition();
  // "sent" badge only for a REAL doc id — a failed push ("error") falls through to the
  // retry button below (err is seeded from trcloudError). The old check treated the
  // "error" sentinel as sent → no way to retry. See trcloud-state.ts.
  const [sent, setSent] = useState<string | null>(
    initialState === "sent" ? trcloudDocNo ?? "ส่งแล้ว" : null,
  );
  const [err, setErr] = useState<string | null>(
    initialState === "error" ? trcloudError ?? "ส่งไม่สำเร็จ" : null,
  );
  const [warn, setWarn] = useState<string | null>(null);

  // ── AP (แปลง PO → ใบกำกับภาษีซื้อ AP) ──
  // seed จาก prop: มี trcloudApDocId บนใบแล้ว = แปลงแล้ว → โชว์ป้าย "AP แล้ว" แทนปุ่มแปลง.
  const [apConverted, setApConverted] = useState<boolean>(!!trcloudApDocId);
  const [apDocNo, setApDocNo] = useState<string | null>(
    trcloudApDocId ? trcloudApDocNo ?? "AP" : null,
  );
  // seed error จาก prop เฉพาะตอน "ยังไม่มี AP แต่เคยพยายามแปลงแล้วพลาด" (mirror ของ err/send).
  const [apErr, setApErr] = useState<string | null>(
    trcloudApDocId ? null : trcloudApError ?? null,
  );
  const [apPending, startAp] = useTransition();

  // ลิงก์เปิดใน TRCloud — AP ก่อน (ถ้ามี trcloudApDocId ตัวเลข) ไม่งั้น PO ที่ push แล้ว.
  // fresh convert ในเซสชันนี้ยังไม่มี apDocId (action คืนแค่ apDocNo) → ลิงก์ยังชี้ PO จนกว่า refresh.
  const docUrl = trcloudDocUrl({ apDocId: trcloudApDocId, poDocId: trcloudDocId });

  // แปลงเป็น AP — สร้างใบกำกับภาษีซื้อ (ลงบัญชีจริง) จาก PO ที่ส่งแล้ว.
  function convert() {
    setApErr(null);
    startAp(async () => {
      const res = await convertExpenseToAp(expenseId);
      // res.ok ครอบ res.alreadyAp ด้วย (action คืน ok:true + alreadyAp:true เมื่อแปลงไว้แล้ว).
      if (res.ok) {
        setApConverted(true);
        setApDocNo(res.apDocNo ?? "AP");
      } else {
        setApErr(res.error ?? "แปลงเป็น AP ไม่สำเร็จ");
      }
    });
  }

  const CONVERT_TITLE =
    "แปลงใบสั่งซื้อ (PO) นี้เป็นใบกำกับภาษีซื้อ (AP) — ลงบัญชีอัตโนมัติ ให้บัญชี approve";

  // ── ปุ่ม/ป้าย AP ที่โผล่ข้างป้าย "ส่งแล้ว" (ใช้ทั้ง compact + full) ──
  // เปิดใน TRCloud (ถ้ามีลิงก์) — ลิงก์ null (id ไม่ใช่ตัวเลข) = ไม่ render.
  const openLinkFull = docUrl ? (
    <a
      href={docUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="เปิดเอกสารใน TRCloud"
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
    >
      <ExternalLink className="size-3.5" aria-hidden />
      เปิดใน TRCloud
    </a>
  ) : null;
  const openLinkCompact = docUrl ? (
    <a
      href={docUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="เปิดเอกสารใน TRCloud"
      aria-label="เปิดเอกสารใน TRCloud"
      className="inline-flex size-9 items-center justify-center rounded-lg text-blue-700 transition-colors hover:bg-blue-50"
    >
      <ExternalLink className="size-4" aria-hidden />
    </a>
  ) : null;

  if (sent || apConverted) {
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1">
          <span
            title={`ส่ง TRCloud แล้ว${sent && sent !== "ส่งแล้ว" ? ` · ${sent}` : ""}${warn ? `\n⚠️ ${warn}` : ""}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-50 px-3 text-sm font-semibold text-blue-700"
          >
            <CloudCheck className="size-4 shrink-0" />
            ส่งแล้ว
          </span>
          {openLinkCompact}
          {apConverted ? (
            <span
              title={`แปลงเป็น AP แล้ว${apDocNo && apDocNo !== "AP" ? ` · ${apDocNo}` : ""}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-sm font-semibold text-emerald-700"
            >
              <FileCheck2 className="size-4 shrink-0" />
              AP แล้ว
            </span>
          ) : (
            <button
              onClick={convert}
              disabled={apPending}
              title={CONVERT_TITLE}
              aria-label="แปลงเป็น AP"
              className="inline-flex size-9 items-center justify-center rounded-lg bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {apPending ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <FileCheck2 className="size-4 shrink-0" />
              )}
            </button>
          )}
        </span>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1 animate-fade-in">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {sent && (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700"
              title="ส่งเข้า TRCloud แล้ว"
            >
              <CloudCheck className="size-3.5" aria-hidden />
              ส่ง TRCloud แล้ว{sent !== "ส่งแล้ว" ? <span className="tabular-nums"> · {sent}</span> : ""}
            </span>
          )}
          {apConverted ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"
              title="แปลงเป็นใบกำกับภาษีซื้อ (AP) แล้ว — เป็นร่างให้บัญชี approve"
            >
              <FileCheck2 className="size-3.5" aria-hidden />
              AP แล้ว{apDocNo && apDocNo !== "AP" ? <span className="tabular-nums"> · {apDocNo}</span> : ""}
            </span>
          ) : (
            <button
              onClick={convert}
              disabled={apPending}
              title={CONVERT_TITLE}
              className="press inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {apPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FileCheck2 className="size-3.5" aria-hidden />
              )}
              แปลงเป็น AP
            </button>
          )}
          {openLinkFull}
        </div>
        {warn && <span className="max-w-[16rem] text-right text-[11px] leading-snug text-amber-700">{warn}</span>}
        {apErr && <span className="max-w-[16rem] text-right text-[11px] leading-snug text-rose-700">{apErr}</span>}
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
      // Auto-save ฟอร์มที่เปิดอยู่ก่อนส่ง — กันส่งด้วยข้อมูล/สาขาเก่า (CEO 2026-07-21).
      if (onBeforeSend) {
        const saved = await onBeforeSend();
        if (!saved) {
          setErr("บันทึกก่อนส่งไม่สำเร็จ");
          return;
        }
      }
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
