"use server";

// Playland · Server Actions
// All actions require an authenticated session · scope writes by orgId
// Per [[role-rank-privilege-escalation-guard]]: every action calls a role guard
// at top before mutating.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier, canPlaylandManage, canPlaylandAdmin } from "./role-guard";
import { getPlaylandRole } from "./position-resolve";
import { newMemberCode, newSaleCode, newShiftCode, newBookingCode } from "./codes";
import { searchMembers } from "./queries";
import { getAdapter } from "./acs/mock-adapter";
import { verifyBranchOrg, verifyBranchAssignment, verifyMemberOrg, verifyPackageOrg, verifyBookingOrg, isValidThaiPhone, decodePhotoDataUrl } from "./guards";
import { requireOpenShift } from "./wristband";
import { readOvertimeRate, overtimeFromExpiry } from "./overtime";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

function err(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

// ============================================================================
// MEMBERS
// ============================================================================

export interface CreateMemberInput {
  branchId: string;
  type: "KID" | "PARENT" | "STAFF" | "CLEANER" | "VIP" | "BABYSITTER" | "GUEST";
  name: string;
  nickname?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  photoR2Path?: string;
  photoDataUrl?: string;
  familyGroupId?: string;
  newFamilyGroupName?: string;
  consentGiven: boolean;
}

export async function createMember(input: CreateMemberInput): Promise<ActionResult<{ memberId: string; faceId: string | null }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์ลงทะเบียนสมาชิก");
  if (!input.consentGiven) return err("ต้องยินยอม PDPA ก่อนลงทะเบียน");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org ของคุณ");
  if (input.phone && !isValidThaiPhone(input.phone)) return err("เบอร์โทรไม่ถูกต้อง (ใช้ 9-10 หลัก เริ่มต้น 0)");
  // Validate photo size to prevent OOM
  if (input.photoDataUrl) {
    try { decodePhotoDataUrl(input.photoDataUrl, 2_000_000); }
    catch (e) { return err(e instanceof Error ? e.message : "photo invalid"); }
  }

  // Find or create family group
  let familyGroupId = input.familyGroupId;
  if (!familyGroupId && input.newFamilyGroupName) {
    const fg = await prisma.playlandFamilyGroup.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        displayName: input.newFamilyGroupName,
        primaryPhone: input.phone,
      },
    });
    familyGroupId = fg.id;
  }

  const member = await prisma.playlandMember.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      memberCode: newMemberCode(),
      type: input.type,
      name: input.name,
      nickname: input.nickname,
      phone: input.phone,
      email: input.email,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
      photoR2Path: input.photoR2Path,
      registeredById: session.user.id,
      consentAt: new Date(),
      // PDPA: retention = 1 ปี หลัง inactive
      retentionUntil: new Date(Date.now() + 365 * 24 * 60 * 60_000),
    },
  });

  if (familyGroupId) {
    await prisma.playlandFamilyMember.create({
      data: {
        orgId: session.user.org_id,
        familyGroupId,
        memberId: member.id,
        role: input.type === "KID" ? "child" : input.type === "PARENT" ? "primary_guardian" : "relative",
        canPickUp: input.type !== "KID",
      },
    });
  }

  // Trigger face sync to device (Version C local cache)
  // Find device(s) at this branch and enqueue
  const devices = await prisma.playlandDevice.findMany({ where: { branchId: input.branchId, status: { not: "DISABLED" } } });
  for (const d of devices) {
    await prisma.playlandFaceSync.create({
      data: { orgId: session.user.org_id, deviceId: d.id, memberId: member.id, status: "PENDING" },
    });
  }

  // For mock: synchronously register and mark synced + assign faceId
  let assignedFaceId: string | null = null;
  if (devices.length > 0 && input.photoDataUrl) {
    const buf = Buffer.from(input.photoDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const adapter = getAdapter(devices[0].vendor);
    try {
      const res = await adapter.registerFace(
        { memberId: member.id, photo: buf },
        {
          id: devices[0].id,
          deviceId: devices[0].deviceId,
          baseUrl: devices[0].baseUrl,
          protocol: devices[0].protocol as "http" | "tcp",
          modelVersion: devices[0].modelVersion as "B" | "C",
          webhookSecret: devices[0].webhookSecret ?? "",
        },
      );
      assignedFaceId = res.faceId;
      await prisma.playlandMember.update({ where: { id: member.id }, data: { faceId: assignedFaceId } });
      await prisma.playlandFaceSync.updateMany({
        where: { memberId: member.id, deviceId: devices[0].id },
        data: { status: "SYNCED", syncedAt: new Date() },
      });
    } catch (e) {
      console.warn("[playland] face register failed", e);
    }
  } else if (input.photoDataUrl) {
    // No device but photo provided · still generate a mock face id so UI demos work
    assignedFaceId = `MOCK-${member.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    await prisma.playlandMember.update({ where: { id: member.id }, data: { faceId: assignedFaceId } });
  }

  // Audit
  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "member.create",
      entityType: "PlaylandMember",
      entityId: member.id,
      after: { name: input.name, type: input.type, faceId: assignedFaceId },
      category: "general",
    },
  });

  // เซฟใบยินยอม/Waiver เป็น "แถวจริง" (เดิมเช็คบ็อกซ์ยินยอมหายไป ไม่บันทึก = ในศาลเท่ากับไม่มี)
  // ผูกกับสมาชิก ครั้งเดียวตอนลงทะเบียน · best-effort (ไม่บล็อกการสมัครถ้า write พลาด)
  try {
    await prisma.playlandWaiver.create({
      data: {
        orgId: session.user.org_id,
        memberId: member.id,
        signatureType: "checkbox",
        signedByName: input.newFamilyGroupName?.trim() || input.name,
        signedByPhone: input.phone ?? null,
        metadata: { consentGiven: true, source: "register", branchId: input.branchId },
      },
    });
  } catch { /* best-effort · สมาชิกถูกสร้างแล้ว · waiver เป็น secondary */ }

  revalidatePath("/playland");
  revalidatePath("/playland/members");
  return { ok: true, data: { memberId: member.id, faceId: assignedFaceId } };
}

// Search members from the client SPA (members screen / check-in "เคยมาแล้ว")
export interface MemberSearchHit {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  memberCode: string | null;
  type: string;
  lastVisitAt: string | null;
}

export async function searchMembersAction(input: { branchId?: string; query: string }): Promise<ActionResult<MemberSearchHit[]>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const q = input.query.trim();
  if (q.length < 1) return { ok: true, data: [] };
  const rows = await searchMembers(session.user.org_id, q, input.branchId, 20);
  return {
    ok: true,
    data: rows.map((m) => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      phone: m.phone,
      memberCode: m.memberCode,
      type: m.type,
      lastVisitAt: m.lastVisitAt ? m.lastVisitAt.toISOString() : null,
    })),
  };
}

// ============================================================================
// SESSIONS (check-in via cashier)
// ============================================================================

export interface CheckInInput {
  branchId: string;
  memberId: string;
  packageId: string;
  paymentMethod: "CASH" | "STRIPE" | "PROMPTPAY" | "KBANK" | "SCB" | "TRUEMONEY" | "LINEPAY" | "CHARGE_TO_MEMBER" | "COMPLIMENTARY";
  paymentRef?: string;
  bookingId?: string;
}

export async function checkInSession(input: CheckInInput): Promise<ActionResult<{ sessionId: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์ check-in");
  if (!(await verifyBranchAssignment(input.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");
  if (!(await verifyMemberOrg(input.memberId, session.user.org_id))) return err("สมาชิกไม่อยู่ใน org");
  if (input.bookingId && !(await verifyBookingOrg(input.bookingId, session.user.org_id))) return err("booking ไม่อยู่ใน org");
  let shiftId: string;
  try { shiftId = await requireOpenShift(session.user.org_id, input.branchId, session.user.id); }
  catch (e) { return err(e instanceof Error ? e.message : "shift required"); }

  // Prevent double check-in: if member has ACTIVE/PAUSED session, error
  const existing = await prisma.playlandSession.findFirst({
    where: { orgId: session.user.org_id, memberId: input.memberId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true, status: true },
  });
  if (existing) return err(`สมาชิกนี้มี session ${existing.status} อยู่แล้ว · ปิด session เดิมก่อน`);

  // booking ที่ยังไม่จ่าย/หมดอายุ/ยกเลิก ห้ามเช็คอินเป็น "เข้าแล้ว"
  //   อนุญาตเฉพาะ PAID (จ่ายออนไลน์แล้ว) หรือ PENDING (มาจ่ายสดที่เคาน์เตอร์ตอนนี้ · เช็คอินจะเก็บเงิน+ออกใบเสร็จให้)
  //   EXPIRED/CANCELLED/NO_SHOW/CHECKED_IN → ปฏิเสธ
  if (input.bookingId) {
    const bk = await prisma.playlandBooking.findFirst({
      where: { id: input.bookingId, orgId: session.user.org_id },
      select: { status: true },
    });
    if (!bk) return err("ไม่พบ booking");
    if (bk.status !== "PAID" && bk.status !== "PENDING") {
      return err(`booking สถานะ ${bk.status} · เช็คอินไม่ได้ (ต้องจ่ายเงินก่อน)`);
    }
  }

  const pkg = await prisma.playlandPackage.findFirst({ where: { id: input.packageId, orgId: session.user.org_id, active: true } });
  if (!pkg) return err("Package ไม่พบ");

  const minutes = pkg.minutes ?? 0;
  const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  // D-A1 (CEO 2026-06-24): ค่าเข้าเล่น = บันทึกเป็น "รายการขายจริง" แยกตามวิธีจ่าย
  //   → ตอนปิดกะ สรุปเงินสดในลิ้นชักได้ตรง (เดิมค่าเข้าไม่เข้าระบบเลย)
  // ทำ session + sale + เพิ่มยอดกะ ใน transaction เดียว (atomic — เงินกับ session เกิดพร้อมกัน)
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
    const sess = await tx.playlandSession.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        memberId: input.memberId,
        packageId: input.packageId,
        bookingId: input.bookingId,
        packageMinutes: minutes,
        packagePriceCents: pkg.price,
        status: "ACTIVE",
        checkInAt: new Date(),
        expiresAt: expiresAt ?? undefined,
        cashierUserId: session.user.id,
      },
    });
    if (pkg.price > 0) {
      await tx.playlandSale.create({
        data: {
          orgId: session.user.org_id,
          branchId: input.branchId,
          shiftId,
          sessionId: sess.id,
          saleCode: newSaleCode(),
          totalCents: pkg.price,
          paymentMethod: input.paymentMethod,
          paymentRef: input.paymentRef,
          cashierUserId: session.user.id,
        },
      });
      await tx.playlandShift.update({ where: { id: shiftId }, data: { totalSessionsCents: { increment: pkg.price } } });
    }
    await tx.playlandMember.update({ where: { id: input.memberId }, data: { lastVisitAt: new Date() } });
    if (input.bookingId) {
      // มาร์ค CHECKED_IN แบบ race-safe: สำเร็จเฉพาะถ้ายัง PAID/PENDING อยู่
      //   (ถ้า booking เพิ่งถูกยกเลิก/หมดอายุพร้อมกัน → ไม่ force-mark · rollback)
      const marked = await tx.playlandBooking.updateMany({
        where: { id: input.bookingId, orgId: session.user.org_id, status: { in: ["PAID", "PENDING"] } },
        data: { status: "CHECKED_IN" },
      });
      if (marked.count !== 1) throw new Error("booking สถานะเปลี่ยนไปแล้ว · เช็คอินไม่ได้");
    }
    return sess;
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : "เช็คอินไม่สำเร็จ");
  }

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "session.checkin",
      entityType: "PlaylandSession",
      entityId: created.id,
      after: { packageId: pkg.id, minutes, priceCents: pkg.price, paymentMethod: input.paymentMethod },
      category: "money",
    },
  });

  revalidatePath("/playland");
  revalidatePath("/playland/monitor");
  return { ok: true, data: { sessionId: created.id } };
}

export interface CheckOutInput {
  sessionId: string;
  /** วิธีจ่ายค่าปรับเกินเวลา (ถ้ามี) · default CASH */
  overtimePaymentMethod?: CheckInInput["paymentMethod"];
  /** บันทึก "ใครมารับเด็ก" — log อย่างเดียว ไม่บล็อก (CEO 2026-06-25) */
  pickedUpByMemberId?: string;
  pickedUpByName?: string;
}

export async function checkOutSession(input: CheckOutInput): Promise<ActionResult<{ overtimeCents: number; overtimeMinutes: number }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const sessionId = input.sessionId;
  const sRow = await prisma.playlandSession.findFirst({
    where: { id: sessionId, orgId: session.user.org_id },
    include: { branch: { select: { settings: true } } },
  });
  if (!sRow) return err("Session not found");
  if (sRow.checkOutAt || sRow.status === "COMPLETED" || sRow.status === "FORFEITED") return err("เช็คเอาท์ไปแล้ว");

  const now = new Date();
  // ค่าปรับเกินเวลา (CEO 2026-06-24): คิดจาก expiresAt จริงฝั่ง server (ไม่เชื่อ client)
  const rate = readOvertimeRate(sRow.branch.settings);
  const ot = overtimeFromExpiry(sRow.packageMinutes, sRow.expiresAt, now, rate);
  // กะที่เปิดอยู่ของแคชเชียร์คนนี้ (ถ้ามี) — ใช้ผูกค่าปรับเข้ากะ · ไม่บังคับ (เช็คเอาท์ต้องทำได้เสมอ)
  const openShift = ot.cents > 0
    ? await prisma.playlandShift.findFirst({ where: { orgId: session.user.org_id, branchId: sRow.branchId, cashierUserId: session.user.id, status: "OPEN" }, select: { id: true } })
    : null;

  await prisma.$transaction(async (tx) => {
    // ปิด session แบบ race-safe: สำเร็จเฉพาะถ้ายังไม่ถูกปิด (กดรัว 2 ครั้ง → ครั้งที่ 2 no-op)
    const closed = await tx.playlandSession.updateMany({
      where: { id: sessionId, orgId: session.user.org_id, status: { in: ["ACTIVE", "PAUSED", "EXPIRED"] }, checkOutAt: null },
      data: { status: "COMPLETED", checkOutAt: now, closedByUserId: session.user.id, pickedUpByMemberId: input.pickedUpByMemberId ?? null, pickedUpByName: input.pickedUpByName?.trim() || null },
    });
    if (closed.count !== 1) throw new Error("เช็คเอาท์ไปแล้ว");
    if (ot.cents > 0) {
      await tx.playlandSale.create({
        data: {
          orgId: session.user.org_id,
          branchId: sRow.branchId,
          shiftId: openShift?.id ?? null,
          sessionId,
          saleCode: newSaleCode(),
          totalCents: ot.cents,
          paymentMethod: input.overtimePaymentMethod ?? "CASH",
          cashierUserId: session.user.id,
        },
      });
      if (openShift) await tx.playlandShift.update({ where: { id: openShift.id }, data: { totalSessionsCents: { increment: ot.cents } } });
    }
    // ปลดสายรัดที่ผูกกับ session นี้ (เดิม checkout ไม่ปลด → สายรัดยัง ACTIVE สแกนเข้าได้)
    await tx.playlandWristband.updateMany({
      where: { sessionId, orgId: session.user.org_id, status: "ACTIVE" },
      data: { status: "RETURNED", returnedAt: now, lastScanAt: now },
    });
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: sRow.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "session.checkout",
      entityType: "PlaylandSession",
      entityId: sessionId,
      after: { overtimeMinutes: ot.minutes, overtimeCents: ot.cents, overtimePaymentMethod: ot.cents > 0 ? (input.overtimePaymentMethod ?? "CASH") : null },
      category: ot.cents > 0 ? "money" : "general",
    },
  });
  revalidatePath("/playland");
  revalidatePath("/playland/monitor");
  return { ok: true, data: { overtimeCents: ot.cents, overtimeMinutes: ot.minutes } };
}

export interface ExtendSessionInput {
  sessionId: string;
  extraPackageId: string;
  paymentMethod: CheckInInput["paymentMethod"];
}

export async function extendSession(input: ExtendSessionInput): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const sRow = await prisma.playlandSession.findFirst({ where: { id: input.sessionId, orgId: session.user.org_id } });
  if (!sRow) return err("Session not found");
  if (!(await verifyBranchAssignment(sRow.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");
  let shiftId: string;
  try { shiftId = await requireOpenShift(session.user.org_id, sRow.branchId, session.user.id); }
  catch (e) { return err(e instanceof Error ? e.message : "shift required"); }
  const pkg = await prisma.playlandPackage.findFirst({ where: { id: input.extraPackageId, orgId: session.user.org_id, active: true } });
  if (!pkg) return err("Package not found");
  const extra = pkg.minutes ?? 0;
  // ต่อเวลาจาก "ตอนนี้" ถ้าเลยเวลาไปแล้ว (เกินเวลา) · ไม่งั้นต่อจาก expiresAt เดิม
  const base = sRow.expiresAt && sRow.expiresAt.getTime() > Date.now() ? sRow.expiresAt.getTime() : Date.now();
  const newExpires = new Date(base + extra * 60_000);
  // D-A1: ต่อเวลา = รายการขายจริง แยกตามวิธีจ่าย (เหมือนค่าเข้า) → ลิ้นชักตรง
  await prisma.$transaction(async (tx) => {
    await tx.playlandSession.update({
      where: { id: input.sessionId },
      data: {
        packageMinutes: sRow.packageMinutes + extra,
        packagePriceCents: sRow.packagePriceCents + pkg.price,
        extendedCount: sRow.extendedCount + 1,
        expiresAt: newExpires,
        status: sRow.status === "EXPIRED" ? "ACTIVE" : sRow.status,
      },
    });
    if (pkg.price > 0) {
      await tx.playlandSale.create({
        data: {
          orgId: session.user.org_id,
          branchId: sRow.branchId,
          shiftId,
          sessionId: input.sessionId,
          saleCode: newSaleCode(),
          totalCents: pkg.price,
          paymentMethod: input.paymentMethod,
          cashierUserId: session.user.id,
        },
      });
      await tx.playlandShift.update({ where: { id: shiftId }, data: { totalSessionsCents: { increment: pkg.price } } });
    }
  });
  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: sRow.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "session.extend",
      entityType: "PlaylandSession",
      entityId: input.sessionId,
      after: { addedMinutes: extra, addedCents: pkg.price, paymentMethod: input.paymentMethod },
      category: "money",
    },
  });
  revalidatePath("/playland");
  revalidatePath("/playland/monitor");
  return { ok: true, data: undefined };
}

export async function resolveAlert(alertId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  await prisma.playlandAlert.updateMany({
    where: { id: alertId, orgId: session.user.org_id, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedByUserId: session.user.id },
  });
  revalidatePath("/playland");
  return { ok: true, data: undefined };
}

// ============================================================================
// POS
// ============================================================================

export interface CreateSaleInput {
  branchId: string;
  sessionId?: string;
  items: Array<{ productId: string; quantity: number }>;
  paymentMethod: CheckInInput["paymentMethod"];
  paymentRef?: string;
  promoId?: string;
  discountCents?: number;
}

export async function createSale(input: CreateSaleInput): Promise<ActionResult<{ saleId: string; totalCents: number }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchAssignment(input.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");
  if (input.items.length === 0) return err("ยังไม่ได้เลือกสินค้า");

  // W3 · shift required (per CEO ans 4A)
  let openShiftId: string;
  try { openShiftId = await requireOpenShift(session.user.org_id, input.branchId, session.user.id); }
  catch (e) { return err(e instanceof Error ? e.message : "shift required"); }
  const openShift = { id: openShiftId };

  // 🔒 นโยบาย CEO 2026-06-25: แคชเชียร์ลดราคาเองไม่ได้ — ส่วนลดมาจาก "โปรโมชั่นส่วนกลาง" เท่านั้น
  // จึง "เพิกเฉย" discountCents ที่ client ส่งมา (กันยิง action ตรงเพื่อลดเงินเข้ากระเป๋า · ไม่มี audit)
  // promo enforcement engine (คำนวณ discount จาก PlaylandPromo ฝั่ง server) = คลื่น 3
  const discount = 0;
  // Stock check INSIDE transaction with SELECT FOR UPDATE-style row lock via update
  // (Prisma uses optimistic via current value · we do a 2-step: refetch in tx, then decrement)
  const result = await prisma.$transaction(async (tx) => {
    const ids = input.items.map((i) => i.productId);
    const products = await tx.playlandProduct.findMany({
      where: { id: { in: ids }, orgId: session.user.org_id, active: true },
    });
    const pmap = new Map(products.map((p) => [p.id, p]));

    let total = 0;
    const lineData: Array<{ productId: string; productName: string; quantity: number; unitCents: number; lineCents: number }> = [];
    for (const it of input.items) {
      const p = pmap.get(it.productId);
      if (!p) throw new Error(`ไม่พบสินค้า ${it.productId}`);
      if (p.stock < it.quantity) throw new Error(`สินค้า "${p.name}" เหลือสต๊อก ${p.stock}`);
      const line = p.priceCents * it.quantity;
      total += line;
      lineData.push({ productId: p.id, productName: p.name, quantity: it.quantity, unitCents: p.priceCents, lineCents: line });
    }
    total = Math.max(0, total - discount);

    const s = await tx.playlandSale.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        sessionId: input.sessionId,
        shiftId: openShift?.id,
        saleCode: newSaleCode(),
        totalCents: total,
        discountCents: discount,
        promoId: input.promoId,
        paymentMethod: input.paymentMethod,
        paymentRef: input.paymentRef,
        cashierUserId: session.user.id,
        lines: { create: lineData.map((l) => ({ orgId: session.user.org_id, ...l })) },
      },
    });
    for (const it of input.items) {
      // Conditional decrement: only succeeds if stock still >= quantity (race-safe)
      const upd = await tx.playlandProduct.updateMany({
        where: { id: it.productId, stock: { gte: it.quantity } },
        data: { stock: { decrement: it.quantity } },
      });
      if (upd.count === 0) throw new Error(`สินค้า ${it.productId} เหลือไม่พอ (race condition)`);
      // ledger: ขายออก
      const pp = pmap.get(it.productId);
      await tx.playlandStockMovement.create({
        data: { orgId: session.user.org_id, branchId: input.branchId, productId: it.productId, kind: "SALE_OUT", quantity: -it.quantity, unitCostCents: pp?.costCents ?? null, balanceAfter: (pp?.stock ?? 0) - it.quantity, refType: "sale", refId: s.id, actorUserId: session.user.id },
      });
    }
    if (openShift) {
      await tx.playlandShift.update({
        where: { id: openShift.id },
        data: { totalSalesCents: { increment: total } },
      });
    }
    return { sale: s, total };
  }).catch((e) => {
    return { error: e instanceof Error ? e.message : String(e) };
  });

  if ("error" in result) return err(result.error);
  const sale = result.sale;
  const total = result.total;

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "sale.create",
      entityType: "PlaylandSale",
      entityId: sale.id,
      after: { totalCents: total, lineCount: input.items.length, paymentMethod: input.paymentMethod },
      category: "money",
    },
  });

  revalidatePath("/playland/pos");
  revalidatePath("/playland/reports");
  return { ok: true, data: { saleId: sale.id, totalCents: total } };
}

// ============================================================================
// SHIFTS
// ============================================================================

export async function openShift(branchId: string, openingCashCents: number): Promise<ActionResult<{ shiftId: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchAssignment(branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");
  const existing = await prisma.playlandShift.findFirst({
    where: { branchId, cashierUserId: session.user.id, status: "OPEN" },
  });
  if (existing) return { ok: true, data: { shiftId: existing.id } };
  const s = await prisma.playlandShift.create({
    data: {
      orgId: session.user.org_id,
      branchId,
      cashierUserId: session.user.id,
      shiftCode: newShiftCode(),
      openingCashCents,
    },
  });
  return { ok: true, data: { shiftId: s.id } };
}

export async function closeShift(input: { shiftId: string; closingCashCents: number; isDayClose: boolean; notes?: string }): Promise<ActionResult<{ varianceCents: number; expectedCashCents: number; byMethod: Record<string, number> }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const sRow = await prisma.playlandShift.findFirst({ where: { id: input.shiftId, orgId: session.user.org_id, status: "OPEN" } });
  if (!sRow) return err("Shift not found or already closed");

  // D-A1 (CEO 2026-06-24): "ควรมีในลิ้นชัก" = เงินเปิดกะ + เงินสด "ที่รับจริง" เท่านั้น
  //   เดิม: openingCash + totalSalesCents (รวมโอน/บัตรเข้าเป็นเงินสด + ค่าเข้าไม่นับ) → variance มั่ว จับขโมยไม่ได้
  //   ใหม่: รวมจากรายการขายจริงในกะ (ขนม + ค่าเข้า + ต่อเวลา + ค่าปรับ) แยกตามวิธีจ่าย · เอาเฉพาะ CASH
  const grouped = await prisma.playlandSale.groupBy({
    by: ["paymentMethod"],
    where: { shiftId: input.shiftId, orgId: session.user.org_id, voidedAt: null },
    _sum: { totalCents: true },
  });
  const byMethod: Record<string, number> = {};
  for (const g of grouped) byMethod[g.paymentMethod] = g._sum.totalCents ?? 0;
  const cashCents = byMethod["CASH"] ?? 0;
  const expected = sRow.openingCashCents + cashCents;
  const variance = input.closingCashCents - expected;

  // ปิดกะแบบ atomic: สำเร็จเฉพาะถ้ายัง OPEN อยู่ (กัน 2 คนกดปิดพร้อมกัน = ตัวเลขเขียนทับ)
  const closed = await prisma.playlandShift.updateMany({
    where: { id: input.shiftId, orgId: session.user.org_id, status: "OPEN" },
    data: {
      status: "CLOSED",
      endedAt: new Date(),
      closingCashCents: input.closingCashCents,
      expectedCashCents: expected,
      varianceCents: variance,
      isDayClose: input.isDayClose,
      notes: input.notes,
      closedByUserId: session.user.id,
    },
  });
  if (closed.count !== 1) return err("กะนี้เพิ่งถูกปิดไปแล้ว (อาจมีคนกดปิดพร้อมกัน) · รีเฟรชหน้าแล้วตรวจอีกครั้ง");
  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: sRow.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: input.isDayClose ? "shift.close_day" : "shift.close",
      entityType: "PlaylandShift",
      entityId: input.shiftId,
      after: { expectedCashCents: expected, openingCashCents: sRow.openingCashCents, cashSalesCents: cashCents, closingCents: input.closingCashCents, varianceCents: variance, byMethod, isDayClose: input.isDayClose },
      category: "money",
    },
  });
  revalidatePath("/playland/shifts");
  revalidatePath("/playland/reports");
  return { ok: true, data: { varianceCents: variance, expectedCashCents: expected, byMethod } };
}

// ยกเลิก/คืนเงินบิล (manager+) — กดผิด/คืนเงินลูกค้า
// บิลที่ void แล้วจะถูกตัดออกจาก "ควรมีในลิ้นชัก" อัตโนมัติ (closeShift กรอง voidedAt:null)
export async function voidSale(input: { saleId: string; reason: string }): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandManage(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("ไม่มีสิทธิ์ยกเลิกบิล · ต้องเป็นผู้จัดการขึ้นไป");
  const sale = await prisma.playlandSale.findFirst({
    where: { id: input.saleId, orgId: session.user.org_id, voidedAt: null },
    include: { lines: true, shift: { select: { status: true } } },
  });
  if (!sale) return err("ไม่พบบิล หรือถูกยกเลิกไปแล้ว");
  // กันยกเลิกบิลของกะที่ปิดแล้ว → ลิ้นชัก/ยอดที่กระทบไปแล้วจะเพี้ยนย้อนหลัง (ต้องปรับผ่านบัญชี)
  if (sale.shift && sale.shift.status !== "OPEN") return err("บิลนี้อยู่ในกะที่ปิดแล้ว · ยกเลิกไม่ได้ (ติดต่อบัญชีเพื่อปรับ)");

  await prisma.$transaction(async (tx) => {
    // race-safe void: สำเร็จเฉพาะถ้ายังไม่ถูก void (กดซ้ำ → ครั้งที่ 2 no-op)
    const voided = await tx.playlandSale.updateMany({
      where: { id: input.saleId, orgId: session.user.org_id, voidedAt: null },
      data: { voidedAt: new Date(), voidedByUserId: session.user.id, voidReason: input.reason.trim() || "ยกเลิกโดยผู้จัดการ" },
    });
    if (voided.count !== 1) throw new Error("บิลถูกยกเลิกไปแล้ว");
    // คืนสต๊อกสินค้ากลับ (เฉพาะบิลที่มีสินค้า · ค่าเข้า/ต่อเวลา/ค่าปรับ ไม่มี line) + ledger คืนเข้า
    for (const l of sale.lines) {
      await tx.playlandStockMovement.create({
        data: { orgId: session.user.org_id, branchId: sale.branchId, productId: l.productId, kind: "RETURN_IN", quantity: l.quantity, refType: "sale", refId: sale.id, note: `ยกเลิกบิล ${sale.saleCode}`, actorUserId: session.user.id },
      });
      await tx.playlandProduct.updateMany({
        where: { id: l.productId, orgId: session.user.org_id },
        data: { stock: { increment: l.quantity } },
      });
    }
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: sale.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "sale.void",
      entityType: "PlaylandSale",
      entityId: sale.id,
      after: { saleCode: sale.saleCode, totalCents: sale.totalCents, reason: input.reason },
      category: "money",
    },
  });
  revalidatePath("/playland/pos");
  revalidatePath("/playland/reports");
  return { ok: true, data: undefined };
}

// ============================================================================
// SETTINGS (manager+)
// ============================================================================

export async function upsertPackage(input: { id?: string; branchId: string | null; type: "FIXED" | "PER_MINUTE" | "DAY_PASS"; name: string; description?: string; minutes?: number; price: number; perMinuteRate?: number; active: boolean }): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandManage(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("ไม่มีสิทธิ์");
  if (input.branchId && !(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.id) {
    await prisma.playlandPackage.update({
      where: { id: input.id, orgId: session.user.org_id },
      data: {
        type: input.type,
        name: input.name,
        description: input.description,
        minutes: input.minutes,
        price: input.price,
        perMinuteRate: input.perMinuteRate,
        active: input.active,
      },
    });
  } else {
    await prisma.playlandPackage.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        type: input.type,
        name: input.name,
        description: input.description,
        minutes: input.minutes,
        price: input.price,
        perMinuteRate: input.perMinuteRate,
        active: input.active,
      },
    });
  }
  revalidatePath("/playland/settings");
  revalidatePath("/playland");
  return { ok: true, data: undefined };
}

export async function upsertProduct(input: { id?: string; branchId: string; kind?: "SALE_ITEM" | "SPARE_PART"; name: string; barcode?: string; sku?: string; category?: string; supplier?: string; priceCents: number; costCents?: number; stock: number; reorderLevel?: number; active: boolean; imageR2Path?: string | null }): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandManage(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.id) {
    await prisma.playlandProduct.update({
      where: { id: input.id, orgId: session.user.org_id },
      data: {
        name: input.name,
        kind: input.kind,
        barcode: input.barcode,
        sku: input.sku,
        category: input.category,
        supplier: input.supplier,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stock: input.stock,
        reorderLevel: input.reorderLevel ?? 0,
        active: input.active,
        // เก็บรูปสินค้าเฉพาะเมื่อส่งค่ามา (undefined = ไม่แตะของเดิม · "" = ล้างรูป)
        ...(input.imageR2Path !== undefined ? { imageR2Path: input.imageR2Path || null } : {}),
      },
    });
  } else {
    await prisma.playlandProduct.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        kind: input.kind ?? "SALE_ITEM",
        name: input.name,
        barcode: input.barcode,
        sku: input.sku,
        category: input.category,
        supplier: input.supplier,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stock: input.stock,
        reorderLevel: input.reorderLevel ?? 0,
        active: input.active,
        imageR2Path: input.imageR2Path || null,
      },
    });
  }
  revalidatePath("/playland/settings");
  revalidatePath("/playland/pos");
  revalidatePath("/playland/stock");
  return { ok: true, data: undefined };
}

export async function upsertBranch(input: { id?: string; name: string; slug: string; address?: string; phone?: string; settings?: Record<string, unknown>; active: boolean }): Promise<ActionResult<{ branchId: string }>> {
  const session = await requireSession();
  if (!canPlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("ไม่มีสิทธิ์");
  if (input.id) {
    const u = await prisma.playlandBranch.update({
      where: { id: input.id, orgId: session.user.org_id },
      data: { name: input.name, slug: input.slug, address: input.address, phone: input.phone, settings: input.settings as object, active: input.active },
    });
    return { ok: true, data: { branchId: u.id } };
  }
  const c = await prisma.playlandBranch.create({
    data: { orgId: session.user.org_id, name: input.name, slug: input.slug, address: input.address, phone: input.phone, settings: input.settings as object, active: input.active },
  });
  return { ok: true, data: { branchId: c.id } };
}

export async function upsertDevice(input: { id?: string; branchId: string; deviceId: string; deviceName: string; vendor?: string; baseUrl?: string; protocol?: "http" | "tcp"; modelVersion?: "B" | "C"; webhookSecret?: string }): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("ไม่มีสิทธิ์");
  if (input.id) {
    await prisma.playlandDevice.update({
      where: { id: input.id, orgId: session.user.org_id },
      data: {
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        vendor: input.vendor ?? "acs-auto",
        baseUrl: input.baseUrl,
        protocol: input.protocol ?? "http",
        modelVersion: input.modelVersion ?? "C",
        webhookSecret: input.webhookSecret,
      },
    });
  } else {
    await prisma.playlandDevice.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        vendor: input.vendor ?? "acs-auto",
        baseUrl: input.baseUrl,
        protocol: input.protocol ?? "http",
        modelVersion: input.modelVersion ?? "C",
        webhookSecret: input.webhookSecret,
      },
    });
  }
  revalidatePath("/playland/settings");
  return { ok: true, data: undefined };
}

// ============================================================================
// BOOKINGS (walk-up / phone bookings created by cashier)
// Mirrors app/api/playland/bookings/create/route.ts but auth-scoped for staff.
// ============================================================================

export interface CreateBookingInput {
  branchId: string;
  packageId: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  /** YYYY-MM-DD (local) */
  slotDate: string;
  /** 0-23 */
  slotHour: number;
  paymentMethod?: CheckInInput["paymentMethod"];
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<ActionResult<{ bookingId: string; bookingCode: string; amountCents: number }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์จองล่วงหน้า");
  if (!(await verifyBranchAssignment(input.branchId, session.user.org_id, session.user.id, session.user.role))) return err("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");
  if (!input.customerName.trim()) return err("กรอกชื่อลูกค้า");
  if (!isValidThaiPhone(input.customerPhone)) return err("เบอร์โทรไม่ถูกต้อง (ใช้ 9-10 หลัก เริ่มต้น 0)");
  if (input.partySize < 1 || input.partySize > 20) return err("จำนวนคน 1-20");
  if (input.slotHour < 0 || input.slotHour > 23) return err("เวลาไม่ถูกต้อง");

  const slotStart = new Date(`${input.slotDate}T${String(input.slotHour).padStart(2, "0")}:00:00+07:00`);
  if (Number.isNaN(slotStart.getTime())) return err("วันที่/เวลาไม่ถูกต้อง");
  if (slotStart.getTime() < Date.now() - 24 * 3600_000) return err("เลือกวันในอดีตไม่ได้");

  const pkg = await prisma.playlandPackage.findFirst({
    where: { id: input.packageId, orgId: session.user.org_id, active: true },
  });
  if (!pkg) return err("Package ไม่พบ");

  const slotEnd = new Date(slotStart.getTime() + (pkg.minutes ?? 60) * 60_000);
  const amount = pkg.price * input.partySize;

  const booking = await prisma.playlandBooking.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      packageId: pkg.id,
      bookingCode: newBookingCode(),
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone,
      partySize: Math.max(1, input.partySize),
      slotStart,
      slotEnd,
      amountCents: amount,
      paymentMethod: input.paymentMethod ?? "CASH",
      paymentStatus: "pending",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    },
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "booking.create",
      entityType: "PlaylandBooking",
      entityId: booking.id,
      after: { bookingCode: booking.bookingCode, amountCents: amount, partySize: input.partySize },
      category: "money",
    },
  });

  revalidatePath("/playland");
  revalidatePath("/playland/bookings");
  return { ok: true, data: { bookingId: booking.id, bookingCode: booking.bookingCode, amountCents: amount } };
}
