"use server";

// Cash collection + deposit server actions (2026-05-30 split).
//
// Step 1 / collect:
// - createCashCollection: per-chair breakdown · NO deposit fields · audit ·
//   recompute drift. countedAmount is derived server-side from chair lines.
// - requestUnlock: OFFICE+ can clear the 30-min edit lock so maid can re-edit
// - presignEvidenceUpload: optional rollup-photo presign (form may omit it)
// - presignChairPhoto: presign per-problem-chair photo (1 per broken chair)
//
// Step 2 / deposit:
// - batchDeposit: groups 1+ pending collections into ONE bank trip · captures
//   bankFee · creates ChairopsCashDeposit row + updates collection.depositId.
// - presignSlipUpload: presign for the deposit slip photo

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

const CHAIR_LINE_STATUSES = ["collected", "broken", "empty", "skipped"] as const;

const chairLineInput = z.object({
  chairCode: z.string().min(1).max(40),
  status: z.enum(CHAIR_LINE_STATUSES),
  amount: zBaht(),
  reason: z.string().max(200).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  photoHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .nullable(),
});

const cashCollectionInput = z.object({
  lines: z.array(chairLineInput).min(1, { message: "ต้องมีอย่างน้อย 1 เก้าอี้" }),
  evidencePhotoUrl: z.string().url().optional().nullable(),
  imageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, { message: "ลายนิ้วมือรูปไม่ถูกต้อง" })
    .optional()
    .nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type CashCollectionInput = z.infer<typeof cashCollectionInput>;
export type ChairLine = z.infer<typeof chairLineInput>;

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function createCashCollection(
  raw: CashCollectionInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");
  const parsed = cashCollectionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  }
  const data = parsed.data;

  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา · ติดต่อออฟฟิศ" };
  }

  // Validate every line + rule-check status/amount/reason combinations.
  const seenCodes = new Set<string>();
  for (const line of data.lines) {
    const code = line.chairCode.trim();
    if (!code) return { ok: false, error: "รหัสเก้าอี้ว่าง" };
    if (seenCodes.has(code)) {
      return { ok: false, error: `รหัสซ้ำ ${code}` };
    }
    seenCodes.add(code);
    if (line.status === "collected") {
      if (line.amount <= 0) {
        return { ok: false, error: `${code} · เก็บแล้วยอดต้อง > 0` };
      }
    } else {
      if (line.amount !== 0) {
        return { ok: false, error: `${code} · ไม่ได้เก็บแต่กรอกยอด > 0` };
      }
      if (line.status === "broken" || line.status === "skipped") {
        if (!line.reason || line.reason.trim().length === 0) {
          return { ok: false, error: `${code} · ต้องระบุเหตุผล` };
        }
      }
    }
    if (line.photoUrl && !isAllowedPhotoUrl(line.photoUrl)) {
      return { ok: false, error: `${code} · รูปไม่ถูกต้อง` };
    }
  }
  // At least one collected line so we actually have cash to track.
  const collectedCount = data.lines.filter((l) => l.status === "collected").length;
  if (collectedCount === 0) {
    return { ok: false, error: "ต้องมีอย่างน้อย 1 เก้าอี้ที่เก็บได้" };
  }

  // Confirm every chairCode actually belongs to this branch (prevents typos
  // / cross-branch writes via tampered client payload).
  const branchChairs = await prisma.chairopsChair.findMany({
    where: {
      branchId,
      orgId: session.user.orgId,
      chairCode: { in: data.lines.map((l) => l.chairCode.trim()) },
      isActive: true,
    },
    select: { chairCode: true },
  });
  const validCodes = new Set(branchChairs.map((c) => c.chairCode));
  for (const line of data.lines) {
    if (!validCodes.has(line.chairCode.trim())) {
      return {
        ok: false,
        error: `รหัส ${line.chairCode} ไม่ใช่ของสาขานี้`,
      };
    }
  }

  const countedAmount = data.lines.reduce((sum, l) => sum + l.amount, 0);

  // Rollup photo is optional in the new flow (CEO 2026-05-30). If supplied,
  // it still goes through the dedup gate.
  if (data.evidencePhotoUrl && !isAllowedPhotoUrl(data.evidencePhotoUrl)) {
    return { ok: false, error: "รูปรวมไม่ถูกต้อง · ต้องอัปโหลดผ่านระบบ" };
  }
  if (data.imageHash) {
    const dup = await prisma.chairopsCashCollection.findUnique({
      where: {
        orgId_imageHash: {
          orgId: session.user.orgId,
          imageHash: data.imageHash,
        },
      },
      select: { id: true },
    });
    if (dup) {
      return { ok: false, error: "รูปนี้เคยส่งแล้ว · ถ่ายใหม่ทุกครั้ง" };
    }
  }

  const rl = rateLimit(`cash:${session.user.id}`, LIMITS.cashCollect);
  if (!rl.ok) {
    return { ok: false, error: "ส่งบ่อยเกินไป · รอสักครู่แล้วลองใหม่" };
  }

  // imageHash column is NOT NULL on the table; when the rollup photo is
  // omitted, store a synthetic per-row hash (random) so the unique guard
  // never trips on a NULL/empty value across collisions.
  const fallbackHash =
    data.imageHash ??
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsCashCollection.create({
        data: {
          orgId: session.user.orgId,
          branchId,
          maidId: session.user.id,
          countedAmount,
          depositedAmount: 0, // legacy column · deposit lives on cash_deposits now
          evidencePhotoUrl: data.evidencePhotoUrl ?? "",
          slipPhotoUrl: null,
          imageHash: fallbackHash,
          notes: data.notes ?? null,
          chairBreakdown: { lines: data.lines },
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
            countedAmount,
            chairCount: data.lines.length,
            collectedCount,
            notes: data.notes ?? null,
          },
          metadata: { route: "/chairops/collect/new" },
        },
        tx,
      );

      return row;
    });

    await recomputeDriftForBranch(branchId);

    revalidatePath("/chairops/m");
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

