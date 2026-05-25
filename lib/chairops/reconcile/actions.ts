"use server";

// Reconcile lib-level server actions (W2 claude-design Phase 2).
//
// Why this file lives in `lib/` (not `app/(admin)/chairops/reconcile/actions.ts`):
// the page-level `actions.ts` already owns mutations that share `actions` server
// fields (disputeCollection / requestWriteOff / approve / reject). This file
// is a thin server-action layer for the redesigned `(office)/reconcile` UI to
// invoke (e.g. the "recompute drift for this branch" button in the detail
// header). New W2 actions land here so we don't touch the existing
// reconcile/actions.ts that BR15 chain depends on.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/chairops/auth/session";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { writeAudit } from "@/lib/chairops/audit/log";

// TODO[claude-design]: Wave 2 · expand to optionally re-evaluate alerts after
// recompute so the right-rail alert badge refreshes without a second call.
// Today the page already refetches alerts on revalidate · safe enough for pilot.
export async function recomputeDriftForBranchAction(
  branchId: string,
): Promise<{ ok: true; driftAmount: number } | { ok: false; error: string }> {
  if (!branchId || typeof branchId !== "string") {
    return { ok: false, error: "missing branchId" };
  }
  const session = await requireRole("OFFICE");
  try {
    const snap = await recomputeDriftForBranch(branchId);
    await writeAudit({
      userId: session.user.id,
      action: "drift.recompute_manual",
      entity: "Drift",
      entityId: branchId,
      newValue: { driftAmount: snap.driftAmount, status: snap.status },
    });
    revalidatePath("/chairops/reconcile");
    revalidatePath(`/chairops/reconcile/${branchId}`);
    return { ok: true, driftAmount: snap.driftAmount };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "ไม่สามารถ recompute ได้",
    };
  }
}
