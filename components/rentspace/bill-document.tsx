// RentSpace — shared A4 bill/invoice markup.
// Pure presentational (no hooks) so it renders in Server Components: used by the
// public bill view (/rentspace/bill/[token]) and the batch-print page. Mirrors
// the invoice block from bills/[id]/page.tsx. Display-only — reads stored totals,
// never recomputes. NOTE: bills/[id]/page.tsx keeps its own inline copy (owned by
// another agent) — this component is for the new read-only surfaces only.

import { Zap, Droplet, Landmark } from "lucide-react";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName, periodLabel } from "@/lib/rentspace/format";

const ITEM_KIND_LABELS: Record<string, string> = {
  rent: "ค่าเช่า",
  electric: "ค่าไฟ",
  water: "ค่าน้ำ",
  late_fee: "ค่าปรับล่าช้า",
  discount: "ส่วนลด",
  land_tax: "ภาษีที่ดิน",
  custom: "ค่าใช้จ่ายเพิ่มเติม",
  common_fee: "ค่าส่วนกลาง",
  waste: "ค่าขยะ",
  other: "อื่น ๆ",
};

type BillItem = {
  id: string;
  kind: string;
  label: string;
  qty: unknown;
  unitPrice: unknown;
  amount: unknown;
  vatable: boolean;
};

/** มิเตอร์ก่อน→หลัง สำหรับแสดงให้ผู้เช่าตรวจการคิดค่าน้ำ-ไฟ. */
type MeterDetail = { prev: number; curr: number; usage: number; rate: number; amount: number };

/** ช่องทางชำระเงินของโครงการ (บัญชี/พร้อมเพย์) — แสดงท้ายบิลให้ผู้เช่าจ่ายง่าย. */
export type BillPaymentInfo = {
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
  promptpayId?: string | null;
  paymentNote?: string | null;
};

export type BillDocumentData = {
  billNo: string;
  period: string;
  status: string;
  issueDate: Date | null;
  dueDate: Date | null;
  subtotal: unknown;
  discountAmount: unknown;
  vatAmount: unknown;
  totalAmount: unknown;
  paidAmount: unknown;
  project: {
    name: string;
    address?: string | null;
    billCompanyName?: string | null;
    billAddress?: string | null;
    billTaxId?: string | null;
    billBranch?: string | null;
  };
  unit: { code: string; name?: string | null };
  tenant: {
    bizName?: string | null;
    prefix?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    nickname?: string | null;
    taxId?: string | null;
  };
  items: BillItem[];
  /** เลขมิเตอร์ก่อน→หลังของงวดนี้ (ไฟ/น้ำ) — เสริม แสดงถ้ามี. */
  meterReadings?: { electric?: MeterDetail; water?: MeterDetail };
  /** ช่องทางชำระเงิน — เสริม แสดงถ้ามี. */
  bank?: BillPaymentInfo;
};

function hasBank(b?: BillPaymentInfo): boolean {
  return !!(b && (b.bankName || b.bankAccountNo || b.bankAccountHolder || b.promptpayId || b.paymentNote));
}

/** บล็อกแสดงเลขมิเตอร์ ก่อน→หลัง = ใช้ N หน่วย × เรต = เงิน (ไฟ/น้ำ) —
 *  โชว์ที่มาของค่าน้ำ-ไฟให้ลูกค้าเห็นชัด (โปร่งใส ตรวจสอบได้เอง ว่าไม่มีคิดเกิน). */
