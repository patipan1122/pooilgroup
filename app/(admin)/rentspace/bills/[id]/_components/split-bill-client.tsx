"use client";

// RentSpace — "แตกบิล" = เอกสารวางบิลแยก (พิมพ์/ส่งผู้เช่า).
// บิลหลักในระบบ "ไม่ถูกแตะ" เลย (ยอด + การรับเงิน + สลิป อยู่ที่บิลหลักใบเดียว).
// ที่นี่แค่ "แบ่งรายการในบิลออกเป็นเอกสารวางบิล 2 ใบ" ไว้ยื่นผู้เช่า:
//   • ใบที่ 1 = รายการที่ติ๊กเลือก (เช่น ค่าน้ำ-ไฟ)
//   • ใบที่ 2 = รายการที่เหลือ (เช่น ค่าเช่า)
// docB คิดแบบ "ส่วนที่เหลือของบิลหลัก" (หักจากยอดจริง) → ยอด 2 ใบรวมกัน = บิลหลักเป๊ะเสมอ
// ไม่มีการคิดเงินเพิ่ม · ไม่เขียนฐานข้อมูล.

import { useMemo, useState } from "react";
import { Printer, Scissors, ArrowLeft } from "lucide-react";
import { formatBaht } from "@/lib/rentspace/format";
import { computeBillTotals, round2 } from "@/lib/rentspace/bill-math";
import {
  BillDocument,
  BILL_DOC_STYLE,
  type BillDocumentData,
  type BillPaymentInfo,
} from "@/components/rentspace/bill-document";

export type SplitItem = {
  id: string;
  kind: string;
  label: string;
  qty: number;
  unitPrice: number;
  amount: number;
  vatable: boolean;
};

type MeterDetail = { prev: number; curr: number; usage: number; rate: number; amount: number };

export type SplitBillClientProps = {
  billId: string;
  billNo: string;
  period: string;
  status: string;
  issueDate: string | null; // ISO
  dueDate: string | null; // ISO
  vatPercent: number;
  master: { subtotal: number; discountAmount: number; vatAmount: number; totalAmount: number };
  project: BillDocumentData["project"];
  unit: BillDocumentData["unit"];
  tenant: BillDocumentData["tenant"];
  items: SplitItem[];
  meterReadings?: { electric?: MeterDetail; water?: MeterDetail };
  bank?: BillPaymentInfo;
};

const KIND_LABELS: Record<string, string> = {
  rent: "ค่าเช่า",
  electric: "ค่าไฟ",
  water: "ค่าน้ำ",
  late_fee: "ค่าปรับล่าช้า",
  discount: "ส่วนลด",
  land_tax: "ภาษีที่ดิน",
  common_fee: "ค่าส่วนกลาง",
  waste: "ค่าขยะ",
  custom: "ค่าใช้จ่ายเพิ่มเติม",
  other: "อื่น ๆ",
};

/** หมวดที่ถือเป็น "ค่าสาธารณูปโภค/บริการ" — ใช้กับปุ่มลัด "แยกค่าน้ำ-ไฟ" */
const UTILITY_KINDS = new Set(["electric", "water", "common_fee", "waste"]);

/** ป้ายสั้นบอกว่าใบนี้มีอะไร (จากหมวดของรายการ) */
function groupLabel(items: SplitItem[]): string {
  if (items.length === 0) return "—";
  const kinds = Array.from(new Set(items.map((i) => KIND_LABELS[i.kind] ?? i.kind)));
  if (kinds.length <= 3) return kinds.join(" + ");
  return `${kinds.slice(0, 2).join(" + ")} +${kinds.length - 2}`;
}

