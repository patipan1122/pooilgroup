"use server";

// ClawFleet · ตู้คีบ OS — Wave 2 · ระบบแจ้งซ่อม + rebaseline มิเตอร์หลังซ่อม
// -----------------------------------------------------------------------------
// ทำไมมี: ช่างซ่อมได้แค่ 3/10 · แจ้งซ่อมเดิมเป็นแค่ mock · เปลี่ยนมิเตอร์แล้วโดนหาว่าโกง.
// แนวคิด: การ "ตั้งมิเตอร์ใหม่หลังเปลี่ยนบอร์ด/รีเซ็ต" เป็นเรื่องเงิน (มิเตอร์ = ตัวหารรายได้)
//   → ห้ามให้คนแจ้งซ่อมตั้งเลขเองแล้วมีผลทันที (จะเปิดช่องโกง/ครหา).
//   → ใช้ maker-checker เหมือนใบตัดของเสีย (reviewCfLoss): "ช่างเสนอ" เลขใหม่ ·
//     "ผจก./แอดมิน อนุมัติ" ตอนปิดงาน จึงเขียน baseline จริง · คนเสนอ ≠ คนอนุมัติ.
//
// org-scoped ทุก mutation · แจ้งซ่อม = ความเสี่ยงต่ำ (viewer/staff/ช่างแจ้งได้ ตามสิทธิ์สาขา) ·
// ปิดงาน/ยกเลิก/เปิด-ปิดตู้ = ผจ.สาขา/แอดมินเท่านั้น (CHECKER).
//
// มิเตอร์เก็บเป็น Int (ไม่ใช่ cents).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireCfSession,
  userBranchIds,
  isCfBranchManager,
  cfHasAdminPower,
} from "./role-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";

const REPAIRS_PATH = "/clawfleet/os/repairs";

// mirror config-requests.ts — แยก Result (ไม่มี data) กับ ResultOf<T> (มี data) ชัด ๆ
// กัน conditional-type edge case ใน TS strict.
type Result = { ok: true } | { ok: false; error: string };
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

// FIRST_SETUP redo (ปลดล็อก baseline ตู้เพื่อตั้งใหม่) = super_admin คนเดียวเท่านั้น.
// baseline = ตัวหารรายได้ → org_admin/program_admin/ผจก.สาขา ห้ามปลดล็อก (กันช่องโกง/ครหา).
// ใช้ isSuperAdmin(role) ตรง ๆ · ไม่ reuse cfHasAdminPower/assertCfAdmin (มันเปิดให้ program_admin grant).
function assertSuperAdminOnly(
  session: Awaited<ReturnType<typeof requireCfSession>>,
): boolean {
  const role = session.actingAs ? session.actingAs.realUser.role : session.user.role;
  return isSuperAdmin(role);
}

// CHECKER = ผจก.สาขา หรือ แอดมิน (program_admin ผ่าน user_modules grant) ที่เข้าถึง "สาขาของตู้/ใบนี้" ได้
// → เลิกใช้ isCfChecker(role) static เดิม (ตัด program_admin + ไม่ scope สาขา = ผจก.สาขา A ปิดงานสาขา B ได้)
// → ใช้ userBranchIds(session): "ALL" = admin-power (แอดมิน+program_admin) เห็นทุกสาขา ·
//   ไม่งั้น = list สาขาที่ user สังกัด → ต้องมี branchId ของ ticket/machine อยู่ในลิสต์ + เป็น ผจก.สาขา

// =============================================================
// 1) แจ้งซ่อม (create ticket) — ความเสี่ยงต่ำ · ผู้ใช้ ClawFleet ที่เข้าถึงสาขาตู้ได้แจ้งได้
// =============================================================
const CreateSchema = z.object({
  machineId: z.string().uuid("ไม่ระบุตู้"),
  symptom: z.string().trim().min(1, "กรอกอาการเสีย").max(200),
  note: z.string().trim().max(2000).optional(),
  photoUrls: z.array(z.string().trim().max(1000)).max(12).optional(),
  meterResetRequested: z.boolean().optional(),
  proposedCoinMeter: z.number().int().min(0).max(100_000_000).optional(),
  proposedDollStock: z.number().int().min(0).max(1_000_000).optional(),
});

