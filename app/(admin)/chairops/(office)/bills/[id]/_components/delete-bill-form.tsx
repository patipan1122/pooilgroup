"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteBill } from "../../actions";

export function DeleteBillForm({ billId }: { billId: string }) {
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
      const result = await deleteBill(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/chairops/bills");
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-3 w-full rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
      >
        ลบบิลนี้
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <p className="text-xs font-medium text-rose-900">
        ยืนยันลบ? · กู้คืนไม่ได้
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
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-md bg-rose-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
        >
          {isPending ? "กำลังลบ…" : "ลบจริง"}
        </button>
      </div>
    </form>
  );
}
