"use server";

// Maid-side parts request (mockup Phone "PartsForm" · เบิกของจากคลัง).
//
// A maid requesting parts does NOT change physical stock — office fulfils later
// by adjusting stock (existing `adjustStock` action). We therefore record the
// request as a ChairopsSparePartMovement with delta:0 (no stock change) and
// encode the PENDING request state + requested quantity in `reason`, keyed to
// the maid's branch + user. This avoids a schema migration while giving office
// an auditable queue (filter movements where reason starts with the marker).
//
// Idempotent: an identical pending request (same part + qty + reason) created
// within the last 5 minutes is treated as a duplicate retry and returns the
// existing row instead of creating another.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { MAID_PART_REQUEST_PREFIX } from "@/lib/chairops/parts/constants";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const inputSchema = z.object({
  partId: zUUID(),
  quantity: z.coerce
    .number()
    .int()
    .positive({ message: "จำนวนต้องมากกว่า 0" })
    .max(999, { message: "จำนวนมากเกินไป" }),
  reason: z.string().trim().min(1, { message: "ระบุเหตุผลที่เบิก" }).max(300),
  /** client idempotency key (IndexedDB outbox) — stored in audit metadata */
  idempotencyKey: z.string().trim().max(64).optional().nullable(),
});

export type RequestPartInput = z.infer<typeof inputSchema>;

export async function requestPartFromMaid(
  raw: RequestPartInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  }

  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return { ok: false, error: "บัญชียังไม่ได้กำหนดสาขา · ติดต่อออฟฟิศ" };
  }

  // Verify part belongs to the maid's org (defense in depth · RLS still applies).
  const part = await prisma.chairopsSparePart.findFirst({
    where: { id: parsed.data.partId, orgId: session.user.orgId },
    select: { id: true, name: true, unit: true },
  });
  if (!part) return { ok: false, error: "ไม่พบอะไหล่ที่เลือก" };

  const reasonText = `${MAID_PART_REQUEST_PREFIX} · qty=${parsed.data.quantity} · ${parsed.data.reason}`;

  // Idempotency: skip if an identical pending request exists in last 5 min.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const dup = await prisma.chairopsSparePartMovement.findFirst({
    where: {
      orgId: session.user.orgId,
      partId: part.id,
      branchId,
      byUserId: session.user.id,
      reason: reasonText,
      at: { gte: fiveMinAgo },
    },
    select: { id: true },
  });
  if (dup) return { ok: true, data: { id: dup.id } };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsSparePartMovement.create({
        data: {
          orgId: session.user.orgId,
          partId: part.id,
          branchId,
          // delta 0 — request only; office adjusts real stock on fulfilment.
          delta: 0,
          reason: reasonText,
          byUserId: session.user.id,
        },
      });

      await writeAudit(
        {
          userId: session.user.id,
          action: "spare_part.maid_request",
          entity: "SparePartMovement",
          entityId: row.id,
          newValue: {
            partId: part.id,
            partName: part.name,
            quantity: parsed.data.quantity,
            unit: part.unit,
            branchId,
            status: "PENDING",
            reason: parsed.data.reason,
          },
          metadata: {
            route: "/chairops/m/parts/new",
            idempotencyKey: parsed.data.idempotencyKey ?? null,
          },
        },
        tx,
      );

      return row;
    });

    revalidatePath("/chairops/parts");
    revalidatePath("/chairops/m/parts/new");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "ส่งคำขอเบิกไม่สำเร็จ",
    };
  }
}
