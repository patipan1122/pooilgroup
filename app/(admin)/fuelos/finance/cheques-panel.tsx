"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, AlertTriangle, Landmark, Clock } from "lucide-react";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { formatBaht, bkkDate, bkkToday } from "@/lib/fuelos/utils/format";
import type { ChequeRow, CustomerOption } from "@/lib/fuelos/finance-data";
import { addCheque, clearCheque, bounceCheque } from "./actions";

const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-warning/15 text-warning",
  CLEARED: "bg-leaf-100 text-leaf-700",
  BOUNCED: "bg-danger/10 text-danger",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "รอขึ้นเงิน",
  CLEARED: "ขึ้นเงินแล้ว",
  BOUNCED: "เด้ง",
};

const DAY = 864e5;

export function ChequesPanel({
  cheques,
  customers,
}: {
  cheques: ChequeRow[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant={showForm ? "outline" : "primary"} onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-4" /> เพิ่มเช็ค
        </Button>
      </div>

      {showForm && (
        <AddForm
          customers={customers}
          onDone={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      )}

      <div className="grid gap-2">
        {cheques.length === 0 && (
          <div className="text-center text-zinc-400 py-10 text-sm">ยังไม่มีเช็ค</div>
        )}
        {cheques.map((c) => (
          <ChequeCard key={c.id} c={c} onChanged={() => router.refresh()} />
        ))}
      </div>
    </div>
  );
}

function ChequeCard({ c, onChanged }: { c: ChequeRow; onChanged: () => void }) {
  const [pending, start] = useTransition();

  // เตือนเช็คใกล้/เลยกำหนด เฉพาะที่ยังรอขึ้นเงิน
  const daysToDue = Math.floor((new Date(c.dueDate).getTime() - Date.now()) / DAY);
  const dueSoon = c.status === "PENDING" && daysToDue <= 3;
  const overdue = c.status === "PENDING" && daysToDue < 0;

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

  function onBounce() {
    const reason = window.prompt("เหตุผลเช็คเด้ง (เช่น เงินในบัญชีไม่พอ)") ?? undefined;
    // ผู้ใช้กด cancel = null → ไม่ทำต่อ
    if (reason === undefined) return;
    act(() => bounceCheque(c.id, reason), "บันทึกเช็คเด้งแล้ว · คืนยอดหนี้ลูกค้า");
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-4",
        c.status === "PENDING" && "border-warning/40",
        c.status === "BOUNCED" && "border-danger/40 bg-danger/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{c.customerName}</span>
            <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full", STATUS_PILL[c.status])}>
              {STATUS_LABEL[c.status]}
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1">
              <Landmark className="size-3" /> {c.bank} · เลขที่ {c.chequeNumber}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1",
                overdue ? "text-danger font-medium" : dueSoon ? "text-warning font-medium" : "",
              )}
            >
              <Clock className="size-3" /> ถึงกำหนด {bkkDate(c.dueDate)}
              {overdue ? " (เลยกำหนด)" : dueSoon ? ` (อีก ${Math.max(0, daysToDue)} วัน)` : ""}
            </span>
          </div>
          {c.status === "BOUNCED" && c.bouncedReason && (
            <div className="text-[11px] text-danger mt-1">เหตุผล: {c.bouncedReason}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold tabular-nums font-[family-name:var(--font-plex-mono)]">
            {formatBaht(c.amount)}
          </div>
        </div>
      </div>

      {c.status === "PENDING" && (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            loading={pending}
            onClick={() => act(() => clearCheque(c.id), "บันทึกขึ้นเงินสำเร็จ")}
          >
            <Check className="size-4" /> ขึ้นเงินสำเร็จ
          </Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={onBounce}>
            <AlertTriangle className="size-4" /> เช็คเด้ง
          </Button>
        </div>
      )}
      {c.status === "CLEARED" && (
        <div className="flex gap-2 mt-3">
          {/* เช็คที่ขึ้นเงินแล้วยังเด้งย้อนหลังได้ (ธนาคารเรียกคืน) → คืนยอดหนี้ */}
          <Button size="sm" variant="outline" disabled={pending} onClick={onBounce}>
            <AlertTriangle className="size-4" /> แจ้งเด้งย้อนหลัง
          </Button>
        </div>
      )}
    </div>
  );
}

function AddForm({
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
      const r = await addCheque(fd);
      if (r.ok) {
        toast.success("เพิ่มเช็คแล้ว");
        onDone();
      } else {
        toast.error(r.error ?? "เพิ่มเช็คไม่สำเร็จ");
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
        <span className="text-zinc-500 text-xs">เลขที่เช็ค</span>
        <input
          name="chequeNumber"
          required
          placeholder="เช่น 0012345"
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="text-zinc-500 text-xs">ธนาคาร</span>
        <input
          name="bank"
          required
          placeholder="เช่น กสิกรไทย"
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        />
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
        <span className="text-zinc-500 text-xs">วันที่ถึงกำหนด</span>
        <input
          name="dueDate"
          type="date"
          required
          defaultValue={bkkToday()}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        />
      </label>

      <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
        <Button type="submit" loading={pending}>
          เพิ่มเช็ค
        </Button>
      </div>
    </form>
  );
}
