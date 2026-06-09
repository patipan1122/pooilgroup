"use client";

// Read-only payment-request detail for the executive in LINE (LIFF). Shows the
// net amount, every bill, the payee with one-tap COPY (real copy here, unlike the
// flex card), and a PromptPay QR (rendered via the repo's existing qrserver pattern)
// so the exec scans → pays → drops the slip back in the group.
import { useState } from "react";
import { Copy, Check, ReceiptText } from "lucide-react";
import type { PaymentRequestDetail } from "@/lib/ledger/payment-request-queries";
import { ReceiptThumb } from "@/components/ledger/ReceiptThumb";

const baht = (n: number) =>
  `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ประเภทเอกสารผู้ขาย (ใบกำกับ/วางบิล/เสนอราคา ฯลฯ) — ตรงกับ ExpenseDocType.
const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice: "ใบกำกับภาษี",
  receipt: "ใบเสร็จรับเงิน",
  cash_bill: "บิลเงินสด",
  delivery_note: "ใบส่งของ",
  quotation: "ใบเสนอราคา / ใบวางบิล",
  other: "อื่น ๆ",
};
const fmtDocType = (t: string): string => DOC_TYPE_LABEL[t] ?? t;

// วันที่บนเอกสาร — ISO (YYYY-MM-DD) → "9 มิ.ย. 2569" (พ.ศ.).
function fmtThaiDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

const STATE_LABEL: Record<string, string> = {
  open: "รอโอน",
  partial: "จ่ายบางส่วน",
  paid: "จ่ายแล้ว",
  abnormal: "ต้องตรวจ",
  cancelled: "ยกเลิกแล้ว",
  reversed: "ทำรายการคืน",
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      },
      () => {},
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-zinc-400">{label}</p>
        <p className="truncate text-base font-bold tabular-nums text-zinc-900">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`คัดลอก${label}`}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-3 text-xs font-semibold text-white active:scale-95"
      >
        {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {done ? "คัดลอกแล้ว" : "คัดลอก"}
      </button>
    </div>
  );
}

/** One label→value row inside a voucher card. Hidden when the value is empty. */
function VField({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] text-zinc-400">{label}</span>
      <span
        className={`min-w-0 text-right text-xs ${strong ? "font-semibold text-zinc-900" : "text-zinc-700"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function PayreqDetailClient({
  req,
  bankLabel,
  ppPayload,
}: {
  req: PaymentRequestDetail;
  bankLabel: string | null;
  ppPayload: string | null;
}) {
  const qrUrl = ppPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&qzone=1&data=${encodeURIComponent(ppPayload)}`
    : null;

  return (
    <div className="space-y-4">
      {/* Amount */}
      <div className="rounded-2xl bg-[var(--color-brand-50,#EFF4FF)] p-4 text-center">
        <p className="text-xs text-zinc-500">ยอดที่ต้องโอน · {req.vendor || "ไม่ระบุผู้ขาย"}</p>
        <p className="mt-1 text-3xl font-bold text-zinc-900">{baht(req.expectedTransfer)}</p>
        {req.whtTotal > 0 && (
          <p className="mt-0.5 text-xs text-amber-600">
            ยอดบิลรวม {baht(req.billsGross)} − หัก ณ ที่จ่าย {baht(req.whtTotal)}
          </p>
        )}
        <p className="mt-1 text-[11px] font-medium text-zinc-500">
          สถานะ: {STATE_LABEL[req.state] ?? req.state}
        </p>
      </div>

      {/* Uploaded QR image (exec attached on ขอโอน) — scan straight to pay. Wins over
          the generated PromptPay QR (a real bank/shop QR the requester provided). */}
      {req.payeeQrImageUrl && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold text-zinc-600">สแกน QR เพื่อจ่าย</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={req.payeeQrImageUrl} alt="QR สำหรับจ่าย" className="size-60 rounded-lg object-contain" />
          <p className="text-[11px] text-zinc-400">QR ที่แนบมากับคำขอ · สแกนในแอปธนาคาร</p>
        </div>
      )}

      {/* PromptPay QR (generated from พร้อมเพย์) — only when no uploaded QR. */}
      {!req.payeeQrImageUrl && qrUrl && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold text-zinc-600">สแกนพร้อมเพย์เพื่อจ่าย</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="PromptPay QR" className="size-56 rounded-lg" />
          <p className="text-[11px] text-zinc-400">บันทึกรูป/สแกนในแอปธนาคาร · ยอดถูกฝังในคิวอาร์แล้ว</p>
        </div>
      )}

      {/* No QR (paid to a plain bank account) — explain + point to the copy button.
          A PromptPay QR can only be built from a พร้อมเพย์ id (เบอร์/บัตรปชช), not a
          bank account number — so we guide the exec to copy + transfer instead. */}
      {!req.payeeQrImageUrl && !qrUrl && (req.payeeAcctNo || req.payeePromptpay) && (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-center">
          <p className="text-xs font-medium text-zinc-600">
            ใบนี้ไม่มี QR — กดปุ่ม <span className="font-bold text-[var(--color-brand-700)]">คัดลอก</span> ด้านล่าง แล้วโอนในแอปธนาคาร
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            อยากให้สแกน QR จ่ายได้? ใส่ &ldquo;พร้อมเพย์&rdquo; (เบอร์/บัตรปชช) ตอนขอโอน
          </p>
        </div>
      )}

      {/* Payee (copyable) */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-zinc-500">โอนเข้าบัญชี</p>
        {req.payeeAcctName && (
          <p className="text-sm font-medium text-zinc-700">{req.payeeAcctName}</p>
        )}
        {bankLabel && <p className="text-xs text-zinc-500">{bankLabel}</p>}
        {req.payeeAcctNo && <CopyRow label="เลขบัญชี" value={req.payeeAcctNo} />}
        {req.payeePromptpay && <CopyRow label="พร้อมเพย์" value={req.payeePromptpay} />}
        {!req.payeeAcctNo && !req.payeePromptpay && (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-400">— ยังไม่ระบุบัญชีผู้รับ —</p>
        )}
      </div>

      {/* ใบสำคัญจ่าย — one voucher card per bill: everything ops entered (สาขา/หมวด/
          ประเภทเอกสาร/วันที่/VAT/หัก ณ ที่จ่าย/ผู้บันทึก) + the original document below it,
          so the exec verifies straight here without drilling in (CEO 2026-06-09). */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
          <ReceiptText className="size-3.5 text-zinc-400" aria-hidden />
          ใบสำคัญจ่าย ({req.bills.length} รายการ)
        </p>
        <div className="space-y-3">
          {req.bills.map((b, i) => {
            const hasImage = Boolean(b.originalUrl || b.thumbUrl);
            return (
              <div
                key={`${b.docCode}-${i}`}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
              >
                {/* header: doc type + internal doc code */}
                <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2">
                  <span className="rounded-md bg-[var(--color-brand-50,#EFF4FF)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-brand-700,#1d4ed8)]">
                    {fmtDocType(b.docType)}
                  </span>
                  <span className="truncate font-mono text-[11px] text-zinc-400">{b.docCode}</span>
                </div>

                {/* voucher fields */}
                <div className="space-y-1.5 px-3 py-2.5">
                  <VField label="ผู้ขาย" value={b.vendor ?? req.vendor} strong />
                  <VField label="เลขที่เอกสาร" value={b.vendorDocNumber} />
                  <VField label="วันที่" value={fmtThaiDate(b.docDate)} />
                  <VField label="สาขา" value={b.branchName} />
                  <VField label="หมวด" value={b.categoryName} />
                  {b.note && <VField label="รายละเอียด" value={b.note} />}

                  <div className="my-1 border-t border-dashed border-zinc-200" />
                  <VField label="ยอดบิล" value={baht(b.amount)} strong />
                  {b.vat > 0 && <VField label="ภาษีมูลค่าเพิ่ม" value={baht(b.vat)} />}
                  {b.wht > 0 && <VField label="หัก ณ ที่จ่าย" value={`− ${baht(b.wht)}`} />}

                  {b.createdByName && (
                    <p className="pt-1 text-right text-[10px] text-zinc-400">
                      บันทึกโดย {b.createdByName}
                    </p>
                  )}
                </div>

                {/* original document attached — tap → full-screen, "เปิดต้นฉบับ", PDF-aware */}
                {hasImage && (
                  <div className="border-t border-zinc-100 px-3 py-2.5">
                    <p className="mb-1.5 text-[11px] font-medium text-zinc-400">เอกสารต้นฉบับที่แนบ</p>
                    <ReceiptThumb
                      thumbUrl={b.thumbUrl}
                      originalUrl={b.originalUrl}
                      alt={`เอกสาร ${b.docCode}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">
        โอนแล้ว → ส่งสลิปกลับกลุ่มนี้ ระบบจับคู่ + ปิดบิลให้อัตโนมัติ ✅
      </p>
    </div>
  );
}
