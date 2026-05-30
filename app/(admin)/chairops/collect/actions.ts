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
import { presignUpload, evidenceKey, slipKey } from "@/lib/chairops/storage/r2";
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

  // กันรูปซ้ำ — schema มี @@unique([orgId, imageHash]) แล้ว แต่ check ก่อนเพื่อ error message ดี
  const dup = await prisma.chairopsCashCollection.findUnique({
    where: {
      orgId_imageHash: { orgId: session.user.orgId, imageHash: data.imageHash },
    },
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
          orgId: session.user.orgId,
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

  const existing = await prisma.chairopsCashCollection.findFirst({
    where: { id: parsedId.data, orgId: session.user.orgId },
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

// Step 2 — maid actually goes to bank, deposits, comes back to attach slip.
// Updates an existing row that was created in step 1 with countedAmount only
// (depositedAmount=0, slipPhotoUrl=null). Allowed even after the 30-min edit
// lock because depositing is a separate event from the original count.
const recordDepositInput = z.object({
  collectionId: z.string().uuid(),
  depositedAmount: zBaht(),
  slipPhotoUrl: z.string().url({ message: "ต้องแนบรูปสลิป" }),
  slipImageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, { message: "ลายนิ้วมือสลิปไม่ถูกต้อง" }),
});

export type RecordDepositInput = z.infer<typeof recordDepositInput>;

export async function recordDeposit(
  raw: RecordDepositInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");
  const parsed = recordDepositInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  }
  const data = parsed.data;

  if (data.depositedAmount <= 0) {
    return { ok: false, error: "ยอดที่ฝากต้องมากกว่า 0" };
  }
  if (!isAllowedPhotoUrl(data.slipPhotoUrl)) {
    return { ok: false, error: "รูปสลิปไม่ถูกต้อง · ต้องอัปโหลดผ่านระบบ" };
  }

  const existing = await prisma.chairopsCashCollection.findFirst({
    where: { id: data.collectionId, orgId: session.user.orgId },
    select: {
      id: true,
      branchId: true,
      maidId: true,
      slipPhotoUrl: true,
      countedAmount: true,
      depositedAmount: true,
    },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };
  if (existing.maidId !== session.user.id) {
    return { ok: false, error: "ไม่ใช่รายการของคุณ" };
  }
  if (existing.slipPhotoUrl) {
    return { ok: false, error: "รายการนี้ฝากเงินไปแล้ว" };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsCashCollection.update({
        where: { id: data.collectionId },
        data: {
          depositedAmount: data.depositedAmount,
          slipPhotoUrl: data.slipPhotoUrl,
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "cash_collection.deposit",
          entity: "CashCollection",
          entityId: row.id,
          oldValue: {
            depositedAmount: existing.depositedAmount,
            slipPhotoUrl: existing.slipPhotoUrl,
          },
          newValue: {
            depositedAmount: data.depositedAmount,
            slipPhotoUrl: data.slipPhotoUrl,
          },
          metadata: { route: "/chairops/m/collect/[id]/deposit" },
        },
        tx,
      );
      return row;
    });

    // Drift uses depositedAmount — now that this row is actually deposited,
    // recompute so any prior shortage clears.
    await recomputeDriftForBranch(existing.branchId);

    revalidatePath(`/chairops/m/collect/${updated.id}`);
    revalidatePath("/chairops/m");
    return { ok: true, data: { id: updated.id } };
  } catch {
    return { ok: false, error: "บันทึกการฝากไม่สำเร็จ · ลองอีกครั้ง" };
  }
}

/**
 * Step 2 slip-photo presign. Mirrors presignEvidenceUpload but uses the
 * slipKey/ prefix so we don't collide with the step-1 count photo.
 */
export async function presignSlipUpload(args: {
  contentType: string;
  collectionId: string;
}): Promise<ActionResult<{ url: string; publicUrl: string; key: string }>> {
  const session = await requireExactRole("MAID");

  if (!session.user.primaryBranchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา" };
  }
  const idParsed = zUUID().safeParse(args.collectionId);
  if (!idParsed.success) return { ok: false, error: "collectionId ไม่ถูกต้อง" };

  const ct = args.contentType;
  if (!/^image\/(jpeg|jpg|png|webp|heic)$/i.test(ct)) {
    return { ok: false, error: "ต้องเป็นไฟล์รูปภาพเท่านั้น" };
  }

  const collection = await prisma.chairopsCashCollection.findFirst({
    where: { id: idParsed.data, orgId: session.user.orgId },
    select: { maidId: true, branch: { select: { slug: true } } },
  });
  if (!collection || collection.maidId !== session.user.id) {
    return { ok: false, error: "ไม่พบรายการ" };
  }

  const ext = ct.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = slipKey(collection.branch.slug, idParsed.data, ext);
  const { url, publicUrl } = await presignUpload(key, ct);
  return { ok: true, data: { url, publicUrl, key } };
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

  const branch = await prisma.chairopsBranch.findFirstOrThrow({
    where: { id: session.user.primaryBranchId, orgId: session.user.orgId },
    select: { slug: true },
  });

  const ext = ct.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = evidenceKey(branch.slug, draftIdParsed.data, ext);
  const { url, publicUrl } = await presignUpload(key, ct);
  return { ok: true, data: { url, publicUrl, key } };
}