// Per-problem-chair photo presign — one R2 URL for each broken chair photo.
// Hashed in client (sha256) so we can reuse the chair photo URL across the
// round if needed. Key shape: cash-chair/yyyy/mm/<branchSlug>/<collId>-<chair>.<ext>
export async function presignChairPhoto(args: {
  contentType: string;
  draftId: string;
  chairCode: string;
}): Promise<ActionResult<{ url: string; publicUrl: string; key: string }>> {
  const session = await requireExactRole("MAID");
  if (!session.user.primaryBranchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา" };
  }
  const draft = zUUID().safeParse(args.draftId);
  if (!draft.success) return { ok: false, error: "draftId ไม่ถูกต้อง" };
  const safeChair = args.chairCode.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
  if (!safeChair) return { ok: false, error: "chairCode ว่าง" };

  const ct = args.contentType;
  if (!/^image\/(jpeg|jpg|png|webp|heic)$/i.test(ct)) {
    return { ok: false, error: "ต้องเป็นไฟล์รูปภาพ" };
  }

  const branch = await prisma.chairopsBranch.findFirstOrThrow({
    where: { id: session.user.primaryBranchId, orgId: session.user.orgId },
    select: { slug: true },
  });
  const ext = ct.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `cash-chair/${yyyy}/${mm}/${branch.slug}/${draft.data}-${safeChair}.${ext}`;
  const { url, publicUrl } = await presignUpload(key, ct);
  return { ok: true, data: { url, publicUrl, key } };
}

// Step 2 — batch deposit. Maid picks 1+ pending collection rows, types the
// actual amount that landed at the bank, optional bank fee, and the slip
// photo. We mark every chosen collection with depositId in one transaction.
const batchDepositInput = z.object({
  collectionIds: z.array(z.string().uuid()).min(1).max(50),
  depositedAmount: zBaht(),
  bankFee: zBaht(),
  slipPhotoUrl: z.string().url({ message: "ต้องแนบสลิป" }),
  slipImageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, { message: "ลายนิ้วมือสลิปไม่ถูกต้อง" }),
  notes: z.string().max(500).optional().nullable(),
});

export type BatchDepositInput = z.infer<typeof batchDepositInput>;

