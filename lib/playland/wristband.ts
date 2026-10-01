"use server";

// Playland · Wristband (QR strap) · Harborland-style /bigfeature W1
//
// State machine per CEO 2026-05-26:
//   issue → ISSUED (bound to paid member · waiting at gate)
//   scan at gate → ACTIVE (opens session if not already)
//   scan again → picker: ออก (RETURNED) / ขายของ (POS_CHARGE)
//
// QR code = 12-char short alphanumeric · easy to print on small square
// Format: prefix `PW-` + 9 random chars · e.g. `PW-A3F9K2BC7`

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "./role-guard";
import { verifyBranchOrg, verifyBranchAssignment, verifyMemberOrg } from "./guards";
import { newSaleCode } from "./codes";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { normalizeWristbandCode, WRISTBAND_PREFIX, WRISTBAND_CODE_ALPHABET } from "./wristband-code";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
function err(msg: string) { return { ok: false as const, error: msg }; }

// ────────────────────────────────────────────────────────────────────────────
// Code generation · 12 chars · case-insensitive lookup but stored upper
// ────────────────────────────────────────────────────────────────────────────
function generateWristbandCode(): string {
  const bytes = crypto.randomBytes(9);
  let out = WRISTBAND_PREFIX;
  for (let i = 0; i < 9; i++) out += WRISTBAND_CODE_ALPHABET[bytes[i] % WRISTBAND_CODE_ALPHABET.length];
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Shift guard · enforced on every cashier action (per CEO ans 4A)
// ────────────────────────────────────────────────────────────────────────────
export async function requireOpenShift(orgId: string, branchId: string, cashierUserId: string) {
  const shift = await prisma.playlandShift.findFirst({
    where: { orgId, branchId, cashierUserId, status: "OPEN" },
    select: { id: true },
  });
  if (!shift) {
    throw new Error("ยังไม่ได้เปิดกะ · กรุณาเปิดกะที่ /playland/shifts ก่อน");
  }
  return shift.id;
}

// ────────────────────────────────────────────────────────────────────────────
// LIST · ลูกค้าวันนี้ที่ต้องออก/พิมพ์สายรัด (จ่ายเงินแล้วรอสแกนเข้า + กำลังเล่น/พักอยู่)
// หน้า "ออกสายรัดใหม่" เลือกชื่อจากรายการนี้ แทนการต้องไปค้นหาสมาชิกแล้วกลับมา (CEO 2026-10-01)
// ────────────────────────────────────────────────────────────────────────────
export interface StrapCandidate {
  sessionId: string;
  memberId: string;
  name: string;
  nickname: string | null;
  packageMinutes: number;
  status: "PENDING_ENTRY" | "ACTIVE" | "PAUSED";
  wristband: { id: string; code: string; status: string } | null;
}

export async function listStrapCandidates(branchId: string): Promise<ActionResult<StrapCandidate[]>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchAssignment(branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");

  // เริ่มวัน = 00:00 เวลาไทย (UTC+7) · รอสแกนเข้า (PENDING_ENTRY) นับเฉพาะของวันนี้ กันของค้างเก่า
  const BKK = 7 * 3600_000;
  const bkk = new Date(Date.now() + BKK);
  const startOfDay = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()) - BKK);

  const rows = await prisma.playlandSession.findMany({
    where: {
      orgId: session.user.org_id,
      branchId,
      OR: [{ status: "PENDING_ENTRY", createdAt: { gte: startOfDay } }, { status: { in: ["ACTIVE", "PAUSED"] } }],
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      memberId: true,
      packageMinutes: true,
      status: true,
      member: { select: { name: true, nickname: true } },
      wristbands: { where: { status: { in: ["ISSUED", "ACTIVE"] } }, orderBy: { issuedAt: "desc" }, take: 1, select: { id: true, code: true, status: true } },
    },
  });

  return {
    ok: true,
    data: rows
      .filter((r) => r.status === "PENDING_ENTRY" || r.status === "ACTIVE" || r.status === "PAUSED")
      .map((r) => ({
        sessionId: r.id,
        memberId: r.memberId,
        name: r.member.name,
        nickname: r.member.nickname,
        packageMinutes: r.packageMinutes,
        status: r.status as StrapCandidate["status"],
        wristband: r.wristbands[0] ?? null,
      })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ISSUE · cashier hands a paid wristband to a member
// ────────────────────────────────────────────────────────────────────────────
export async function issueWristband(input: {
  branchId: string;
  memberId: string;
  /** ถ้าจ่ายเงินไว้แล้วที่เคาน์เตอร์ (checkInSession สร้าง session แบบ PENDING_ENTRY ไว้ก่อน)
   *  ผูกสายรัดนี้เข้ากับ session นั้น · scan ที่ประตูจะแค่ "เริ่มเวลา" ไม่เก็บเงินซ้ำ */
  sessionId?: string;
}): Promise<ActionResult<{ wristbandId: string; code: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchAssignment(input.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");
  if (!(await verifyMemberOrg(input.memberId, session.user.org_id))) return err("สมาชิกไม่อยู่ใน org");

  try {
    await requireOpenShift(session.user.org_id, input.branchId, session.user.id);
  } catch (e) {
    return err(e instanceof Error ? e.message : "shift required");
  }

  if (input.sessionId) {
    const pending = await prisma.playlandSession.findFirst({
      where: { id: input.sessionId, orgId: session.user.org_id, memberId: input.memberId, status: "PENDING_ENTRY" },
      select: { id: true },
    });
    if (!pending) return err("session ที่จะผูกสายรัดนี้ไม่พบ หรือสถานะเปลี่ยนไปแล้ว");
  }

  // Retry-on-collision (extremely rare with 24^9 ≈ 2.6 trillion combos)
  let code = generateWristbandCode();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.playlandWristband.findUnique({ where: { code }, select: { id: true } });
    if (!existing) break;
    code = generateWristbandCode();
  }

  const w = await prisma.playlandWristband.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      code,
      memberId: input.memberId,
      sessionId: input.sessionId,
      status: "ISSUED",
      issuedByUserId: session.user.id,
      boundAt: new Date(),
    },
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id, branchId: input.branchId, actorUserId: session.user.id, actorRole: session.user.role,
      action: "wristband.issue", entityType: "PlaylandWristband", entityId: w.id, category: "general",
      after: { code, memberId: input.memberId },
    },
  });

  revalidatePath("/playland/wristbands");
  revalidatePath("/playland");
  return { ok: true, data: { wristbandId: w.id, code } };
}

