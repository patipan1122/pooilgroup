"use client";

// Close / reopen a branch from the maid activity table (CEO 2026-08-23) —
// same confirm+toast pattern as DeleteLeaveButton in this folder.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closeBranch, reopenBranch } from "@/app/(admin)/chairops/branches/actions";

export function CloseBranchButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!window.confirm(`ปิดสาขา "${branchName}"? สาขานี้จะไม่ขึ้นในหน้าตรวจยอด/dashboard อื่นอีก`)) return;
    startTransition(async () => {
      const res = await closeBranch(branchId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`ปิดสาขา "${branchName}" แล้ว`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="ml-2 inline-flex items-center rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
    >
      ปิดสาขา
    </button>
  );
}

export function ReopenBranchButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const res = await reopenBranch(branchId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`เปิดสาขา "${branchName}" ใหม่แล้ว`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="ml-2 inline-flex items-center rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
    >
      เปิดสาขาใหม่
    </button>
  );
}
