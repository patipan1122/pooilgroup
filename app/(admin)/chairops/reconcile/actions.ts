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
import { canWriteOff, canSelfApproveWriteOff } from "@/lib/chairops/auth/role-guards";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import { pushBranchDepositsToLedger } from "@/lib/chairops/reconcile/ledger-push";
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
  // CEO 2026-06-02 P0 IDOR fix · scope lookup + update to the session org so
  // a forged collectionId from another tenant can never be disputed (and so
  // the redirect doesn't leak a foreign branchId either).
  const orgId = session.user.orgId;
  const c = await prisma.chairopsCashCollection.findFirst({
    where: { id: collectionId, orgId, deletedAt: null },
  });
  if (!c) redirect(`/chairops/reconcile?error=${encodeURIComponent("ไม่พบรายการ")}`);

  // We don't have a "disputed" column in schema; we use notes + audit.
  // Wave-0 fix: note update + audit atomic
  const stampedNote = `[dispute ${new Date().toISOString()} by ${session.user.displayName}] ${reason}`;
  await prisma.$transaction(async (tx) => {
    // updateMany w/ composite (orgId, id) — IDOR-safe even though we already
    // re-checked above; defense-in-depth against TOCTOU between findFirst
    // and update.
    await tx.chairopsCashCollection.updateMany({
      where: { id: collectionId, orgId, deletedAt: null },
      data: { notes: c!.notes ? `${c!.notes}\n${stampedNote}` : stampedNote },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "cash_collection.dispute",
        entity: "CashCollection",
        entityId: collectionId,
        oldValue: { notes: c!.notes },
        newValue: { notes: `${c!.notes ?? ""}\n${stampedNote}`, reason },
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
  // "ตั้งต้นใหม่" support (CEO 2026-06-25): a write-off settles drift up to
  // `effectiveDate` and carries a direction (ขาด/เกิน). `amount` is a positive
  // magnitude; the sign lives in `direction`.
  direction: z.enum(["SHORT", "OVER"]).default("SHORT"),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง").optional(),
});

export async function requestWriteOff(formData: FormData) {
  const session = await requireRole("OFFICE");
  const parsed = requestSchema.safeParse({
    branchId: formData.get("branchId"),
    amount: Number(formData.get("amount")),
    reason: formData.get("reason"),
    direction: formData.get("direction") ?? "SHORT",
    effectiveDate: formData.get("effectiveDate") ?? undefined,
  });
  if (!parsed.success) {
    const branchId = String(formData.get("branchId") ?? "");
    redirect(
      `/chairops/reconcile/${branchId}?error=${encodeURIComponent(parsed.error.issues[0].message)}`
    );
  }
  const { branchId, amount, reason, direction } = parsed.data;
  // ตั้งต้นวันอนาคตไม่ได้ · default = วันนี้ (Bangkok day grain).
  const todayBkk = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const effDay = parsed.data.effectiveDate ?? todayBkk;
  if (effDay > todayBkk) {
    redirect(`/chairops/reconcile/${branchId}?error=${encodeURIComponent("ตั้งต้นวันอนาคตไม่ได้")}`);
  }
  if (amount < 1) {
    redirect(`/chairops/reconcile/${branchId}?error=${encodeURIComponent("จำนวนเงินต้องมากกว่า 0")}`);
  }
  // @db.Date round-trips at UTC midnight of the calendar date.
  const effectiveDate = new Date(`${effDay}T00:00:00.000Z`);
  // CEO 2026-06-02 P0 IDOR fix · branch must belong to the session org. The
  // previous lookup keyed on id alone allowed a forged branchId from another
  // tenant to land a PENDING write-off + alert against tenant B's branch.
  const sessionOrgId = session.user.orgId;
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: sessionOrgId },
    select: { id: true, name: true, orgId: true },
  });
  if (!branch) redirect(`/chairops/reconcile?error=${encodeURIComponent("ไม่พบสาขา")}`);

  const kindLabel = direction === "OVER" ? "ตัดเงินเกิน" : "ตัดเงินขาด";

  // Wave-0 fix: write-off + alert + audit atomic in one tx
  const wo = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsWriteOff.create({
      data: {
        orgId: branch!.orgId,
        branchId,
        amount,
        reason,
        direction,
        effectiveDate,
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
        title: `ขอ${kindLabel} ${amount.toLocaleString()} ฿ ที่ ${branch!.name} (ตั้งต้น ${effDay})`,
        message: `โดย ${session.user.displayName} · เหตุผล: ${reason}`,
        contextJson: { writeOffId: row.id, amount, direction, effectiveDate: effDay },
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "write_off.request",
        entity: "WriteOff",
        entityId: row.id,
        newValue: { branchId, amount, reason, direction, effectiveDate: effDay },
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
  if (!writeOffId) redirect(`/chairops/write-offs?error=${encodeURIComponent("missing id")}`);
  // CEO 2026-06-02 P0 IDOR fix · approving a write-off must be scoped to the
  // session org so a forged id cannot APPROVE another tenant's pending write
  // (which would also fool that tenant's drift engine).
  const orgId = session.user.orgId;
  const wo = await prisma.chairopsWriteOff.findFirst({
    where: { id: writeOffId, orgId },
  });
  if (!wo) redirect(`/chairops/write-offs?error=${encodeURIComponent("ไม่พบรายการ")}`);
  if (wo.status !== "PENDING") redirect(`/chairops/write-offs?error=${encodeURIComponent("รายการนี้ปิดไปแล้ว")}`);

  // Privilege check: <500 needs MANAGER, >=500 needs CEO
  if (!canWriteOff(session.user, wo.amount)) {
    redirect(
      `/chairops/write-offs?error=${encodeURIComponent(
        `role ${session.user.role} อนุมัติยอด ${wo.amount.toLocaleString()} ฿ ไม่ได้ (>500 ต้อง CEO · <500 ต้อง MANAGER ขึ้นไป)`
      )}`
    );
  }
  // BR7 maker-checker: ผู้ขอห้ามอนุมัติเอง — ยกเว้น superadmin (ADMIN) ผู้อนุมัติคนเดียว
  // (CEO 2026-06-25). การอนุมัติเองจะถูก stamp selfApproved=true ใน audit.
  const isSelfApprove = wo.makerId === session.user.id;
  if (isSelfApprove && !canSelfApproveWriteOff(session.user)) {
    redirect(`/chairops/write-offs?error=${encodeURIComponent("ห้ามอนุมัติ write-off ที่ตัวเองขอ (maker/checker)")}`);
  }

  // Wave-0 fix: approve + audit atomic. CEO 2026-06-02 P0 IDOR fix: composite
  // (orgId, id) on the update guards against TOCTOU. status:"PENDING" on the
  // update makes approve idempotent — a double-click / racing 2nd approver
  // touches 0 rows (no double drift recompute · no overwritten approver).
  let touched = 0;
  await prisma.$transaction(async (tx) => {
    const res = await tx.chairopsWriteOff.updateMany({
      where: { id: writeOffId, orgId, status: "PENDING" },
      data: {
        status: "APPROVED",
        approverId: session.user.id,
        approverAt: new Date(),
      },
    });
    touched = res.count;
    if (touched === 0) return;

    // Note: WRITE_OFF_REQUESTED alerts are resolved manually on /alerts (we don't
    // do JSON-path filtering here to keep the action lean + Prisma-version-safe).

    await writeAudit(
      {
        userId: session.user.id,
        action: "write_off.approve",
        entity: "WriteOff",
        entityId: writeOffId,
        oldValue: { status: wo.status },
        newValue: { status: "APPROVED", amount: wo.amount, selfApproved: isSelfApprove },
      },
      tx,
    );
  });
  if (touched === 0) redirect(`/chairops/write-offs?error=${encodeURIComponent("ไม่พบรายการ")}`);

  // Drift is computed from POS − deposits. Write-offs are tracked but do NOT
  // adjust the deposit total automatically (CEO discretion in v0.2). Still
  // recompute + re-evaluate alerts so the dashboard refreshes.
  await recomputeDriftForBranch(wo.branchId);
  await evaluateAndEmitAlerts(session.user.orgId);

  revalidatePath("/chairops/write-offs");
  revalidatePath(`/chairops/reconcile/${wo.branchId}`);
  // sidebar cumDrift + exec dashboard read the same drift → refresh both (P1-9)
  revalidatePath("/chairops/reconcile");
  revalidatePath("/chairops");
  redirect(`/chairops/write-offs?approved=${writeOffId}`);
}

// ----- Reject write-off -----

export async function rejectWriteOff(formData: FormData) {
  const session = await requireRole("OFFICE");
  const writeOffId = String(formData.get("writeOffId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!writeOffId) redirect(`/chairops/write-offs?error=${encodeURIComponent("missing id")}`);
  if (reason.length < 3) redirect(`/chairops/write-offs?error=${encodeURIComponent("เหตุผลสั้นเกินไป")}`);

  // CEO 2026-06-02 P0 IDOR fix · see approveWriteOff note.
  const orgId = session.user.orgId;
  const wo = await prisma.chairopsWriteOff.findFirst({
    where: { id: writeOffId, orgId },
  });
  if (!wo) redirect(`/chairops/write-offs?error=${encodeURIComponent("ไม่พบรายการ")}`);
  if (wo.status !== "PENDING") redirect(`/chairops/write-offs?error=${encodeURIComponent("ปิดไปแล้ว")}`);
  if (!canWriteOff(session.user, wo.amount)) {
    redirect(
      `/chairops/write-offs?error=${encodeURIComponent(
        `role ${session.user.role} ไม่มีสิทธิ์ตัดสินรายการนี้`
      )}`
    );
  }

  // Wave-0 fix: reject + audit atomic. CEO 2026-06-02 P0 IDOR fix: composite
  // (orgId, id) on the update.
  let touched = 0;
  await prisma.$transaction(async (tx) => {
    const res = await tx.chairopsWriteOff.updateMany({
      where: { id: writeOffId, orgId },
      data: {
        status: "REJECTED",
        approverId: session.user.id,
        approverAt: new Date(),
        notes: reason,
      },
    });
    touched = res.count;
    if (touched === 0) return;

    await writeAudit(
      {
        userId: session.user.id,
        action: "write_off.reject",
        entity: "WriteOff",
        entityId: writeOffId,
        oldValue: { status: wo.status },
        newValue: { status: "REJECTED", reason },
      },
      tx,
    );
  });
  if (touched === 0) redirect(`/chairops/write-offs?error=${encodeURIComponent("ไม่พบรายการ")}`);

  revalidatePath("/chairops/write-offs");
  revalidatePath(`/chairops/reconcile/${wo.branchId}`);
  redirect(`/chairops/write-offs?rejected=${writeOffId}`);
}

// ----- Reconcile bridge (CEO 2026-08-15): ตั้งค่าบริษัท/บัญชีธนาคารของสาขา
// + ปุ่มส่งยอดฝากเข้า ledger_revenue_entry (bank-recon) — ดู lib/chairops/
// reconcile/ledger-push.ts สำหรับกลไกกันส่งซ้ำ -----

const reconcileConfigSchema = z.object({
  branchId: zUUID(),
  companyId: zUUID(),
  bankAccountId: zUUID(),
});

export async function saveReconcileAccountConfig(formData: FormData) {
  const session = await requireRole("OFFICE");
  const parsed = reconcileConfigSchema.safeParse({
    branchId: formData.get("branchId"),
    companyId: formData.get("companyId"),
    bankAccountId: formData.get("bankAccountId"),
  });
  if (!parsed.success) {
    const branchId = String(formData.get("branchId") ?? "");
    redirect(
      `/chairops/reconcile/${branchId}?error=${encodeURIComponent("กรุณาเลือกบริษัทและบัญชีธนาคารให้ครบ")}`
    );
  }
  const { branchId, companyId, bankAccountId } = parsed.data;
  const orgId = session.user.orgId;
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId },
    select: { reconcileCompanyId: true, reconcileBankAccountId: true },
  });
  if (!branch) redirect(`/chairops/reconcile?error=${encodeURIComponent("ไม่พบสาขา")}`);

  await prisma.$transaction(async (tx) => {
    await tx.chairopsBranch.updateMany({
      where: { id: branchId, orgId },
      data: { reconcileCompanyId: companyId, reconcileBankAccountId: bankAccountId },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "branch.reconcile_account.save",
        entity: "ChairopsBranch",
        entityId: branchId,
        oldValue: {
          reconcileCompanyId: branch!.reconcileCompanyId,
          reconcileBankAccountId: branch!.reconcileBankAccountId,
        },
        newValue: { companyId, bankAccountId },
      },
      tx,
    );
  });

  revalidatePath(`/chairops/reconcile/${branchId}`);
  redirect(`/chairops/reconcile/${branchId}?reconcileConfigSaved=1`);
}

const sendDepositsSchema = z.object({ branchId: zUUID() });

export async function sendDepositsToReconcile(formData: FormData) {
  const session = await requireRole("OFFICE");
  const parsed = sendDepositsSchema.safeParse({ branchId: formData.get("branchId") });
  if (!parsed.success) {
    redirect(`/chairops/reconcile?error=${encodeURIComponent("ข้อมูลไม่ถูกต้อง")}`);
  }
  const { branchId } = parsed.data;
  const orgId = session.user.orgId;

  const result = await pushBranchDepositsToLedger(orgId, branchId);

  await writeAudit({
    userId: session.user.id,
    action: "chairops_deposit.send_to_ledger",
    entity: "ChairopsBranch",
    entityId: branchId,
    newValue: result,
  });

  if (!result.ok) {
    redirect(`/chairops/reconcile/${branchId}?error=${encodeURIComponent(result.error ?? "ส่งไม่สำเร็จ")}`);
  }

  revalidatePath(`/chairops/reconcile/${branchId}`);
  redirect(
    `/chairops/reconcile/${branchId}?reconcileSent=${result.inserted}&reconcileSkippedReview=${result.pendingReviewSkipped}`
  );
}
