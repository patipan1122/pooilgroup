"use client";

// Read-only payment-request detail for the executive in LINE (LIFF). Shows the
// net amount, every bill, the payee with one-tap COPY (real copy here, unlike the
// flex card), and a PromptPay QR (rendered via the repo's existing qrserver pattern)
// so the exec scans → pays → drops the slip back in the group.
import { useState } from "react";
import { Copy, Check, ReceiptText } from "lucide-react";
import type { PaymentRequestDetail } from "@/lib/ledger/payment-request-queries";

const baht = (n: number) =>
  `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

      {/* PromptPay QR (if available) */}
      {qrUrl && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold text-zinc-600">สแกนพร้อมเพย์เพื่อจ่าย</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="PromptPay QR" className="size-56 rounded-lg" />
          <p className="text-[11px] text-zinc-400">บันทึกรูป/สแกนในแอปธนาคาร · ยอดถูกฝังในคิวอาร์แล้ว</p>
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

      {/* Bills */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-zinc-500">รายการบิล ({req.bills.length} ใบ)</p>
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {req.bills.map((b, i) => (
            <li key={`${b.docCode}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 truncate text-zinc-600">
                <ReceiptText className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="font-mono">{b.docCode}</span>
              </span>
              <span className="shrink-0 tabular-nums text-zinc-700">
                {baht(b.amount)}
                {b.wht > 0 ? <span className="text-zinc-400"> − {baht(b.wht)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">
        โอนแล้ว → ส่งสลิปกลับกลุ่มนี้ ระบบจับคู่ + ปิดบิลให้อัตโนมัติ ✅
      </p>
    </div>
  );
}
