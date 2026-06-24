"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { formatBaht, BILL_STATUS, PAYMENT_METHODS } from "@/lib/rentspace/format";
import { actRecordPayment } from "@/app/(admin)/rentspace/_actions";
import type { OverdueUnit, OverdueBill } from "@/lib/rentspace/collections";

const METHODS: ("cash" | "transfer" | "qr" | "card")[] = ["cash", "transfer", "qr", "card"];

export function CollectionRow({ room }: { room: OverdueUnit }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rs-card overflow-hidden">
      {/* collapsed header — code + tenant + outstanding + chevron */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--rs-bg-2)] transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold" style={{ color: "var(--rs-text)" }}>
              {room.code}
            </span>
            {room.name && (
              <span className="text-[12.5px] truncate" style={{ color: "var(--rs-text-3)" }}>
                {room.name}
              </span>
            )}
          </div>
          <div className="text-[13px] truncate mt-0.5" style={{ color: "var(--rs-text-2)" }}>
            {room.tenantName}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px]" style={{ color: "var(--rs-text-3)" }}>
            ค้างชำระ
          </div>
          <div className="font-bold tabular-nums" style={{ color: "var(--rs-danger)" }}>
            {formatBaht(room.totalOutstanding)}
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{
            color: "var(--rs-text-3)",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {/* expanded — unpaid bills with inline รับชำระ form */}
      {open && (
        <div className="border-t" style={{ borderColor: "var(--rs-border)" }}>
          {room.bills.map((bill) => (
            <BillRow key={bill.id} bill={bill} unitCode={room.code} />
          ))}
        </div>
      )}
    </div>
  );
}

function BillRow({ bill, unitCode }: { bill: OverdueBill; unitCode: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(bill.outstanding));
  const [method, setMethod] = useState<"cash" | "transfer" | "qr" | "card">("transfer");
  const [pending, start] = useTransition();
  const st = BILL_STATUS[bill.status] ?? { label: bill.status, color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" };

  function submit() {
    const amt = Number(String(amount).replace(/[^0-9.]/g, "")) || 0;
    if (amt <= 0) {
      toast.error("กรอกจำนวนเงิน");
      return;
    }
    start(async () => {
      try {
        await actRecordPayment({
          billId: bill.id,
          amountThb: amt,
          paidOn: new Date().toISOString().slice(0, 10),
          method,
        });
        toast.success(`รับชำระ ${unitCode} · ${bill.label} แล้ว`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="px-4 py-3" style={{ borderTop: "1px solid var(--rs-border)" }}>
      {/* bill meta line */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13.5px] font-semibold" style={{ color: "var(--rs-text)" }}>
          {bill.label}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: st.soft, color: st.color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
          {st.label}
        </span>
        {bill.dueDate && (
          <span className="text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
            ครบกำหนด {bill.dueDate}
          </span>
        )}
        <span className="ml-auto text-[12px]" style={{ color: "var(--rs-text-3)" }}>
          เต็ม{" "}
          <span className="tabular-nums" style={{ color: "var(--rs-text-2)" }}>
            {formatBaht(bill.totalAmount)}
          </span>
          {bill.paidAmount > 0 && (
            <>
              {" · จ่ายแล้ว "}
              <span className="tabular-nums" style={{ color: "var(--rs-text-2)" }}>
                {formatBaht(bill.paidAmount)}
              </span>
            </>
          )}
        </span>
      </div>

      {/* outstanding line */}
      <div className="mt-2 text-[12px]" style={{ color: "var(--rs-text-2)" }}>
        ค้าง{" "}
        <span className="font-semibold tabular-nums" style={{ color: "var(--rs-danger)" }}>
          {formatBaht(bill.outstanding)}
        </span>
      </div>

      {/* inline รับชำระ form — amount+method row, then full-width save on phone */}
      <div className="mt-2 flex flex-wrap items-stretch gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label={`จำนวนเงินรับชำระ ${bill.label}`}
          className="min-w-0 flex-1 sm:flex-none sm:w-28 h-11 rounded-lg px-2.5 text-sm tabular-nums"
          style={{ border: "1.5px solid var(--rs-border)", outline: "none", color: "var(--rs-text)" }}
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as "cash" | "transfer" | "qr" | "card")}
          aria-label={`วิธีชำระ ${bill.label}`}
          className="h-11 rounded-lg px-2 text-sm"
          style={{ border: "1.5px solid var(--rs-border)", outline: "none", color: "var(--rs-text)" }}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHODS[m]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="w-full sm:w-auto sm:ml-auto h-11 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--rs-ok)" }}
        >
          {pending ? "…" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
