"use server";

// Damage-ticket server actions for MAID-side reporting.
// ticketCode format: CH-YYYY-NNNN (year + 4-digit running sequence within year).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { canSeeBranch } from "@/lib/chairops/auth/role-guards";
import { writeAudit } from "@/lib/chairops/audit/log";
import { presignUpload, damageKey } from "@/lib/chairops/storage/r2";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { assertAllowedPhotoUrls } from "@/lib/chairops/utils/url-guard";
import { createTicketWithCode } from "@/lib/chairops/utils/ticket-code";
import { DAMAGE_CATEGORIES } from "./new/constants";

const inputSchema = z.object({
  chairId: z.string().nullable().optional(),
  category: z.enum(DAMAGE_CATEGORIES),
  description: z.string().min(5, { message: "อธิบายอาการอย่างน้อย 5 ตัวอักษร" }).max(1000),
  priority: z.enum(["URGENT", "NORMAL"]).default("NORMAL"),
  photoUrls: z.array(z.string().url()).max(5),
});

export type DamageInput = z.infer<typeof inputSchema>;

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// B-002 fix: removed local Gregorian-year nextTicketCode.
// Now uses lib/utils/ticket-code.ts which generates CH-{พ.ศ.}-NNNN consistent with Pool's pattern.

export async function createDamageTicket(
  raw: DamageInput
): Promise<ActionResult<{ id: string; ticketCode: string }>> {
  const session = await requireExactRole("MAID");
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return { ok: false, error: "บัญชียังไม่ได้กำหนดสาขา · ติดต่อออฟฟิศ" };
  }

  // CRIT-002: validate photo URLs
  try {
    assertAllowedPhotoUrls(parsed.data.photoUrls, "photoUrls");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "รูปไม่ถูกต้อง" };
  }

  // Verify chair belongs to maid's branch (defense in depth)
  if (parsed.data.chairId) {
    const chair = await prisma.chairopsChair.findUnique({
      where: { id: parsed.data.chairId },
      select: { branchId: true },
    });
    if (!chair || chair.branchId !== branchId) {
      return { ok: false, error: "เก้าอี้ที่เลือกไม่ได้อยู่ในสาขาของคุณ" };
    }
  }

  try {
    const created = await createTicketWithCode<{ id: string; ticketCode: string }>(
      {
        branchId,
        chairId: parsed.data.chairId || null,
        reportedById: session.user.id,
        category: parsed.data.category,
        description: parsed.data.description,
        priority: parsed.data.priority,
        photoUrls: parsed.data.photoUrls,
        status: "OPEN",
      },
      { id: true, ticketCode: true }
    );

    await writeAudit({
      userId: session.user.id,
      action: "damage.create",
      entity: "DamageTicket",
      entityId: created.id,
      newValue: {
        ticketCode: created.ticketCode,
        branchId,
        chairId: parsed.data.chairId || null,
        category: parsed.data.category,
        priority: parsed.data.priority,
        photoCount: parsed.data.photoUrls.length,
      },
      metadata: { route: "/chairops/damage/new" },
    });

    revalidatePath("/chairops/damage");
    return { ok: true, data: { id: created.id, ticketCode: created.ticketCode } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" };
  }
  return { ok: false, error: "สร้างเลขใบแจ้งซ่อมไม่สำเร็จ · ลองอีกครั้ง" };
}

export async function presignDamageUpload(args: {
  contentType: string;
  draftId: string;
  index: number;
}): Promise<ActionResult<{ url: string; publicUrl: string }>> {
  const session = await requireExactRole("MAID");
  if (!session.user.primaryBranchId) {
    return { ok: false, error: "ยังไม่ได้กำหนดสาขา" };
  }
  if (!zUUID().safeParse(args.draftId).success) {
    return { ok: false, error: "draftId ไม่ถูกต้อง" };
  }
  if (!/^image\/(jpeg|jpg|png|webp|heic)$/i.test(args.contentType)) {
    return { ok: false, error: "ต้องเป็นไฟล์รูปภาพเท่านั้น" };
  }
  if (args.index < 0 || args.index > 4) {
    return { ok: false, error: "ดัชนีรูปไม่ถูกต้อง" };
  }
  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: session.user.primaryBranchId },
    select: { slug: true },
  });
  // draftId stands in for ticketCode in the key; safe to use because we sanitize.
  const ext = args.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = damageKey(branch.slug, args.draftId, args.index, ext);
  const { url, publicUrl } = await presignUpload(key, args.contentType);
  return { ok: true, data: { url, publicUrl } };
}

/** Maid view: chairs in her branch · used for the dropdown. */
export async function listMyBranchChairs(): Promise<
  ActionResult<Array<{ id: string; chairCode: string; isOnline: boolean }>>
> {
  const session = await requireExactRole("MAID");
  if (!session.user.primaryBranchId) return { ok: true, data: [] };
  if (!canSeeBranch(session.user, session.user.primaryBranchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  const chairs = await prisma.chairopsChair.findMany({
    where: { branchId: session.user.primaryBranchId, isActive: true },
    orderBy: { chairCode: "asc" },
    select: { id: true, chairCode: true, isOnline: true },
  });
  return { ok: true, data: chairs };
}
