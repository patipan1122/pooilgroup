"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { markPaid } from "../../actions";
import { SlipUploader } from "./slip-uploader";
import { baht } from "@/lib/chairops/utils/format";

interface Props {
  billId: string;
  defaultPaidAt: string; // YYYY-MM-DD
  defaultPaidAmount: number;
  branchSlug: string;
}

export function MarkPaidForm({
  billId,
  defaultPaidAt,
  defaultPaidAmount,
  branchSlug,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  // BA-03 (2026-06-03) · live diff vs bill amount so partial-pay/overpay
  // are visible BEFORE submit · server guards reject > 5% overpay.
  const billAmount = defaultPaidAmount;
  const [paidAmount, setPaidAmount] = useState<number>(defaultPaidAmount);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("id", billId);
    if (slipUrl) fd.set("slipPhotoUrl", slipUrl);
    startTransition(async () => {
      const result = await markPaid(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-emerald-900">
            วันที่จ่าย
          </span>
          <input
            type="date"
            name="paidAt"
            defaultValue={defaultPaidAt}
            required
            className="w-full rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-emerald-900">
            ยอดที่จ่าย
          </span>
          <input
            type="number"
            name="paidAmount"
            step="0.01"
            min="0"
            defaultValue={defaultPaidAmount}
            onChange={(e) =>
              setPaidAmount(Number(e.currentTarget.value) || 0)
            }
            className="w-full rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      </div>

      {/* BA-03 (2026-06-03) · live diff feedback */}
      {paidAmount > 0
        ? (() => {
            const overpay = paidAmount > billAmount * 1.05;
            const partial = paidAmount < billAmount * 0.98;
            const diff = billAmount - paidAmount;
            if (overpay) {
              return (
                <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                  ⚠️ ยอดที่จ่าย {baht(paidAmount)} เกินยอดบิล{" "}
                  {baht(billAmount)}
                </p>
              );
            }
            if (partial) {
              return (
                <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  💡 จ่ายบางส่วน · ส่วนต่าง {baht(diff)}
                </p>
              );
            }
            return null;
          })()
        : null}

      <SlipUploader
        branchSlug={branchSlug}
        billId={billId}
        value={slipUrl}
        onChange={setSlipUrl}
      />

      {error ? (
        <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {isPending ? "กำลังบันทึก…" : "ยืนยันว่าจ่ายแล้ว"}
      </button>
    </form>
  );
}