/**
 * แจ้งซ่อมตู้ใหม่ (สถานะ OPEN). snapshot รหัสตู้ + สาขาจากตู้จริง (org-scoped).
 * ถ้าติ๊ก "ขอตั้งมิเตอร์ใหม่หลังซ่อม" → เก็บเลขที่เสนอไว้เฉย ๆ (ยังไม่แตะ baseline จริง) —
 * baseline จะเปลี่ยนก็ต่อเมื่อ ผจก./แอดมิน อนุมัติตอนปิดงาน (maker-checker).
 * เขียน ticket + log REPORT ในทรานแซกชันเดียว (ไม่มี ticket ลอยไร้ log).
 */
export async function createRepairTicket(input: unknown): Promise<ResultOf<{ ticketId: string }>> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  // สิทธิ์: เข้าถึงสาขาของตู้ได้ (viewer/staff/ผจก./แอดมิน) — แจ้งซ่อม = low risk.
  // เลิกใช้ assertCanAccessMachine (มัน redirect() → ถูก try/catch กลืนเป็น "NEXT_REDIRECT") →
  // ใช้ requireCfSession + โหลดตู้ (org scope) + เช็ก scope สาขาเอง → คืน error ที่อ่านออก.
  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // ดึงตู้ (org scope) → snapshot branchId + code
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId },
    select: { id: true, branchId: true, code: true },
  });
  if (!machine) return err("ไม่พบตู้ในองค์กรนี้");

  // scope สาขา — แจ้งซ่อมได้ทุก role ที่เข้าถึงสาขาของตู้ได้ ("ALL" = admin-power เห็นทุกสาขา)
  const reportScope = await userBranchIds(session);
  if (reportScope !== "ALL" && !reportScope.includes(machine.branchId)) {
    return err("ไม่มีสิทธิ์แจ้งซ่อมตู้สาขานี้");
  }

  // ตั้งมิเตอร์ใหม่ต้องเสนอเลขมาให้ครบ (coin + doll) ไม่งั้นถือว่าไม่ได้ขอ rebaseline
  const meterResetRequested =
    data.meterResetRequested === true &&
    data.proposedCoinMeter != null &&
    data.proposedDollStock != null;
  if (data.meterResetRequested === true && !meterResetRequested) {
    return err("ขอตั้งมิเตอร์ใหม่ต้องกรอกทั้งเลขมิเตอร์เหรียญและจำนวนตุ๊กตาที่เหลือให้ครบ");
  }

  try {
    const ticketId = await prisma.$transaction(async (tx) => {
      const ticket = await tx.cfRepairTicket.create({
        data: {
          orgId,
          branchId: machine.branchId,
          machineId: machine.id,
          machineCode: machine.code,
          symptom: data.symptom,
          note: data.note || null,
          photoUrls: data.photoUrls ?? [],
          status: "OPEN",
          reportedById: session.user.id,
          reportedByName: session.user.name || session.user.email || "ไม่ทราบชื่อ",
          meterResetRequested,
          proposedCoinMeter: meterResetRequested ? data.proposedCoinMeter : null,
          proposedDollStock: meterResetRequested ? data.proposedDollStock : null,
        },
        select: { id: true },
      });

      await tx.cfRepairLog.create({
        data: {
          orgId,
          ticketId: ticket.id,
          action: "REPORT",
          byId: session.user.id,
          byName: session.user.name || session.user.email || "ไม่ทราบชื่อ",
          note: data.symptom,
        },
      });

      return ticket.id;
    });

    revalidatePath(REPAIRS_PATH);
    return { ok: true, data: { ticketId } };
  } catch (e) {
    return err(`แจ้งซ่อมไม่สำเร็จ: ${(e as Error).message}`);
  }
}

// =============================================================
// 1.5) N1 · FIRST_SETUP redo — อนุมัติ "ตั้งค่าครั้งแรกใหม่" (super_admin คนเดียว)
//      ปลดล็อก baseline ตู้ → แม่บ้าน re-capture ได้. คนละ path กับ REPAIR (ไม่แตะ maker-checker เดิม).
// =============================================================
type FirstSetupTicket = {
  id: string;
  machineId: string;
  branchId: string;
  status: string;
  kind: string;
  reportedById: string | null;
};

/**
 * อนุมัติใบ FIRST_SETUP redo — ปลดล็อก baseline ตู้ (isFirstBaselineLocked=false) เพื่อตั้งใหม่.
 *
 * สิทธิ์ = super_admin เท่านั้น (assertSuperAdminOnly) — ไม่ใช่ org_admin/program_admin/ผจก.สาขา.
 * maker≠checker: คนขอตั้งใหม่ (reportedById) ห้ามอนุมัติเอง.
 * atomic claim (status ∈ OPEN|IN_PROGRESS → RESOLVED · count!==1 = โดนปิดไปแล้ว).
 * เขียน audit FIRST_SETUP_REDO + log RECALIBRATE ในทรานเดียว.
 */
