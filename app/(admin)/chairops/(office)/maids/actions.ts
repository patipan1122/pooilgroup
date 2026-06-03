"use server";

// ============================================================
// ChairOps · Maid Roster · BF1 server actions (DEVIL-MVP)
// ============================================================
// One row = one day-off. One row = one paycheck. NO formula. NO approval.
//
// Permissions (per CEO LOCKED 2026-06-02):
//   CEO+ADMIN  → all mutations
//   MANAGER    → no maid mutations (read-only roster) · no pay surfaces
//   OFFICE     → read-only roster · no pay surfaces
//   MAID       → LIFF self-flag own day-off ONLY (see requestOwnDayOff)
//
// Per [[feedback-use-server-only-async-2026-06-02]]: exports MUST be async.
// All consts + types live in ./types.ts.
// ============================================================

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { canManageUser, rankOf } from "@/lib/chairops/auth/role-guards";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { notifyChannel } from "@/lib/chairops/line/messaging";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
import type { ActionResult } from "./types";

// -- helpers ----------------------------------------------------------------
function bkkToday(): Date {
  // Bangkok-anchored "today as DATE column" — strip wall-clock TZ to UTC date.
  const now = new Date();
  const tz = process.env.APP_TIMEZONE || "Asia/Bangkok";
  // Use Intl to get YYYY-MM-DD in BKK then parse as UTC midnight (so @db.Date
  // stores the right calendar day regardless of server clock).
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

function parseDateYmd(input: string): Date | null {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// ============================================================
// Day-off (ADMIN mutations)
// ============================================================

const createDayOffSchema = z.object({
  maidId: zUUID(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องเป็น YYYY-MM-DD"),
  // Multi-day input · UI converts "ลายาว 5 วัน" → days=5 server loops INSERT.
  // 1 = single day (default) · 31 = max ever (1 month) to keep noise sane.
  days: z.coerce.number().int().min(1).max(31).default(1),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function createDayOff(formData: FormData): Promise<ActionResult<{ count: number }>> {
  const session = await requireRole(ChairopsUserRole.ADMIN);

  const parsed = createDayOffSchema.safeParse({
    maidId: formData.get("maidId"),
    startDate: formData.get("startDate"),
    days: formData.get("days") || 1,
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.maidId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบแม่บ้าน" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }
  if (target.role !== ChairopsUserRole.MAID) {
    return { ok: false, error: "ลาได้เฉพาะแม่บ้าน" };
  }

  const start = parseDateYmd(parsed.data.startDate);
  if (!start) return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };

  const reason = (parsed.data.reason ?? "").trim() || null;
  const days = parsed.data.days;

  // Generate consecutive dates · server loops INSERT skipDuplicates to make
  // re-submitting a partial range idempotent (admin saw P2002 on a duplicate
  // day and re-tried — second call should NOT crash, just create the missing
  // rows).
  const rows: { orgId: string; maidId: string; date: Date; reason: string | null; createdById: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    rows.push({
      orgId: session.user.orgId,
      maidId: target.id,
      date: d,
      reason,
      createdById: session.user.id,
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.chairopsMaidDayOff.createMany({
        data: rows,
        skipDuplicates: true,
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "maid.day_off.create",
          entity: "MaidDayOff",
          entityId: target.id,
          newValue: {
            maidId: target.id,
            startDate: parsed.data.startDate,
            days,
            inserted: created.count,
            reason,
          },
        },
        tx,
      );
      return created;
    });

    revalidatePath("/chairops/maids");
    revalidatePath(`/chairops/maids/${target.id}`);
    revalidatePath("/chairops");
    return { ok: true, data: { count: result.count } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

const deleteDayOffSchema = z.object({ id: zUUID() });

export async function deleteDayOff(formData: FormData): Promise<ActionResult> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  const parsed = deleteDayOffSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  // IDOR defense — composite where (id + orgId) per OWN-02 audit pattern.
  const existing = await prisma.chairopsMaidDayOff.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการลา" };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsMaidDayOff.delete({ where: { id: existing.id } });
    await writeAudit(
      {
        userId: session.user.id,
        action: "maid.day_off.delete",
        entity: "MaidDayOff",
        entityId: existing.id,
        oldValue: {
          maidId: existing.maidId,
          date: existing.date,
          reason: existing.reason,
        },
      },
      tx,
    );
  });

  revalidatePath("/chairops/maids");
  revalidatePath(`/chairops/maids/${existing.maidId}`);
  revalidatePath("/chairops");
  return { ok: true };
}

// ============================================================
// MAID self-flag own day-off (LIFF)
// Cutoff: maid can cancel her own day-off until 18:00 BKK. After that
// → ADMIN-only via deleteDayOff() above.
// ============================================================

const requestOwnDayOffSchema = z.object({
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function requestOwnDayOff(formData: FormData): Promise<ActionResult> {
  const session = await requireExactRole(ChairopsUserRole.MAID);
  const parsed = requestOwnDayOffSchema.safeParse({
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "เหตุผลยาวเกินไป" };
  }

  const today = bkkToday();
  const reason = (parsed.data.reason ?? "").trim() || null;

  try {
    await prisma.$transaction(async (tx) => {
      // upsert — if maid taps twice, second tap is no-op (idempotent).
      await tx.chairopsMaidDayOff.upsert({
        where: {
          orgId_maidId_date: {
            orgId: session.user.orgId,
            maidId: session.user.id,
            date: today,
          },
        },
        create: {
          orgId: session.user.orgId,
          maidId: session.user.id,
          date: today,
          reason,
          createdById: session.user.id,
        },
        update: reason ? { reason } : {},
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "maid.day_off.self_request",
          entity: "MaidDayOff",
          entityId: session.user.id,
          newValue: { date: today, reason, self: true },
          metadata: { route: "/chairops/m" },
        },
        tx,
      );
    });

    // Best-effort office ping · don't fail the action if LINE not configured.
    try {
      await notifyChannel(
        "ops",
        `🌿 ${session.user.displayName} แจ้งลาวันนี้ ${reason ? `· เหตุผล: ${reason}` : "(ไม่ระบุเหตุผล)"}`,
      );
    } catch {
      // swallow
    }

    revalidatePath("/chairops/m");
    revalidatePath("/chairops/maids");
    revalidatePath("/chairops");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

export async function cancelOwnDayOff(): Promise<ActionResult> {
  const session = await requireExactRole(ChairopsUserRole.MAID);
  // Hard cutoff 18:00 BKK — after that, ADMIN-only revocation.
  const tz = process.env.APP_TIMEZONE || "Asia/Bangkok";
  const hh = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  const hourBkk = Number(hh);
  if (hourBkk >= 18) {
    return { ok: false, error: "เลย 18:00 แล้ว · ติดต่อออฟฟิศเพื่อยกเลิก" };
  }

  const today = bkkToday();

  const existing = await prisma.chairopsMaidDayOff.findUnique({
    where: {
      orgId_maidId_date: {
        orgId: session.user.orgId,
        maidId: session.user.id,
        date: today,
      },
    },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการลาวันนี้" };

  // Only the maid herself can self-cancel her own self-flagged leave
  if (existing.createdById !== session.user.id) {
    return { ok: false, error: "รายการนี้ออฟฟิศบันทึกให้ · ติดต่อออฟฟิศเพื่อยกเลิก" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsMaidDayOff.delete({ where: { id: existing.id } });
    await writeAudit(
      {
        userId: session.user.id,
        action: "maid.day_off.self_cancel",
        entity: "MaidDayOff",
        entityId: existing.id,
        oldValue: { date: existing.date, reason: existing.reason },
        metadata: { route: "/chairops/m" },
      },
      tx,
    );
  });

  revalidatePath("/chairops/m");
  revalidatePath("/chairops/maids");
  revalidatePath("/chairops");
  return { ok: true };
}

// ============================================================
// Maid profile · payroll/HR fields (CEO+ADMIN only)
// CEO 2026-06-03 · phone + bank account + employment-contract attachment so
// payroll can be set up later. Contract file is uploaded to R2 by the client
// (generic /api/r2/sign route) — we only store the resulting URL + filename.
// ============================================================

const updateMaidProfileSchema = z.object({
  maidId: zUUID(),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  bankName: z.string().trim().max(60).optional().or(z.literal("")),
  bankAccountNo: z.string().trim().max(40).optional().or(z.literal("")),
  bankAccountName: z.string().trim().max(120).optional().or(z.literal("")),
  // SEC: must be our R2 CDN — refusing arbitrary hosts closes the SSRF vector
  // (the server fetches this URL to mirror the file into Drive).
  contractFileUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((s) => s === "" || isAllowedPhotoUrl(s), "ลิงก์ไฟล์ไม่ถูกต้อง")
    .optional()
    .or(z.literal("")),
  contractFileName: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function updateMaidProfile(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole(ChairopsUserRole.ADMIN);

  const parsed = updateMaidProfileSchema.safeParse({
    maidId: formData.get("maidId"),
    phone: formData.get("phone") || undefined,
    bankName: formData.get("bankName") || undefined,
    bankAccountNo: formData.get("bankAccountNo") || undefined,
    bankAccountName: formData.get("bankAccountName") || undefined,
    contractFileUrl: formData.get("contractFileUrl") || undefined,
    contractFileName: formData.get("contractFileName") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const v = parsed.data;

  const target = await prisma.chairopsUser.findFirst({
    where: { id: v.maidId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบแม่บ้าน" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }
  if (target.role !== ChairopsUserRole.MAID) {
    return { ok: false, error: "ใช้ได้เฉพาะแม่บ้าน" };
  }

  // Empty string → null (clear the field). The @@unique([orgId, phone]) means
  // a phone collision throws P2002 → friendly message instead of a 500.
  const norm = (s: string | undefined) => {
    const t = (s ?? "").trim();
    return t === "" ? null : t;
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.chairopsUser.update({
        where: { id: target.id },
        data: {
          phone: norm(v.phone),
          bankName: norm(v.bankName),
          bankAccountNo: norm(v.bankAccountNo),
          bankAccountName: norm(v.bankAccountName),
          contractFileUrl: norm(v.contractFileUrl),
          contractFileName: norm(v.contractFileName),
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "maid.profile.update",
          entity: "User",
          entityId: target.id,
          // never log full account number — just whether it was set
          newValue: {
            phone: norm(v.phone),
            bankName: norm(v.bankName),
            bankAccountSet: norm(v.bankAccountNo) != null,
            contractSet: norm(v.contractFileUrl) != null,
          },
        },
        tx,
      );
    });

    // Best-effort: archive a newly-attached contract to Google Drive
    // (CEO 2026-06-03). Never blocks/fails the save — R2 copy is authoritative.
    const newContract = norm(v.contractFileUrl);
    if (newContract && newContract !== target.contractFileUrl) {
      try {
        const { getDriveConnection, backupFileToDrive } = await import(
          "@/lib/chairops/storage/drive"
        );
        if (await getDriveConnection(session.user.orgId)) {
          const resp = await fetch(newContract, {
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) {
            const bytes = Buffer.from(await resp.arrayBuffer());
            const ym = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Bangkok",
              year: "numeric",
              month: "2-digit",
            }).format(new Date()); // "YYYY-MM"
            await backupFileToDrive({
              orgId: session.user.orgId,
              category: "contract",
              periodYm: ym,
              fileName: norm(v.contractFileName) ?? `contract-${target.id}`,
              mimeType:
                resp.headers.get("content-type") ?? "application/octet-stream",
              bytes,
              r2Url: newContract,
              sourceTable: "ChairopsUser",
              sourceId: target.id,
            });
          }
        }
      } catch (e) {
        console.error("[chairops] contract drive backup failed (non-fatal)", e);
      }
    }

    revalidatePath(`/chairops/maids/${target.id}`);
    revalidatePath("/chairops/maids");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "เบอร์โทรนี้มีแม่บ้านคนอื่นใช้แล้ว" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

// ============================================================
// Pay ledger (CEO+ADMIN only · MAID/MANAGER/OFFICE no access)
// ============================================================

const recordPaySchema = z.object({
  maidId: zUUID(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องเป็น YYYY-MM-DD"),
  amount: z.coerce
    .number()
    .int("ต้องเป็นจำนวนเต็ม")
    .min(-1_000_000)
    .max(1_000_000),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function recordPay(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole(ChairopsUserRole.ADMIN);

  const parsed = recordPaySchema.safeParse({
    maidId: formData.get("maidId"),
    date: formData.get("date"),
    amount: formData.get("amount"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.maidId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบแม่บ้าน" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์จ่ายค่าจ้างให้ ${target.role}` };
  }
  if (target.role !== ChairopsUserRole.MAID) {
    return { ok: false, error: "บันทึกค่าจ้างได้เฉพาะแม่บ้าน" };
  }

  const date = parseDateYmd(parsed.data.date);
  if (!date) return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  const note = (parsed.data.note ?? "").trim() || null;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.chairopsMaidDailyPay.upsert({
        where: {
          orgId_maidId_date: {
            orgId: session.user.orgId,
            maidId: target.id,
            date,
          },
        },
        create: {
          orgId: session.user.orgId,
          maidId: target.id,
          date,
          amount: parsed.data.amount,
          note,
          paidById: session.user.id,
        },
        update: {
          amount: parsed.data.amount,
          note,
          paidById: session.user.id,
          paidAt: new Date(),
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "maid.pay.record",
          entity: "MaidDailyPay",
          entityId: created.id,
          newValue: {
            maidId: target.id,
            date: parsed.data.date,
            amount: parsed.data.amount,
            note,
          },
        },
        tx,
      );
      return created;
    });

    revalidatePath(`/chairops/maids/${target.id}/pay`);
    revalidatePath(`/chairops/maids/${target.id}`);
    revalidatePath("/chairops/maids");
    revalidatePath("/chairops");
    return { ok: true, data: row };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

const deletePaySchema = z.object({ id: zUUID() });

export async function deletePay(formData: FormData): Promise<ActionResult> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  const parsed = deletePaySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  const existing = await prisma.chairopsMaidDailyPay.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsMaidDailyPay.delete({ where: { id: existing.id } });
    await writeAudit(
      {
        userId: session.user.id,
        action: "maid.pay.delete",
        entity: "MaidDailyPay",
        entityId: existing.id,
        oldValue: {
          maidId: existing.maidId,
          date: existing.date,
          amount: existing.amount,
        },
      },
      tx,
    );
  });

  revalidatePath(`/chairops/maids/${existing.maidId}/pay`);
  revalidatePath(`/chairops/maids/${existing.maidId}`);
  revalidatePath("/chairops/maids");
  return { ok: true };
}

// ============================================================
// Assignment reassignment helper · keeps MaidAssignment in sync
// when admin reassigns maid → branch. Used by the roster detail
// page (lighter-weight than the /chairops/users/[id] surface).
// ============================================================

const reassignSchema = z.object({
  maidId: zUUID(),
  branchId: z.string().nullable(),
});

export async function reassignMaidBranch(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole(ChairopsUserRole.ADMIN);

  const parsed = reassignSchema.safeParse({
    maidId: formData.get("maidId"),
    branchId: formData.get("branchId") || null,
  });
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const target = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.maidId, orgId: session.user.orgId },
  });
  if (!target) return { ok: false, error: "ไม่พบแม่บ้าน" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: `คุณไม่มีสิทธิ์แก้ไขผู้ใช้ระดับ ${target.role}` };
  }
  if (target.role !== ChairopsUserRole.MAID) {
    return { ok: false, error: "ใช้ได้เฉพาะแม่บ้าน" };
  }
  // Suppress unused — kept as defensive sentinel for future MGR delegation.
  void rankOf;

  if (parsed.data.branchId) {
    const branch = await prisma.chairopsBranch.findFirst({
      where: { id: parsed.data.branchId, orgId: session.user.orgId },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขา" };
  }

  if (target.primaryBranchId === parsed.data.branchId) {
    return { ok: false, error: "สาขาเดิมอยู่แล้ว" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // close any open assignment(s) — defensive, normally there is at most one.
      await tx.chairopsMaidAssignment.updateMany({
        where: { userId: target.id, isActive: true, endedAt: null },
        data: { isActive: false, endedAt: new Date() },
      });
      if (parsed.data.branchId) {
        await tx.chairopsMaidAssignment.create({
          data: {
            orgId: session.user.orgId,
            userId: target.id,
            branchId: parsed.data.branchId,
            startedAt: new Date(),
            isActive: true,
          },
        });
      }
      await tx.chairopsUser.update({
        where: { id: target.id },
        data: { primaryBranchId: parsed.data.branchId },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "maid.reassign_branch",
          entity: "User",
          entityId: target.id,
          oldValue: { primaryBranchId: target.primaryBranchId },
          newValue: { primaryBranchId: parsed.data.branchId },
        },
        tx,
      );
    });

    revalidatePath(`/chairops/maids/${target.id}`);
    revalidatePath("/chairops/maids");
    revalidatePath("/chairops");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "มี assignment ค้างอยู่ · refresh แล้วลองใหม่" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}
