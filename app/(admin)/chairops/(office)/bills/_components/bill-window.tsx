"use client";

// BillWindow — the draggable "pay this bill" panel (CEO 2026-06-03).
// Opened from the bills matrix; shows the payee bank account + amount so the
// CEO can copy-paste into a banking app and mark paid in one click, all while
// the matrix stays visible behind (non-modal · compare several at once).

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Landmark,
  Loader2,
  Receipt,
  Undo2,
} from "lucide-react";

import { FloatingWindow } from "@/components/chairops/redesign/floating-window";
import { baht } from "@/lib/chairops/utils/format";
import {
  getBillDetail,
  markPaid,
  unmarkPaid,
  type BillDetailDTO,
} from "../actions";

const STATUS_META: Record<
  BillDetailDTO["status"],
  { label: string; cls: string }
> = {
  PAID: { label: "จ่ายแล้ว", cls: "bg-emerald-100 text-emerald-700" },
  PENDING: { label: "รอจ่าย", cls: "bg-amber-100 text-amber-700" },
  OVERDUE: { label: "เกินกำหนด", cls: "bg-rose-100 text-rose-700" },
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (insecure context) — no-op */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
      aria-label={`คัดลอก${label}`}
    >
      {copied ? (
        <>
          <Check className="size-3 text-emerald-600" /> คัดลอกแล้ว
        </>
      ) : (
        <>
          <Copy className="size-3" /> คัดลอก
        </>
      )}
    </button>
  );
}

export function BillWindow({
  billId,
  initialOffset = 0,
  canEdit,
  onClose,
}: {
  billId: string;
  initialOffset?: number;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [bill, setBill] = useState<BillDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Plain async (NOT wrapped in startTransition) so it can be safely awaited
  // inside a mutation's transition without nesting transitions.
  const load = useCallback(async () => {
    const res = await getBillDetail(billId);
    if (res.ok) {
      setBill(res.data ?? null);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [billId]);

  useEffect(() => {
    // fetch-on-mount: setState happens after an async server call (syncing with
    // an external system), which is a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const doMarkPaid = () => {
    setActionErr(null);
    const fd = new FormData();
    fd.set("id", billId);
    startTransition(async () => {
      const res = await markPaid(fd);
      if (!res.ok) {
        setActionErr(res.error);
        return;
      }
      router.refresh(); // refresh the matrix behind
      load();
    });
  };

  const doUnmark = () => {
    setActionErr(null);
    const fd = new FormData();
    fd.set("id", billId);
    startTransition(async () => {
      const res = await unmarkPaid(fd);
      if (!res.ok) {
        setActionErr(res.error);
        return;
      }
      router.refresh();
      load();
    });
  };

  const title = bill ? bill.branchName : "กำลังโหลด…";
  const subtitle = bill ? `${bill.categoryLabel} · ${bill.periodLabel}` : undefined;

  return (
    <FloatingWindow
      title={title}
      subtitle={subtitle}
      initialOffset={initialOffset}
      onClose={onClose}
      width={340}
    >
      {error ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : !bill ? (
        <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" /> กำลังโหลดข้อมูลบิล…
        </div>
      ) : (
        <div className="space-y-3">
          {/* status + amount */}
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_META[bill.status].cls}`}
            >
              {STATUS_META[bill.status].label}
            </span>
            <div className="text-right">
              <div className="text-lg font-bold tabular-nums text-zinc-900">
                {baht(bill.amount)}
              </div>
              <div className="text-[11px] text-zinc-500">
                กำหนด {bill.dueDateIso}
              </div>
            </div>
          </div>

          {/* payee bank account — copy to bank app */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <Landmark className="size-3.5" /> โอนไปที่
            </div>
            {bill.bankAccountTo ? (
              <div className="flex items-start justify-between gap-2">
                <span className="break-all font-mono text-sm text-zinc-900">
                  {bill.bankAccountTo}
                </span>
                <CopyButton value={bill.bankAccountTo} label="เลขบัญชี" />
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                ยังไม่ได้ใส่เลขบัญชีปลายทาง · เปิดหน้าเต็มเพื่อเพิ่ม
              </p>
            )}
            {bill.paymentTerms ? (
              <p className="mt-1.5 text-[11px] text-zinc-500">
                เงื่อนไข: {bill.paymentTerms}
              </p>
            ) : null}
          </div>

          {/* quick amount copy (exact transfer amount) */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-200 p-2.5">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                ยอดโอน
              </div>
              <div className="font-mono text-sm font-semibold text-zinc-900">
                {bill.amount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
            <CopyButton value={bill.amount.toFixed(2)} label="ยอดเงิน" />
          </div>

          {bill.notes ? (
            <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-xs text-zinc-600">
              📝 {bill.notes}
            </p>
          ) : null}

          {bill.slipPhotoUrl ? (
            <a
              href={bill.slipPhotoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
            >
              <Receipt className="size-3.5" /> ดูสลิปที่แนบ
            </a>
          ) : null}

          {actionErr ? (
            <p className="rounded-md bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
              {actionErr}
            </p>
          ) : null}

          {/* actions */}
          {canEdit ? (
            <div className="flex flex-col gap-2 pt-1">
              {bill.status === "PAID" ? (
                <button
                  type="button"
                  onClick={doUnmark}
                  disabled={pending}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  <Undo2 className="size-3.5" /> ยกเลิกการจ่าย
                  {bill.paidAtIso ? ` (${bill.paidAtIso})` : ""}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doMarkPaid}
                  disabled={pending}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  จ่ายแล้ววันนี้
                </button>
              )}
              <a
                href={`/chairops/bills/${bill.id}`}
                className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
              >
                <ExternalLink className="size-3" /> เปิดหน้าเต็ม / แก้ไข
              </a>
            </div>
          ) : (
            <a
              href={`/chairops/bills/${bill.id}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
            >
              <ExternalLink className="size-3" /> เปิดหน้าเต็ม
            </a>
          )}
        </div>
      )}
    </FloatingWindow>
  );
}