async function resolveFirstSetupRedo(
  session: Awaited<ReturnType<typeof requireCfSession>>,
  ticket: FirstSetupTicket,
  orgId: string,
): Promise<Result> {
  // super_admin คนเดียวเท่านั้น (baseline = ตัวหารรายได้)
  if (!assertSuperAdminOnly(session)) {
    return err("อนุมัติตั้งค่าครั้งแรกใหม่ได้เฉพาะ super admin เท่านั้น");
  }

  if (ticket.status === "RESOLVED") return err("ใบนี้ปิดงานไปแล้ว");
  if (ticket.status === "CANCELLED") return err("ใบนี้ถูกยกเลิกไปแล้ว");

  // maker≠checker — คนขอตั้งใหม่ห้ามอนุมัติเอง (segregation of duties)
  if (ticket.reportedById && ticket.reportedById === session.user.id) {
    return err("อนุมัติใบที่ตัวเองขอไม่ได้ · ให้ super admin คนอื่นอนุมัติ (คนเสนอ ≠ คนอนุมัติ)");
  }

  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";

  const result = await prisma
    .$transaction(async (tx) => {
      const now = new Date();

      // atomic claim — อนุมัติได้ครั้งเดียว
      const claim = await tx.cfRepairTicket.updateMany({
        where: { id: ticket.id, orgId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: {
          status: "RESOLVED",
          resolvedById: session.user.id,
          resolvedByName: byName,
          resolvedAt: now,
          meterAppliedAt: now,
        },
      });
      if (claim.count !== 1) {
        throw new Error("ใบนี้เพิ่งถูกปิดงานไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      // ปลดล็อก baseline ตู้ → แม่บ้าน re-capture ได้ (INITIAL event เดิมยังอยู่เป็นประวัติ ·
      // partial-unique index บังคับ 1 INITIAL/ตู้ → การตั้งใหม่ต้องล้าง INITIAL เดิมด้วย ไม่งั้นชน P2002).
      const machine = await tx.cfMachine.findFirst({
        where: { id: ticket.machineId, orgId },
        select: { isFirstBaselineLocked: true, firstBaselineAppliedAt: true },
      });
      if (!machine) throw new Error("ไม่พบตู้ที่จะปลดล็อก baseline ในองค์กรนี้");

      await tx.cfMachine.update({
        where: { id: ticket.machineId },
        data: {
          isFirstBaselineLocked: false,
          firstBaselineAppliedAt: null,
        },
      });

      // ล้าง INITIAL event เดิมของตู้ (VOID) เพื่อเปิดทาง baseline ใหม่ (partial-unique WHERE event_type='INITIAL').
      // เปลี่ยน eventType → VOID (คงประวัติไว้ · ไม่ลบทิ้ง) → index ปล่อยแถวนั้น (WHERE ไม่ match แล้ว).
      await tx.cfCollectionEvent.updateMany({
        where: { orgId, machineId: ticket.machineId, eventType: "INITIAL" },
        data: { eventType: "VOID" },
      });

      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_FIRST_SETUP_REDO",
          resourceType: "CF_MACHINE",
          resourceId: ticket.machineId,
          diff: {
            old: {
              isFirstBaselineLocked: machine.isFirstBaselineLocked,
              firstBaselineAppliedAt: machine.firstBaselineAppliedAt,
            },
            new: { isFirstBaselineLocked: false, firstBaselineAppliedAt: null },
            ticketId: ticket.id,
            reportedById: ticket.reportedById,
            approvedBy: byName,
          },
        },
      });

      await tx.cfRepairLog.create({
        data: {
          orgId,
          ticketId: ticket.id,
          action: "RECALIBRATE",
          byId: session.user.id,
          byName,
          note: "อนุมัติตั้งค่าครั้งแรกใหม่ · ปลดล็อก baseline ตู้ (แม่บ้านตั้งใหม่ได้)",
        },
      });
    })
    .then(() => ({ ok: true as const }))
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(REPAIRS_PATH);
  return { ok: true };
}

