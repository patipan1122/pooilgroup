"use server";

// ChairOps Wave-1 W5 · Write-off bulk-approve stub action.
//
// Spec: /tmp/claude-design_chairops_plan.md §W5 step 3 + §4.1 (action stubs)
//
// Single-row approve / reject / request live in `app/(admin)/chairops/reconcile/actions.ts`
// (wave-0 wrapped + audit + drift-recompute already in place). We must NOT
// modify those. This file adds ONE new bulk helper for the sticky-bottom action
// bar on /chairops/write-offs (BR3 "<500 mgr" auto-approve fast lane).
//
// BR15 atomic chain (write-off → drift recompute → alert resolve) is NOT yet
// DB-level cascade — we still call the existing `recomputeDriftForBranch` per
// branch after the TX commits, same as `approveWriteOff`. The atomic
// 1-TX cascade is deferred to Wave 2 (see TODO[claude-design] below).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { canWriteOff } from "@/lib/chairops/auth/role-guards";
import { writeAudit } from "@/lib/chairops/audit/log";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";

const BULK_CAP_BAHT = 500; // BR3 fast lane: <500 = MANAGER, ≥500 = CEO solo

/**
 * Bulk-approve write-offs whose amount < BULK_CAP_BAHT.
 *
 * Accepts FormData with repeated `writeOffIds[]` entries. Any selected row that
 * fails the maker-checker (self-approve) or threshold (≥500 needs CEO) guard
 * is skipped silently — the UI is expected to only offer rows the actor can
 * legally approve (the sticky bar disables the button otherwise).
 *
 * TODO[claude-design]: Wave-2 atomic BR15 chain
 *   - Move drift-recompute + alert-resolve INTO the same $transaction so a
 *     partial failure rolls back the whole batch (BA Phase 3 BR15 spec).
 *   - Currently we follow the existing single-row pattern (TX = update + audit,
 *     drift/alerts recomputed post-commit) for consistency with `approveWriteOff`.
 */
export async function bulkApproveWriteOffsAction(formData: FormData) {
  const session = await requireRole("MANAGER"); // bulk fast lane = MANAGER+ only
  const rawIds = formData
    .getAll("writeOffIds[]")
    .map((v) => String(v))
    .filter(Boolean);

  if (rawIds.length === 0) {
    redirect(
      `/chairops/write-offs?error=${encodeURIComponent("ไม่ได้เลือกรายการ")}`,
    );
  }

  const rows = await prisma.chairopsWriteOff.findMany({
    where: { id: { in: rawIds }, status: "PENDING" },
    select: { id: true, branchId: true, amount: true, makerId: true, status: true },
  });

  const eligible = rows.filter(
    (w) =>
      w.amount < BULK_CAP_BAHT &&
      w.makerId !== session.user.id &&
      canWriteOff(session.user, w.amount),
  );

  if (eligible.length === 0) {
    redirect(
      `/chairops/write-offs?error=${encodeURIComponent(
        "ไม่มีรายการที่อนุมัติได้ (อาจเป็นรายการของตัวเอง · ยอด ≥ 500 · หรือปิดไปแล้ว)",
      )}`,
    );
  }

  // Per-row tx so a single bad row doesn't roll back the rest. (Wave 2 will
  // switch to single TX once BR15 cascade ships — see TODO above.)
  const approvedAt = new Date();
  const branchIds = new Set<string>();
  for (const wo of eligible) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.chairopsWriteOff.update({
        where: { id: wo.id },
        data: {
          status: "APPROVED",
          approverId: session.user.id,
          approverAt: approvedAt,
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "write_off.bulk_approve",
          entity: "WriteOff",
          entityId: wo.id,
          oldValue: { status: "PENDING" },
          newValue: { status: updated.status, amount: wo.amount, bulk: true },
        },
        tx,
      );
    });
    branchIds.add(wo.branchId);
  }

  // Post-commit BR15 chain (Wave-1 best-effort)
  for (const branchId of branchIds) {
    await recomputeDriftForBranch(branchId);
  }
  await evaluateAndEmitAlerts(session.user.orgId);

  revalidatePath("/chairops/write-offs");
  redirect(`/chairops/write-offs?approved=${eligible.length}`);
}
