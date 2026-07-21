"use client";

// TrcloudButton — ปุ่มเดียว "ส่งเข้า TRCloud" (CEO 2026-06-10: รวม 2 ปุ่มเป็น 1).
//
// กดปุ่มเดียว → ระบบตัดสินเองว่าบิลนี้เป็น "สินค้าสต๊อก" หรือ "ค่าใช้จ่าย":
//   • ถ้าบรรทัดจับคู่กับ SKU สินค้า (เก็บสต๊อก) ได้ → เปิดจับคู่ + รับเข้าคลัง (StockInButton)
//   • ถ้าไม่ใช่สินค้าสต๊อก → ส่งเป็นค่าใช้จ่าย (AP) ทันที
// มีปุ่มเดียว = กดซ้ำ 2 ทางบนบิลเดียวไม่ได้ → กันต้นทุนเบิ้ล. โค้ดส่งเงิน (sendExpenseToTrcloud /
// stock-in) ใช้ของเดิมทั้งหมด — ตัวนี้แค่ "ตัวเลือกทาง" + กันกดซ้ำ.

import { useState, useTransition } from "react";
import { Send, Loader2, CloudCheck, RefreshCw, Boxes, ExternalLink, FileCheck2 } from "lucide-react";
import { sendExpenseToTrcloud, convertExpenseToAp } from "@/app/(admin)/ledger/_actions";
import { flushDraftSave } from "@/lib/ledger/draft-save-registry";
import { trcloudState } from "@/lib/ledger/trcloud-state";
import { trcloudDocUrl } from "@/lib/ledger/trcloud-url";
import { StockInButton } from "./StockInButton";

type SkuOpt = { id: string; productId: string; productName: string | null; businessGroup: string | null };