// =============================================================
// 2) ปิดงานซ่อม (resolve) — ผจก./แอดมินเท่านั้น = CHECKER
//    + maker-checker rebaseline มิเตอร์ (คนเสนอ ≠ คนอนุมัติ · mirror reviewCfLoss)
// =============================================================
const ResolveSchema = z.object({
  resolutionNote: z.string().trim().max(2000).optional(),
  applyMeterReset: z.boolean().optional(),
  reactivate: z.boolean().optional(),
});

/**
 * ปิดงานซ่อม (OPEN|IN_PROGRESS → RESOLVED). ผจก./แอดมินเท่านั้น.
 *
 * atomic claim ด้วย updateMany where status ∈ [OPEN,IN_PROGRESS] → count!==1 = มีคนปิดไปแล้ว (กันปิดซ้อน).
 *
 * maker-checker rebaseline: ถ้า applyMeterReset && ticket.meterResetRequested && เสนอเลขครบ →
 *   guard resolvedById !== reportedById (คนเสนอ ≠ คนอนุมัติ · segregation of duties เหมือนใบตัดของเสีย) →
 *   เขียน baseline จริง: machine.lastCoinMeter/lastDollStock = เลขที่เสนอ (lastDollMeter คงเดิม) +
 *   ticket.meterAppliedAt=now + auditLog CF_METER_RECALIBRATE (old/new) + log RECALIBRATE.
 * reactivate → machine.isActive=true (เปิดตู้กลับหลังซ่อมเสร็จ).
 * ทั้งหมดใน $transaction เดียว → ถ้าล้มกลางทาง rollback หมด (ไม่มี baseline เปลี่ยนครึ่ง ๆ).
 */