// ────────────────────────────────────────────────────────────────────────────
// SCAN · lookup wristband + return allowed-actions per state
// ────────────────────────────────────────────────────────────────────────────
export type WristbandLookup = {
  wristband: {
    id: string;
    code: string;
    status: string;
    boundAt: string | null;
    activatedAt: string | null;
  };
  member: {
    id: string;
    name: string;
    nickname: string | null;
    memberCode: string | null;
    type: string;
    photoR2Path: string | null;
  } | null;
  session: {
    id: string;
    status: string;
    expiresAt: string | null;
    packageName: string;
  } | null;
  allowedActions: Array<"ACTIVATE" | "ACTIVATE_PENDING" | "POS_CHARGE" | "EXIT" | "REBIND">;
  hint: string;
};

export async function lookupWristband(rawCode: string): Promise<ActionResult<WristbandLookup>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");

  const code = normalizeWristbandCode(rawCode);
  if (!code) return err("กรอก code ก่อน");

  const w = await prisma.playlandWristband.findFirst({
    where: { code, orgId: session.user.org_id },
    include: {
      member: { select: { id: true, name: true, nickname: true, memberCode: true, type: true, photoR2Path: true } },
      session: { include: { package: { select: { name: true } } } },
    },
  });
  if (!w) return err(`ไม่พบ wristband "${code}" · อาจพิมพ์ผิด หรือ ยังไม่ได้ออกที่สาขานี้`);

  // State → allowed actions
  let allowedActions: WristbandLookup["allowedActions"] = [];
  let hint = "";
  if (w.status === "LOST") {
    hint = "wristband นี้ถูก mark เป็น LOST · ห้ามใช้";
  } else if (w.status === "RETURNED") {
    hint = "wristband นี้คืนแล้ว · ออก wristband ใหม่ถ้าจะใช้อีก";
  } else if (w.status === "ISSUED") {
    if (w.sessionId && w.session?.status === "PENDING_ENTRY") {
      // จ่ายเงินไว้แล้วที่เคาน์เตอร์ · scan นี้แค่เริ่มเวลา ไม่เก็บเงินซ้ำ
      allowedActions = ["ACTIVATE_PENDING"];
      hint = "จ่ายเงินแล้วที่เคาน์เตอร์ · กดเพื่อเริ่มเวลาเล่น";
    } else {
      // First scan at gate · collect payment + activate session
      allowedActions = ["ACTIVATE"];
      hint = "ครั้งแรก · กดเปิด gate + เริ่มเวลาเล่น";
    }
  } else if (w.status === "ACTIVE") {
    allowedActions = ["POS_CHARGE", "EXIT"];
    hint = "เลือก: ขายของให้คนนี้ · หรือ ออก (จบ session)";
  }

  // Log the lookup (for audit-trace of scans)
  await prisma.playlandWristbandScan.create({
    data: {
      orgId: session.user.org_id,
      wristbandId: w.id,
      scannedByUserId: session.user.id,
      scanType: "LOOKUP",
      outcome: "picker_shown",
      metadata: { allowedActions },
    },
  });
  await prisma.playlandWristband.update({ where: { id: w.id }, data: { lastScanAt: new Date() } });

  return {
    ok: true,
    data: {
      wristband: {
        id: w.id,
        code: w.code,
        status: w.status,
        boundAt: w.boundAt?.toISOString() ?? null,
        activatedAt: w.activatedAt?.toISOString() ?? null,
      },
      member: w.member ? {
        id: w.member.id, name: w.member.name, nickname: w.member.nickname,
        memberCode: w.member.memberCode, type: w.member.type, photoR2Path: w.member.photoR2Path,
      } : null,
      session: w.session ? {
        id: w.session.id, status: w.session.status,
        expiresAt: w.session.expiresAt?.toISOString() ?? null,
        packageName: w.session.package?.name ?? "—",
      } : null,
      allowedActions,
      hint,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ACTIVATE · scan #2 at gate · move ISSUED → ACTIVE + create session if needed
// ────────────────────────────────────────────────────────────────────────────
export async function activateWristband(input: {
  code: string;
  packageId: string;
  paymentMethod: "CASH" | "PROMPTPAY" | "STRIPE" | "CHARGE_TO_MEMBER";
}): Promise<ActionResult<{ sessionId: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");

  const code = normalizeWristbandCode(input.code);
  const w = await prisma.playlandWristband.findFirst({
    where: { code, orgId: session.user.org_id, status: "ISSUED" },
  });
  if (!w) return err("wristband ไม่อยู่ในสถานะ ISSUED");
  if (!w.memberId) return err("wristband ยังไม่ได้ผูกสมาชิก");
  if (!(await verifyBranchAssignment(w.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");

  // Prevent double-charge: same guard checkInSession already has — a member
  // who already has a live (paid-and-waiting or playing) session must close/
  // activate it first, not get a second paid session opened via this path.
  // [[playland-auditbigteam-track-a-5-p0-2026-09-29]]
  const existingSession = await prisma.playlandSession.findFirst({
    where: { orgId: session.user.org_id, memberId: w.memberId, status: { in: ["PENDING_ENTRY", "ACTIVE", "PAUSED"] } },
    select: { id: true, status: true },
  });
  if (existingSession) return err(`สมาชิกนี้มี session ${existingSession.status} อยู่แล้ว · ปิด/เริ่มเวลา session เดิมก่อน`);

  let shiftId: string;
  try {
    shiftId = await requireOpenShift(session.user.org_id, w.branchId, session.user.id);
  } catch (e) {
    return err(e instanceof Error ? e.message : "shift required");
  }

  const pkg = await prisma.playlandPackage.findFirst({
    where: { id: input.packageId, orgId: session.user.org_id, active: true },
  });
  if (!pkg) return err("Package ไม่พบ");

  const minutes = pkg.minutes ?? 0;
  const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  const result = await prisma.$transaction(async (tx) => {
    const s = await tx.playlandSession.create({
      data: {
        orgId: session.user.org_id,
        branchId: w.branchId,
        memberId: w.memberId!,
        packageId: pkg.id,
        packageMinutes: minutes,
        packagePriceCents: pkg.price,
        status: "ACTIVE",
        checkInAt: new Date(),
        expiresAt,
        cashierUserId: session.user.id,
      },
    });
    // D-A1 (CEO 2026-06-24): ค่าเข้าตอนเปิดสายรัดที่ประตู = บันทึกเป็น "รายการขายจริง" + บวกเข้ายอดกะ
    //   (เดิมเปิดสายรัดเก็บเงินค่าเข้าแต่เงินไม่เข้าระบบ/ลิ้นชักเลย · ตรงนี้ atomic กับ session ในทรานแซกชันเดียว)
    if (pkg.price > 0) {
      await tx.playlandSale.create({
        data: {
          orgId: session.user.org_id,
          branchId: w.branchId,
          shiftId,
          sessionId: s.id,
          saleCode: newSaleCode(),
          totalCents: pkg.price,
          paymentMethod: input.paymentMethod,
          cashierUserId: session.user.id,
        },
      });
      await tx.playlandShift.update({ where: { id: shiftId }, data: { totalSessionsCents: { increment: pkg.price } } });
    }
    await tx.playlandWristband.update({
      where: { id: w.id },
      data: { status: "ACTIVE", activatedAt: new Date(), sessionId: s.id, lastScanAt: new Date() },
    });
    await tx.playlandWristbandScan.create({
      data: {
        orgId: session.user.org_id, wristbandId: w.id, scannedByUserId: session.user.id,
        scanType: "GATE_IN", outcome: "ok",
        metadata: { sessionId: s.id, packageId: pkg.id, paymentMethod: input.paymentMethod },
      },
    });
    return s;
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id, branchId: w.branchId, actorUserId: session.user.id, actorRole: session.user.role,
      action: "wristband.activate", entityType: "PlaylandWristband", entityId: w.id,
      category: "money", after: { sessionId: result.id, packageId: pkg.id, priceCents: pkg.price, paymentMethod: input.paymentMethod },
    },
  });

  revalidatePath("/playland");
  return { ok: true, data: { sessionId: result.id } };
}

// ────────────────────────────────────────────────────────────────────────────
// ACTIVATE PENDING · scan at gate for a wristband ALREADY paid at the counter
// (checkInSession created the session as PENDING_ENTRY · this scan is what
// actually starts the clock — no payment collected here, it happened already)
// D-A2 (CEO 2026-09-29)
// ────────────────────────────────────────────────────────────────────────────
export async function activatePendingSession(code: string): Promise<ActionResult<{
  sessionId: string;
  memberName: string;
  memberNickname: string | null;
  packageLabel: string;
  packageMinutes: number;
  packagePriceCents: number;
}>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");

  const upper = normalizeWristbandCode(code);
  const w = await prisma.playlandWristband.findFirst({
    where: { code: upper, orgId: session.user.org_id, status: "ISSUED" },
    include: {
      member: { select: { name: true, nickname: true } },
      session: { include: { package: { select: { name: true } } } },
    },
  });
  if (!w) return err("wristband ไม่อยู่ในสถานะ ISSUED");
  if (!w.sessionId || !w.session) return err('wristband นี้ยังไม่ได้จ่ายเงิน · ใช้ปุ่ม "เปิด gate · เริ่มเล่น" แทน');
  if (w.session.status !== "PENDING_ENTRY") return err(`session สถานะ ${w.session.status} อยู่แล้ว · เริ่มเวลาซ้ำไม่ได้`);
  if (!(await verifyBranchAssignment(w.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");

  const now = new Date();
  const expiresAt = w.session.packageMinutes > 0 ? new Date(now.getTime() + w.session.packageMinutes * 60_000) : null;

  await prisma.$transaction(async (tx) => {
    // Race-safe: สำเร็จเฉพาะถ้ายังเป็น PENDING_ENTRY อยู่ · กันสแกนซ้อน 2 ครั้งพร้อมกันรีเซ็ตเวลาซ้ำ
    const activated = await tx.playlandSession.updateMany({
      where: { id: w.sessionId!, status: "PENDING_ENTRY" },
      data: { status: "ACTIVE", checkInAt: now, expiresAt },
    });
    if (activated.count !== 1) throw new Error("session ถูกเริ่มเวลาไปแล้ว หรือสถานะเปลี่ยนไปแล้ว");
    await tx.playlandWristband.update({
      where: { id: w.id },
      data: { status: "ACTIVE", activatedAt: now, lastScanAt: now },
    });
    await tx.playlandWristbandScan.create({
      data: {
        orgId: session.user.org_id, wristbandId: w.id, scannedByUserId: session.user.id,
        scanType: "GATE_IN", outcome: "ok", metadata: { sessionId: w.sessionId },
      },
    });
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id, branchId: w.branchId, actorUserId: session.user.id, actorRole: session.user.role,
      action: "session.activate_pending", entityType: "PlaylandSession", entityId: w.sessionId,
      category: "general", after: { expiresAt },
    },
  });

  revalidatePath("/playland");
  return {
    ok: true,
    data: {
      sessionId: w.sessionId,
      memberName: w.member?.name ?? "—",
      memberNickname: w.member?.nickname ?? null,
      packageLabel: w.session.package?.name ?? "—",
      packageMinutes: w.session.packageMinutes,
      packagePriceCents: w.session.packagePriceCents,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// EXIT · scan + choose ออก · ACTIVE → RETURNED + close session
// ────────────────────────────────────────────────────────────────────────────
export async function exitWristband(code: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const upper = normalizeWristbandCode(code);

  const w = await prisma.playlandWristband.findFirst({
    where: { code: upper, orgId: session.user.org_id, status: "ACTIVE" },
  });
  if (!w) return err("wristband ไม่อยู่ในสถานะ ACTIVE");
  if (!(await verifyBranchAssignment(w.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");

  await prisma.$transaction(async (tx) => {
    if (w.sessionId) {
      await tx.playlandSession.update({
        where: { id: w.sessionId },
        data: { status: "COMPLETED", checkOutAt: new Date(), closedByUserId: session.user.id },
      });
    }
    await tx.playlandWristband.update({
      where: { id: w.id },
      data: { status: "RETURNED", returnedAt: new Date(), lastScanAt: new Date() },
    });
    await tx.playlandWristbandScan.create({
      data: {
        orgId: session.user.org_id, wristbandId: w.id, scannedByUserId: session.user.id,
        scanType: "EXIT", outcome: "ok",
        metadata: { sessionId: w.sessionId },
      },
    });
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id, branchId: w.branchId, actorUserId: session.user.id, actorRole: session.user.role,
      action: "wristband.exit", entityType: "PlaylandWristband", entityId: w.id, category: "general",
    },
  });

  revalidatePath("/playland");
  return { ok: true, data: undefined };
}

// ────────────────────────────────────────────────────────────────────────────
// OFFLINE · cache active wristbands for a branch + bulk-sync queued scans
// (per [[playland-offline-first-decision]]) · cashier tablet works when net drops
// ────────────────────────────────────────────────────────────────────────────
export async function getActiveWristbandsForCache(branchId: string): Promise<ActionResult<Array<{
  code: string; status: string; branchId: string; memberName: string | null;
}>>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  // Only ISSUED + ACTIVE are scannable · RETURNED/LOST excluded (=deny anyway)
  const rows = await prisma.playlandWristband.findMany({
    where: { orgId: session.user.org_id, branchId, status: { in: ["ISSUED", "ACTIVE"] } },
    select: { code: true, status: true, branchId: true, member: { select: { name: true } } },
    take: 2000,
  });
  return {
    ok: true,
    data: rows.map((r) => ({ code: r.code, status: r.status, branchId: r.branchId, memberName: r.member?.name ?? null })),
  };
}

export async function syncOfflineScans(input: {
  branchId: string;
  scans: Array<{ code: string; scannedAt: number; outcome: string }>;
}): Promise<ActionResult<{ synced: number }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.scans.length === 0) return { ok: true, data: { synced: 0 } };

  let synced = 0;
  for (const s of input.scans.slice(0, 500)) {
    const w = await prisma.playlandWristband.findFirst({
      where: { code: normalizeWristbandCode(s.code), orgId: session.user.org_id },
      select: { id: true },
    });
    if (!w) continue;
    await prisma.playlandWristbandScan.create({
      data: {
        orgId: session.user.org_id,
        wristbandId: w.id,
        scannedByUserId: session.user.id,
        scanType: "GATE_IN",
        outcome: `offline_${s.outcome}`,
        metadata: { source: "offline_sync", scannedAt: new Date(s.scannedAt).toISOString() },
      },
    });
    synced++;
  }
  return { ok: true, data: { synced } };
}

// ────────────────────────────────────────────────────────────────────────────
// LOST · cashier marks wristband as lost · prevents re-use
// ────────────────────────────────────────────────────────────────────────────
export async function markWristbandLost(code: string, notes?: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const w = await prisma.playlandWristband.findFirst({
    where: { code: normalizeWristbandCode(code), orgId: session.user.org_id },
  });
  if (!w) return err("ไม่พบ wristband");
  await prisma.playlandWristband.update({ where: { id: w.id }, data: { status: "LOST", notes: notes ?? w.notes } });
  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id, branchId: w.branchId, actorUserId: session.user.id, actorRole: session.user.role,
      action: "wristband.lost", entityType: "PlaylandWristband", entityId: w.id, category: "general", after: { notes },
    },
  });
  revalidatePath("/playland/wristbands");
  return { ok: true, data: undefined };
}
