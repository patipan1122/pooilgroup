// RentSpace — ใบบิล/ใบวางบิล A4 (ดีไซน์ทางการ · โลโก้ JPSYNC · CEO เคาะ 2026-07-29).
// Pure presentational (no hooks) → ใช้ใน Server Component ได้. Display-only: อ่าน
// ยอดที่เก็บไว้ ไม่คิดใหม่. ใช้ร่วม: หน้าบิลสาธารณะ (/rentspace/bill/[token]) ·
// หน้าแอดมิน bills/[id] · batch print · ใบวางบิลแยก (แตกบิล).
// เนื้อหาเดิมครบ + เพิ่มความเป็นทางการ: หัวเอกสาร · ยอดเงินเป็นตัวอักษร.
// CEO 2026-08-12: ตัดช่องเซ็นรับรอง (ลายเซ็นประ) ออกจากเอกสารทุกใบ — ไม่ใช้.

import { Zap, Droplet, Landmark } from "lucide-react";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName, periodLabel, bahtText } from "@/lib/rentspace/format";

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
  taxInvoiceNo?: string | null;
  taxInvoiceIssuedAt?: Date | null;
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
    address?: string | null;
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

/** โลโก้ JPSYNC จริง (ไฟล์ใน public/logos · git-tracked). ใช้ <img> ธรรมดา
 *  เพื่อให้พิมพ์เอกสาร + หน้า public token render ได้ทุกที่ไม่ต้องพึ่ง next/image. */
function JpsyncLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logos/jpsync-logo-full.png"
      alt="JPSYNC GROUP · BE THE FUTURE"
      style={{ height: 60, width: "auto", display: "block" }}
    />
  );
}

