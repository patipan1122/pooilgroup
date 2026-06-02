"use server";

// Cleanliness report server actions.
// Grade auto-derived: FAIL if any item off, WARN if 1-2 off, else PASS.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { presignUpload, cleanlinessKey } from "@/lib/chairops/storage/r2";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { assertAllowedPhotoUrls } from "@/lib/chairops/utils/url-guard";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  ChairopsAlertStatus,
  ChairopsCleanlinessGrade,
} from "@/lib/generated/prisma/enums";
import {
  fatigueCheck,
  formatLineMessage,
  notifyChannel,
} from "@/lib/chairops/alerts/_shared";
import { autoResolveCleanlinessFail } from "@/lib/chairops/alerts/auto-resolve";

const checklistSchema = z.object({
  floor: z.boolean(),
  chairs: z.boolean(),
  restroom: z.boolean(),
  trash: z.boolean(),
  signage: z.boolean(),
  lighting: z.boolean(),
});

const inputSchema = z.object({
  checklist: checklistSchema,
  photoUrls: z.array(z.string().url()).min(1, { message: "ต้องแนบรูปอย่างน้อย 1 รูป" }).max(5),
  notes: z.string().max(500).optional().nullable(),
});

export type CleanlinessInput = z.infer<typeof inputSchema>;

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function gradeFromChecklist(c: z.infer<typeof checklistSchema>): "PASS" | "WARN" | "FAIL" {
  const offCount = Object.values(c).filter((v) => v === false).length;
  if (offCount === 0) return "PASS";
  if (offCount <= 2) return "WARN";
  return "FAIL";
}

export async function createCleanlinessReport(
  raw: CleanlinessInput
): Promise<ActionResult<{ id: string; grade: "PASS" | "WARN" | "FAIL" }>> {
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

  const grade = gradeFromChecklist(parsed.data.checklist);

  // Wave-0 fix: create + audit atomic
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsCleanlinessReport.create({
      data: {
        orgId: session.user.orgId,
        branchId,
        byMaidId: session.user.id,
        checklist: parsed.data.checklist,
        photoUrls: parsed.data.photoUrls,
        grade,
        notes: parsed.data.notes ?? null,
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "cleanliness.create",
        entity: "CleanlinessReport",
        entityId: row.id,
        newValue: {
          branchId,
          checklist: parsed.data.checklist,
          grade,
          photoCount: parsed.data.photoUrls.length,
        },
        metadata: { route: "/chairops/cleanliness/new" },
      },
      tx,
    );

    return row;
  });

  // BF2 D3 · event-driven CLEANLINESS_FAIL emit (post-tx, fire-and-forget so
  // a LINE outage doesn't block the maid's submit). Also auto-resolves any
  // open FAIL alert when a PASS rolls in within the 14-day window.
  void (async () => {
    try {
      if (grade === "PASS") {
        await autoResolveCleanlinessFail(session.user.orgId, branchId);
        return;
      }
      if (grade !== "FAIL") return;

      // Idempotency · skip if event-hook already fired for this report.
      const existing = await prisma.chairopsAlert.findFirst({
        where: {
          orgId: session.user.orgId,
          kind: ChairopsAlertKind.CLEANLINESS_FAIL,
          status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
          contextJson: { path: ["reportId"], equals: created.id },
        },
        select: { id: true },
      });
      if (existing) return;

      // 2× FAIL in last 7d → CRITICAL.
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
      const failCount7d = await prisma.chairopsCleanlinessReport.count({
        where: {
          orgId: session.user.orgId,
          branchId,
          grade: ChairopsCleanlinessGrade.FAIL,
          reportedAt: { gte: sevenDaysAgo },
        },
      });
      const level = failCount7d >= 2 ? ChairopsAlertLevel.CRITICAL : ChairopsAlertLevel.WARN;

      const branch = await prisma.chairopsBranch.findUnique({
        where: { id: branchId },
        select: { name: true },
      });
      const branchName = branch?.name ?? "(ไม่ทราบสาขา)";

      const alert = await prisma.chairopsAlert.create({
        data: {
          orgId: session.user.orgId,
          branchId,
          kind: ChairopsAlertKind.CLEANLINESS_FAIL,
          level,
          title: `ตรวจสภาพไม่ผ่าน · ${branchName}`,
          message: failCount7d >= 2
            ? `ไม่ผ่าน ${failCount7d} ครั้งใน 7 วัน · ตรวจสอบด่วน`
            : `แม่บ้านรายงาน FAIL · ตรวจสอบรูปภาพ`,
          contextJson: {
            reportId: created.id,
            byMaidId: session.user.id,
            photoUrls: parsed.data.photoUrls,
            failCount7d,
            linkPath: `/chairops/cleanliness/${created.id}`,
            source: "cleanliness-submit",
          },
        },
      });

      const channels: ("ops" | "ceo")[] = level === ChairopsAlertLevel.CRITICAL
        ? ["ops", "ceo"]
        : ["ops"];
      const line = formatLineMessage({
        orgId: alert.orgId,
        branchId: alert.branchId,
        kind: alert.kind,
        level: alert.level,
        title: alert.title,
        message: alert.message,
        contextJson: alert.contextJson as Record<string, unknown>,
        channels,
      });
      for (const ch of channels) {
        if (!fatigueCheck(ch)) continue;
        await notifyChannel(ch, line);
      }
    } catch (err) {
      console.error("[cleanliness-submit] alert emit failed:", err);
    }
  })();

  revalidatePath("/chairops/cleanliness");
  return { ok: true, data: { id: created.id, grade } };
}

export async function presignCleanlinessUpload(args: {
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
  const branch = await prisma.chairopsBranch.findFirstOrThrow({
    where: { id: session.user.primaryBranchId, orgId: session.user.orgId },
    select: { slug: true },
  });
  const ext = args.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = cleanlinessKey(branch.slug, args.draftId, args.index, ext);
  const { url, publicUrl } = await presignUpload(key, args.contentType);
  return { ok: true, data: { url, publicUrl } };
}
