"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";

export async function clearDepositReview(formData: FormData) {
  const session = await requireRole("OFFICE");
  const depositId = zUUID().safeParse(formData.get("depositId"));
  if (!depositId.success) redirect("/chairops/review-queue?error=invalid");

  const orgId = session.user.orgId;
  const deposit = await prisma.chairopsCashDeposit.findFirst({
    where: { id: depositId.data, orgId },
    select: { id: true, branchId: true, requiresReview: true },
  });
  if (!deposit) redirect("/chairops/review-queue?error=notfound");
  if (!deposit.requiresReview) {
    revalidatePath("/chairops/review-queue");
    redirect("/chairops/review-queue");
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
  redirect("/chairops/review-queue");
}
