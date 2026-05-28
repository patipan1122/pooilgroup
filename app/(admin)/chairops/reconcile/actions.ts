"use server";

// Reconcile actions — dispute collection · request/approve/reject write-off
//
// Per spec:
//   - Write-off > 500฿ requires CEO approval (canWriteOff)
//   - Office can request · MANAGER (<500) / CEO (>=500) approves
//   - All mutations audit-logged
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { canWriteOff } from "@/lib/chairops/auth/role-guards";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import { ChairopsAlertKind, ChairopsAlertLevel } from "@/lib/generated/prisma/enums";
import { zUUID, zBaht } from "@/lib/chairops/schemas/zod-helpers";

// ----- Dispute a maid's cash collection -----

const disputeSchema = z.object({
  collectionId: zUUID(),
  reason: z.string().min(3, "เหตุผลสั้นเกินไป").max(500),
});

export async function disputeCollection(formData: FormData) {
  const session = await requireRole("OFFICE");
  const parsed = disputeSchema.safeParse({
    collectionId: formData.get("collectionId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect(`/chairops/reconcile?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }
  const { collectionId, reason } = parsed.data;
  const c = await prisma.chairopsCashCollection.findUnique({ where: { id: collectionId } });
  if (!c) redirect(`/reconcile?error=${encodeURIComponent("ไม่พบรายการ")}`);

  // We don't have a "disputed" column in schema; we use notes + audit.
  // Wave-0 fix: note update + audit atomic
  const stampedNote = `[dispute ${new Date().toISOString()} by ${session.user.displayName}] ${reason}`;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.chairopsCashCollection.update({
      where: { id: collectionId },
      data: { notes: c!.notes ? `${c!.notes}\n${stampedNote}` : stampedNote },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "cash_collection.dispute",
        entity: "CashCollection",
        entityId: collectionId,
        oldValue: { notes: c!.notes },
        newValue: { notes: updated.notes, reason },
      },
      tx,
    );
  });
  revalidatePath(`/chairops/reconcile/${c!.branchId}`);
  redirect(`/chairops/reconcile/${c!.branchId}?disputed=${collectionId}`);
}

// ----- Request a write-off (creates PENDING WriteOff + WRITE_OFF_REQUESTED alert) -----

const requestSchema = z.object({
  branchId: zUUID(),
  amount: zBaht(),
  reason: z.string().min(5, "เหตุผลสั้นเกินไป").max(500),
});

export async function requestWriteOff(formData: FormData) {
  const session = await requireRole("OFFICE");
  const parsed = requestSchema.safeParse({
    branchId: formData.get("branchId"),
    amount: Number(formData.get("amount")),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const branchId = String(formData.get("branchId") ?? "");
    redirect(
      `/chairops/reconcile/${branchId}?error=${encodeURIComponent(parsed.error.issues[0].message)}`
    );
  }
  const { branchId, amount, reason } = parsed.data;
  // W0: pull orgId from the branch so both write-off + alert + audit stamp
  // the correct tenant. session.user.orgId would work too but reading from
  // the branch row guards against a stale session pointing at the wrong org.
  const branch = await prisma.chairopsBranch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, orgId: true },
  });
  if (!branch) redirect(`/reconcile?error=${encodeURIComponent("ไม่พบสาขา")}`);

  // Wave-0 fix: write-off + alert + audit atomic in one tx
  const wo = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsWriteOff.create({
      data: {
        orgId: branch!.orgId,
        branchId,
        amount,
        reason,
        makerId: session.user.id,
        status: "PENDING",
      },
    });

    // Emit alert so CEO/manager sees it in the queue
    await tx.chairopsAlert.create({
      data: {
        orgId: branch!.orgId,
        branchId,
        kind: ChairopsAlertKind.WRITE_OFF_REQUESTED,
        level: amount >= 500 ? ChairopsAlertLevel.WARN : ChairopsAlertLevel.INFO,
        title: `ขอตัดเงินขาด ${amount.toLocaleString()} ฿ ที่ ${branch!.name}`,
        message: `โดย ${session.user.displayName} · เหตุผล: ${reason}`,
        contextJson: { writeOffId: row.id, amount },
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "write_off.request",
        entity: "WriteOff",
        entityId: row.id,
        newValue: { branchId, amount, reason },
      },
      tx,
    );

    return row;
  });

  revalidatePath("/chairops/write-offs");
  revalidatePath(`/chairops/reconcile/${branchId}`);
  redirect(`/chairops/write-offs?requested=${wo.id}`);
}

