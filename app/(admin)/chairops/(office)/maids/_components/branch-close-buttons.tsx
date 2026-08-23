"use client";

// Close / reopen a branch from the maid activity table (CEO 2026-08-23).
//
// CEO 2026-08-23 follow-up: "ข้อมูลทุกอย่างมันควรเชื่อมโยงกันหมด" — there was
// already a "ปิดสาขา" toggle on /chairops/reconcile (`toggleBranchClosedAction`,
// super_admin only, touches ONLY `closedAt` — a closed branch stays visible
// everywhere, muted/pinned to the bottom, so office can still settle leftover
// cash). This file used to have its OWN closeBranch/reopenBranch actions that
// also flipped `isActive`, which made a "closed" branch vanish entirely from
// dashboard/reconcile/collect instead of showing muted — a second, divergent
// close-branch mechanism no one asked for. Deleted that; both buttons now call
// the SAME shared action the reconcile page already uses, so "closed" means
// one consistent thing everywhere. No confirm dialog either, matching the
// reconcile sidebar's existing pattern (a plain immediate toggle).

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toggleBranchClosedAction } from "@/lib/chairops/reconcile/actions";

function useToggleClosed(branchName: string, closed: boolean) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(branchId: string) {
    startTransition(async () => {
      const res = await toggleBranchClosedAction(branchId, closed);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(closed ? `ปิดสาขา "${branchName}" แล้ว` : `เปิดสาขา "${branchName}" ใหม่แล้ว`);
      router.refresh();
    });
  }

  return { pending, toggle };
}

export function CloseBranchButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { pending, toggle } = useToggleClosed(branchName, true);
  return (
    <button
      type="button"
      onClick={() => toggle(branchId)}
      disabled={pending}
      className="ml-2 inline-flex items-center rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
    >
      ปิดสาขา
    </button>
  );
}

export function ReopenBranchButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { pending, toggle } = useToggleClosed(branchName, false);
  return (
    <button
      type="button"
      onClick={() => toggle(branchId)}
      disabled={pending}
      className="ml-2 inline-flex items-center rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
    >
      เปิดสาขาใหม่
    </button>
  );
}
