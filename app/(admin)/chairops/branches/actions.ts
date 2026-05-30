"use server";

// Branch admin actions — chair list management primarily.
// CEO 2026-05-30 hit "ยังไม่มีเก้าอี้ในสาขา" on the branch-collect picker for
// 29/30 branches and there was no UI to add chairs. This adds a single
// idempotent bulk-add action so office/admin can paste chair codes (one per
// line) on the branch detail page.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const addChairsInput = z.object({
  branchId: z.string().uuid(),
  // chairCodes can be comma- or newline-separated; we normalize. Empty rejected.
  codesRaw: z.string().min(1).max(8000),
});

export type AddChairsInput = z.infer<typeof addChairsInput>;

export async function addChairsToBranch(
  raw: AddChairsInput,
): Promise<ActionResult<{ inserted: number; skippedExisting: number; codes: string[] }>> {
  const session = await requireRole("OFFICE");

  const parsed = addChairsInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  }
  const { branchId, codesRaw } = parsed.data;

  // Normalize: split on commas or newlines, trim, uppercase, dedupe, length-guard.
  const codes = Array.from(
    new Set(
      codesRaw
        .split(/[,\n\r]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0 && s.length <= 40),
    ),
  );
  if (codes.length === 0) {
    return { ok: false, error: "ไม่มีรหัสเก้าอี้ที่ใช้ได้" };
  }
  if (codes.length > 200) {
    return { ok: false, error: `รหัสเยอะเกินไป (${codes.length}) · จำกัด 200/ครั้ง` };
  }

  // Verify branch belongs to this org (defense-in-depth on requireRole gate).
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: session.user.orgId },
    select: { id: true, name: true },
  });
  if (!branch) {
    return { ok: false, error: "ไม่พบสาขา" };
  }

  // Find which codes already exist (idempotent — re-adding is a no-op).
  const existing = await prisma.chairopsChair.findMany({
    where: {
      orgId: session.user.orgId,
      chairCode: { in: codes },
    },
    select: { chairCode: true, branchId: true },
  });
  const existingSet = new Set(existing.map((e) => e.chairCode));
  const toInsert = codes.filter((c) => !existingSet.has(c));

  // Reject if any of the existing codes belong to a DIFFERENT branch — chair
  // codes are unique per org and re-pointing one to a new branch should be a
  // deliberate move, not an accidental side effect of "bulk add".
  const wrongBranch = existing.filter((e) => e.branchId !== branchId);
  if (wrongBranch.length > 0) {
    return {
      ok: false,
      error: `รหัส ${wrongBranch.map((e) => e.chairCode).join(",")} อยู่สาขาอื่นแล้ว · ย้ายผ่านหน้า edit เก้าอี้`,
    };
  }

  if (toInsert.length === 0) {
    return {
      ok: true,
      data: { inserted: 0, skippedExisting: codes.length, codes },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsChair.createMany({
      data: toInsert.map((code) => ({
        orgId: session.user.orgId,
        branchId,
        chairCode: code,
        isActive: true,
      })),
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "chairs.bulk_add",
        entity: "Chair",
        entityId: branchId,
        newValue: { branchId, codes: toInsert, count: toInsert.length },
        metadata: { route: "/chairops/branches/[id]/chairs/add" },
      },
      tx,
    );
  });

  revalidatePath(`/chairops/branches/${branchId}`);
  revalidatePath("/chairops/branches");
  revalidatePath("/chairops/branch-collect");

  return {
    ok: true,
    data: {
      inserted: toInsert.length,
      skippedExisting: existingSet.size,
      codes,
    },
  };
}
