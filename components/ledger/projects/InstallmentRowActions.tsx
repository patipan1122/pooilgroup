"use client";

// InstallmentRowActions — ลบงวด (deleteInstallmentAction) + ย้อน "ยังไม่จ่าย" (revertInstallmentAction).
// revert โชว์เฉพาะงวดที่จ่ายแล้ว/รอสลิป/สลิปหลุด (มี anchor ให้ถอน). gate: canManage · server backstop.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Undo2 } from "lucide-react";
import {
  deleteInstallmentAction,
  revertInstallmentAction,
} from "@/app/(admin)/ledger/_actions";
import type { InstallmentDisplayStatus } from "@/lib/ledger/installments";

export function InstallmentRowActions({
  installmentId,
  status,
}: {
  installmentId: string;
  status: InstallmentDisplayStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const canRevert =
    status === "paid" || status === "paid_pending_slip" || status === "broken";

  function del() {
    if (!window.confirm("ลบงวดนี้? (ลบแล้วเอาคืนไม่ได้)")) return;
    setErr(null);
    startTransition(async () => {
      const res = await deleteInstallmentAction(installmentId);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "ลบไม่สำเร็จ");
    });
  }

  function revert() {
    if (!window.confirm('ย้อนงวดกลับเป็น "ยังไม่จ่าย"? (ถอดบิลที่ผูกไว้)')) return;
    setErr(null);
    startTransition(async () => {
      const res = await revertInstallmentAction(installmentId);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "ย้อนไม่สำเร็จ");
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      {canRevert && (
        <button
          type="button"
          onClick={revert}
          disabled={pending}
          aria-label="ย้อนเป็นยังไม่จ่าย"
          title="ย้อนเป็นยังไม่จ่าย"
          className="press grid size-8 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Undo2 className="size-4" aria-hidden />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={del}
        disabled={pending}
        aria-label="ลบงวด"
        title="ลบงวด"
        className="press grid size-8 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
      {err && <span className="text-[11px] text-rose-600">{err}</span>}
    </span>
  );
}
