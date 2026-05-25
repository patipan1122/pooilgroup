"use client";

// Client island · "Recompute สาขานี้" button.
// Calls the W2-added lib-level server action so the page header refreshes
// without a hard nav. Pending state shows spinner + disables click.

import { useTransition } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { recomputeDriftForBranchAction } from "@/lib/chairops/reconcile/actions";

export function RecomputeButton({ branchId }: { branchId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await recomputeDriftForBranchAction(branchId);
          if (!res.ok) {
            // Best-effort feedback · toast wiring lives in Wave 1 W4 alerts.
            // Use console for now so we don't depend on a global toaster.
            console.error("[recompute]", res.error);
          }
        });
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label="Recompute drift สำหรับสาขานี้"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCcw className="size-3.5" aria-hidden="true" />
      )}
      {pending ? "กำลังคำนวณ…" : "Recompute สาขานี้"}
    </button>
  );
}
