"use server";

// ============================================================
// CSV Import — soft delete / restore (CEO 2026-06-30)
// ============================================================
// super_admin (chairops ADMIN role + Pool super_admin) can soft-delete a whole
// CSV import or a single imported row, and restore it. SOFT = reversible:
// the row stays in the DB with `deletedAt` set, vanishes from every money /
// visibility query, and the drift cache is recomputed immediately so the
// shortage numbers stay honest. The audit log keeps the full who/when trail.
//
// Why soft, not hard: CEO chose "ซ่อนไว้ เรียกคืนได้ + เก็บหลักฐาน" — money rows
// must never be silently erasable.
// ============================================================

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { writeAudit } from "@/lib/chairops/audit/log";
import { revalidatePath } from "next/cache";

type Result = { ok: true; count: number } | { ok: false; error: string };

const PERM_ERROR =
  "เฉพาะผู้ดูแลสูงสุด (super admin) เท่านั้นที่ลบ/เรียกคืนการนำเข้าได้";

async function revalidateAffected() {
  revalidatePath("/chairops/import/history");
  revalidatePath("/chairops/import/maid-collections");
  revalidatePath("/chairops/collections");
  revalidatePath("/chairops/reconcile");
  revalidatePath("/chairops/reconcile/[branchId]", "page");
  revalidatePath("/chairops/dashboard/[branchSlug]", "page");
}

/** Soft-delete one or many imported collection rows (whole batch = pass all ids). */
export async function softDeleteCollections(input: {
  collectionIds: string[];
  reason?: string;
}): Promise<Result> {
  const session = await requireRole("ADMIN");
  if (!isSuperAdmin(session.poolUser.role)) {
    return { ok: false, error: PERM_ERROR };
  }
  const ids = [...new Set(input.collectionIds ?? [])].filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "ไม่ได้เลือกรายการ" };

  const orgId = session.user.orgId;
  // IDOR-safe: only this org's rows that aren't already deleted.
  const targets = await prisma.chairopsCashCollection.findMany({
    where: { id: { in: ids }, orgId, deletedAt: null },
    select: { id: true, branchId: true },
  });
  if (targets.length === 0) {
    return { ok: false, error: "ไม่พบรายการที่ลบได้ (อาจถูกลบไปแล้ว)" };
  }
  const targetIds = targets.map((t) => t.id);
  const branchIds = [...new Set(targets.map((t) => t.branchId))];

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.chairopsCashCollection.updateMany({
      where: { id: { in: targetIds }, orgId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        deletedById: session.user.id,
        deleteReason: input.reason?.slice(0, 500) || null,
      },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "cash_collection.soft_delete",
        entity: "CashCollection",
        entityId: targetIds.length === 1 ? targetIds[0] : "batch",
        orgId,
        newValue: {
          count: res.count,
          collectionIds: targetIds,
          branchIds,
          reason: input.reason ?? null,
        },
        metadata: { route: "/chairops/import/history" },
      },
      tx,
    );
    return res.count;
  });

  // Recompute drift per affected branch AFTER the soft-delete commits, so the
  // shortage cache reflects the removed rows (deleted rows are now filtered out
  // of every drift aggregate). Sequential — a single import touches few branches.
  for (const branchId of branchIds) {
    await recomputeDriftForBranch(branchId);
  }

  await revalidateAffected();
  return { ok: true, count: updated };
}

/** Restore (un-delete) previously soft-deleted imported rows. */
export async function restoreCollections(input: {
  collectionIds: string[];
}): Promise<Result> {
  const session = await requireRole("ADMIN");
  if (!isSuperAdmin(session.poolUser.role)) {
    return { ok: false, error: PERM_ERROR };
  }
  const ids = [...new Set(input.collectionIds ?? [])].filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "ไม่ได้เลือกรายการ" };

  const orgId = session.user.orgId;
  const targets = await prisma.chairopsCashCollection.findMany({
    where: { id: { in: ids }, orgId, deletedAt: { not: null } },
    select: { id: true, branchId: true },
  });
  if (targets.length === 0) {
    return { ok: false, error: "ไม่พบรายการที่เรียกคืนได้" };
  }
  const targetIds = targets.map((t) => t.id);
  const branchIds = [...new Set(targets.map((t) => t.branchId))];

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.chairopsCashCollection.updateMany({
      where: { id: { in: targetIds }, orgId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null, deleteReason: null },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "cash_collection.restore",
        entity: "CashCollection",
        entityId: targetIds.length === 1 ? targetIds[0] : "batch",
        orgId,
        newValue: { count: res.count, collectionIds: targetIds, branchIds },
        metadata: { route: "/chairops/import/history" },
      },
      tx,
    );
    return res.count;
  });

  for (const branchId of branchIds) {
    await recomputeDriftForBranch(branchId);
  }

  await revalidateAffected();
  return { ok: true, count: updated };
}
