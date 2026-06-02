"use client";

// OWN-BILLS-03 (2026-06-03) · explicit "ยกเลิกการจ่าย" verb.
// Earlier, clearing the paidAt field in the edit form silently un-marked a
// PAID bill. updateBill now skips paidAt when blank · this component is the
// ONLY UI path that reverts PAID → PENDING, with a 2-step confirm + audit
// trail entry "bill.unmark_paid".

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { unmarkPaid } from "../../actions";

export function UnmarkPaidForm({ billId }: { billId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("id", billId);
    startTransition(async () => {
      const result = await unmarkPaid(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-3 w-full rounded-md border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
      >
        ยกเลิกการจ่าย (เอาเครื่องหมายจ่ายแล้วออก)
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <p className="text-xs font-medium text-amber-900">
        ยืนยันยกเลิกการจ่าย? · บิลจะกลับไปเป็น &quot;รอจ่าย&quot;
      </p>
      {error ? (
        <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          ไม่ใช่ · เก็บไว้
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-md bg-amber-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {isPending ? "กำลังยกเลิก…" : "ยืนยัน"}
        </button>
      </div>
    </form>
  );
}