/** บล็อกแสดงเลขมิเตอร์ ก่อน→หลัง = ใช้ N หน่วย × เรต = เงิน (ไฟ/น้ำ) — โปร่งใส ตรวจสอบเองได้. */
function MeterDetailBlock({ meters }: { meters: { electric?: MeterDetail; water?: MeterDetail } }) {
  const rows: { icon: React.ReactNode; label: string; m: MeterDetail }[] = [];
  if (meters.electric) rows.push({ icon: <Zap className="h-3.5 w-3.5" />, label: "ค่าไฟ", m: meters.electric });
  if (meters.water) rows.push({ icon: <Droplet className="h-3.5 w-3.5" />, label: "ค่าน้ำ", m: meters.water });
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}>
      <div className="text-[11px] font-bold uppercase mb-2 tracking-wide" style={{ color: "var(--rs-text-3)" }}>
        รายละเอียดค่าน้ำ-ไฟ (คำนวณจากมิเตอร์)
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--rs-text)" }}>
                <span style={{ color: "var(--rs-text-3)" }}>{r.icon}</span>
                {r.label}
              </span>
              <span className="tabular-nums" style={{ color: "var(--rs-text-3)" }}>
                · เลขก่อน <b style={{ color: "var(--rs-text-2)" }}>{r.m.prev.toLocaleString()}</b> → เลขหลัง{" "}
                <b style={{ color: "var(--rs-text-2)" }}>{r.m.curr.toLocaleString()}</b> = ใช้{" "}
                <b style={{ color: "var(--rs-text-2)" }}>{r.m.usage.toLocaleString()}</b> หน่วย ×{" "}
                <b style={{ color: "var(--rs-text-2)" }}>{r.m.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
              </span>
            </span>
            <b className="tabular-nums" style={{ color: "var(--rs-text)" }}>{formatBaht(r.m.amount)}</b>
          </div>
        ))}
      </div>
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
    <div className="flex justify-between gap-4 py-1">
      <span className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </span>
      <span
        className={`tabular-nums text-right ${strong ? "text-[14px] font-bold" : "text-[13px] font-medium"}`}
        style={{ color: strong ? color : "var(--rs-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Renders one A4 invoice. Wrap each instance in a print-friendly container.
 * `domId` lets the public single-bill page target `#rs-bill` for print scoping.
 * optional props (docTitle/docNote/hidePayment/hideStamp) ใช้กับ "ใบวางบิลแยก".
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
  /** แทนหัวข้อ "ใบแจ้งหนี้/ใบเสร็จรับเงิน" (เช่น "ใบวางบิล" สำหรับใบแยก). */
  docTitle?: string;
  /** บรรทัดหมายเหตุใต้หัวข้อ. */
  docNote?: string;
  /** ซ่อนแถว "ชำระแล้ว/คงเหลือ" (ใบวางบิลแยก — การรับเงินอยู่บิลหลัก). */
  hidePayment?: boolean;
  /** ซ่อนป้ายสถานะ (ใบวางบิลแยก). */
  hideStamp?: boolean;
}) {
  const total = toNum(bill.totalAmount);
  const paid = toNum(bill.paidAmount);
  const remaining = Math.max(0, total - paid);
  const discountTotal = toNum(bill.discountAmount);
  const vat = toNum(bill.vatAmount);
  const subtotal = toNum(bill.subtotal);
  const items = bill.items ?? [];

  const isVoid = bill.status === "void";
  const isPaid = remaining <= 0 && !isVoid;
  const headline = docTitle ?? (bill.taxInvoiceNo ? "ใบกำกับภาษี / ใบเสร็จรับเงิน" : isPaid ? "ใบเสร็จรับเงิน" : "ใบแจ้งหนี้");
  const headlineEn = docTitle ? "BILLING NOTE" : bill.taxInvoiceNo ? "TAX INVOICE" : isPaid ? "RECEIPT" : "INVOICE";
  const statusLabel = isVoid ? "ยกเลิก" : isPaid ? "ชำระแล้ว" : "ค้างชำระ";
  const statusTone = isVoid ? "var(--rs-text-3)" : isPaid ? "var(--rs-ok)" : "var(--rs-danger)";
  const statusBg = isVoid ? "var(--rs-bg-3)" : isPaid ? "var(--rs-ok-soft)" : "var(--rs-danger-soft)";

  const brand = "var(--rs-brand)";
  const line = "var(--rs-border)";

  return (
    <div id={domId} className="rs-bill-doc" style={{ position: "relative" }}>
      {/* accent bar */}
      <div style={{ height: 5, borderRadius: 3, background: brand, marginBottom: 20 }} />

      {/* header: โลโก้ + หัวเอกสาร */}
      <div className="flex items-start justify-between gap-4">
        <JpsyncLogo />
        <div className="text-right">
          <div className="text-[22px] font-extrabold leading-none" style={{ color: "var(--rs-text)" }}>
            {headline}
          </div>
          <div className="text-[10px] font-semibold mt-1" style={{ color: "var(--rs-text-3)", letterSpacing: "3px" }}>
            {headlineEn}
          </div>
          {!hideStamp && (
            <span
              className="inline-block mt-2 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background: statusBg, color: statusTone }}
            >
              {statusLabel}
            </span>
          )}
          {docNote && (
            <div className="text-[11px] mt-1.5 font-semibold" style={{ color: "var(--rs-brand)" }}>
              {docNote}
            </div>
          )}
        </div>
      </div>

      <div className="my-4" style={{ height: 1, background: line }} />

      {/* คู่สัญญา: ผู้ออกบิล | เรียกเก็บจาก */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--rs-text-3)" }}>
            ผู้ออกบิล
          </div>
          <div className="text-[14.5px] font-bold" style={{ color: "var(--rs-text)" }}>
            {bill.project.billCompanyName || bill.project.name}
          </div>
          {(bill.project.billAddress || bill.project.address) && (
            <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
              {bill.project.billAddress || bill.project.address}
            </div>
          )}
          {bill.project.billTaxId && (
            <div className="text-[12px]" style={{ color: "var(--rs-text-2)" }}>
              เลขผู้เสียภาษี {bill.project.billTaxId}
              {bill.project.billBranch ? ` · ${bill.project.billBranch}` : ""}
            </div>
          )}
          <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            โครงการ {bill.project.name}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--rs-text-3)" }}>
            เรียกเก็บจาก
          </div>
          <div className="text-[14.5px] font-bold" style={{ color: "var(--rs-text)" }}>
            {tenantDisplayName(bill.tenant)}
          </div>
          {bill.tenant.address && (
            <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
              {bill.tenant.address}
            </div>
          )}
          {bill.tenant.taxId && (
            <div className="text-[12px]" style={{ color: "var(--rs-text-2)" }}>
              เลขผู้เสียภาษี {bill.tenant.taxId}
            </div>
          )}
          <div className="text-[12px]" style={{ color: "var(--rs-text-2)" }}>
            ห้อง {bill.unit.code}
            {bill.unit.name ? ` · ${bill.unit.name}` : ""}
          </div>
        </div>
      </div>

      {/* แถบข้อมูลบิล */}
      <div
        className={`grid ${bill.taxInvoiceNo ? "grid-cols-4" : "grid-cols-3"} mt-5 rounded-xl overflow-hidden`}
        style={{ border: `1px solid ${line}` }}
      >
        {[
          { k: "เลขที่บิล", v: bill.billNo, num: true },
          { k: "งวด", v: periodLabel(bill.period), num: false },
          {
            k: "วันที่ออก / ครบกำหนด",
            v: `${bill.issueDate ? thaiDateLong(bill.issueDate) : "—"} → ${bill.dueDate ? thaiDateLong(bill.dueDate) : "—"}`,
            num: true,
          },
          ...(bill.taxInvoiceNo
            ? [
                {
                  k: "เลขที่ใบกำกับภาษี",
                  v: `${bill.taxInvoiceNo}${bill.taxInvoiceIssuedAt ? ` (${thaiDateLong(bill.taxInvoiceIssuedAt)})` : ""}`,
                  num: true,
                },
              ]
            : []),
        ].map((c, i) => (
          <div key={c.k} className="px-3.5 py-2.5" style={{ background: "var(--rs-bg-2)", borderLeft: i ? `1px solid ${line}` : undefined }}>
            <div className="text-[10px] font-semibold" style={{ color: "var(--rs-text-3)" }}>
              {c.k}
            </div>
            <div className={`text-[13px] font-bold mt-0.5 ${c.num ? "tabular-nums" : ""}`} style={{ color: "var(--rs-text)" }}>
              {c.v}
            </div>
          </div>
        ))}
      </div>

      {/* items */}
      <div className="overflow-x-auto mt-5">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-left" style={{ color: "#fff" }}>
              <th className="py-2.5 px-3 font-semibold text-[11.5px]" style={{ background: brand, borderRadius: "8px 0 0 8px" }}>
                รายการ
              </th>
              <th className="py-2.5 px-3 font-semibold text-[11.5px] text-right" style={{ background: brand }}>
                จำนวน × ราคา
              </th>
              <th className="py-2.5 px-3 font-semibold text-[11.5px] text-right" style={{ background: brand, borderRadius: "0 8px 8px 0" }}>
                จำนวนเงิน
              </th>
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
                <tr key={it.id} style={{ borderBottom: `1px solid ${line}` }}>
                  <td className="py-2.5 px-3 align-top" style={{ color: "var(--rs-text)" }}>
                    {it.label}
                    {it.kind && it.kind !== "other" ? (
                      <span className="text-[11px] ml-1.5" style={{ color: "var(--rs-text-3)" }}>
                        {ITEM_KIND_LABELS[it.kind] ?? it.kind}
                      </span>
                    ) : null}
                    {it.vatable ? (
                      <span
                        className="inline-flex items-center text-[10px] font-bold ml-1.5 px-1.5 py-0.5 rounded"
                        style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand-700)" }}
                        title="รายการนี้คิดภาษีมูลค่าเพิ่ม"
                      >
                        VAT
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[12.5px] align-top" style={{ color: "var(--rs-text-2)" }}>
                    {toNum(it.qty)} × {formatBaht(toNum(it.unitPrice))}
                  </td>
                  <td
                    className="py-2.5 px-3 text-right tabular-nums font-semibold align-top"
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

      {/* meter detail */}
      {bill.meterReadings && <MeterDetailBlock meters={bill.meterReadings} />}

      {/* summary: ตัวอักษร | ยอด */}
      <div className="flex flex-wrap justify-between gap-6 mt-5 items-start">
        <div className="flex-1" style={{ minWidth: 200 }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--rs-text-3)" }}>
            จำนวนเงินเป็นตัวอักษร
          </div>
          <div className="text-[13px] font-semibold italic" style={{ color: "var(--rs-text)" }}>
            {bahtText(total)}
          </div>
        </div>
        <div style={{ width: 290, flex: "none" }}>
          <TotalRow label="ยอดก่อนภาษี" value={formatBaht(subtotal)} />
          {discountTotal > 0 && <TotalRow label="ส่วนลด" value={`− ${formatBaht(discountTotal)}`} tone="ok" />}
          {vat > 0 && <TotalRow label="ภาษีมูลค่าเพิ่ม (VAT)" value={formatBaht(vat)} />}
          <div
            className="flex justify-between items-center rounded-xl px-4 py-2.5 my-2"
            style={{ background: "var(--rs-brand-50)" }}
          >
            <span className="text-[13.5px] font-bold" style={{ color: "var(--rs-brand-700)" }}>
              ยอดรวมทั้งสิ้น
            </span>
            <span className="text-[21px] font-extrabold tabular-nums" style={{ color: "var(--rs-brand)" }}>
              {formatBaht(total)}
            </span>
          </div>
          {!hidePayment && (
            <div style={{ borderTop: `1px dashed ${line}`, paddingTop: 4 }}>
              <TotalRow label="ชำระแล้ว" value={formatBaht(paid)} />
              <TotalRow label="คงเหลือ" value={formatBaht(remaining)} strong tone={remaining > 0 ? "danger" : "ok"} />
            </div>
          )}
        </div>
      </div>

      {/* payment + note */}
      {hasBank(bill.bank) && bill.bank && (
        <div className="grid mt-6 gap-4" style={{ gridTemplateColumns: bill.bank.paymentNote ? "1.3fr 1fr" : "1fr" }}>
          <div className="rounded-xl px-4 py-3" style={{ border: `1px solid ${line}` }}>
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="h-4 w-4" style={{ color: brand }} />
              <span className="text-[13px] font-bold" style={{ color: "var(--rs-text)" }}>
                ช่องทางชำระเงิน
              </span>
            </div>
            <div className="space-y-1 text-[12.5px]" style={{ color: "var(--rs-text)" }}>
              {bill.bank.bankName && (
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--rs-text-2)" }}>ธนาคาร</span>
                  <b className="text-right">{bill.bank.bankName}</b>
                </div>
              )}
              {bill.bank.bankAccountNo && (
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--rs-text-2)" }}>เลขบัญชี</span>
                  <b className="text-right tabular-nums select-all">{bill.bank.bankAccountNo}</b>
                </div>
              )}
              {bill.bank.bankAccountHolder && (
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--rs-text-2)" }}>ชื่อบัญชี</span>
                  <b className="text-right">{bill.bank.bankAccountHolder}</b>
                </div>
              )}
              {bill.bank.promptpayId && (
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--rs-text-2)" }}>พร้อมเพย์</span>
                  <b className="text-right tabular-nums select-all">{bill.bank.promptpayId}</b>
                </div>
              )}
            </div>
          </div>
          {bill.bank.paymentNote && (
            <div className="rounded-xl px-4 py-3" style={{ background: "var(--rs-danger-soft)", border: "1px solid #F3D2D2" }}>
              <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--rs-danger)" }}>
                โปรดทราบ
              </div>
              <div className="text-[12px] leading-snug" style={{ color: "#9A3535" }}>
                {bill.bank.paymentNote}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared A4 print CSS used by the public bill page + batch print page. */
export const BILL_DOC_STYLE = `
  .rs-bill-doc { position: relative; }
  @media print {
    @page { size: A4; margin: 14mm; }
    .rs-bill-doc { box-shadow: none !important; }
  }
`;
