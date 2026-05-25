"use server";

// Playland · Server Actions
// All actions require an authenticated session · scope writes by orgId
// Per [[role-rank-privilege-escalation-guard]]: every action calls a role guard
// at top before mutating.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier, canPlaylandManage, canPlaylandAdmin } from "./role-guard";
import { newMemberCode, newSaleCode, newShiftCode } from "./codes";
import { getAdapter } from "./acs/mock-adapter";
import { verifyBranchOrg, verifyMemberOrg, verifyPackageOrg, verifyBookingOrg, isValidThaiPhone, decodePhotoDataUrl } from "./guards";

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

  revalidatePath("/playland");
  revalidatePath("/playland/members");
  return { ok: true, data: { memberId: member.id, faceId: assignedFaceId } };
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
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (!(await verifyMemberOrg(input.memberId, session.user.org_id))) return err("สมาชิกไม่อยู่ใน org");
  if (input.bookingId && !(await verifyBookingOrg(input.bookingId, session.user.org_id))) return err("booking ไม่อยู่ใน org");

  // Prevent double check-in: if member has ACTIVE/PAUSED session, error
  const existing = await prisma.playlandSession.findFirst({
    where: { orgId: session.user.org_id, memberId: input.memberId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true, status: true },
  });
  if (existing) return err(`สมาชิกนี้มี session ${existing.status} อยู่แล้ว · ปิด session เดิมก่อน`);

  const pkg = await prisma.playlandPackage.findFirst({ where: { id: input.packageId, orgId: session.user.org_id, active: true } });
  if (!pkg) return err("Package ไม่พบ");

  const minutes = pkg.minutes ?? 0;
  const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  const created = await prisma.playlandSession.create({
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

  // Update member last visit
  await prisma.playlandMember.update({ where: { id: input.memberId }, data: { lastVisitAt: new Date() } });

  // Link booking if provided
  if (input.bookingId) {
    await prisma.playlandBooking.update({
      where: { id: input.bookingId },
      data: { status: "CHECKED_IN" },
    });
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

export async function checkOutSession(sessionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const sRow = await prisma.playlandSession.findFirst({ where: { id: sessionId, orgId: session.user.org_id } });
  if (!sRow) return err("Session not found");
  await prisma.playlandSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", checkOutAt: new Date(), closedByUserId: session.user.id },
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
      category: "general",
    },
  });
  revalidatePath("/playland");
  revalidatePath("/playland/monitor");
  return { ok: true, data: undefined };
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
  const pkg = await prisma.playlandPackage.findFirst({ where: { id: input.extraPackageId, orgId: session.user.org_id, active: true } });
  if (!pkg) return err("Package not found");
  const extra = pkg.minutes ?? 0;
  const newExpires = sRow.expiresAt ? new Date(sRow.expiresAt.getTime() + extra * 60_000) : new Date(Date.now() + extra * 60_000);
  await prisma.playlandSession.update({
    where: { id: input.sessionId },
    data: {
      packageMinutes: sRow.packageMinutes + extra,
      packagePriceCents: sRow.packagePriceCents + pkg.price,
      extendedCount: sRow.extendedCount + 1,
      expiresAt: newExpires,
      status: sRow.status === "EXPIRED" ? "ACTIVE" : sRow.status,
    },
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
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.items.length === 0) return err("ยังไม่ได้เลือกสินค้า");

  // Find open shift
  const openShift = await prisma.playlandShift.findFirst({
    where: { branchId: input.branchId, cashierUserId: session.user.id, status: "OPEN" },
  });

  const discount = input.discountCents ?? 0;
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

export async function closeShift(input: { shiftId: string; closingCashCents: number; isDayClose: boolean; notes?: string }): Promise<ActionResult<{ varianceCents: number }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const sRow = await prisma.playlandShift.findFirst({ where: { id: input.shiftId, orgId: session.user.org_id, status: "OPEN" } });
  if (!sRow) return err("Shift not found or already closed");
  const expected = sRow.openingCashCents + sRow.totalSalesCents;
  const variance = input.closingCashCents - expected;
  await prisma.playlandShift.update({
    where: { id: input.shiftId },
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
  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: sRow.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: input.isDayClose ? "shift.close_day" : "shift.close",
      entityType: "PlaylandShift",
      entityId: input.shiftId,
      after: { expectedCents: expected, closingCents: input.closingCashCents, varianceCents: variance, isDayClose: input.isDayClose },
      category: "money",
    },
  });
  revalidatePath("/playland/shifts");
  revalidatePath("/playland/reports");
  return { ok: true, data: { varianceCents: variance } };
}

// ============================================================================
// SETTINGS (manager+)
// ============================================================================

export async function upsertPackage(input: { id?: string; branchId: string | null; type: "FIXED" | "PER_MINUTE" | "DAY_PASS"; name: string; description?: string; minutes?: number; price: number; perMinuteRate?: number; active: boolean }): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์");
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

export async function upsertProduct(input: { id?: string; branchId: string; name: string; barcode?: string; sku?: string; category?: string; priceCents: number; costCents?: number; stock: number; reorderLevel?: number; active: boolean }): Promise<ActionResult> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.id) {
    await prisma.playlandProduct.update({
      where: { id: input.id, orgId: session.user.org_id },
      data: {
        name: input.name,
        barcode: input.barcode,
        sku: input.sku,
        category: input.category,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stock: input.stock,
        reorderLevel: input.reorderLevel ?? 0,
        active: input.active,
      },
    });
  } else {
    await prisma.playlandProduct.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        name: input.name,
        barcode: input.barcode,
        sku: input.sku,
        category: input.category,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stock: input.stock,
        reorderLevel: input.reorderLevel ?? 0,
        active: input.active,
      },
    });
  }
  revalidatePath("/playland/settings");
  revalidatePath("/playland/pos");
  return { ok: true, data: undefined };
}

export async function upsertBranch(input: { id?: string; name: string; slug: string; address?: string; phone?: string; settings?: Record<string, unknown>; active: boolean }): Promise<ActionResult<{ branchId: string }>> {
  const session = await requireSession();
  if (!canPlaylandAdmin(session.user.role)) return err("ไม่มีสิทธิ์");
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
  if (!canPlaylandAdmin(session.user.role)) return err("ไม่มีสิทธิ์");
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
