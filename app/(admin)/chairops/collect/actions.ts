"use server";

// Cash collection server actions
// - createCashCollection: validate · auto-fill branchId · check image hash · audit · recompute drift
// - requestUnlock: OFFICE+ can clear the 30-min lock so maid can re-edit
// - presignEvidenceUpload: returns R2 presigned URL (called from client before submit)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, requireAuth, requireExactRole } from "@/lib/chairops/auth/session";
import { canUnlockCollection } from "@/lib/chairops/auth/role-guards";
import { writeAudit } from "@/lib/chairops/audit/log";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { presignUpload, evidenceKey } from "@/lib/chairops/storage/r2";
import { zBaht, zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
import { rateLimit, LIMITS } from "@/lib/chairops/utils/rate-limit";

const cashCollectionInput = z.object({
  countedAmount: zBaht(),
  depositedAmount: zBaht(),
  evidencePhotoUrl: z.string().url({ message: "ต้องแนบรูปหลักฐาน" }),
  slipPhotoUrl: z.string().url().optional().nullable(),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/i, { message: "ลายนิ้วมือรูปไม่ถูกต้อง" }),
  notes: z.string().max(500).optional().nullable(),
});

export type CashCollectionInput = z.infer<typeof cashCollectionInput>;

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function createCashCollection(
  raw: CashCollectionInput
): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");
  const parsed = cashCollectionInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const data = parsed.data;

  if (data.countedAmount <= 0) {
    return { ok: false, error: "ยอดที่นับต้องมากกว่า 0" };
  }

  // CRIT-002: server-side photo URL validation (URLs must live under R2_PUBLIC_URL)
  if (!isAllowedPhotoUrl(data.evidencePhotoUrl)) {
    return { ok: false, error: "รูปเงินสดไม่ถูกต้อง · ต้องอัปโหลดผ่านระบบ" };
  }
  if (data.slipPhotoUrl && !isAllowedPhotoUrl(data.slipPhotoUrl)) {
    return { ok: false, error: "รูปสลิปไม่ถูกต้อง · ต้องอัปโหลดผ่านระบบ" };
  }

  // CRIT-003: rate limit per maid
  const rl = rateLimit(`cash:${session.user.id}`, LIMITS.cashCollect);
  if (!rl.ok) {
    return { ok: false, error: "ส่งบ่อยเกินไป · รอสักครู่แล้วลองใหม่" };
  }

  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา · ติดต่อออฟฟิศ" };
  }

  // กันรูปซ้ำ — schema มี @@unique([imageHash]) แล้ว แต่ check ก่อนเพื่อ error message ดี
  const dup = await prisma.chairopsCashCollection.findUnique({
    where: { imageHash: data.imageHash },
    select: { id: true, collectedAt: true },
  });
  if (dup) {
    return {
      ok: false,
      error: "รูปนี้เคยส่งแล้ว · กรุณาถ่ายรูปใหม่ทุกครั้งที่บันทึก",
    };
  }

  try {
    // Wave-0 fix: create + audit atomic in one tx
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsCashCollection.create({
        data: {
          branchId,
          maidId: session.user.id,
          countedAmount: data.countedAmount,
          depositedAmount: data.depositedAmount,
          evidencePhotoUrl: data.evidencePhotoUrl,
          slipPhotoUrl: data.slipPhotoUrl ?? null,
          imageHash: data.imageHash,
          notes: data.notes ?? null,
        },
      });

      await writeAudit(
        {
          userId: session.user.id,
          action: "cash_collection.create",
          entity: "CashCollection",
          entityId: row.id,
          newValue: {
            branchId,
            countedAmount: data.countedAmount,
            depositedAmount: data.depositedAmount,
            notes: data.notes ?? null,
          },
          metadata: { route: "/chairops/collect/new" },
        },
        tx,
      );

      return row;
    });

    // Recompute drift after every collection (mandated by spec).
    // Kept outside tx — heavy read+write across multiple tables, would
    // hold tx open too long.
    await recomputeDriftForBranch(branchId);

    revalidatePath("/chairops/collect");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    const msg =
      err instanceof Error && err.message.includes("imageHash")
        ? "รูปนี้เคยส่งแล้ว · ถ่ายรูปใหม่"
        : "บันทึกไม่สำเร็จ · กรุณาลองอีกครั้ง";
    return { ok: false, error: msg };
  }
}

export async function requestUnlock(id: string): Promise<ActionResult> {
  const session = await requireAuth();
  if (!canUnlockCollection(session.user)) {
    return { ok: false, error: "ไม่มีสิทธิ์ปลดล็อก · ต้องเป็นออฟฟิศหรือสูงกว่า" };
  }

  const parsedId = zUUID().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  const existing = await prisma.chairopsCashCollection.findUnique({
    where: { id: parsedId.data },
    select: { id: true, lockedAt: true, branchId: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };

  // Wave-0 fix: update + audit atomic
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsCashCollection.update({
      where: { id: parsedId.data },
      data: {
        lockedAt: null,
        unlockedById: session.user.id,
        unlockedAt: new Date(),
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "cash_collection.unlock",
        entity: "CashCollection",
        entityId: row.id,
        oldValue: { lockedAt: existing.lockedAt },
        newValue: { lockedAt: null, unlockedById: session.user.id },
        metadata: { route: "/chairops/collect/[id]" },
      },
      tx,
    );

    return row;
  });

  revalidatePath(`/chairops/collect/${updated.id}`);
  revalidatePath("/chairops/collect");
  return { ok: true, data: undefined };
}

/**
 * Returns a presigned R2 PUT URL + publicUrl that the maid's browser will upload to directly.
 * Branch slug is auto-resolved from session.user.primaryBranchId.
 */
export async function presignEvidenceUpload(args: {
  contentType: string;
  /** Pre-generated UUID for the upcoming collection so the key matches the row */
  draftId: string;
}): Promise<ActionResult<{ url: string; publicUrl: string; key: string }>> {
  const session = await requireExactRole("MAID");

  if (!session.user.primaryBranchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา" };
  }

  const draftIdParsed = zUUID().safeParse(args.draftId);
  if (!draftIdParsed.success) return { ok: false, error: "draftId ไม่ถูกต้อง" };

  const ct = args.contentType;
  if (!/^image\/(jpeg|jpg|png|webp|heic)$/i.test(ct)) {
    return { ok: false, error: "ต้องเป็นไฟล์รูปภาพเท่านั้น" };
  }

  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: session.user.primaryBranchId },
    select: { slug: true },
  });

  const ext = ct.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = evidenceKey(branch.slug, draftIdParsed.data, ext);
  const { url, publicUrl } = await presignUpload(key, ct);
  return { ok: true, data: { url, publicUrl, key } };
}