export function TrcloudButton({
  expenseId,
  companyId,
  status,
  docType,
  trcloudDocId,
  trcloudDocNo,
  trcloudError,
  trcloudApDocId,
  trcloudApDocNo,
  trcloudApError,
  stockinNo,
  stockSkus,
  stockInEnabled,
  isStockCategory,
}: {
  expenseId: string;
  companyId: string;
  status: string;
  docType?: string | null;
  trcloudDocId: string | null;
  trcloudDocNo: string | null;
  trcloudError: string | null;
  /** AP (ลงบัญชีจริง) mirror ของ trcloudDoc* — set = แปลงเป็น AP แล้ว (โชว์ป้าย "AP แล้ว"). */
  trcloudApDocId?: string | null;
  trcloudApDocNo?: string | null;
  trcloudApError?: string | null;
  /** ถ้ารับเข้าคลังแล้ว = เลขเอกสาร (กันส่งซ้ำ) */
  stockinNo?: string | null;
  stockSkus: SkuOpt[];
  /** เปิดใช้คลังสินค้าไหม (flag) — ถ้าปิด ส่งเป็นค่าใช้จ่ายอย่างเดียว */
  stockInEnabled: boolean;
  /** หมวดที่เลือก = "สินค้าเพื่อขายแบบมีสต๊อก" → ถึงจะให้ผูก SKU + ขยับสต๊อก (คนเลือกเองเท่านั้น) */
  isStockCategory: boolean;
}) {
  const sendable = status === "confirmed" || status === "locked";
  const isQuotation = docType === "quotation";
  const initialState = trcloudState(trcloudDocId);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "stock">("idle");
  // "ส่งแล้ว" badge only for a REAL doc id — a failed push ("error") shows the retry
  // button instead (err seeded from trcloudError). See trcloud-state.ts.
  const [sent, setSent] = useState<string | null>(
    initialState === "sent" ? trcloudDocNo ?? "ส่งแล้ว" : null,
  );
  const [err, setErr] = useState<string | null>(
    initialState === "error" ? trcloudError ?? "ส่งไม่สำเร็จ" : null,
  );
  const [warn, setWarn] = useState<string | null>(null);

  // ── AP (แปลง PO → ใบกำกับภาษีซื้อ AP · ลงบัญชีจริง) ──
  // seed จาก prop: มี trcloudApDocId บนใบแล้ว = แปลงแล้ว → โชว์ป้าย "AP แล้ว" แทนปุ่มแปลง.
  const [apConverted, setApConverted] = useState<boolean>(!!trcloudApDocId);
  const [apDocNo, setApDocNo] = useState<string | null>(
    trcloudApDocId ? trcloudApDocNo ?? "AP" : null,
  );
  const [apErr, setApErr] = useState<string | null>(
    trcloudApDocId ? null : trcloudApError ?? null,
  );
  const [apPending, startAp] = useTransition();
  const CONVERT_TITLE =
    "แปลงใบสั่งซื้อ (PO) นี้เป็นใบกำกับภาษีซื้อ (AP) — ลงบัญชีอัตโนมัติ ให้บัญชี approve";
  // แปลงเป็น AP — สร้างใบกำกับภาษีซื้อ (draft ให้บัญชี approve) จาก PO ที่ส่งแล้ว.
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

  // ── mutual exclusion: ทำไปทางใดทางหนึ่งแล้ว → ไม่ให้ทำอีกทาง (กันต้นทุนเบิ้ล) ──
  if (stockinNo) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
        <Boxes className="size-4" /> รับเข้าคลังแล้ว{stockinNo !== "sent" ? ` · ${stockinNo}` : ""} · ส่งซ้ำไม่ได้
      </p>
    );
  }
  if (sent) {
    // ลิงก์เปิดใน TRCloud — AP ก่อน (ถ้ามี id ตัวเลข) ไม่งั้น PO. null = ไม่ render.
    const docUrl = trcloudDocUrl({ apDocId: trcloudApDocId, poDocId: trcloudDocId });
    return (
      <div className="mt-2 flex flex-col items-end gap-0.5">
        <div className="flex flex-wrap items-center justify-end gap-1">
          <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700">
            <CloudCheck className="size-3.5" /> ส่ง TRCloud แล้ว{sent !== "ส่งแล้ว" ? ` · ${sent}` : ""}
          </span>
          {apConverted ? (
            <span
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700"
              title="แปลงเป็นใบกำกับภาษีซื้อ (AP) แล้ว — เป็นร่างให้บัญชี approve"
            >
              <FileCheck2 className="size-3.5" /> AP แล้ว{apDocNo && apDocNo !== "AP" ? ` · ${apDocNo}` : ""}
            </span>
          ) : (
            <button
              onClick={convert}
              disabled={apPending}
              title={CONVERT_TITLE}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:bg-zinc-300"
            >
              {apPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />} แปลงเป็น AP
            </button>
          )}
          {docUrl && (
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="เปิดเอกสารใน TRCloud"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
            >
              <ExternalLink className="size-3.5" /> เปิดใน TRCloud
            </a>
          )}
        </div>
        {warn && <span className="max-w-[16rem] text-right text-[11px] text-amber-600">{warn}</span>}
        {apErr && <span className="max-w-[16rem] text-right text-[11px] text-rose-600">{apErr}</span>}
      </div>
    );
  }

  // ── โหมดสินค้าสต๊อก: เปิดจับคู่ SKU + รับเข้าคลัง (StockInButton เปิดเอง) ──
  if (mode === "stock") {
    return (
      <div className="mt-2">
        <StockInButton
          expenseId={expenseId}
          companyId={companyId}
          stockSkus={stockSkus}
          autoOpen
          onClose={() => setMode("idle")}
        />
        <button
          type="button"
          onClick={() => { setMode("idle"); runExpense(true); }}
          disabled={pending}
          className="mt-1 text-[11px] font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-50"
        >
          ไม่ใช่สินค้าสต๊อก? ส่งเป็นค่าใช้จ่ายแทน
        </button>
      </div>
    );
  }

  // ส่งเป็นค่าใช้จ่าย (AP) — โค้ดเดิมจาก SendToTrcloudButton (รวม quotation warn).
  function runExpense(skipQuotationConfirm = false) {
    if (isQuotation && !skipQuotationConfirm) {
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
      // เซฟ draft ที่ยังค้างบนฟอร์มก่อน (เช่น เปลี่ยนสาขาแล้วยังไม่กดบันทึก) → กันส่งค่าเก่า.
      const saved = await flushDraftSave(expenseId);
      if (!saved) { setErr("บันทึกการแก้ไขก่อนส่งไม่สำเร็จ — ลองกดบันทึกในใบก่อน"); return; }
      const res = await sendExpenseToTrcloud(expenseId);
      if (res.ok) {
        setSent(res.docNo ?? "ส่งแล้ว");
        if (res.warning) setWarn(res.warning);
      } else setErr(res.error ?? "ส่งไม่สำเร็จ");
    });
  }

  // กดปุ่มหลัก: ดูจาก "หมวดที่คนเลือก" เท่านั้น (ไม่เดารายบรรทัด — CEO 2026-06-10).
  // หมวด "สินค้าเพื่อขายแบบมีสต๊อก" → เปิดผูก SKU + ขยับสต๊อก · หมวดอื่น → ส่งค่าใช้จ่าย (AP).
  function onMainClick() {
    if (isStockCategory && stockInEnabled) { setMode("stock"); return; }
    runExpense();
  }

  return (
    <div className="mt-2 flex flex-col items-end gap-0.5">
      <button
        onClick={onMainClick}
        disabled={pending || !sendable}
        title={sendable ? "ส่งใบนี้เข้า TRCloud (ระบบแยกสินค้าสต๊อก/ค่าใช้จ่ายให้เอง)" : "ยืนยันรายการก่อนจึงส่งได้"}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : err ? <RefreshCw className="size-4" /> : <Send className="size-4" />}
        {err ? "ลองส่งอีกครั้ง" : "ส่งเข้า TRCloud"}
      </button>
      {isQuotation && !err && (
        <span className="max-w-[16rem] text-right text-[11px] text-amber-600">ใบเสนอราคา — ส่งได้ แต่ขอคืน VAT ไม่ได้</span>
      )}
      {err && <span className="max-w-[16rem] text-right text-[11px] text-rose-600">{err}</span>}
    </div>
  );
}