export async function batchDeposit(
  raw: BatchDepositInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");
  const parsed = batchDepositInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  }
  const data = parsed.data;
  if (data.depositedAmount <= 0) {
    return { ok: false, error: "ยอดฝากต้องมากกว่า 0" };
  }
  if (!isAllowedPhotoUrl(data.slipPhotoUrl)) {
    return { ok: false, error: "รูปสลิปไม่ถูกต้อง · อัปโหลดผ่านระบบ" };
  }

  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา" };
  }

  // All chosen collections must belong to this maid, this branch, and be
  // pending (depositId null). One mismatch → reject the whole batch.
  const collections = await prisma.chairopsCashCollection.findMany({
    where: {
      id: { in: data.collectionIds },
      orgId: session.user.orgId,
      branchId,
      maidId: session.user.id,
    },
    select: { id: true, depositId: true, countedAmount: true },
  });
  if (collections.length !== data.collectionIds.length) {
    return { ok: false, error: "บางรายการไม่ใช่ของคุณ / ไม่ใช่ของสาขานี้" };
  }
  const alreadyDeposited = collections.filter((c) => c.depositId !== null);
  if (alreadyDeposited.length > 0) {
    return {
      ok: false,
      error: `${alreadyDeposited.length} รายการฝากไปแล้ว · รีเฟรชหน้ารายการ`,
    };
  }

  // Reject slip-hash dup (e.g. maid uploads same screenshot twice by mistake).
  const dup = await prisma.chairopsCashDeposit.findUnique({
    where: {
      orgId_slipImageHash: {
        orgId: session.user.orgId,
        slipImageHash: data.slipImageHash,
      },
    },
    select: { id: true },
  });
  if (dup) {
    return { ok: false, error: "สลิปนี้เคยใช้แล้ว · ถ่ายใหม่" };
  }

  try {
    const deposit = await prisma.$transaction(async (tx) => {
      const dep = await tx.chairopsCashDeposit.create({
        data: {
          orgId: session.user.orgId,
          branchId,
          maidId: session.user.id,
          depositedAmount: data.depositedAmount,
          bankFee: data.bankFee,
          slipPhotoUrl: data.slipPhotoUrl,
          slipImageHash: data.slipImageHash,
          notes: data.notes ?? null,
        },
      });
      await tx.chairopsCashCollection.updateMany({
        where: { id: { in: data.collectionIds } },
        data: { depositId: dep.id },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "cash_deposit.create",
          entity: "CashDeposit",
          entityId: dep.id,
          newValue: {
            branchId,
            collectionIds: data.collectionIds,
            depositedAmount: data.depositedAmount,
            bankFee: data.bankFee,
            countedTotal: collections.reduce((s, c) => s + c.countedAmount, 0),
          },
          metadata: { route: "/chairops/m/deposit" },
        },
        tx,
      );
      return dep;
    });

    await recomputeDriftForBranch(branchId);

    revalidatePath("/chairops/m");
    revalidatePath("/chairops/collect");
    return { ok: true, data: { id: deposit.id } };
  } catch {
    return { ok: false, error: "บันทึกการฝากไม่สำเร็จ · ลองอีกครั้ง" };
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

// Step 2 slip-photo presign for the new batchDeposit flow. The maid generates
// a client-side draft UUID for the upcoming deposit and uploads the slip to
// that key; the URL is then sent into batchDeposit() as slipPhotoUrl.
export async function presignSlipUpload(args: {
  contentType: string;
  /** Client-generated UUID — becomes the slip's R2 key + the eventual deposit row id reference. */
  depositDraftId: string;
}): Promise<ActionResult<{ url: string; publicUrl: string; key: string }>> {
  const session = await requireExactRole("MAID");

  if (!session.user.primaryBranchId) {
    return { ok: false, error: "บัญชีของคุณยังไม่ได้กำหนดสาขา" };
  }
  const idParsed = zUUID().safeParse(args.depositDraftId);
  if (!idParsed.success) return { ok: false, error: "depositDraftId ไม่ถูกต้อง" };

  const ct = args.contentType;
  if (!/^image\/(jpeg|jpg|png|webp|heic)$/i.test(ct)) {
    return { ok: false, error: "ต้องเป็นไฟล์รูปภาพเท่านั้น" };
  }

  const collection = await prisma.chairopsBranch.findFirstOrThrow({
    where: { id: session.user.primaryBranchId, orgId: session.user.orgId },
    select: { slug: true },
  });
  // Synthesize the shape the legacy presignSlipUpload code expects below.
  const _legacyShape: { maidId: string; branch: { slug: string } } = {
    maidId: session.user.id,
    branch: { slug: collection.slug },
  };
  void _legacyShape;
  const ext = ct.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = slipKey(collection.slug, idParsed.data, ext);
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
