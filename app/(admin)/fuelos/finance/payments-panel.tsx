"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, X, Receipt, Link2 } from "lucide-react";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { formatBaht, bkkDate, bkkDateTime, bkkToday } from "@/lib/fuelos/utils/format";
import type { PaymentRow, CustomerOption } from "@/lib/fuelos/finance-data";
import { recordPayment, verifyPayment, rejectPayment } from "./actions";

const METHOD_LABEL: Record<string, string> = {
  TRANSFER: "โอน",
  CASH: "เงินสด",
  CHEQUE: "เช็ค",
};

const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-warning/15 text-warning",
  VERIFIED: "bg-leaf-100 text-leaf-700",
  REJECTED: "bg-danger/10 text-danger",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "รอยืนยัน",
  VERIFIED: "ยืนยันแล้ว",
  REJECTED: "ปฏิเสธ",
};

export function PaymentsPanel({
  payments,
  customers,
}: {
  payments: PaymentRow[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant={showForm ? "outline" : "primary"} onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-4" /> บันทึกรับชำระ
        </Button>
      </div>

      {showForm && (
        <RecordForm
          customers={customers}
          onDone={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      )}

      <div className="grid gap-2">
        {payments.length === 0 && (
          <div className="text-center text-zinc-400 py-10 text-sm">ยังไม่มีรายการรับชำระ</div>
        )}
        {payments.map((p) => (
          <PaymentCard key={p.id} p={p} onChanged={() => router.refresh()} />
        ))}
      </div>
    </div>
  );
}

function PaymentCard({ p, onChanged }: { p: PaymentRow; onChanged: () => void }) {
  const [pending, start] = useTransition();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        onChanged();
      } else {
        toast.error(r.error ?? "ทำรายการไม่สำเร็จ");
      }
    });
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-4",
        p.status === "PENDING" && "border-warning/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{p.customerName}</span>
            <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full", STATUS_PILL[p.status])}>
              {STATUS_LABEL[p.status]}
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-2 text-zinc-600">
              {METHOD_LABEL[p.method] ?? p.method}
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>รับเมื่อ {bkkDate(p.paymentDate)}</span>
            {p.reference && (
              <span className="inline-flex items-center gap-1">
                <Receipt className="size-3" /> อ้างอิง {p.reference}
              </span>
            )}
            {p.hasOrder && p.orderNo && (
              <span className="inline-flex items-center gap-1 text-brand-700">
                <Link2 className="size-3" /> {p.orderNo}
              </span>
            )}
          </div>
          {p.status === "VERIFIED" && p.verifiedByName && p.verifiedAt && (
            <div className="text-[11px] text-leaf-700 mt-1">
              ยืนยันโดย {p.verifiedByName} · {bkkDateTime(p.verifiedAt)}
              {p.hasOrder && " · ปลดวงเงินเครดิตแล้ว"}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold tabular-nums font-[family-name:var(--font-plex-mono)]">
            {formatBaht(p.amount)}
          </div>
        </div>
      </div>

      {p.status === "PENDING" && (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            loading={pending}
            onClick={() => act(() => verifyPayment(p.id), "ยืนยันยอดเข้าแล้ว")}
          >
            <Check className="size-4" /> ยืนยันยอดเข้าจริง
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => act(() => rejectPayment(p.id), "ปฏิเสธรายการแล้ว")}
          >
            <X className="size-4" /> ปฏิเสธ
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordForm({
  customers,
  onDone,
}: {
  customers: CustomerOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await recordPayment(fd);
      if (r.ok) {
        toast.success("บันทึกรับชำระแล้ว (รอยืนยันยอดเข้า)");
        onDone();
      } else {
        toast.error(r.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm sm:col-span-2">
        <span className="text-zinc-500 text-xs">ลูกค้า</span>
        <select name="customerId" required className="h-10 rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="">— เลือกลูกค้า —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        <span className="text-zinc-500 text-xs">ยอดเงิน (บาท)</span>
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="0.00"
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm tabular-nums"
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="text-zinc-500 text-xs">วิธีรับชำระ</span>
        <select name="method" defaultValue="TRANSFER" className="h-10 rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="TRANSFER">โอน</option>
          <option value="CASH">เงินสด</option>
          <option value="CHEQUE">เช็ค</option>
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        <span className="text-zinc-500 text-xs">วันที่รับชำระ</span>
        <input
          name="paymentDate"
          type="date"
          required
          defaultValue={bkkToday()}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="text-zinc-500 text-xs">เลขอ้างอิง / สลิป (กันซ้ำ)</span>
        <input
          name="reference"
          placeholder="เลขที่สลิป / เลขอ้างอิงโอน"
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        />
      </label>

      <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
        <Button type="submit" loading={pending}>
          บันทึกรับชำระ
        </Button>
      </div>
    </form>
  );
}
