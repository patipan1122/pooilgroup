"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";

// CEO 2026-09-22: also callable from the reconcile Ledger tab's slip chip
// (not just the dedicated review-queue page) — `returnTo` lets the caller
// land back where they were instead of always jumping to /review-queue.
// Validated as a same-origin chairops path (never a bare redirect() on raw
// form input) to avoid an open-redirect via a tampered form field.
function safeReturnTo(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  return /^\/chairops\/[a-zA-Z0-9/_-]*$/.test(raw) ? raw : null;
}

export async function clearDepositReview(formData: FormData) {
  const session = await requireRole("OFFICE");
  const depositId = zUUID().safeParse(formData.get("depositId"));
  const returnTo = safeReturnTo(formData.get("returnTo")) ?? "/chairops/review-queue";
  if (!depositId.success) redirect(`${returnTo}?error=invalid`);

  const orgId = session.user.orgId;
  const deposit = await prisma.chairopsCashDeposit.findFirst({
    where: { id: depositId.data, orgId },
    select: { id: true, branchId: true, requiresReview: true },
  });
  if (!deposit) redirect(`${returnTo}?error=notfound`);
  if (!deposit.requiresReview) {
    revalidatePath(returnTo);
    redirect(returnTo);
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsCashDeposit.updateMany({
      where: { id: depositId.data, orgId },
      data: { requiresReview: false },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "cash_deposit.review_cleared",
        entity: "CashDeposit",
        entityId: depositId.data,
        oldValue: { requiresReview: true },
        newValue: { requiresReview: false },
      },
      tx,
    );
  });

  revalidatePath("/chairops/review-queue");
  revalidatePath(`/chairops/reconcile/${deposit.branchId}`);
  redirect(returnTo);
}