export default function SplitBillClient(props: SplitBillClientProps) {
  const { items, master, vatPercent, billNo } = props;

  // เริ่มต้น: ติ๊กค่าน้ำ-ไฟ (กรณีใช้บ่อยสุด — แยกค่าเช่ากับค่าสาธารณูปโภค)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((i) => UTILITY_KINDS.has(i.kind)).map((i) => i.id)),
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectUtilities = () =>
    setSelected(new Set(items.filter((i) => UTILITY_KINDS.has(i.kind)).map((i) => i.id)));
  const selectRent = () =>
    setSelected(new Set(items.filter((i) => i.kind === "rent").map((i) => i.id)));

  // แบ่งรายการเป็น 2 กลุ่ม
  const groupA = items.filter((i) => selected.has(i.id)); // ใบที่ 1 (ติ๊กเลือก)
  const groupB = items.filter((i) => !selected.has(i.id)); // ใบที่ 2 (ที่เหลือ)

  // คิดยอดใบที่ 1 ด้วย "สูตรเดียวกับบิลจริง" (computeBillTotals) — จัดสรรส่วนลดตามสัดส่วน
  const totals = useMemo(() => {
    const gA = items.filter((i) => selected.has(i.id));
    const grossMain = round2(items.reduce((s, i) => s + i.amount, 0));
    const grossA = round2(gA.reduce((s, i) => s + i.amount, 0));
    const discountA = grossMain > 0 ? round2(master.discountAmount * (grossA / grossMain)) : 0;
    const tA = computeBillTotals({
      items: gA.map((i) => ({ amount: i.amount, vatable: i.vatable })),
      approvedDiscount: discountA,
      vatPercent,
    });
    // ใบที่ 2 = "ส่วนที่เหลือของบิลหลัก" (หักจากยอดจริง) → รวม 2 ใบ = บิลหลักเป๊ะเสมอ
    const tB = {
      subtotal: round2(master.subtotal - tA.subtotal),
      discountAmount: round2(master.discountAmount - tA.discountAmount),
      vatAmount: round2(master.vatAmount - tA.vatAmount),
      totalAmount: round2(master.totalAmount - tA.totalAmount),
    };
    return { tA, tB };
  }, [items, selected, master, vatPercent]);

  const issueDate = props.issueDate ? new Date(props.issueDate) : null;
  const dueDate = props.dueDate ? new Date(props.dueDate) : null;

  const baseDoc = (
    group: SplitItem[],
    t: { subtotal: number; discountAmount: number; vatAmount: number; totalAmount: number },
  ): BillDocumentData => ({
    billNo,
    period: props.period,
    status: props.status,
    issueDate,
    dueDate,
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    vatAmount: t.vatAmount,
    totalAmount: t.totalAmount,
    paidAmount: 0,
    project: props.project,
    unit: props.unit,
    tenant: props.tenant,
    items: group.map((i) => ({
      id: i.id,
      kind: i.kind,
      label: i.label,
      qty: i.qty,
      unitPrice: i.unitPrice,
      amount: i.amount,
      vatable: i.vatable,
    })),
    // โชว์เลขมิเตอร์เฉพาะใบที่มีค่าน้ำ/ไฟอยู่ (ให้ตรงกับรายการในใบนั้น)
    meterReadings: group.some((i) => i.kind === "electric" || i.kind === "water")
      ? props.meterReadings
      : undefined,
    bank: props.bank,
  });

  const docA = baseDoc(groupA, totals.tA);
  const docB = baseDoc(groupB, totals.tB);

  const sumTwo = round2(totals.tA.totalAmount + totals.tB.totalAmount);
  const matches = Math.abs(sumTwo - master.totalAmount) < 0.005;
  const canSplit = groupA.length > 0 && groupB.length > 0;

  return (
    <div className="rs-scope">
      {/* ── controls (ไม่พิมพ์) ── */}
      <div className="print:hidden space-y-4">
        <a
          href={`/rentspace/bills/${props.billId}`}
          className="inline-flex items-center gap-1.5 text-[13px]"
          style={{ color: "var(--rs-text-2)" }}
        >
          <ArrowLeft className="h-4 w-4" /> กลับหน้าบิล {billNo}
        </a>

        <div className="rs-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Scissors className="h-5 w-5" style={{ color: "var(--rs-brand)" }} />
            <h1 className="text-lg font-bold" style={{ color: "var(--rs-text)" }}>
              แตกบิล — พิมพ์ใบวางบิลแยก
            </h1>
          </div>
          <p className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
            เลือกรายการที่จะแยกออกเป็น <b>ใบที่ 1</b> · รายการที่เหลือจะเป็น <b>ใบที่ 2</b> อัตโนมัติ ·
            บิลหลัก <b>{billNo}</b> ในระบบไม่เปลี่ยน — นี่คือแค่เอกสารไว้ยื่นผู้เช่า
          </p>

          {/* ปุ่มลัด */}
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="rs-btn rs-btn-ghost text-[12.5px]" onClick={selectUtilities} type="button">
              แยกค่าน้ำ-ไฟ
            </button>
            <button className="rs-btn rs-btn-ghost text-[12.5px]" onClick={selectRent} type="button">
              แยกค่าเช่า
            </button>
          </div>

          {/* รายการ + checkbox */}
          <div className="mt-3 rounded-xl overflow-hidden" style={{ border: "1px solid var(--rs-border)" }}>
            {items.map((it) => {
              const on = selected.has(it.id);
              return (
                <label
                  key={it.id}
                  className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer border-b last:border-0"
                  style={{ borderColor: "var(--rs-border)", background: on ? "var(--rs-brand-soft, var(--rs-info-soft))" : "transparent" }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(it.id)} className="h-4 w-4" />
                  <span className="flex-1 text-[13px]" style={{ color: "var(--rs-text)" }}>
                    {it.label}
                    <span className="text-[11.5px] ml-1.5" style={{ color: "var(--rs-text-3)" }}>
                      {KIND_LABELS[it.kind] ?? it.kind}
                    </span>
                  </span>
                  <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: "var(--rs-text)" }}>
                    {formatBaht(it.amount)}
                  </span>
                  <span
                    className="text-[11px] font-semibold w-14 text-right"
                    style={{ color: on ? "var(--rs-brand)" : "var(--rs-text-3)" }}
                  >
                    {on ? "ใบที่ 1" : "ใบที่ 2"}
                  </span>
                </label>
              );
            })}
          </div>

          {/* ตรวจยอดรวม */}
          <div
            className="mt-3 flex items-center justify-between rounded-xl px-4 py-3 text-[13px]"
            style={{
              background: matches ? "var(--rs-ok-soft)" : "var(--rs-danger-soft)",
              color: matches ? "var(--rs-ok)" : "var(--rs-danger)",
            }}
          >
            <span className="font-semibold">
              {matches ? "✓ ยอด 2 ใบรวมกัน = บิลหลักเป๊ะ" : "⚠️ ยอดรวมไม่ตรง — ตรวจสอบ"}
            </span>
            <span className="tabular-nums font-bold">
              {formatBaht(sumTwo)} / {formatBaht(master.totalAmount)}
            </span>
          </div>

          {!canSplit && (
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--rs-pending)" }}>
              เลือกอย่างน้อย 1 รายการ และต้องเหลือรายการไว้ใบที่ 2 ด้วย (ทั้งสองใบต้องมีของ)
            </p>
          )}

          <button
            className="rs-btn w-full justify-center mt-4"
            onClick={() => window.print()}
            disabled={!canSplit}
            type="button"
          >
            <Printer className="h-4 w-4" /> พิมพ์ใบวางบิลแยก (2 ใบ)
          </button>
        </div>

        {/* หัวพรีวิว */}
        <div className="text-[12.5px] font-semibold" style={{ color: "var(--rs-text-3)" }}>
          พรีวิว (จะพิมพ์ออกมา 2 หน้า)
        </div>
      </div>

      {/* ── เอกสารที่จะพิมพ์ ── */}
      <div id="rs-split-print" className="space-y-6 mt-4">
        {canSplit ? (
          <>
            <div className="rs-card rs-split-doc p-6">
              <BillDocument
                bill={docA}
                docTitle="ใบวางบิล"
                docNote={`ใบที่ 1/2 · ${groupLabel(groupA)} · อ้างอิงบิล ${billNo}`}
                hidePayment
                hideStamp
              />
            </div>
            <div className="rs-card rs-split-doc p-6">
              <BillDocument
                bill={docB}
                docTitle="ใบวางบิล"
                docNote={`ใบที่ 2/2 · ${groupLabel(groupB)} · อ้างอิงบิล ${billNo}`}
                hidePayment
                hideStamp
              />
            </div>
          </>
        ) : null}
      </div>

      <style>{`
        ${BILL_DOC_STYLE}
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          body * { visibility: hidden; }
          #rs-split-print, #rs-split-print * { visibility: visible; }
          #rs-split-print { position: absolute; inset: 0; margin: 0; }
          .rs-split-doc {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            page-break-after: always;
          }
          .rs-split-doc:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