// ----- Approve write-off -----

export async function approveWriteOff(formData: FormData) {
  const session = await requireRole("OFFICE"); // hierarchy enforced via canWriteOff below
  const writeOffId = String(formData.get("writeOffId") ?? "");
  if (!writeOffId) redirect(`/write-offs?error=${encodeURIComponent("missing id")}`);
  const wo = await prisma.chairopsWriteOff.findUnique({ where: { id: writeOffId } });
  if (!wo) redirect(`/write-offs?error=${encodeURIComponent("ไม่พบรายการ")}`);
  if (wo.status !== "PENDING") redirect(`/write-offs?error=${encodeURIComponent("รายการนี้ปิดไปแล้ว")}`);

  // Privilege check: <500 needs MANAGER, >=500 needs CEO
  if (!canWriteOff(session.user, wo.amount)) {
    redirect(
      `/chairops/write-offs?error=${encodeURIComponent(
        `role ${session.user.role} อนุมัติยอด ${wo.amount.toLocaleString()} ฿ ไม่ได้ (>500 ต้อง CEO · <500 ต้อง MANAGER ขึ้นไป)`
      )}`
    );
  }
  if (wo.makerId === session.user.id) {
    redirect(`/write-offs?error=${encodeURIComponent("ห้ามอนุมัติ write-off ที่ตัวเองขอ (maker/checker)")}`);
  }

  // Wave-0 fix: approve + audit atomic
  await prisma.$transaction(async (tx) => {
    const updated = await tx.chairopsWriteOff.update({
      where: { id: writeOffId },
      data: {
        status: "APPROVED",
        approverId: session.user.id,
        approverAt: new Date(),
      },
    });

    // Note: WRITE_OFF_REQUESTED alerts are resolved manually on /alerts (we don't
    // do JSON-path filtering here to keep the action lean + Prisma-version-safe).

    await writeAudit(
      {
        userId: session.user.id,
        action: "write_off.approve",
        entity: "WriteOff",
        entityId: writeOffId,
        oldValue: { status: wo.status },
        newValue: { status: updated.status, amount: wo.amount },
      },
      tx,
    );
  });

  // Drift is computed from POS − deposits. Write-offs are tracked but do NOT
  // adjust the deposit total automatically (CEO discretion in v0.2). Still
  // recompute + re-evaluate alerts so the dashboard refreshes.
  await recomputeDriftForBranch(wo.branchId);
  await evaluateAndEmitAlerts(session.user.orgId);

  revalidatePath("/chairops/write-offs");
  revalidatePath(`/chairops/reconcile/${wo.branchId}`);
  redirect(`/chairops/write-offs?approved=${writeOffId}`);
}

// ----- Reject write-off -----

export async function rejectWriteOff(formData: FormData) {
  const session = await requireRole("OFFICE");
  const writeOffId = String(formData.get("writeOffId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!writeOffId) redirect(`/write-offs?error=${encodeURIComponent("missing id")}`);
  if (reason.length < 3) redirect(`/write-offs?error=${encodeURIComponent("เหตุผลสั้นเกินไป")}`);

  const wo = await prisma.chairopsWriteOff.findUnique({ where: { id: writeOffId } });
  if (!wo) redirect(`/write-offs?error=${encodeURIComponent("ไม่พบรายการ")}`);
  if (wo.status !== "PENDING") redirect(`/write-offs?error=${encodeURIComponent("ปิดไปแล้ว")}`);
  if (!canWriteOff(session.user, wo.amount)) {
    redirect(
      `/chairops/write-offs?error=${encodeURIComponent(
        `role ${session.user.role} ไม่มีสิทธิ์ตัดสินรายการนี้`
      )}`
    );
  }

  // Wave-0 fix: reject + audit atomic
  await prisma.$transaction(async (tx) => {
    const updated = await tx.chairopsWriteOff.update({
      where: { id: writeOffId },
      data: {
        status: "REJECTED",
        approverId: session.user.id,
        approverAt: new Date(),
        notes: reason,
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "write_off.reject",
        entity: "WriteOff",
        entityId: writeOffId,
        oldValue: { status: wo.status },
        newValue: { status: updated.status, reason },
      },
      tx,
    );
  });

  revalidatePath("/chairops/write-offs");
  revalidatePath(`/chairops/reconcile/${wo.branchId}`);
  redirect(`/chairops/write-offs?rejected=${writeOffId}`);
}