export async function resolveRepairTicket(
  ticketId: string,
  input: unknown,
): Promise<Result> {
  if (typeof ticketId !== "string" || ticketId.length === 0) return err("ไม่ระบุใบแจ้งซ่อม");
  const parsed = ResolveSchema.safeParse(input ?? {});
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // โหลด ticket (org scope) เพื่ออ่านสถานะ + สาขา + ข้อมูล rebaseline ก่อน claim
  const ticket = await prisma.cfRepairTicket.findFirst({
    where: { id: ticketId, orgId },
    select: {
      id: true,
      machineId: true,
      branchId: true,
      status: true,
      kind: true,
      reportedById: true,
      meterResetRequested: true,
      proposedCoinMeter: true,
      proposedDollStock: true,
    },
  });
  if (!ticket) return err("ไม่พบใบแจ้งซ่อม");

  // N1 · FIRST_SETUP redo — คนละเส้นทางกับ REPAIR ปกติ.
  // ปลดล็อก baseline ตู้ (isFirstBaselineLocked=false) เพื่อให้แม่บ้านตั้งค่าครั้งแรกใหม่ได้ ·
  // อนุมัติได้เฉพาะ super_admin (ไม่ใช่ org_admin/program_admin/ผจก.สาขา) · maker≠checker.
  if (ticket.kind === "FIRST_SETUP") {
    return resolveFirstSetupRedo(session, ticket, orgId);
  }

  // CHECKER guard + scope สาขา — ผจก.สาขา/แอดมิน "ของสาขานี้" เท่านั้น
  // admin-power (แอดมิน+program_admin grant) ผ่านทุกสาขา · ผจก.สาขาเข้าเฉพาะสาขาตัวเอง ·
  // viewer (read-only org-wide) เขียนไม่ได้ — ห้ามใช้ scope==="ALL" ตัดสิน admin (viewer ก็ได้ "ALL").
  const adminPower = await cfHasAdminPower(session);
  const isChecker = adminPower || isCfBranchManager(session.user.role);
  if (!isChecker) return err("เฉพาะผู้จัดการสาขา/แอดมินเท่านั้นที่ปิดงานซ่อมได้");
  if (!adminPower) {
    const scope = await userBranchIds(session);
    if (scope !== "ALL" && !scope.includes(ticket.branchId)) {
      return err("ไม่มีสิทธิ์ในสาขานี้");
    }
  }

  if (ticket.status === "RESOLVED") return err("ใบนี้ปิดงานไปแล้ว");
  if (ticket.status === "CANCELLED") return err("ใบนี้ถูกยกเลิกไปแล้ว");

  // ตัดสินใจว่าจะ rebaseline มิเตอร์ไหม
  const wantsRebaseline =
    data.applyMeterReset === true &&
    ticket.meterResetRequested === true &&
    ticket.proposedCoinMeter != null &&
    ticket.proposedDollStock != null;

  // maker ≠ checker — คนเสนอตั้งมิเตอร์ห้ามเป็นคนอนุมัติเอง (กันโกง/ครหา)
  if (wantsRebaseline && ticket.reportedById && ticket.reportedById === session.user.id) {
    return err("ตั้งมิเตอร์ใหม่ที่ตัวเองเสนอไม่ได้ · ให้ผู้จัดการ/แอดมินคนอื่นอนุมัติ (คนเสนอ ≠ คนอนุมัติ)");
  }

  const cleanNote = data.resolutionNote ? data.resolutionNote.slice(0, 2000) : null;
  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";

  const result = await prisma
    .$transaction(async (tx) => {
      const now = new Date();

      // atomic claim — ปิดงานได้ครั้งเดียว (กัน 2 คนปิดพร้อมกัน)
      const claim = await tx.cfRepairTicket.updateMany({
        where: { id: ticket.id, orgId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: {
          status: "RESOLVED",
          resolvedById: session.user.id,
          resolvedByName: byName,
          resolvedAt: now,
          resolutionNote: cleanNote,
          ...(wantsRebaseline ? { meterAppliedAt: now } : {}),
        },
      });
      if (claim.count !== 1) {
        throw new Error("ใบนี้เพิ่งถูกปิดงานไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      // rebaseline มิเตอร์จริง — เขียน baseline ใหม่ให้ตู้ (org scope) ในทรานเดียวกัน
      if (wantsRebaseline) {
        const machine = await tx.cfMachine.findFirst({
          where: { id: ticket.machineId, orgId },
          select: { lastCoinMeter: true, lastDollStock: true },
        });
        if (!machine) {
          throw new Error("ไม่พบตู้ที่จะตั้งมิเตอร์ใหม่ในองค์กรนี้");
        }

        await tx.cfMachine.update({
          where: { id: ticket.machineId },
          data: {
            lastCoinMeter: ticket.proposedCoinMeter ?? machine.lastCoinMeter,
            lastDollStock: ticket.proposedDollStock ?? machine.lastDollStock,
            // lastDollMeter คงเดิม (การซ่อมไม่รีเซ็ตตัวนับตุ๊กตาที่ออกสะสม)
          },
        });

        await tx.auditLog.create({
          data: {
            orgId,
            userId: session.user.id,
            action: "CF_METER_RECALIBRATE",
            resourceType: "CF_MACHINE",
            resourceId: ticket.machineId,
            diff: {
              old: {
                lastCoinMeter: machine.lastCoinMeter,
                lastDollStock: machine.lastDollStock,
              },
              new: {
                lastCoinMeter: ticket.proposedCoinMeter,
                lastDollStock: ticket.proposedDollStock,
              },
              ticketId: ticket.id,
              reportedById: ticket.reportedById,
            },
          },
        });

        await tx.cfRepairLog.create({
          data: {
            orgId,
            ticketId: ticket.id,
            action: "RECALIBRATE",
            byId: session.user.id,
            byName,
            note: `ตั้งมิเตอร์ใหม่ · เหรียญ ${machine.lastCoinMeter}→${ticket.proposedCoinMeter} · ตุ๊กตา ${machine.lastDollStock}→${ticket.proposedDollStock}`,
          },
        });
      }

      // เปิดตู้กลับ (ถ้าเลือก) — หลังซ่อมเสร็จให้กลับมาใช้งาน
      if (data.reactivate === true) {
        await tx.cfMachine.updateMany({
          where: { id: ticket.machineId, orgId },
          data: { isActive: true },
        });
      }

      // log ปิดงาน
      await tx.cfRepairLog.create({
        data: {
          orgId,
          ticketId: ticket.id,
          action: "RESOLVE",
          byId: session.user.id,
          byName,
          note: cleanNote,
        },
      });
    })
    .then(() => ({ ok: true as const }))
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(REPAIRS_PATH);
  return { ok: true };
}

// =============================================================
// 3) ยกเลิกใบแจ้งซ่อม (cancel) — ผจก./แอดมินเท่านั้น
// =============================================================
export async function cancelRepairTicket(ticketId: string, note?: string): Promise<Result> {
  if (typeof ticketId !== "string" || ticketId.length === 0) return err("ไม่ระบุใบแจ้งซ่อม");

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  const cleanNote = typeof note === "string" && note.trim().length > 0 ? note.trim().slice(0, 2000) : null;
  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";

  const ticket = await prisma.cfRepairTicket.findFirst({
    where: { id: ticketId, orgId },
    select: { id: true, branchId: true, status: true },
  });
  if (!ticket) return err("ไม่พบใบแจ้งซ่อม");

  // CHECKER guard + scope สาขา — ผจก.สาขา/แอดมิน "ของสาขานี้" เท่านั้น (viewer เขียนไม่ได้)
  const adminPower = await cfHasAdminPower(session);
  const isChecker = adminPower || isCfBranchManager(session.user.role);
  if (!isChecker) return err("เฉพาะผู้จัดการสาขา/แอดมินเท่านั้นที่ยกเลิกใบแจ้งซ่อมได้");
  if (!adminPower) {
    const scope = await userBranchIds(session);
    if (scope !== "ALL" && !scope.includes(ticket.branchId)) {
      return err("ไม่มีสิทธิ์ในสาขานี้");
    }
  }

  if (ticket.status === "RESOLVED") return err("ใบนี้ปิดงานไปแล้ว · ยกเลิกไม่ได้");
  if (ticket.status === "CANCELLED") return err("ใบนี้ถูกยกเลิกไปแล้ว");

  const result = await prisma
    .$transaction(async (tx) => {
      // atomic claim — ยกเลิกได้ครั้งเดียว (กันชนกับปิดงาน/ยกเลิกซ้อน)
      const claim = await tx.cfRepairTicket.updateMany({
        where: { id: ticket.id, orgId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: { status: "CANCELLED", resolutionNote: cleanNote },
      });
      if (claim.count !== 1) {
        throw new Error("ใบนี้เพิ่งถูกปิด/ยกเลิกไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      await tx.cfRepairLog.create({
        data: {
          orgId,
          ticketId: ticket.id,
          action: "CANCEL",
          byId: session.user.id,
          byName,
          note: cleanNote,
        },
      });
    })
    .then(() => ({ ok: true as const }))
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(REPAIRS_PATH);
  return { ok: true };
}

// =============================================================
// 4) เปิด/ปิดตู้ (toggle active) — ผจก./แอดมินเท่านั้น
//    ปิดตู้ = ระงับการเก็บ/นับชั่วคราวระหว่างรอซ่อม · เปิด = กลับมาใช้งาน
// =============================================================
export async function toggleMachineActive(machineId: string, isActive: boolean): Promise<Result> {
  if (typeof machineId !== "string" || machineId.length === 0) return err("ไม่ระบุตู้");
  if (typeof isActive !== "boolean") return err("สถานะไม่ถูกต้อง");

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId },
    select: { id: true, branchId: true, isActive: true },
  });
  if (!machine) return err("ไม่พบตู้ในองค์กรนี้");

  // CHECKER guard + scope สาขา — ผจก.สาขา/แอดมิน "ของสาขาตู้นี้" เท่านั้น (viewer เขียนไม่ได้)
  const adminPower = await cfHasAdminPower(session);
  const isChecker = adminPower || isCfBranchManager(session.user.role);
  if (!isChecker) return err("เฉพาะผู้จัดการสาขา/แอดมินเท่านั้นที่เปิด/ปิดตู้ได้");
  if (!adminPower) {
    const scope = await userBranchIds(session);
    if (scope !== "ALL" && !scope.includes(machine.branchId)) {
      return err("ไม่มีสิทธิ์ในสาขานี้");
    }
  }

  if (machine.isActive === isActive) {
    // ไม่เปลี่ยนอะไร — idempotent no-op (กดปุ่มเดิมซ้ำ = ผลเท่าเดิม)
    revalidatePath(REPAIRS_PATH);
    return { ok: true };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.cfMachine.updateMany({
        where: { id: machineId, orgId, isActive: machine.isActive },
        data: { isActive },
      });
      if (claim.count !== 1) {
        throw new Error("สถานะตู้เพิ่งถูกเปลี่ยนไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: isActive ? "CF_MACHINE_ACTIVATE" : "CF_MACHINE_DEACTIVATE",
          resourceType: "CF_MACHINE",
          resourceId: machineId,
          diff: { old: { isActive: machine.isActive }, new: { isActive } },
        },
      });
    });

    revalidatePath(REPAIRS_PATH);
    return { ok: true };
  } catch (e) {
    return err(`เปลี่ยนสถานะตู้ไม่สำเร็จ: ${(e as Error).message}`);
  }
}