function MeterDetailBlock({ meters }: { meters: { electric?: MeterDetail; water?: MeterDetail } }) {
  const rows: { icon: React.ReactNode; label: string; m: MeterDetail }[] = [];
  if (meters.electric) rows.push({ icon: <Zap className="h-3.5 w-3.5" />, label: "ค่าไฟ", m: meters.electric });
  if (meters.water) rows.push({ icon: <Droplet className="h-3.5 w-3.5" />, label: "ค่าน้ำ", m: meters.water });
  if (rows.length === 0) return null;
  return (
    <div
      className="mt-3 rounded-xl px-3.5 py-2.5"
      style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
    >
      <div className="text-[11.5px] font-semibold uppercase mb-2" style={{ color: "var(--rs-text-3)" }}>
        รายละเอียดค่าน้ำ-ไฟ (คำนวณจากมิเตอร์)
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
            {/* บรรทัด 1: ป้าย + ยอดเงินของหมวดนี้ (เด่น) */}
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--rs-text)" }}>
                <span className="inline-flex items-center" style={{ color: "var(--rs-text-3)" }}>{r.icon}</span>
                {r.label}
              </span>
              <b className="tabular-nums" style={{ color: "var(--rs-text)" }}>{formatBaht(r.m.amount)}</b>
            </div>
            {/* บรรทัด 2: ที่มา — เลขก่อน→เลขหลัง = หน่วย × เรต */}
            <div className="tabular-nums mt-0.5" style={{ color: "var(--rs-text-3)" }}>
              เลขก่อน <b style={{ color: "var(--rs-text-2)" }}>{r.m.prev.toLocaleString()}</b> →{" "}
              เลขหลัง <b style={{ color: "var(--rs-text-2)" }}>{r.m.curr.toLocaleString()}</b> ={" "}
              ใช้ <b style={{ color: "var(--rs-text-2)" }}>{r.m.usage.toLocaleString()}</b> หน่วย ×{" "}
              <b style={{ color: "var(--rs-text-2)" }}>{r.m.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> บาท/หน่วย
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** บล็อกช่องทางชำระเงิน — โดดเด่น คัดลอกง่าย สำหรับหน้าผู้เช่า. */
function PaymentBlock({ bank }: { bank: BillPaymentInfo }) {
  return (
    <div
      className="mt-5 rounded-xl px-4 py-3.5"
      style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Landmark className="h-4 w-4" style={{ color: "var(--rs-brand)" }} />
        <span className="text-[13.5px] font-bold" style={{ color: "var(--rs-text)" }}>
          ช่องทางชำระเงิน
        </span>
      </div>
      <div className="space-y-1 text-[13px]" style={{ color: "var(--rs-text)" }}>
        {bank.bankName && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--rs-text-2)" }}>ธนาคาร</span>
            <b className="text-right">{bank.bankName}</b>
          </div>
        )}
        {bank.bankAccountNo && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--rs-text-2)" }}>เลขบัญชี</span>
            <b className="text-right tabular-nums select-all">{bank.bankAccountNo}</b>
          </div>
        )}
        {bank.bankAccountHolder && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--rs-text-2)" }}>ชื่อบัญชี</span>
            <b className="text-right">{bank.bankAccountHolder}</b>
          </div>
        )}
        {bank.promptpayId && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "var(--rs-text-2)" }}>พร้อมเพย์</span>
            <b className="text-right tabular-nums select-all">{bank.promptpayId}</b>
          </div>
        )}
      </div>
      {bank.paymentNote && (
        <div
          className="text-[12px] mt-2 pt-2 border-t font-semibold leading-snug"
          style={{ color: "var(--rs-danger)", borderColor: "var(--rs-border)" }}
        >
          ⚠️ {bank.paymentNote}
        </div>
      )}
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  tone?: "danger" | "ok";
}) {
  const color = tone === "danger" ? "var(--rs-danger)" : tone === "ok" ? "var(--rs-ok)" : "var(--rs-text)";
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className={strong ? "text-[14px] font-semibold" : "text-[13px]"} style={{ color: strong ? "var(--rs-text)" : "var(--rs-text-2)" }}>
        {label}
      </span>
      <span
        className={`tabular-nums text-right ${strong ? "text-[15px] font-bold" : "text-[13.5px] font-medium"}`}
        style={{ color: strong ? color : "var(--rs-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Renders one A4 invoice. Wrap each instance in a print-friendly container.
 * `domId` lets the public single-bill page target `#rs-bill` for print scoping;
 * the batch page renders many without a single id (uses .rs-bill-doc class).
 */
export function BillDocument({
  bill,
  domId,
  docTitle,
  docNote,
  hidePayment,
  hideStamp,
}: {
  bill: BillDocumentData;
  domId?: string;
  /** แทนหัวข้อ "ใบแจ้งหนี้/ใบเสร็จรับเงิน" (ใช้กับใบวางบิลแยก เช่น "ใบวางบิล"). */
  docTitle?: string;
  /** บรรทัดหมายเหตุใต้หัวข้อ (เช่น "แยกส่วน: ค่าน้ำ-ไฟ · อ้างอิงบิล INV..."). */
  docNote?: string;
  /** ซ่อนแถว "ชำระแล้ว/คงเหลือ" — ใช้กับใบวางบิลแยกที่การรับเงินอยู่บิลหลักใบเดียว. */
  hidePayment?: boolean;
  /** ซ่อนตราประทับชำระ/ค้างชำระ — ใช้กับใบวางบิลแยก. */
  hideStamp?: boolean;
}) {
  const total = toNum(bill.totalAmount);
  const paid = toNum(bill.paidAmount);
  const remaining = Math.max(0, total - paid);
  const discountTotal = toNum(bill.discountAmount);
  const vat = toNum(bill.vatAmount);
  const subtotal = toNum(bill.subtotal);
  const items = bill.items ?? [];
  const stampState = remaining <= 0 && bill.status !== "void" ? "paid" : bill.status === "void" ? "void" : "unpaid";

  return (
    <div id={domId} className="rs-bill-doc" style={{ position: "relative" }}>
      {/* paid / unpaid stamp */}
      {!hideStamp && (
        <div className="rs-bill-stamp" data-state={stampState}>
          {bill.status === "void" ? "ยกเลิก" : remaining <= 0 ? "ชำระแล้ว" : "ค้างชำระ"}
        </div>
      )}

      {/* invoice header */}
      <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b" style={{ borderColor: "var(--rs-border)" }}>
        <div>
          <div className="text-xl font-bold" style={{ color: "var(--rs-text)" }}>
            {bill.project.billCompanyName || bill.project.name}
          </div>
          {(bill.project.billAddress || bill.project.address) && (
            <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
              {bill.project.billAddress || bill.project.address}
            </div>
          )}
          {bill.project.billTaxId && (
            <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
              เลขผู้เสียภาษี {bill.project.billTaxId}
              {bill.project.billBranch ? ` · ${bill.project.billBranch}` : ""}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[14px] font-bold" style={{ color: "var(--rs-text)" }}>
            {docTitle ?? (remaining <= 0 && bill.status !== "void" ? "ใบเสร็จรับเงิน" : "ใบแจ้งหนี้")}
          </div>
          <div className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
            เลขที่ {bill.billNo}
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
            งวด {periodLabel(bill.period)}
          </div>
          {docNote && (
            <div className="text-[12px] mt-1 font-semibold" style={{ color: "var(--rs-brand)" }}>
              {docNote}
            </div>
          )}
        </div>
      </div>

      {/* bill-to + meta */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-[11.5px] font-semibold uppercase mb-1" style={{ color: "var(--rs-text-3)" }}>
            เรียกเก็บจาก
          </div>
          <div className="text-[14px] font-medium" style={{ color: "var(--rs-text)" }}>
            {tenantDisplayName(bill.tenant)}
          </div>
          {bill.tenant.taxId && (
            <div className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
              เลขผู้เสียภาษี {bill.tenant.taxId}
            </div>
          )}
          <div className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
            ห้อง {bill.unit.code}
            {bill.unit.name ? ` · ${bill.unit.name}` : ""}
          </div>
        </div>
        <div className="text-right text-[12.5px] space-y-0.5" style={{ color: "var(--rs-text-2)" }}>
          <div>
            งวด: <b style={{ color: "var(--rs-text)" }}>{periodLabel(bill.period)}</b>
          </div>
          <div>วันที่ออกบิล: {bill.issueDate ? thaiDateLong(bill.issueDate) : "—"}</div>
          <div>
            ครบกำหนด: <b style={{ color: "var(--rs-text)" }}>{bill.dueDate ? thaiDateLong(bill.dueDate) : "—"}</b>
          </div>
        </div>
      </div>

      {/* items */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[12px] border-b" style={{ color: "var(--rs-text-2)", borderColor: "var(--rs-border)" }}>
              <th className="py-2 font-semibold">รายการ</th>
              <th className="py-2 font-semibold text-right">จำนวน × ราคา</th>
              <th className="py-2 font-semibold text-right">รวม</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 text-center text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                  ไม่มีรายการย่อย
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-b last:border-0" style={{ borderColor: "var(--rs-border)" }}>
                  <td className="py-2.5" style={{ color: "var(--rs-text)" }}>
                    {it.label}
                    {it.kind && it.kind !== "other" ? (
                      <span className="text-[11.5px] ml-1.5" style={{ color: "var(--rs-text-3)" }}>
                        {ITEM_KIND_LABELS[it.kind] ?? it.kind}
                      </span>
                    ) : null}
                    {it.vatable ? (
                      <span
                        className="inline-flex items-center text-[10.5px] font-semibold ml-1.5 px-1.5 py-0.5 rounded"
                        style={{ background: "var(--rs-info-soft)", color: "var(--rs-info)" }}
                        title="รายการนี้คิดภาษีมูลค่าเพิ่ม"
                      >
                        VAT
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                    {toNum(it.qty)} × {formatBaht(toNum(it.unitPrice))}
                  </td>
                  <td
                    className="py-2.5 text-right tabular-nums font-medium"
                    style={{ color: toNum(it.amount) < 0 ? "var(--rs-ok)" : "var(--rs-text)" }}
                  >
                    {formatBaht(toNum(it.amount))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* meter detail — เลขมิเตอร์ก่อน→หลัง ให้ผู้เช่าตรวจค่าน้ำ-ไฟ */}
      {bill.meterReadings && <MeterDetailBlock meters={bill.meterReadings} />}

      {/* totals */}
      <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
        <div className="ml-auto max-w-xs">
          <TotalRow label="ยอดก่อนภาษี" value={formatBaht(subtotal)} />
          {discountTotal > 0 && <TotalRow label="ส่วนลด" value={`− ${formatBaht(discountTotal)}`} tone="ok" />}
          {vat > 0 && <TotalRow label="ภาษีมูลค่าเพิ่ม (VAT)" value={formatBaht(vat)} />}
          <div className="border-t my-1.5" style={{ borderColor: "var(--rs-border)" }} />
          <TotalRow label="ยอดรวมทั้งสิ้น" value={formatBaht(total)} strong />
          {!hidePayment && <TotalRow label="ชำระแล้ว" value={formatBaht(paid)} />}
          {!hidePayment && (
            <TotalRow label="คงเหลือ" value={formatBaht(remaining)} strong tone={remaining > 0 ? "danger" : "ok"} />
          )}
        </div>
      </div>

      {/* payment — ช่องทางชำระเงิน (โอน/พร้อมเพย์) ให้ผู้เช่าจ่ายง่าย */}
      {hasBank(bill.bank) && bill.bank && <PaymentBlock bank={bill.bank} />}
    </div>
  );
}

/** Shared stamp + A4 print CSS used by the public bill page + batch print page. */
export const BILL_DOC_STYLE = `
  .rs-bill-doc { position: relative; }
  .rs-bill-stamp {
    position: absolute;
    top: 18px;
    right: 18px;
    transform: rotate(-12deg);
    padding: 4px 14px;
    border: 2.5px solid currentColor;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 1px;
    /* translucent watermark so any text behind the stamp stays legible */
    opacity: .55;
    pointer-events: none;
    z-index: 1;
  }
  .rs-bill-stamp[data-state="paid"] { color: var(--rs-ok); }
  .rs-bill-stamp[data-state="unpaid"] { color: var(--rs-danger); }
  .rs-bill-stamp[data-state="void"] { color: var(--rs-text-3); }
  /* Print: pin the stamp into the A4 top-right margin so it never sits on the
     header meta (bill no / period) or the line-item table + totals. Higher
     specificity (.rs-bill-doc .rs-bill-stamp) intentionally wins over the
     consuming pages' bare ".rs-bill-stamp { top:0; right:0 }" print override. */
  @media print {
    .rs-bill-doc .rs-bill-stamp {
      top: 4px;
      right: 4px;
      opacity: .5;
      z-index: 1;
    }
  }
`;
