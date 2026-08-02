"use server";

import { randomUUID, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { putObject } from "@/lib/r2/upload";
import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/log";
import { toNum, currentPeriod } from "@/lib/rentspace/format";
import { createBillForContract, recomputeBillTotals, computeMeterUsage, round2 } from "@/lib/rentspace/billing";
import { getBaseUrl } from "@/lib/utils/base-url";
import { newPortalToken, portalUrl } from "@/lib/rentspace/portal";
import { notifyBillIssued } from "@/lib/rentspace/notify";
import type { RentalBillStatus } from "@/lib/generated/prisma/enums";

async function gateAdmin() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    // program_admin of rentspace also allowed for operational actions
    const { userIsModuleAdmin } = await import("@/lib/auth/module-access");
    const ok = await userIsModuleAdmin(session.user, "rentspace");
    if (!ok) throw new Error("ไม่มีสิทธิ์ดำเนินการนี้");
  }
  return session;
}

/** Anti-IDOR: throw unless the record exists within the caller's org. */
async function ownGuard(exists: Promise<{ id: string } | null>, label: string): Promise<void> {
  if (!(await exists)) throw new Error(`ไม่พบ${label} หรือไม่มีสิทธิ์`);
}

async function logAudit(
  session: Awaited<ReturnType<typeof requireSession>>,
  action: AuditAction,
  resourceType: string,
  resourceId: string,
  diff?: Record<string, unknown>,
) {
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action,
    resourceType,
    resourceId,
    diff: diff ? { new: diff } : undefined,
  });
}

// ───────── file upload ─────────
async function uploadDataUrl(orgId: string, sub: string, dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("ไฟล์ไม่ถูกต้อง");
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 8MB");
  const ext = mime.includes("pdf") ? "pdf" : mime.split("/")[1]?.split("+")[0] || "bin";
  const key = `orgs/${orgId}/rentspace/${sub}/${randomUUID()}.${ext}`;
  return putObject(key, buf, mime);
}

export async function actUploadFile(input: { sub: string; dataUrl: string }): Promise<{ url: string }> {
  const session = await gateAdmin();
  const url = await uploadDataUrl(session.user.org_id, input.sub.replace(/[^a-z0-9_-]/gi, ""), input.dataUrl);
  return { url };
}

// ───────── unit drawer (rich detail for plan click) ─────────
export async function actGetUnitDrawer(unitId: string) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const { currentPeriod, toNum, tenantDisplayName } = await import("@/lib/rentspace/format");
  const unit = await prisma.rentalUnit.findFirst({
    where: { id: unitId, orgId },
    include: {
      contracts: { where: { status: { in: ["active", "expiring", "expired"] } }, take: 1, orderBy: { startDate: "desc" }, include: { tenant: true } },
      meters: { include: { readings: { orderBy: { period: "desc" }, take: 1 } } },
      bills: {
        orderBy: { period: "desc" },
        take: 8,
        include: { payments: { orderBy: { paidOn: "desc" } } },
      },
    },
  });
  if (!unit) throw new Error("ไม่พบห้อง");
  const period = currentPeriod();
  const c = unit.contracts[0] ?? null;
  const curBill = unit.bills.find((b) => b.period === period) ?? null;
  const elecM = unit.meters.find((m) => m.kind === "electric");
  const waterM = unit.meters.find((m) => m.kind === "water");
  const elecR = elecM?.readings.find((r) => r.period === period) ?? null;
  const waterR = waterM?.readings.find((r) => r.period === period) ?? null;

  return {
    unit: { id: unit.id, code: unit.code, name: unit.name, status: unit.status as string },
    tenant: c?.tenant ? { name: tenantDisplayName(c.tenant), phone: (c.tenant.phones ?? [])[0] ?? "" } : null,
    contract: c
      ? {
          id: c.id,
          contractNo: c.contractNo,
          rent: toNum(c.rentAmountThb),
          deposit: toNum(c.depositAmountThb),
          endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : null,
          rentDueDay: c.rentDueDay,
          electricRate: toNum(c.electricRate ?? unit.contracts[0]?.electricRate ?? 0),
          waterRate: toNum(c.waterRate ?? 0),
        }
      : null,
    period,
    currentBill: curBill
      ? {
          billId: curBill.id,
          rent: toNum(curBill.rentAmount),
          electric: toNum(curBill.electricAmount),
          water: toNum(curBill.waterAmount),
          lateFee: toNum(curBill.lateFeeAmount),
          discount: toNum(curBill.discountAmount),
          vat: toNum(curBill.vatAmount),
          total: toNum(curBill.totalAmount),
          paid: toNum(curBill.paidAmount),
          status: curBill.status as string,
        }
      : null,
    meters: {
      electric: elecR ? { prev: toNum(elecR.prevReading), curr: toNum(elecR.currReading), usage: toNum(elecR.usage) } : null,
      water: waterR ? { prev: toNum(waterR.prevReading), curr: toNum(waterR.currReading), usage: toNum(waterR.usage) } : null,
    },
    baseRent: toNum(unit.baseRentThb),
    history: unit.bills.map((b) => ({
      billId: b.id,
      period: b.period,
      total: toNum(b.totalAmount),
      paid: toNum(b.paidAmount),
      status: b.status as string,
      payments: b.payments.map((p) => ({
        paidOn: p.paidOn.toISOString().slice(0, 10),
        method: p.method,
        amount: toNum(p.amountThb),
      })),
    })),
  };
}

// ───────── project ─────────
export async function actSaveProject(input: {
  id?: string;
  name: string;
  slug: string;
  address?: string;
  description?: string;
  planImageUrl?: string;
  electricRate?: number;
  waterRate?: number;
  vatPercent?: number;
  // รายการที่คิด VAT (ค่าเริ่มต้นของทั้งโครงการ)
  vatOnRent?: boolean;
  vatOnElectric?: boolean;
  vatOnWater?: boolean;
  lateFeeType?: "none" | "fixed" | "percent_total" | "per_day";
  lateFeeValue?: number;
  lateFeeGraceDays?: number;
  billDueDay?: number;
  autoBillEnabled?: boolean;
  view3dEnabled?: boolean;
  billEditUnlocked?: boolean;
  billDeleteUnlocked?: boolean;
  billIssueUnlocked?: boolean;
  // ── tax-header (ผู้ให้เช่า) — shown on the bill so corporate tenants get a ใบกำกับภาษี
  billCompanyName?: string;
  billTaxId?: string;
  billBranch?: string;
  billAddress?: string;
  // ── สิทธิ์จัดการสัญญา (mirror bill toggles)
  contractEditUnlocked?: boolean;
  contractDeleteUnlocked?: boolean;
  // ── บัญชีรับเงิน (โชว์บนบิล/สัญญา/หน้าจ่ายออนไลน์)
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
  promptpayId?: string;
  paymentNote?: string;
}) {
  const session = await gateAdmin();
  const isSuper = isSuperAdmin(session.user.role);
  // สวิตช์ปลดล็อก (แก้/ลบ/ออกบิล · แก้/ลบสัญญา) = การให้สิทธิ์คนอื่น → เฉพาะ super_admin
  // ตั้งได้ (กัน module admin ปลดล็อกให้ตัวเอง). แม้ตอน "สร้างโครงการใหม่" module admin
  // ก็ต้องไม่ honor input (ไม่งั้นตั้ง unlock=true ตอน create เพื่อ escalate ได้) →
  // บังคับ default ปลอดภัยเสมอ (ออกบิลได้ · แก้/ลบไม่ได้).
  const permFields = isSuper
    ? {
        billEditUnlocked: input.billEditUnlocked ?? false,
        billDeleteUnlocked: input.billDeleteUnlocked ?? false,
        billIssueUnlocked: input.billIssueUnlocked ?? true,
        contractEditUnlocked: input.contractEditUnlocked ?? false,
        contractDeleteUnlocked: input.contractDeleteUnlocked ?? false,
      }
    : !input.id
      ? {
          // non-super สร้างโครงการแรก → บังคับค่าปลอดภัย (ไม่เอาจาก input)
          billEditUnlocked: false,
          billDeleteUnlocked: false,
          billIssueUnlocked: true,
          contractEditUnlocked: false,
          contractDeleteUnlocked: false,
        }
      : {}; // non-super แก้โครงการเดิม → ไม่แตะสวิตช์ปลดล็อกเลย
  const data = {
    name: input.name.trim(),
    slug: input.slug.trim() || "default",
    address: input.address ?? null,
    description: input.description ?? null,
    planImageUrl: input.planImageUrl ?? null,
    electricRate: input.electricRate ?? 7,
    waterRate: input.waterRate ?? 18,
    vatPercent: input.vatPercent ?? 0,
    vatOnRent: input.vatOnRent ?? true,
    vatOnElectric: input.vatOnElectric ?? false,
    vatOnWater: input.vatOnWater ?? false,
    lateFeeType: input.lateFeeType ?? "none",
    lateFeeValue: input.lateFeeValue ?? 0,
    lateFeeGraceDays: input.lateFeeGraceDays ?? 7,
    billDueDay: input.billDueDay ?? 5,
    autoBillEnabled: input.autoBillEnabled ?? true,
    view3dEnabled: input.view3dEnabled ?? true,
    billCompanyName: input.billCompanyName?.trim() || null,
    billTaxId: input.billTaxId?.trim() || null,
    billBranch: input.billBranch?.trim() || null,
    billAddress: input.billAddress?.trim() || null,
    bankName: input.bankName?.trim() || null,
    bankAccountNo: input.bankAccountNo?.trim() || null,
    bankAccountHolder: input.bankAccountHolder?.trim() || null,
    promptpayId: input.promptpayId?.trim() || null,
    paymentNote: input.paymentNote?.trim() || null,
    ...permFields,
  };
  let id = input.id;
  if (id) {
    await ownGuard(prisma.rentalProject.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }), "โครงการ");
    await prisma.rentalProject.update({ where: { id }, data });
  } else {
    const created = await prisma.rentalProject.create({
      data: { id: randomUUID(), orgId: session.user.org_id, ...data },
    });
    id = created.id;
  }
  await logAudit(session, "RENTSPACE_SETTINGS_UPDATED", "rental_project", id, { name: data.name });
  revalidatePath("/rentspace");
  revalidatePath("/rentspace/settings");
  return { id };
}

// ───────── unit ─────────
export async function actSaveUnit(input: {
  id?: string;
  projectId: string;
  code: string;
  name?: string;
  building?: string;
  floor?: number;
  zone?: string;
  areaSqm?: number;
  baseRentThb?: number;
  status?: "vacant" | "occupied" | "reserved" | "inactive";
  mapX?: number;
  mapY?: number;
  mapW?: number;
  mapH?: number;
  mapColor?: string;
  sortOrder?: number;
}) {
  const session = await gateAdmin();
  const data = {
    code: input.code.trim(),
    name: input.name ?? null,
    building: input.building ?? null,
    floor: input.floor ?? null,
    zone: input.zone ?? null,
    areaSqm: input.areaSqm ?? null,
    baseRentThb: input.baseRentThb ?? 0,
    status: input.status ?? "vacant",
    mapX: input.mapX ?? null,
    mapY: input.mapY ?? null,
    mapW: input.mapW ?? null,
    mapH: input.mapH ?? null,
    mapColor: input.mapColor ?? null,
    sortOrder: input.sortOrder ?? 0,
  };
  let id = input.id;
  if (id) {
    await ownGuard(prisma.rentalUnit.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }), "ห้อง");
    await prisma.rentalUnit.update({ where: { id }, data });
  } else {
    // anti-IDOR: ห้ามสร้างห้องใต้โครงการของ org อื่น (FK เช็คแค่ว่ามีอยู่ ไม่เช็คเจ้าของ)
    await ownGuard(
      prisma.rentalProject.findFirst({ where: { id: input.projectId, orgId: session.user.org_id }, select: { id: true } }),
      "โครงการ",
    );
    const created = await prisma.rentalUnit.create({
      data: { id: randomUUID(), orgId: session.user.org_id, projectId: input.projectId, ...data },
    });
    id = created.id;
  }
  await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_unit", id, { code: data.code });
  revalidatePath("/rentspace");
  revalidatePath("/rentspace/units");
  return { id };
}

/** Bulk-save map positions from the drag editor. */
export async function actSaveUnitPositions(
  positions: { id: string; mapX: number; mapY: number; mapW: number; mapH: number }[],
) {
  const session = await gateAdmin();
  await prisma.$transaction(
    positions.map((p) =>
      prisma.rentalUnit.updateMany({
        where: { id: p.id, orgId: session.user.org_id },
        data: { mapX: p.mapX, mapY: p.mapY, mapW: p.mapW, mapH: p.mapH },
      }),
    ),
  );
  await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_unit", "bulk-positions", { count: positions.length });
  revalidatePath("/rentspace");
  return { ok: true };
}

export async function actDeleteUnit(id: string) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalUnit.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }),
    "ห้อง",
  );
  const active = await prisma.rentalContract.count({
    where: { unitId: id, status: { in: ["active", "expiring", "expired"] } },
  });
  if (active > 0) throw new Error("ลบไม่ได้ — มีสัญญาที่ยังใช้งานอยู่");
  await prisma.rentalUnit.update({ where: { id }, data: { isActive: false, status: "inactive" } });
  await logAudit(session, "RENTSPACE_UNIT_DELETED", "rental_unit", id);
  revalidatePath("/rentspace/units");
  revalidatePath("/rentspace");
  return { ok: true };
}

// ───────── buildings (อาคาร / โซน) — จัดผังเอง ─────────
export async function actSaveBuilding(input: { id?: string; projectId: string; name: string; zone?: string }) {
  const session = await gateAdmin();
  const name = input.name.trim();
  if (!name) throw new Error("กรุณากรอกชื่ออาคาร");
  await ownGuard(
    prisma.rentalProject.findFirst({ where: { id: input.projectId, orgId: session.user.org_id }, select: { id: true } }),
    "โครงการ",
  );
  const zone = input.zone?.trim() || null;
  if (input.id) {
    await ownGuard(
      prisma.rentalBuilding.findFirst({ where: { id: input.id, orgId: session.user.org_id }, select: { id: true } }),
      "อาคาร",
    );
    await prisma.rentalBuilding.update({ where: { id: input.id }, data: { name, zone } });
    // sync ชื่ออาคารแบบข้อความในห้อง (ให้โค้ดเก่าที่อ่าน unit.building ยังตรง)
    await prisma.rentalUnit.updateMany({ where: { buildingId: input.id, orgId: session.user.org_id }, data: { building: name } });
    await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_building", input.id, { renamedTo: name });
    revalidatePath("/rentspace/units");
    return { id: input.id };
  }
  const last = await prisma.rentalBuilding.findFirst({
    where: { orgId: session.user.org_id, projectId: input.projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await prisma.rentalBuilding.create({
    data: {
      id: randomUUID(),
      orgId: session.user.org_id,
      projectId: input.projectId,
      name,
      zone,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_building", created.id, { created: name });
  revalidatePath("/rentspace/units");
  return { id: created.id };
}

export async function actDeleteBuilding(buildingId: string) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalBuilding.findFirst({ where: { id: buildingId, orgId: session.user.org_id }, select: { id: true } }),
    "อาคาร",
  );
  // ย้ายห้องในอาคารนี้ออกเป็น "ไม่ระบุอาคาร" ก่อนลบ (ไม่ลบห้อง)
  await prisma.rentalUnit.updateMany({
    where: { buildingId, orgId: session.user.org_id },
    data: { buildingId: null, building: null },
  });
  await prisma.rentalBuilding.delete({ where: { id: buildingId } });
  await logAudit(session, "RENTSPACE_UNIT_DELETED", "rental_building", buildingId);
  revalidatePath("/rentspace/units");
  return { ok: true };
}

export async function actReorderBuildings(projectId: string, orderedIds: string[]) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalProject.findFirst({ where: { id: projectId, orgId: session.user.org_id }, select: { id: true } }),
    "โครงการ",
  );
  const rows = await prisma.rentalBuilding.findMany({
    where: { id: { in: orderedIds }, orgId: session.user.org_id, projectId },
    select: { id: true },
  });
  const valid = new Set(rows.map((r) => r.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, i) => prisma.rentalBuilding.update({ where: { id }, data: { sortOrder: i + 1 } })),
  );
  await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_project", projectId, { reorderedBuildings: orderedIds.length });
  revalidatePath("/rentspace/units");
  return { ok: true };
}

/** ลำดับที่ CEO จัดเองในหน้า Excel matrix — เขียน matrix_sort_order รายห้อง (ไม่แตะ sortOrder ของหน้าห้อง/ยูนิต) */
export async function actReorderMatrixUnits(projectId: string, orderedIds: string[]) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalProject.findFirst({ where: { id: projectId, orgId: session.user.org_id }, select: { id: true } }),
    "โครงการ",
  );
  // กันเขียนข้ามองค์กร/ข้ามโครงการ: รับเฉพาะห้องที่เป็นของ org+project นี้จริง
  const rows = await prisma.rentalUnit.findMany({
    where: { id: { in: orderedIds }, orgId: session.user.org_id, projectId },
    select: { id: true },
  });
  const valid = new Set(rows.map((r) => r.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, i) => prisma.rentalUnit.update({ where: { id }, data: { matrixSortOrder: i + 1 } })),
  );
  await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_project", projectId, { reorderedMatrixUnits: orderedIds.length });
  revalidatePath("/rentspace/matrix");
  return { ok: true };
}

export async function actMoveUnitToBuilding(unitId: string, buildingId: string | null) {
  const session = await gateAdmin();
  const unit = await prisma.rentalUnit.findFirst({
    where: { id: unitId, orgId: session.user.org_id },
    select: { id: true, projectId: true },
  });
  if (!unit) throw new Error("ไม่พบห้อง หรือไม่มีสิทธิ์");
  let buildingName: string | null = null;
  if (buildingId) {
    const b = await prisma.rentalBuilding.findFirst({
      where: { id: buildingId, orgId: session.user.org_id, projectId: unit.projectId },
      select: { id: true, name: true },
    });
    if (!b) throw new Error("ไม่พบอาคาร (หรืออยู่คนละโครงการ)");
    buildingName = b.name;
  }
  // วางต่อท้ายห้องในอาคารปลายทาง
  const last = await prisma.rentalUnit.findFirst({
    where: { orgId: session.user.org_id, projectId: unit.projectId, buildingId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await prisma.rentalUnit.update({
    where: { id: unitId },
    data: { buildingId, building: buildingName, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await logAudit(session, "RENTSPACE_UNIT_SAVED", "rental_unit", unitId, { movedToBuilding: buildingName });
  revalidatePath("/rentspace/units");
  return { ok: true };
}

// ───────── tenant ─────────
export async function actSaveTenant(input: {
  id?: string;
  prefix?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  bizName?: string;
  phones?: string[];
  idCardNo?: string;
  taxId?: string;
  birthDate?: string;
  nationality?: string;
  address?: string;
  email?: string;
  facebook?: string;
  lineId?: string;
  idCardUrl?: string;
  docUrls?: string[];
  note?: string;
}) {
  const session = await gateAdmin();
  const data = {
    prefix: input.prefix ?? null,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    nickname: input.nickname ?? null,
    bizName: input.bizName ?? null,
    phones: (input.phones ?? []).filter(Boolean),
    idCardNo: input.idCardNo ?? null,
    taxId: input.taxId ?? null,
    birthDate: input.birthDate ? new Date(input.birthDate) : null,
    nationality: input.nationality ?? null,
    address: input.address ?? null,
    email: input.email ?? null,
    facebook: input.facebook ?? null,
    lineId: input.lineId ?? null,
    idCardUrl: input.idCardUrl ?? null,
    docUrls: (input.docUrls ?? []).filter(Boolean),
    note: input.note ?? null,
  };
  let id = input.id;
  if (id) {
    await ownGuard(prisma.rentalTenant.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }), "ผู้เช่า");
    await prisma.rentalTenant.update({ where: { id }, data });
  } else {
    const created = await prisma.rentalTenant.create({
      data: { id: randomUUID(), orgId: session.user.org_id, ...data },
    });
    id = created.id;
  }
  await logAudit(session, "RENTSPACE_TENANT_SAVED", "rental_tenant", id, { bizName: data.bizName });
  revalidatePath("/rentspace/tenants");
  return { id };
}

export async function actDeleteTenant(id: string) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalTenant.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }),
    "ผู้เช่า",
  );
  const active = await prisma.rentalContract.count({
    where: { tenantId: id, status: { in: ["active", "expiring", "expired"] } },
  });
  if (active > 0) throw new Error("ลบไม่ได้ — ผู้เช่ามีสัญญาที่ยังใช้งานอยู่");
  await prisma.rentalTenant.update({ where: { id }, data: { isActive: false } });
  await logAudit(session, "RENTSPACE_TENANT_DELETED", "rental_tenant", id);
  revalidatePath("/rentspace/tenants");
  return { ok: true };
}

// ───────── contract template ─────────
export async function actSaveTemplate(input: {
  id?: string;
  name: string;
  bodyHtml: string;
  isDefault?: boolean;
  changelog?: string;
}) {
  const session = await gateAdmin();
  let id = input.id;
  if (input.isDefault) {
    await prisma.rentalContractTemplate.updateMany({
      where: { orgId: session.user.org_id, isDefault: true },
      data: { isDefault: false },
    });
  }
  const data = {
    name: input.name.trim(),
    bodyHtml: input.bodyHtml,
    isDefault: !!input.isDefault,
    changelog: input.changelog?.trim() || null,
  };
  if (id) {
    await ownGuard(prisma.rentalContractTemplate.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }), "แม่แบบ");
    await prisma.rentalContractTemplate.update({ where: { id }, data });
  } else {
    const created = await prisma.rentalContractTemplate.create({
      data: { id: randomUUID(), orgId: session.user.org_id, ...data },
    });
    id = created.id;
  }
  revalidatePath("/rentspace/contracts/templates");
  return { id };
}

/**
 * สร้าง "เวอร์ชันใหม่" ของแม่แบบสาย (family) เดียวกัน — เก็บเวอร์ชันเดิมไว้ครบ (ไม่ทับ).
 * สัญญาเดิมที่ผูกเวอร์ชันเก่าไว้ยังใช้เวอร์ชันเก่าเหมือนเดิม (templateId ชี้ row เดิม).
 */
export async function actCreateTemplateVersion(input: {
  fromId: string;
  bodyHtml: string;
  name?: string;
  changelog?: string;
  setDefault?: boolean;
}) {
  const session = await gateAdmin();
  const src = await prisma.rentalContractTemplate.findFirst({
    where: { id: input.fromId, orgId: session.user.org_id },
    select: { id: true, name: true, familyKey: true },
  });
  if (!src) throw new Error("ไม่พบแม่แบบต้นทาง");
  // สายของเวอร์ชัน: ใช้ familyKey เดิม หรือเริ่มสายใหม่โดยใช้ id ของต้นทางเป็นคีย์
  const familyKey = src.familyKey ?? src.id;
  if (!src.familyKey) {
    await prisma.rentalContractTemplate.update({ where: { id: src.id }, data: { familyKey } });
  }
  const latest = await prisma.rentalContractTemplate.aggregate({
    where: { orgId: session.user.org_id, familyKey },
    _max: { version: true },
  });
  const nextVersion = (latest._max.version ?? 1) + 1;
  if (input.setDefault) {
    await prisma.rentalContractTemplate.updateMany({
      where: { orgId: session.user.org_id, isDefault: true },
      data: { isDefault: false },
    });
  }
  const created = await prisma.rentalContractTemplate.create({
    data: {
      id: randomUUID(),
      orgId: session.user.org_id,
      familyKey,
      version: nextVersion,
      name: input.name?.trim() || src.name,
      bodyHtml: input.bodyHtml,
      changelog: input.changelog?.trim() || null,
      isDefault: !!input.setDefault,
    },
  });
  revalidatePath("/rentspace/contracts/templates");
  return { id: created.id, version: nextVersion };
}

export async function actDeleteTemplate(id: string) {
  const session = await gateAdmin();
  await ownGuard(prisma.rentalContractTemplate.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }), "แม่แบบ");
  await prisma.rentalContractTemplate.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/rentspace/contracts/templates");
  return { ok: true };
}

// ───────── contract ─────────
async function nextContractNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CT${year}-`;
  const last = await prisma.rentalContract.findFirst({
    where: { orgId, contractNo: { startsWith: prefix } },
    orderBy: { contractNo: "desc" },
    select: { contractNo: true },
  });
  const seq = last ? Number(last.contractNo.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(seq + 1).padStart(4, "0")}`;
}

export async function actSaveContract(input: {
  id?: string;
  projectId: string;
  unitId: string;
  tenantId: string;
  templateId?: string;
  contractDate?: string;
  startDate: string;
  endDate?: string;
  rentAmountThb: number;
  rentDueDay?: number;
  depositAmountThb?: number;
  depositMonths?: number;
  vatPercent?: number;
  // แก้ทับ VAT รายรายการเฉพาะห้องนี้ (null/undefined = ใช้ตามค่าโครงการ)
  vatOnRent?: boolean | null;
  vatOnElectric?: boolean | null;
  vatOnWater?: boolean | null;
  electricRate?: number;
  waterRate?: number;
  lateFeeType?: "none" | "fixed" | "percent_total" | "per_day";
  lateFeeValue?: number;
  lateFeeGraceDays?: number;
  promoDiscountThb?: number;
  promoMonths?: number;
  promoStartPeriod?: string;
  billIssueDay?: number;
  rentSchedule?: { fromPeriod: string; amount: number }[];
  customTermsHtml?: string;
  note?: string;
  // ── ช่องกรอกแม่แบบสัญญามาตรฐาน (2026-07-21) ──
  businessType?: string;
  tradeName?: string;
  renewalNoticeDays?: number | null;
  terminationNoticeDays?: number | null;
  fitOutFreeDays?: number | null;
  buildingModifications?: string;
  witness2Name?: string;
  areaSqm?: number | null;
  /** ผู้มีอำนาจลงนามแทน (บันทึกที่ผู้เช่า — company-level) */
  tenantSignerName?: string;
  tenantSignerPhone?: string;
  /** ค่ารายเดือน per-contract (กรอกแยกทุกสัญญา) — ล้างของเดิมของสัญญานี้แล้วเขียนใหม่ทั้งชุด */
  charges?: { kind?: string; label: string; amountThb: number; vatable?: boolean }[];
  activate?: boolean;
}) {
  const session = await gateAdmin();
  // แก้สัญญา + เปลี่ยนห้อง → จำห้องเดิมไว้ เพื่อปล่อยให้ว่างท้ายฟังก์ชัน (กันห้องเก่าค้าง "เช่าอยู่")
  const prevUnitId = input.id
    ? (
        await prisma.rentalContract.findFirst({
          where: { id: input.id, orgId: session.user.org_id },
          select: { unitId: true },
        })
      )?.unitId ?? null
    : null;
  const data = {
    projectId: input.projectId,
    unitId: input.unitId,
    tenantId: input.tenantId,
    templateId: input.templateId ?? null,
    contractDate: input.contractDate ? new Date(input.contractDate) : null,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    businessType: input.businessType?.trim() || null,
    tradeName: input.tradeName?.trim() || null,
    renewalNoticeDays: input.renewalNoticeDays ?? null,
    terminationNoticeDays: input.terminationNoticeDays ?? null,
    fitOutFreeDays: input.fitOutFreeDays ?? null,
    buildingModifications: input.buildingModifications?.trim() || null,
    witness2Name: input.witness2Name?.trim() || null,
    areaSqm: input.areaSqm ?? null,
    rentAmountThb: input.rentAmountThb,
    rentDueDay: input.rentDueDay ?? 5,
    depositAmountThb: input.depositAmountThb ?? 0,
    depositMonths: input.depositMonths ?? 0,
    vatPercent: input.vatPercent ?? 0,
    vatOnRent: input.vatOnRent ?? null,
    vatOnElectric: input.vatOnElectric ?? null,
    vatOnWater: input.vatOnWater ?? null,
    electricRate: input.electricRate ?? null,
    waterRate: input.waterRate ?? null,
    lateFeeType: input.lateFeeType ?? "none",
    lateFeeValue: input.lateFeeValue ?? 0,
    lateFeeGraceDays: input.lateFeeGraceDays ?? 7,
    promoDiscountThb: input.promoDiscountThb ?? 0,
    promoMonths: input.promoMonths ?? 0,
    promoStartPeriod: input.promoStartPeriod || null,
    billIssueDay: input.billIssueDay ?? null,
    rentSchedule: input.rentSchedule ? (input.rentSchedule as never) : undefined,
    customTermsHtml: input.customTermsHtml ?? null,
    note: input.note ?? null,
    status: (input.activate ? "active" : "draft") as "active" | "draft",
  };

  // บันทึกส่วนขยาย (ผู้ลงนามฝั่งผู้เช่า = company-level → เก็บที่ tenant · ค่ารายเดือน per-contract)
  // เรียกหลังรู้ contractId แล้วทั้งสร้าง/แก้ (รวม path สัญญาเซ็นแล้ว)
  const saveExtras = async (contractId: string) => {
    if (input.tenantSignerName !== undefined || input.tenantSignerPhone !== undefined) {
      await prisma.rentalTenant.updateMany({
        where: { id: input.tenantId, orgId: session.user.org_id },
        data: {
          ...(input.tenantSignerName !== undefined
            ? { authorizedSignerName: input.tenantSignerName.trim() || null }
            : {}),
          ...(input.tenantSignerPhone !== undefined
            ? { authorizedSignerPhone: input.tenantSignerPhone.trim() || null }
            : {}),
        },
      });
    }
    if (input.charges !== undefined) {
      const rows = (input.charges ?? [])
        .filter((c) => c.label?.trim())
        .map((c, i) => ({
          id: randomUUID(),
          orgId: session.user.org_id,
          projectId: input.projectId,
          unitId: null,
          contractId,
          kind: c.kind?.trim() || "other",
          label: c.label.trim(),
          amountThb: Number.isFinite(c.amountThb) ? c.amountThb : 0,
          vatable: !!c.vatable,
          sort: i,
        }));
      // ล้างของเดิมของสัญญานี้แล้วเขียนใหม่ทั้งชุด (atomic) — ค่ารายเดือน = snapshot ตอนออกบิลอยู่แล้ว
      await prisma.$transaction([
        prisma.rentalRecurringCharge.deleteMany({
          where: { contractId, orgId: session.user.org_id },
        }),
        ...(rows.length ? [prisma.rentalRecurringCharge.createMany({ data: rows })] : []),
      ]);
    }
  };

  let id = input.id;
  if (id) {
    const existing = await prisma.rentalContract.findFirst({
      where: { id, orgId: session.user.org_id },
      select: {
        id: true,
        tenantSigned: true,
        editStatus: true,
        customTermsHtml: true,
        project: { select: { contractEditUnlocked: true } },
        _count: { select: { addenda: true } },
      },
    });
    if (!existing) throw new Error("ไม่พบสัญญา หรือไม่มีสิทธิ์");
    if (existing.tenantSigned) {
      // สัญญาเซ็นแล้ว: ต้องเปิดสิทธิ์แก้สัญญา หรือมีคำขอแก้ที่อนุมัติแล้ว (super_admin ทะลุ)
      const allowed =
        existing.project.contractEditUnlocked ||
        existing.editStatus === "approved" ||
        isSuperAdmin(session.user.role);
      if (!allowed) {
        throw new Error('สัญญานี้เซ็นแล้ว — กด "ขอแก้ไขสัญญา" ให้อีกคนอนุมัติก่อน หรือเปิดสิทธิ์แก้สัญญาในหน้าตั้งค่า');
      }
      // ออกฉบับแก้ไข (addendum) เก็บเนื้อเดิม + ล้างลายเซ็นเพื่อให้เซ็นใหม่ (ไม่ลบลายเซ็นเดิมเงียบ ๆ)
      const token = randomBytes(24).toString("base64url");
      await prisma.$transaction([
        prisma.rentalContractAddendum.create({
          data: {
            id: randomUUID(),
            orgId: session.user.org_id,
            contractId: id,
            seq: existing._count.addenda + 1,
            summary: `แก้ไขเงื่อนไขสัญญา (ฉบับแก้ไขที่ ${existing._count.addenda + 1})`,
            bodyHtml: existing.customTermsHtml ?? null,
            createdBy: session.user.id,
          },
        }),
        prisma.rentalContract.update({
          where: { id },
          data: {
            ...data,
            tenantSigned: false,
            signedAt: null,
            signatureDataUrl: null,
            signerName: null,
            signToken: token,
            editStatus: "none",
            editRequestReason: null,
            editProposedBodyHtml: null,
            editRequestedBy: null,
            editRequestedAt: null,
            editDecidedBy: null,
            editDecidedAt: null,
            editDecisionNote: null,
          },
        }),
      ]);
      if (id) await saveExtras(id);
      await logAudit(session, "RENTSPACE_CONTRACT_SAVED", "rental_contract", id, { amendment: true, reSign: true });
      revalidatePath("/rentspace/contracts");
      revalidatePath(`/rentspace/contracts/${id}`);
      revalidatePath("/rentspace");
      return { id, reSignRequired: true };
    }
    await prisma.rentalContract.update({ where: { id }, data });
  } else {
    const created = await prisma.rentalContract.create({
      data: {
        id: randomUUID(),
        orgId: session.user.org_id,
        contractNo: await nextContractNo(session.user.org_id),
        createdBy: session.user.id,
        ...data,
      },
    });
    id = created.id;
  }
  if (id) await saveExtras(id);
  // occupy the unit when activated
  if (input.activate) {
    await prisma.rentalUnit.update({ where: { id: input.unitId }, data: { status: "occupied" } });
  }
  // เปลี่ยนห้องตอนแก้สัญญา → ปล่อยห้องเดิมให้ว่าง ถ้าไม่มีสัญญา active อื่นใช้อยู่ (กันห้องเก่าค้าง occupied)
  if (prevUnitId && prevUnitId !== input.unitId) {
    const otherActive = await prisma.rentalContract.count({
      where: {
        unitId: prevUnitId,
        orgId: session.user.org_id,
        status: { in: ["active", "expiring", "expired"] },
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (otherActive === 0) {
      await prisma.rentalUnit
        .update({ where: { id: prevUnitId }, data: { status: "vacant" } })
        .catch(() => {});
    }
  }
  await logAudit(session, "RENTSPACE_CONTRACT_SAVED", "rental_contract", id, { unitId: input.unitId });
  revalidatePath("/rentspace/contracts");
  revalidatePath("/rentspace");
  return { id };
}

/** #11/#3/#9c แก้เงื่อนไขการเรียกเก็บของสัญญาที่มีอยู่ (ค่าปรับรายคน · ส่วนลดโปรฯ · วันวางบิล) — มีผลกับบิลรอบถัดไป */
export async function actUpdateContractBilling(input: {
  contractId: string;
  lateFeeType: "none" | "fixed" | "percent_total" | "per_day";
  lateFeeValue: number;
  lateFeeGraceDays: number;
  promoDiscountThb: number;
  promoMonths: number;
  promoStartPeriod?: string;
  billIssueDay?: number | null;
}) {
  const session = await gateAdmin();
  // F2: เงื่อนไขค่าปรับ/โปรฯ/วันวางบิล บางส่วน (เช่น ค่าปรับล่าช้า) ถูก "พิมพ์ลงในสัญญา" →
  // สัญญาที่เซ็นแล้วต้องผ่านด่านเดียวกับ actSaveContract ก่อนแก้ (กันเลี่ยงการขออนุมัติ)
  const existing = await prisma.rentalContract.findFirst({
    where: { id: input.contractId, orgId: session.user.org_id },
    select: {
      id: true,
      tenantSigned: true,
      editStatus: true,
      project: { select: { contractEditUnlocked: true } },
    },
  });
  if (!existing) throw new Error("ไม่พบสัญญา หรือไม่มีสิทธิ์");
  if (
    existing.tenantSigned &&
    !(existing.project.contractEditUnlocked || existing.editStatus === "approved" || isSuperAdmin(session.user.role))
  ) {
    throw new Error('สัญญานี้เซ็นแล้ว — กด "ขอแก้ไขสัญญา" ให้อนุมัติก่อน หรือเปิดสิทธิ์แก้สัญญาในตั้งค่า');
  }
  // "งวดเริ่มโปร" — เพิ่มโปรกลางสัญญาต้องเริ่มนับจากงวดที่ระบุ (ค่าเริ่มต้น = งวดปัจจุบัน)
  // ไม่ใช่นับจากวันเข้าอยู่ ไม่งั้นโปรจะถูกใช้ไปกับงวดเก่าที่ผ่านมาแล้ว
  const promoStart =
    input.promoMonths > 0
      ? (input.promoStartPeriod?.trim() || currentPeriod())
      : null;
  await prisma.rentalContract.update({
    where: { id: input.contractId },
    data: {
      lateFeeType: input.lateFeeType,
      lateFeeValue: input.lateFeeValue,
      lateFeeGraceDays: input.lateFeeGraceDays,
      promoDiscountThb: input.promoDiscountThb,
      promoMonths: input.promoMonths,
      promoStartPeriod: promoStart,
      billIssueDay: input.billIssueDay ?? null,
      // consume คำอนุมัติแก้สัญญา (กัน "อนุมัติครั้งเดียว = แก้ได้ไม่จำกัด") — ถ้าไม่มีคำขอ ก็เป็น none อยู่แล้ว (no-op)
      editStatus: "none",
      editProposedBodyHtml: null,
    },
  });
  await logAudit(session, "RENTSPACE_CONTRACT_SAVED", "rental_contract", input.contractId, { billingTerms: true });
  revalidatePath(`/rentspace/contracts/${input.contractId}`);
  revalidatePath("/rentspace/units");
  return { ok: true };
}

export async function actGenerateSignLink(contractId: string) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalContract.findFirst({ where: { id: contractId, orgId: session.user.org_id }, select: { id: true } }),
    "สัญญา",
  );
  const token = randomBytes(24).toString("base64url");
  await prisma.rentalContract.update({ where: { id: contractId }, data: { signToken: token } });
  revalidatePath(`/rentspace/contracts/${contractId}`);
  return { token };
}

export async function actTerminateContract(contractId: string, note?: string) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalContract.findFirst({ where: { id: contractId, orgId: session.user.org_id }, select: { id: true } }),
    "สัญญา",
  );
  const c = await prisma.rentalContract.update({
    where: { id: contractId },
    data: { status: "terminated", moveOutDate: new Date(), note: note ?? null },
  });
  await prisma.rentalUnit.update({ where: { id: c.unitId }, data: { status: "vacant" } });
  await logAudit(session, "RENTSPACE_CONTRACT_TERMINATED", "rental_contract", contractId);
  revalidatePath("/rentspace/contracts");
  revalidatePath("/rentspace");
  return { ok: true };
}

// ───────── deposit ─────────
export async function actRecordDeposit(input: {
  contractId: string;
  kind: "collect" | "refund" | "deduct" | "forfeit";
  amountThb: number;
  occurredOn: string;
  method?: string;
  slipUrl?: string;
  note?: string;
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalContract.findFirst({ where: { id: input.contractId, orgId: session.user.org_id }, select: { id: true } }),
    "สัญญา",
  );
  if (!(input.amountThb > 0)) throw new Error("จำนวนเงินต้องมากกว่า 0");
  // กันยอดติดลบ: คืน/หัก/ริบ เกินเงินประกันที่ถือครองจริงไม่ได้ (server = source of truth)
  if (input.kind !== "collect") {
    const rows = await prisma.rentalDeposit.findMany({
      where: { contractId: input.contractId, orgId: session.user.org_id },
      select: { kind: true, amountThb: true },
    });
    const balance = rows.reduce(
      (s, r) => s + (r.kind === "collect" ? toNum(r.amountThb) : -toNum(r.amountThb)),
      0,
    );
    if (input.amountThb > balance + 0.001) {
      throw new Error(`คืน/หัก/ริบได้ไม่เกินเงินประกันคงเหลือ (${balance.toLocaleString("th-TH")} บาท)`);
    }
  }
  const d = await prisma.rentalDeposit.create({
    data: {
      id: randomUUID(),
      orgId: session.user.org_id,
      contractId: input.contractId,
      kind: input.kind,
      amountThb: input.amountThb,
      occurredOn: new Date(input.occurredOn),
      method: input.method ?? null,
      slipUrl: input.slipUrl ?? null,
      note: input.note ?? null,
      createdBy: session.user.id,
    },
  });
  await logAudit(session, "RENTSPACE_DEPOSIT_RECORDED", "rental_deposit", d.id, { kind: input.kind });
  revalidatePath(`/rentspace/contracts/${input.contractId}`);
  return { id: d.id };
}

// ───────── เอกสารแนบสัญญา (RentalDocument ownerType=contract) ─────────
export async function actAddContractDocument(input: {
  contractId: string;
  label?: string;
  dataUrl: string;
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalContract.findFirst({ where: { id: input.contractId, orgId: session.user.org_id }, select: { id: true } }),
    "สัญญา",
  );
  const url = await uploadDataUrl(session.user.org_id, "contract-doc", input.dataUrl);
  const m = input.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mime = m?.[1] ?? null;
  // ประมาณขนาดไฟล์จริงจากความยาว base64 (4 ตัวอักษร ≈ 3 ไบต์)
  const sizeBytes = m ? Math.round((m[2].replace(/=+$/, "").length * 3) / 4) : null;
  const doc = await prisma.rentalDocument.create({
    data: {
      id: randomUUID(),
      orgId: session.user.org_id,
      ownerType: "contract",
      ownerId: input.contractId,
      label: input.label?.trim() || null,
      url,
      mime,
      sizeBytes,
      uploadedBy: session.user.id,
    },
  });
  await logAudit(session, "RENTSPACE_CONTRACT_DOC_ADDED", "rental_document", doc.id, {
    contractId: input.contractId,
  });
  revalidatePath(`/rentspace/contracts/${input.contractId}`);
  return { id: doc.id, url: doc.url, label: doc.label, mime: doc.mime, sizeBytes: doc.sizeBytes };
}

export async function actDeleteContractDocument(docId: string) {
  const session = await gateAdmin();
  const doc = await prisma.rentalDocument.findFirst({
    where: { id: docId, orgId: session.user.org_id, ownerType: "contract" },
    select: { id: true, ownerId: true },
  });
  if (!doc) throw new Error("ไม่พบเอกสาร หรือไม่มีสิทธิ์");
  await prisma.rentalDocument.delete({ where: { id: docId } });
  await logAudit(session, "RENTSPACE_CONTRACT_DOC_REMOVED", "rental_document", docId, {
    contractId: doc.ownerId,
  });
  revalidatePath(`/rentspace/contracts/${doc.ownerId}`);
  return { ok: true };
}

// ───────── meters ─────────
export async function actSaveMeterReading(input: {
  unitId: string;
  kind: "electric" | "water";
  period: string;
  currReading: number;
  ratePerUnit?: number;
  photoUrl?: string;
  note?: string;
  isReset?: boolean;
  oldMeterFinal?: number;
  /** เลขมิเตอร์ตั้งต้น (ครั้งก่อน) สำหรับห้องใหม่ที่ยังไม่มีประวัติเดือนก่อน —
   *  ใช้เป็นฐานคำนวณหน่วยเดือนแรก แล้วเก็บเป็น meter.initialReading. */
  openingReading?: number;
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalUnit.findFirst({ where: { id: input.unitId, orgId: session.user.org_id }, select: { id: true } }),
    "ห้อง",
  );
  // ── ล็อกมิเตอร์หลังวางบิล: งวดที่ออกบิลแล้ว (ยังไม่ยกเลิก) ห้ามแก้เลขมิเตอร์
  //    เพราะบิลถูกส่งลูกค้าไปแล้ว การแก้เลขจะทำให้ยอดบิลกับมิเตอร์ไม่ตรงกัน.
  //    super_admin ปลดล็อกแก้ได้ (เช่น แก้ที่คีย์ผิด) · คนอื่นต้องยกเลิกบิลก่อน.
  if (!isSuperAdmin(session.user.role)) {
    const billed = await prisma.rentalBill.findFirst({
      where: { orgId: session.user.org_id, unitId: input.unitId, period: input.period, status: { not: "void" } },
      select: { billNo: true },
    });
    if (billed)
      throw new Error(
        `งวดนี้ออกบิลแล้ว (${billed.billNo}) — แก้เลขมิเตอร์ไม่ได้ · ให้ผู้ดูแลระบบ (super admin) แก้ให้ หรือยกเลิกบิลก่อน`,
      );
  }
  // ensure a meter exists
  let meter = await prisma.rentalMeter.findUnique({
    where: { unitId_kind: { unitId: input.unitId, kind: input.kind } },
  });
  if (!meter) {
    meter = await prisma.rentalMeter.create({
      data: { id: randomUUID(), orgId: session.user.org_id, unitId: input.unitId, kind: input.kind },
    });
  }
  // previous reading = last reading before this period.
  // ถ้า "ไม่มีเดือนก่อนหน้าเลย" (เดือนแรกที่จดมิเตอร์ห้องนี้) → ถือเลขที่จดเดือนนี้เป็น
  // "เลขตั้งต้น" → หน่วย = 0 ไม่คิดเงินทั้งมิเตอร์ (เลขมิเตอร์เป็นค่าสะสม จะเริ่มคิดหน่วย
  // จริงเดือนถัดไป). meter.initialReading ใช้เป็นฐานถ้าตั้งค่าไว้จริง (>0) เท่านั้น —
  // ค่า default 0 ไม่ถือเป็นฐาน (กันบั๊กบิลค่าไฟพุ่งเป็นเลขมิเตอร์ทั้งตัว).
  // prevRow = reading ล่าสุดก่อนงวดนี้ (ฐานคำนวณหน่วย) · existingRow = แถวงวดนี้ถ้ามีอยู่แล้ว
  // (กรณีบันทึกซ้ำ — แก้เลข/แนบรูป) → คง "เลขก่อน" เดิมไว้ กันหน่วยเพี้ยนตอนแก้ซ้ำ.
  const [prevRow, existingRow] = await Promise.all([
    prisma.rentalMeterReading.findFirst({
      where: { meterId: meter.id, period: { lt: input.period } },
      orderBy: { period: "desc" },
    }),
    prisma.rentalMeterReading.findUnique({
      where: { meterId_period: { meterId: meter.id, period: input.period } },
      select: { prevReading: true },
    }),
  ]);
  let initial = toNum(meter.initialReading);
  // ห้องใหม่ (ไม่มีเดือนก่อน) + ผู้ใช้กรอก "เลขตั้งต้น" มาจริง → เก็บเป็นฐานถาวรของมิเตอร์นี้
  // เพื่อให้บิลเดือนแรกคิดหน่วย (curr − ตั้งต้น) ได้จริง และแสดง "เลขก่อน" บนบิล.
  // honor เลขที่กรอก "ทุกค่ารวม 0" (explicitOpening) → จอกับบิลตรงกันเสมอ · เขียน DB เฉพาะเมื่อค่าเปลี่ยน.
  let explicitOpening: number | null = null;
  if (!prevRow && input.openingReading != null && input.openingReading >= 0) {
    explicitOpening = input.openingReading;
    if (input.openingReading !== initial) {
      await prisma.rentalMeter.update({
        where: { id: meter.id },
        data: { initialReading: input.openingReading },
      });
      initial = input.openingReading;
    }
  }
  const prevReading = prevRow
    ? toNum(prevRow.currReading)
    : explicitOpening != null
      ? explicitOpening // ผู้ใช้กรอกเลขตั้งต้นเอง (รวม 0) → ใช้ตามนั้น = จอกับบิลตรงกัน
      : existingRow
        ? toNum(existingRow.prevReading) // บันทึกซ้ำงวดเดิม → คงเลขก่อนเดิม (กันหน่วยเพี้ยนเป็น 0)
        : initial > 0
          ? initial
          : toNum(input.currReading); // ไม่มีเดือนก่อน+ไม่มีตั้งต้น → ตั้งต้น=เลขนี้ หน่วย 0
  // resolve rate from contract → project default
  let rate = input.ratePerUnit;
  if (rate == null) {
    const unit = await prisma.rentalUnit.findUnique({
      where: { id: input.unitId },
      include: { project: true, contracts: { where: { status: "active" }, take: 1 } },
    });
    const contract = unit?.contracts[0];
    const projRate = input.kind === "electric" ? unit?.project.electricRate : unit?.project.waterRate;
    const cRate = input.kind === "electric" ? contract?.electricRate : contract?.waterRate;
    rate = toNum(cRate ?? projRate);
  }
  // ── usage is computed SERVER-SIDE only (never trust a client-sent usage/amount).
  // Handles meter rollover / physical replacement via isReset + oldMeterFinal.
  const isReset = !!input.isReset;
  const oldMeterFinal =
    isReset && input.oldMeterFinal != null ? Math.max(0, toNum(input.oldMeterFinal)) : null;
  const usage = computeMeterUsage({
    prevReading,
    currReading: toNum(input.currReading),
    isReset,
    oldMeterFinal,
  });
  const amountThb = round2(usage * toNum(rate));
  const reading = await prisma.rentalMeterReading.upsert({
    where: { meterId_period: { meterId: meter.id, period: input.period } },
    create: {
      id: randomUUID(),
      orgId: session.user.org_id,
      unitId: input.unitId,
      meterId: meter.id,
      kind: input.kind,
      period: input.period,
      prevReading,
      currReading: input.currReading,
      usage,
      isReset,
      oldMeterFinal,
      ratePerUnit: toNum(rate),
      amountThb,
      photoUrl: input.photoUrl ?? null,
      note: input.note ?? null,
      readBy: session.user.id,
    },
    update: {
      prevReading,
      currReading: input.currReading,
      usage,
      isReset,
      oldMeterFinal,
      ratePerUnit: toNum(rate),
      amountThb,
      photoUrl: input.photoUrl ?? undefined,
      note: input.note ?? undefined,
      readBy: session.user.id,
      readAt: new Date(),
    },
  });
  await logAudit(session, "RENTSPACE_METER_READ", "rental_meter_reading", reading.id, {
    unitId: input.unitId,
    kind: input.kind,
    usage,
  });
  revalidatePath("/rentspace/meters");
  return { id: reading.id, usage, amountThb };
}

// ───────── bills ─────────
export async function actCreateBill(contractId: string, period: string, issue = true) {
  const session = await gateAdmin();
  const contract = await prisma.rentalContract.findFirst({
    where: { id: contractId, orgId: session.user.org_id },
    include: { project: true, unit: true },
  });
  if (!contract) throw new Error("ไม่พบสัญญา");
  // super_admin ออกบิลได้เสมอ · คนอื่นต้องให้ super เปิดสวิตช์ "อนุญาตออกบิล" (เปิดเป็นค่าเริ่มต้น)
  if (!isSuperAdmin(session.user.role) && !contract.project.billIssueUnlocked)
    throw new Error("ยังไม่ได้เปิดสิทธิ์ออกบิล — ให้ผู้ดูแลระบบ (super admin) เปิดสวิตช์ในหน้าตั้งค่าก่อน");
  // ออกบิลได้เฉพาะสัญญาที่ยังใช้งาน/หมดอายุ (เช่าต่อรายเดือน) — กันเฉพาะ draft/terminated (ย้ายออกแล้ว)
  if (!["active", "expiring", "expired"].includes(contract.status)) {
    throw new Error("ออกบิลได้เฉพาะสัญญาที่ใช้งานอยู่ (สัญญานี้สถานะ " + contract.status + ")");
  }
  const res = await createBillForContract(contract, period, {
    actorId: session.user.id,
    auto: false,
    issue,
  });
  await logAudit(session, "RENTSPACE_BILL_CREATED", "rental_bill", res.billId, { period });
  revalidatePath("/rentspace/bills");
  revalidatePath("/rentspace");
  return res;
}

/**
 * Preview every room that "ออกบิลทั้งโครงการ" would bill — WITHOUT writing
 * anything. Read-only: computes amounts via buildBill, flags rooms already
 * billed this period and rooms missing a meter reading (their bill would carry
 * rent only). Used by the confirm modal so the user sees the table first.
 */
export async function actBillingPreview(projectId: string, period: string) {
  const session = await gateAdmin();
  const { buildBill } = await import("@/lib/rentspace/billing");
  const { tenantDisplayName } = await import("@/lib/rentspace/format");
  const contracts = await prisma.rentalContract.findMany({
    where: { orgId: session.user.org_id, projectId, status: { in: ["active", "expiring", "expired"] } },
    include: { project: true, unit: true, tenant: true },
    orderBy: { unit: { code: "asc" } },
  });

  const rows: {
    code: string;
    tenant: string;
    rent: number;
    utility: number;
    total: number;
    hasMeter: boolean;
    alreadyBilled: boolean;
  }[] = [];
  let toBillCount = 0;
  let missingMeterCount = 0;
  let sum = 0;

  for (const c of contracts) {
    const code = c.unit?.code ?? "—";
    const tenant = c.tenant ? tenantDisplayName(c.tenant) : "ไม่ระบุชื่อ";

    const existing = await prisma.rentalBill.findUnique({
      where: { contractId_period: { contractId: c.id, period } },
      select: { id: true, status: true },
    });
    // บิลที่ถูกยกเลิก (void) ไม่นับว่า "ออกแล้ว" → ออกใหม่งวดเดิมได้
    if (existing && existing.status !== "void") {
      // already billed → list it flagged, but it won't be re-billed
      rows.push({ code, tenant, rent: 0, utility: 0, total: 0, hasMeter: true, alreadyBilled: true });
      continue;
    }

    const built = await buildBill(c, period);
    const rent = toNum(built.rentAmount);
    const utility = toNum(built.electricAmount) + toNum(built.waterAmount);
    const total = rent + utility + toNum(built.lateFeeAmount);
    // a room "has meter" only if BOTH electric + water were read this period.
    // buildBill pushes a "ยังไม่ได้จดมิเตอร์..." note for each missing side.
    const hasMeter = !built.notes.some((n) => n.includes("ยังไม่ได้จดมิเตอร์"));

    rows.push({ code, tenant, rent, utility, total, hasMeter, alreadyBilled: false });
    toBillCount++;
    if (!hasMeter) missingMeterCount++;
    sum += total;
  }

  return { rows, toBillCount, missingMeterCount, sum: toNum(sum) };
}

export type BillPreviewRow = {
  unitId: string;
  code: string;
  tenant: string;
  alreadyBilled: boolean;
  rent: number;
  electric: number;
  water: number;
  lateFee: number;
  discount: number;
  vat: number;
  total: number;
  missingMeter: boolean;
  notes: string[];
};

/**
 * #2b พรีวิวยอดบิลของ "ห้องที่เลือก" ก่อนกดออกบิลจริง.
 * อ่านอย่างเดียว (ไม่เขียน DB) · ใช้เครื่องคิดบิลตัวเดียวกับ createBillForContract
 * (buildBill + ส่วนลดโปรฯ + VAT) → ยอดที่พรีวิว = ยอดบิลจริงเป๊ะ.
 */
export async function actPreviewBillsForUnits(
  projectId: string,
  period: string,
  unitIds: string[],
): Promise<{ rows: BillPreviewRow[]; sum: number }> {
  const session = await gateAdmin();
  if (!unitIds?.length) return { rows: [], sum: 0 };
  const { buildBill, promoDiscountFor, computeBillTotals } = await import(
    "@/lib/rentspace/billing"
  );
  const { tenantDisplayName } = await import("@/lib/rentspace/format");
  const contracts = await prisma.rentalContract.findMany({
    where: {
      orgId: session.user.org_id,
      projectId,
      status: { in: ["active", "expiring", "expired"] },
      unitId: { in: unitIds },
    },
    include: { project: true, unit: true, tenant: true },
    orderBy: { unit: { code: "asc" } },
  });

  const rows: BillPreviewRow[] = [];
  let sum = 0;
  for (const c of contracts) {
    const code = c.unit?.code ?? "—";
    const tenant = c.tenant ? tenantDisplayName(c.tenant) : "ไม่ระบุชื่อ";

    const existing = await prisma.rentalBill.findUnique({
      where: { contractId_period: { contractId: c.id, period } },
      select: { id: true, status: true },
    });
    // บิลที่ถูกยกเลิก (void) ไม่นับว่า "ออกแล้ว" → ออกใหม่งวดเดิมได้
    if (existing && existing.status !== "void") {
      rows.push({
        unitId: c.unitId, code, tenant, alreadyBilled: true,
        rent: 0, electric: 0, water: 0, lateFee: 0, discount: 0, vat: 0, total: 0,
        missingMeter: false, notes: [],
      });
      continue;
    }

    const built = await buildBill(c, period);
    const vatPercent = toNum(c.vatPercent);
    const promo = promoDiscountFor(c, period);
    const { vatAmount, totalAmount, discountAmount } = computeBillTotals({
      items: built.items.map((it) => ({ amount: it.amount, vatable: it.vatable })),
      approvedDiscount: promo,
      vatPercent,
    });
    const missingMeter = built.notes.some((n) => n.includes("ยังไม่ได้จดมิเตอร์"));
    const total = toNum(totalAmount);
    rows.push({
      unitId: c.unitId,
      code,
      tenant,
      alreadyBilled: false,
      rent: toNum(built.rentAmount),
      electric: toNum(built.electricAmount),
      water: toNum(built.waterAmount),
      lateFee: toNum(built.lateFeeAmount),
      discount: toNum(discountAmount),
      vat: toNum(vatAmount),
      total,
      missingMeter,
      notes: built.notes,
    });
    sum += total;
  }
  return { rows, sum: round2(sum) };
}

/** Generate bills for ALL active contracts of a project for a period. */
export async function actGenerateMonthlyBills(projectId: string, period: string) {
  const session = await gateAdmin();
  // super_admin ออกบิลได้เสมอ · คนอื่นต้องให้ super เปิดสวิตช์ "อนุญาตออกบิล" (เปิดเป็นค่าเริ่มต้น)
  if (!isSuperAdmin(session.user.role)) {
    const proj = await prisma.rentalProject.findFirst({
      where: { id: projectId, orgId: session.user.org_id },
      select: { billIssueUnlocked: true },
    });
    if (!proj?.billIssueUnlocked)
      throw new Error("ยังไม่ได้เปิดสิทธิ์ออกบิล — ให้ผู้ดูแลระบบ (super admin) เปิดสวิตช์ในหน้าตั้งค่าก่อน");
  }
  const contracts = await prisma.rentalContract.findMany({
    where: { orgId: session.user.org_id, projectId, status: { in: ["active", "expiring", "expired"] } },
    include: { project: true, unit: true },
  });
  let created = 0;
  let skipped = 0;
  for (const c of contracts) {
    const res = await createBillForContract(c, period, { actorId: session.user.id, auto: false, issue: true });
    if (res.created) created++;
    else skipped++;
  }
  await logAudit(session, "RENTSPACE_BILL_CREATED", "rental_project", projectId, { period, created, skipped });
  revalidatePath("/rentspace/bills");
  revalidatePath("/rentspace");
  return { created, skipped, total: contracts.length };
}

/** #9d ออกบิลเฉพาะห้องที่เลือก (ไม่ต้องทั้งโครงการ) */
export async function actGenerateBillsForUnits(projectId: string, period: string, unitIds: string[]) {
  const session = await gateAdmin();
  if (!unitIds?.length) throw new Error("ยังไม่ได้เลือกห้องที่จะออกบิล");
  const contracts = await prisma.rentalContract.findMany({
    where: {
      orgId: session.user.org_id,
      projectId,
      status: { in: ["active", "expiring", "expired"] },
      unitId: { in: unitIds },
    },
    include: { project: true, unit: true },
  });
  let created = 0;
  let skipped = 0;
  for (const c of contracts) {
    const res = await createBillForContract(c, period, { actorId: session.user.id, auto: false, issue: true });
    if (res.created) created++;
    else skipped++;
  }
  await logAudit(session, "RENTSPACE_BILL_CREATED", "rental_project", projectId, {
    period,
    created,
    skipped,
    selectedUnits: unitIds.length,
  });
  revalidatePath("/rentspace/bills");
  revalidatePath("/rentspace/meters");
  revalidatePath("/rentspace");
  return { created, skipped, total: contracts.length };
}

/** #5 ขอยกเลิกบิล (maker) — บิลยังไม่ถูกยกเลิกจริงจนกว่าแอดมินอีกคนอนุมัติ */
export async function actRequestVoidBill(billId: string, reason: string) {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: billId, orgId: session.user.org_id },
    select: { id: true, status: true, voidStatus: true },
  });
  if (!bill) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");
  if (bill.status === "void") throw new Error("บิลนี้ถูกยกเลิกไปแล้ว");
  if (bill.voidStatus === "pending") throw new Error("บิลนี้มีคำขอยกเลิกที่รออนุมัติอยู่แล้ว");
  const r = (reason || "").trim();
  if (r.length < 3) throw new Error("กรุณาระบุเหตุผลการยกเลิกบิล");
  await prisma.rentalBill.update({
    where: { id: billId },
    data: {
      voidStatus: "pending",
      voidReason: r,
      voidRequestedBy: session.user.id,
      voidRequestedAt: new Date(),
      voidDecidedBy: null,
      voidDecidedAt: null,
      voidDecisionNote: null,
    },
  });
  await logAudit(session, "RENTSPACE_BILL_VOIDED", "rental_bill", billId, { action: "request_void", reason: r });
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${billId}`);
  return { ok: true };
}

/** #5 อนุมัติ/ปฏิเสธคำขอยกเลิกบิล — checker ต้องไม่ใช่ผู้ขอ (super_admin อนุมัติเองได้) */
export async function actDecideVoidBill(billId: string, decision: "approve" | "reject", note?: string) {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: billId, orgId: session.user.org_id },
    select: { id: true, voidStatus: true, voidRequestedBy: true, paidAmount: true },
  });
  if (!bill) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");
  if (bill.voidStatus !== "pending") throw new Error("ไม่มีคำขอยกเลิกที่รออนุมัติ");
  // กันยกเลิกบิลที่รับเงินมาแล้วโดยไม่จัดการเงิน — ต้องคืน/ย้ายเงินออกให้ยอดรับเป็น 0 ก่อนยกเลิก
  if (decision === "approve" && toNum(bill.paidAmount) > 0) {
    throw new Error(
      "บิลนี้เคยรับชำระเงินมาแล้ว ต้องคืนหรือย้ายเงินที่รับมาออกให้ครบก่อน (ยอดรับ = 0) จึงจะยกเลิกบิลได้",
    );
  }
  // maker ≠ checker — กันคนขอกับคนอนุมัติเป็นคนเดียวกัน (ยกเว้น super_admin)
  if (bill.voidRequestedBy === session.user.id && !isSuperAdmin(session.user.role)) {
    throw new Error("ต้องให้แอดมินอีกคนเป็นผู้อนุมัติคำขอยกเลิก (กันการอนุมัติเอง)");
  }
  const n = (note || "").trim() || null;
  await prisma.rentalBill.update({
    where: { id: billId },
    data:
      decision === "approve"
        ? { status: "void", voidStatus: "approved", voidDecidedBy: session.user.id, voidDecidedAt: new Date(), voidDecisionNote: n }
        : { voidStatus: "rejected", voidDecidedBy: session.user.id, voidDecidedAt: new Date(), voidDecisionNote: n },
  });
  await logAudit(session, "RENTSPACE_BILL_VOIDED", "rental_bill", billId, {
    action: decision === "approve" ? "approve_void" : "reject_void",
    note: n,
  });
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${billId}`);
  return { ok: true };
}

// ───────── โหมดทดลอง: แก้ไข / ลบบิลโดยตรง (ต้องเปิดสิทธิ์ project.billEditUnlocked) ─────────

const EDITABLE_BILL_KINDS = new Set(["rent", "electric", "water", "late_fee", "land_tax", "custom", "other"]);
const ITEM_KIND_FALLBACK_LABEL: Record<string, string> = {
  rent: "ค่าเช่า",
  electric: "ค่าไฟ",
  water: "ค่าน้ำ",
  late_fee: "ค่าปรับล่าช้า",
  land_tax: "ภาษีที่ดิน",
  custom: "ค่าใช้จ่ายเพิ่มเติม",
  other: "อื่น ๆ",
};

/**
 * แก้ไขรายการในบิลโดยตรง (โหมดทดลองเท่านั้น) → แทนที่รายการทั้งหมด + คิดยอดรวม/VAT ใหม่.
 * gate = admin/program_admin ของ rentspace + ต้องเปิดสวิตช์ billEditUnlocked.
 */
export async function actEditBillItems(input: {
  billId: string;
  items: { kind: string; label: string; amount: number; vatable: boolean }[];
}) {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: input.billId, orgId: session.user.org_id },
    select: { id: true, status: true, project: { select: { billEditUnlocked: true } } },
  });
  if (!bill) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");
  // super_admin แก้ไขได้เสมอ · คนอื่นต้องให้ super เปิดสวิตช์ "อนุญาตแก้ไขบิล" ในหน้าตั้งค่าก่อน
  if (!isSuperAdmin(session.user.role) && !bill.project.billEditUnlocked)
    throw new Error("ยังไม่ได้เปิดสิทธิ์แก้ไขบิล — ให้ผู้ดูแลระบบ (super admin) เปิดสวิตช์ในหน้าตั้งค่าก่อน");
  if (bill.status === "void") throw new Error("บิลนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้");

  // sanitize + validate
  const clean = (input.items ?? [])
    .map((it, i) => {
      const kind = EDITABLE_BILL_KINDS.has(it.kind) ? it.kind : "other";
      const label = (it.label ?? "").trim() || ITEM_KIND_FALLBACK_LABEL[kind] || "รายการ";
      const amount = round2(Number(it.amount));
      return { kind, label, amount, vatable: !!it.vatable, sort: i + 1 };
    })
    .filter((it) => Number.isFinite(it.amount) && it.amount >= 0);
  if (clean.length === 0) throw new Error("ต้องมีรายการอย่างน้อย 1 รายการ (ยอด ≥ 0)");

  const sumByKind = (k: string) =>
    round2(clean.filter((it) => it.kind === k).reduce((s, it) => s + it.amount, 0));
  // otherAmount = ทุกรายการที่ไม่เข้าคอลัมน์เฉพาะ (rent/ไฟ/น้ำ/ค่าปรับ) และไม่ใช่ส่วนลด
  // → land_tax/custom/ส่วนกลาง ฯลฯ ตกเข้า otherAmount ไม่หล่นหายจากคอลัมน์ denormalized
  const DEDICATED_KINDS = new Set(["rent", "electric", "water", "late_fee", "discount"]);
  const sumOther = round2(
    clean.filter((it) => !DEDICATED_KINDS.has(it.kind)).reduce((s, it) => s + it.amount, 0),
  );

  await prisma.$transaction(async (tx) => {
    await tx.rentalBillItem.deleteMany({ where: { billId: bill.id } });
    await tx.rentalBillItem.createMany({
      data: clean.map((it) => ({
        billId: bill.id,
        kind: it.kind,
        label: it.label,
        qty: 1,
        unitPrice: it.amount,
        amount: it.amount,
        vatable: it.vatable,
        sort: it.sort,
      })),
    });
    await tx.rentalBill.update({
      where: { id: bill.id },
      data: {
        rentAmount: sumByKind("rent"),
        electricAmount: sumByKind("electric"),
        waterAmount: sumByKind("water"),
        lateFeeAmount: sumByKind("late_fee"),
        otherAmount: sumOther,
      },
    });
  });
  // คิด subtotal/VAT/total/สถานะ ใหม่จากรายการที่เพิ่งแทนที่ (อ่าน items สดจาก DB)
  await recomputeBillTotals(bill.id);
  await logAudit(session, "RENTSPACE_BILL_UPDATED", "rental_bill", bill.id, {
    action: "edit_items",
    lines: clean.length,
  });
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${bill.id}`);
  return { ok: true };
}

/**
 * ลบบิลถาวร (โหมดทดลองเท่านั้น) — ลบรายการ/ประวัติชำระ/ส่วนลดทั้งหมดด้วยใน transaction.
 * gate = admin/program_admin ของ rentspace + ต้องเปิดสวิตช์ billEditUnlocked.
 */
export async function actDeleteBill(billId: string) {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: billId, orgId: session.user.org_id },
    select: { id: true, billNo: true, status: true, project: { select: { billDeleteUnlocked: true } } },
  });
  if (!bill) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");
  // super_admin ลบได้เสมอ · คนอื่นต้องให้ super เปิดสวิตช์ "อนุญาตลบบิล" ในหน้าตั้งค่าก่อน
  if (!isSuperAdmin(session.user.role) && !bill.project.billDeleteUnlocked)
    throw new Error("ยังไม่ได้เปิดสิทธิ์ลบบิล — ให้ผู้ดูแลระบบ (super admin) เปิดสวิตช์ในหน้าตั้งค่าก่อน");

  await prisma.$transaction([
    prisma.rentalDiscount.deleteMany({ where: { billId: bill.id } }),
    prisma.rentalPayment.deleteMany({ where: { billId: bill.id } }),
    prisma.rentalBillItem.deleteMany({ where: { billId: bill.id } }),
    prisma.rentalBill.delete({ where: { id: bill.id } }),
  ]);
  await logAudit(session, "RENTSPACE_BILL_VOIDED", "rental_bill", bill.id, {
    action: "hard_delete",
    billNo: bill.billNo,
  });
  revalidatePath("/rentspace/bills");
  revalidatePath("/rentspace");
  return { ok: true };
}

/**
 * ลบหลายบิลพร้อมกัน (จากหน้าลิสต์ เลือกแล้วลบ).
 * gate = เหมือน actDeleteBill (super_admin เสมอ · คนอื่นต้องเปิด billDeleteUnlocked).
 * ความปลอดภัย: ข้ามบิลที่ "จ่ายแล้ว" (paidAmount>0) — ไม่ลบประวัติการชำระเงิน ให้ใช้ "ยกเลิกบิล" แทน.
 */
export async function actDeleteBillsBulk(billIds: string[]) {
  const session = await gateAdmin();
  const ids = Array.from(new Set((billIds ?? []).filter(Boolean))).slice(0, 500);
  if (ids.length === 0) throw new Error("ยังไม่ได้เลือกบิล");
  const bills = await prisma.rentalBill.findMany({
    where: { id: { in: ids }, orgId: session.user.org_id },
    select: { id: true, billNo: true, paidAmount: true, project: { select: { billDeleteUnlocked: true } } },
  });
  if (bills.length === 0) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");
  // super_admin ลบได้เสมอ · คนอื่นต้องเปิดสวิตช์ "อนุญาตลบบิล" (ทุกบิลอยู่โครงการเดียวกัน)
  const allUnlocked = bills.every((b) => b.project.billDeleteUnlocked);
  if (!isSuperAdmin(session.user.role) && !allUnlocked)
    throw new Error("ยังไม่ได้เปิดสิทธิ์ลบบิล — ให้ผู้ดูแลระบบ (super admin) เปิดสวิตช์ในหน้าตั้งค่าก่อน");

  // กันลบประวัติเงิน: บิลที่จ่ายแล้ว ไม่ลบ (ให้ยกเลิกแทน)
  const deletable = bills.filter((b) => toNum(b.paidAmount) <= 0);
  const delIds = deletable.map((b) => b.id);
  const skippedPaid = bills.length - deletable.length;
  const skippedMissing = ids.length - bills.length; // เลือกมาแต่ไม่พบ/ไม่ใช่ org นี้

  if (delIds.length > 0) {
    await prisma.$transaction([
      prisma.rentalDiscount.deleteMany({ where: { billId: { in: delIds } } }),
      prisma.rentalPayment.deleteMany({ where: { billId: { in: delIds } } }),
      prisma.rentalBillItem.deleteMany({ where: { billId: { in: delIds } } }),
      prisma.rentalBill.deleteMany({ where: { id: { in: delIds }, orgId: session.user.org_id } }),
    ]);
    await logAudit(session, "RENTSPACE_BILL_VOIDED", "rental_bill", delIds[0], {
      action: "bulk_hard_delete",
      count: delIds.length,
      billNos: deletable.map((b) => b.billNo),
    });
    revalidatePath("/rentspace/bills");
    revalidatePath("/rentspace");
  }
  return { deleted: delIds.length, skippedPaid, skippedMissing };
}

// ───────── payments ─────────
export async function actRecordPayment(input: {
  billId: string;
  amountThb: number;
  paidOn: string;
  method?: "cash" | "transfer" | "qr" | "card";
  reference?: string;
  slipUrl?: string;
  note?: string;
}) {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: input.billId, orgId: session.user.org_id },
  });
  if (!bill) throw new Error("ไม่พบบิล");
  // ห้ามรับชำระบิลที่ถูกยกเลิกไปแล้ว
  if (bill.status === "void") throw new Error("บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถรับชำระได้");
  // server = source of truth: ยอดชำระต้องมากกว่า 0 (กัน 0/ติดลบ ทำ paidAmount เพี้ยน)
  if (!(input.amountThb > 0)) throw new Error("จำนวนเงินต้องมากกว่า 0");
  // กันรับชำระซ้ำ (double-click / network retry / หลายแท็บ): บิล+ยอด+วิธี+วันเดียวกัน ภายใน 2 นาที = ซ้ำ
  const dupSince = new Date(Date.now() - 120_000);
  const dup = await prisma.rentalPayment.findFirst({
    where: {
      billId: bill.id,
      amountThb: input.amountThb,
      method: input.method ?? "transfer",
      paidOn: new Date(input.paidOn),
      createdAt: { gte: dupSince },
      status: "confirmed", // นับเฉพาะการชำระที่ยืนยันแล้ว — สลิป pending ของผู้เช่าห้ามบล็อกการบันทึกจริง
    },
    select: { id: true },
  });
  if (dup) return { ok: true, deduped: true };
  await prisma.rentalPayment.create({
    data: {
      id: randomUUID(),
      orgId: session.user.org_id,
      billId: bill.id,
      contractId: bill.contractId,
      amountThb: input.amountThb,
      paidOn: new Date(input.paidOn),
      method: input.method ?? "transfer",
      reference: input.reference ?? null,
      slipUrl: input.slipUrl ?? null,
      note: input.note ?? null,
      receivedBy: session.user.id,
    },
  });
  // atomic increment avoids lost-update race on concurrent / double-click payments
  await prisma.rentalBill.update({
    where: { id: bill.id },
    data: { paidAmount: { increment: input.amountThb } },
  });
  await recomputeBillTotals(bill.id);
  await logAudit(session, "RENTSPACE_PAYMENT_RECORDED", "rental_bill", bill.id, { amount: input.amountThb });
  revalidatePath("/rentspace/payments");
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${bill.id}`);
  revalidatePath("/rentspace");
  return { ok: true };
}

/** #10 รับชำระรวมทุกห้องของผู้เช่า — จัดสรรอัตโนมัติเข้าบิลค้างจากเก่าไปใหม่ */
export async function actRecordCombinedPayment(input: {
  tenantId: string;
  amountThb: number;
  paidOn: string;
  method?: "cash" | "transfer" | "qr" | "card";
  reference?: string;
  slipUrl?: string;
  note?: string;
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalTenant.findFirst({ where: { id: input.tenantId, orgId: session.user.org_id }, select: { id: true } }),
    "ผู้เช่า",
  );
  const amount = round2(input.amountThb);
  if (amount <= 0) throw new Error("กรุณาระบุยอดชำระ");
  // กันรับชำระรวมซ้ำ (double-tap / network retry / หลายแท็บ): ถ้ามีการชำระของผู้เช่ารายนี้
  // วันเดียวกันที่เพิ่งบันทึกใน 90 วิ และรวมยอดครอบยอดนี้แล้ว = ถือว่าซ้ำ ไม่จัดสรรใหม่
  const dupSince = new Date(Date.now() - 90_000);
  const recentPays = await prisma.rentalPayment.findMany({
    where: {
      paidOn: new Date(input.paidOn),
      createdAt: { gte: dupSince },
      status: "confirmed", // นับเฉพาะที่ยืนยันแล้ว — สลิป pending ของผู้เช่าห้ามทำให้ dedup พลาด
      bill: { orgId: session.user.org_id, tenantId: input.tenantId },
    },
    select: { amountThb: true },
  });
  if (recentPays.length > 0) {
    const recentSum = recentPays.reduce((s, p) => s + toNum(p.amountThb), 0);
    if (recentSum >= amount - 0.01) return { ok: true, deduped: true, billsPaid: 0, allocated: 0, leftover: amount };
  }
  // บิลค้างของผู้เช่ารายนี้ทุกห้อง — จัดสรรจากบิลเก่าสุดก่อน
  const bills = await prisma.rentalBill.findMany({
    where: { orgId: session.user.org_id, tenantId: input.tenantId, status: { in: ["issued", "partial", "overdue"] } },
    orderBy: [{ period: "asc" }, { dueDate: "asc" }],
    select: { id: true, contractId: true, totalAmount: true, paidAmount: true },
  });
  let leftover = amount;
  let billsPaid = 0;
  for (const b of bills) {
    if (leftover <= 0) break;
    const remaining = round2(toNum(b.totalAmount) - toNum(b.paidAmount));
    if (remaining <= 0) continue;
    const pay = round2(Math.min(remaining, leftover));
    leftover = round2(leftover - pay);
    billsPaid++;
    await prisma.rentalPayment.create({
      data: {
        id: randomUUID(),
        orgId: session.user.org_id,
        billId: b.id,
        contractId: b.contractId,
        amountThb: pay,
        paidOn: new Date(input.paidOn),
        method: input.method ?? "transfer",
        reference: input.reference ?? null,
        slipUrl: input.slipUrl ?? null,
        note: input.note ? `${input.note} (ชำระรวมหลายห้อง)` : "ชำระรวมหลายห้อง",
        receivedBy: session.user.id,
      },
    });
    await prisma.rentalBill.update({ where: { id: b.id }, data: { paidAmount: { increment: pay } } });
    await recomputeBillTotals(b.id);
  }
  if (billsPaid === 0) throw new Error("ผู้เช่ารายนี้ไม่มีบิลค้างชำระ");
  await logAudit(session, "RENTSPACE_PAYMENT_RECORDED", "rental_tenant", input.tenantId, { amount, billsPaid, leftover });
  revalidatePath("/rentspace/payments");
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/tenants/${input.tenantId}`);
  revalidatePath("/rentspace");
  return { ok: true, billsPaid, allocated: round2(amount - leftover), leftover };
}

// ───────── discounts ─────────
export async function actRequestDiscount(input: {
  billId: string;
  kind: "amount" | "percent";
  value: number;
  reason?: string;
}) {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: input.billId, orgId: session.user.org_id },
    include: { items: true },
  });
  if (!bill) throw new Error("ไม่พบบิล");
  // ฐานส่วนลด = gross จริง = ผลรวม "รายการบิลทุกบรรทัด" ก่อนหักส่วนลด (เหมือน gross ใน computeBillTotals)
  // ใช้ items โดยตรง ไม่ใช้คอลัมน์ denormalized — เพราะคอลัมน์ rent/ไฟ/น้ำ/ค่าปรับ/อื่นๆ อาจไม่ครอบคลุม
  // รายการประจำ (ภาษีที่ดิน · ค่าส่วนกลาง ฯลฯ) → ถ้าไม่รวมจะคิดเพดานส่วนลดต่ำกว่ายอดบิลจริง.
  const base = round2(bill.items.reduce((s, it) => s + toNum(it.amount), 0));
  const raw = input.kind === "percent" ? Math.round(base * (input.value / 100) * 100) / 100 : input.value;
  // a discount can never exceed the bill — keeps totals ≥ 0
  const computedAmount = Math.max(0, Math.min(raw, base));
  const d = await prisma.rentalDiscount.create({
    data: {
      id: randomUUID(),
      orgId: session.user.org_id,
      billId: bill.id,
      kind: input.kind,
      value: input.value,
      computedAmount,
      reason: input.reason ?? null,
      status: "pending",
      requestedBy: session.user.id,
    },
  });
  await logAudit(session, "RENTSPACE_DISCOUNT_REQUESTED", "rental_discount", d.id, { computedAmount });
  revalidatePath(`/rentspace/bills/${bill.id}`);
  revalidatePath("/rentspace/bills");
  return { id: d.id };
}

// ───────── send bill / overdue reminder (F2) ─────────
// Tenants have NO app login + RentSpace has NO LINE channel yet, so delivery is
// a shareable public link (?token). The token is the credential — generated once
// per bill and reused (idempotent: re-sending the same bill keeps the same URL).
// Future phase: automatic LINE push. Email is NOT wired (no generic Resend helper
// exists in repo + constraint forbids adding the dep) → sentChannel = "link".

/** Build the public, copy-able bill URL for a token. */
function publicBillUrl(token: string): string {
  const base = getBaseUrl();
  // base falls back to localhost only in dev; in prod it resolves the deploy URL.
  return `${base}/rentspace/bill/${token}`;
}

const REMINDABLE_STATUSES = ["issued", "partial", "overdue"] as const;

/**
 * "ส่งบิล" — ensure the bill has a public token, stamp sentAt, return the link.
 * Idempotent: calling twice keeps the same token/URL (no duplicate links).
 * Scoped by orgId (anti-IDOR). Email is best-effort only IF a helper existed —
 * none does, so this is link-only and sentChannel = "link".
 */
export async function actSendBill(billId: string): Promise<{ ok: true; token: string; url: string }> {
  const session = await gateAdmin();
  const bill = await prisma.rentalBill.findFirst({
    where: { id: billId, orgId: session.user.org_id },
    select: { id: true, publicToken: true },
  });
  if (!bill) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");

  const token = bill.publicToken ?? randomUUID();
  await prisma.rentalBill.update({
    where: { id: bill.id },
    data: { publicToken: token, sentAt: new Date(), sentChannel: "link" },
  });

  // แจ้งเตือนผู้เช่า (LINE push + อีเมล) — best-effort · dormant ถ้ายังไม่ใส่กุญแจ LINE/Resend
  const notif = await notifyBillIssued(bill.id);
  const channel = notif.channels.length ? notif.channels.join("+") : "link";
  if (channel !== "link") {
    await prisma.rentalBill.update({ where: { id: bill.id }, data: { sentChannel: channel } });
  }

  await logAudit(session, "RENTSPACE_BILL_CREATED", "rental_bill", bill.id, {
    sent: true,
    channel,
    notify: { line: notif.line, email: notif.email },
  });
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${bill.id}`);
  return { ok: true, token, url: publicBillUrl(token) };
}

// ═════════ ลิงก์เชิญพอร์ทัลผู้เช่า + ตรวจสลิปที่ผู้เช่าแจ้งเอง (RentSpace tenant portal · 2026-07-24) ═════════

/** สร้าง/เปิดใช้ลิงก์เชิญของผู้เช่า (ถ้ามีอยู่แล้ว = คืนอันเดิม) → URL เต็ม */
export async function actGenerateTenantPortalLink(tenantId: string): Promise<{ ok: true; url: string }> {
  const session = await gateAdmin();
  const tenant = await prisma.rentalTenant.findFirst({
    where: { id: tenantId, orgId: session.user.org_id },
    select: { id: true, portalToken: true },
  });
  if (!tenant) throw new Error("ไม่พบผู้เช่า หรือไม่มีสิทธิ์");
  const token = tenant.portalToken ?? newPortalToken();
  await prisma.rentalTenant.update({
    where: { id: tenant.id },
    data: { portalToken: token, portalRevoked: false, ...(tenant.portalToken ? {} : { portalTokenAt: new Date() }) },
  });
  await logAudit(session, "RENTSPACE_TENANT_SAVED", "rental_tenant", tenant.id, { portalLink: "generate" });
  revalidatePath(`/rentspace/tenants/${tenant.id}`);
  return { ok: true, url: portalUrl(token) };
}

/** ออกลิงก์ใหม่ (สุ่มใหม่ทับของเดิม → ลิงก์เก่าเปิดไม่ได้) — เผื่อลิงก์รั่ว */
export async function actResetTenantPortalLink(tenantId: string): Promise<{ ok: true; url: string }> {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalTenant.findFirst({ where: { id: tenantId, orgId: session.user.org_id }, select: { id: true } }),
    "ผู้เช่า",
  );
  const token = newPortalToken();
  await prisma.rentalTenant.update({
    where: { id: tenantId },
    data: { portalToken: token, portalRevoked: false, portalTokenAt: new Date() },
  });
  await logAudit(session, "RENTSPACE_TENANT_SAVED", "rental_tenant", tenantId, { portalLink: "reset" });
  revalidatePath(`/rentspace/tenants/${tenantId}`);
  return { ok: true, url: portalUrl(token) };
}

/** เพิกถอนลิงก์เชิญ (ลิงก์เดิมเปิดไม่ได้ · ไม่ลบ token) */
export async function actRevokeTenantPortalLink(tenantId: string): Promise<{ ok: true }> {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalTenant.findFirst({ where: { id: tenantId, orgId: session.user.org_id }, select: { id: true } }),
    "ผู้เช่า",
  );
  await prisma.rentalTenant.update({ where: { id: tenantId }, data: { portalRevoked: true } });
  await logAudit(session, "RENTSPACE_TENANT_SAVED", "rental_tenant", tenantId, { portalLink: "revoke" });
  revalidatePath(`/rentspace/tenants/${tenantId}`);
  return { ok: true };
}

/**
 * ยืนยันสลิปที่ผู้เช่าแจ้งชำระเอง (pending → confirmed).
 * atomic: flip pending→confirmed ด้วย updateMany (กันกดยืนยันซ้ำ = เพิ่มยอด 2 เท่า)
 * แล้วค่อย increment paidAmount + คิดสถานะบิลใหม่ (สูตรเดียวกับ actRecordPayment).
 */
export async function actConfirmTenantPayment(paymentId: string): Promise<{ ok: true }> {
  const session = await gateAdmin();
  const pay = await prisma.rentalPayment.findFirst({
    where: { id: paymentId, orgId: session.user.org_id },
    select: { id: true, billId: true, amountThb: true, status: true },
  });
  if (!pay) throw new Error("ไม่พบรายการชำระ หรือไม่มีสิทธิ์");
  if (pay.status !== "pending") throw new Error("รายการนี้ตรวจไปแล้ว");
  const bill = await prisma.rentalBill.findFirst({
    where: { id: pay.billId, orgId: session.user.org_id },
    select: { id: true, status: true },
  });
  if (!bill) throw new Error("ไม่พบบิล");
  if (bill.status === "void") throw new Error("บิลนี้ถูกยกเลิกแล้ว");

  const flipped = await prisma.rentalPayment.updateMany({
    where: { id: pay.id, orgId: session.user.org_id, status: "pending" },
    data: { status: "confirmed", receivedBy: session.user.id, reviewedBy: session.user.id, reviewedAt: new Date() },
  });
  if (flipped.count === 0) throw new Error("รายการนี้ตรวจไปแล้ว"); // มีคนยืนยันไปก่อนแล้ว (กัน race)

  await prisma.rentalBill.update({ where: { id: bill.id }, data: { paidAmount: { increment: pay.amountThb } } });
  await recomputeBillTotals(bill.id);
  await logAudit(session, "RENTSPACE_PAYMENT_RECORDED", "rental_bill", bill.id, { confirmTenantSlip: true, amount: toNum(pay.amountThb) });
  revalidatePath("/rentspace/payments");
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${bill.id}`);
  revalidatePath("/rentspace");
  return { ok: true };
}

/** ปฏิเสธสลิปที่ผู้เช่าแจ้งเอง (pending → rejected) · ไม่แตะยอด · เก็บเหตุผล */
export async function actRejectTenantPayment(paymentId: string, note?: string): Promise<{ ok: true }> {
  const session = await gateAdmin();
  const pay = await prisma.rentalPayment.findFirst({
    where: { id: paymentId, orgId: session.user.org_id },
    select: { id: true, billId: true, status: true },
  });
  if (!pay) throw new Error("ไม่พบรายการชำระ หรือไม่มีสิทธิ์");
  const flipped = await prisma.rentalPayment.updateMany({
    where: { id: pay.id, orgId: session.user.org_id, status: "pending" },
    data: { status: "rejected", reviewedBy: session.user.id, reviewedAt: new Date(), reviewNote: (note || "").trim() || null },
  });
  if (flipped.count === 0) throw new Error("รายการนี้ตรวจไปแล้ว");
  await logAudit(session, "RENTSPACE_PAYMENT_RECORDED", "rental_bill", pay.billId, { rejectTenantSlip: true });
  revalidatePath("/rentspace/payments");
  return { ok: true };
}

/**
 * "เตือนค้างชำระทั้งงวด" — for every outstanding bill of project+period, ensure a
 * public token, stamp reminderSentAt, and return a ready-to-send list (one row
 * per bill with its copy-able link). Scoped by orgId throughout.
 */
export async function actRemindOverdue(
  projectId: string,
  period: string,
): Promise<{
  ok: true;
  count: number;
  items: { billId: string; code: string; tenantName: string; outstanding: number; url: string }[];
}> {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalProject.findFirst({ where: { id: projectId, orgId: session.user.org_id }, select: { id: true } }),
    "โครงการ",
  );
  const { tenantDisplayName } = await import("@/lib/rentspace/format");

  const bills = await prisma.rentalBill.findMany({
    where: {
      orgId: session.user.org_id,
      projectId,
      period,
      status: { in: REMINDABLE_STATUSES as unknown as RentalBillStatus[] },
    },
    include: { tenant: true },
    orderBy: { billNo: "asc" },
  });

  const items: { billId: string; code: string; tenantName: string; outstanding: number; url: string }[] = [];
  for (const b of bills) {
    const outstanding = Math.max(0, toNum(b.totalAmount) - toNum(b.paidAmount));
    if (outstanding <= 0) continue; // only truly-owing bills get a reminder
    const token = b.publicToken ?? randomUUID();
    await prisma.rentalBill.update({
      where: { id: b.id },
      data: {
        publicToken: token,
        reminderSentAt: new Date(),
        ...(b.publicToken ? {} : { sentAt: b.sentAt ?? new Date(), sentChannel: b.sentChannel ?? "link" }),
      },
    });
    items.push({
      billId: b.id,
      code: b.billNo,
      tenantName: tenantDisplayName(b.tenant),
      outstanding: toNum(outstanding),
      url: publicBillUrl(token),
    });
  }

  await logAudit(session, "RENTSPACE_BILL_CREATED", "rental_project", projectId, {
    remind: true,
    period,
    count: items.length,
  });
  revalidatePath("/rentspace/bills");
  revalidatePath("/rentspace");
  return { ok: true, count: items.length, items };
}

/** Approve/reject a discount. Approval requires admin tier (not program_admin). */
export async function actDecideDiscount(discountId: string, decision: "approved" | "rejected", note?: string) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) throw new Error("เฉพาะผู้ดูแล (admin) ขึ้นไปอนุมัติส่วนลดได้");
  const existing = await prisma.rentalDiscount.findFirst({
    where: { id: discountId, orgId: session.user.org_id },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error("ไม่พบรายการส่วนลด");
  // กันพลิกผล: ตัดสินแล้ว (อนุมัติ/ไม่อนุมัติ) เปลี่ยนซ้ำไม่ได้ — รักษา audit trail
  if (existing.status !== "pending") throw new Error("รายการส่วนลดนี้ตัดสินไปแล้ว เปลี่ยนผลซ้ำไม่ได้");
  const d = await prisma.rentalDiscount.update({
    where: { id: discountId },
    data: {
      status: decision,
      decidedBy: session.user.id,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    },
  });
  await recomputeBillTotals(d.billId);
  await logAudit(session, "RENTSPACE_DISCOUNT_DECIDED", "rental_discount", discountId, { decision });
  revalidatePath(`/rentspace/bills/${d.billId}`);
  revalidatePath("/rentspace/bills");
  return { ok: true };
}

// ───────── ค่าใช้จ่ายประจำ (ภาษีที่ดิน · ส่วนกลาง · ขยะ ฯลฯ — บวกเข้าทุกบิลอัตโนมัติ) ─────────
export async function actSaveRecurringCharge(input: {
  id?: string;
  projectId: string;
  unitId?: string | null;
  kind?: string;
  label: string;
  amountThb: number;
  vatable?: boolean;
  isActive?: boolean;
  sort?: number;
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalProject.findFirst({ where: { id: input.projectId, orgId: session.user.org_id }, select: { id: true } }),
    "โครงการ",
  );
  const label = input.label.trim();
  if (!label) throw new Error("กรุณาระบุชื่อรายการค่าใช้จ่าย");
  // ถ้าระบุห้อง ต้องเป็นห้องในโครงการเดียวกัน (กัน IDOR ข้ามโครงการ/องค์กร)
  if (input.unitId) {
    await ownGuard(
      prisma.rentalUnit.findFirst({ where: { id: input.unitId, orgId: session.user.org_id, projectId: input.projectId }, select: { id: true } }),
      "ห้อง",
    );
  }
  const data = {
    projectId: input.projectId,
    unitId: input.unitId || null,
    kind: (input.kind || "other").trim() || "other",
    label,
    amountThb: input.amountThb ?? 0,
    vatable: input.vatable ?? false,
    isActive: input.isActive ?? true,
    sort: input.sort ?? 0,
  };
  let id = input.id;
  if (id) {
    await ownGuard(
      prisma.rentalRecurringCharge.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }),
      "รายการค่าใช้จ่าย",
    );
    await prisma.rentalRecurringCharge.update({ where: { id }, data });
  } else {
    const created = await prisma.rentalRecurringCharge.create({
      data: { id: randomUUID(), orgId: session.user.org_id, ...data },
    });
    id = created.id;
  }
  await logAudit(session, "RENTSPACE_SETTINGS_UPDATED", "rental_recurring_charge", id, { label });
  revalidatePath("/rentspace/settings");
  return { id };
}

export async function actDeleteRecurringCharge(id: string) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalRecurringCharge.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }),
    "รายการค่าใช้จ่าย",
  );
  await prisma.rentalRecurringCharge.delete({ where: { id } });
  await logAudit(session, "RENTSPACE_SETTINGS_UPDATED", "rental_recurring_charge", id, { deleted: true });
  revalidatePath("/rentspace/settings");
  return { ok: true };
}

// ───────── ขออนุมัติแก้ไขสัญญาที่เซ็นแล้ว (maker≠checker · mirror void บิล) ─────────
// พนักงานเสนอ "ข้อความที่ขอแก้" (proposedBodyHtml = เนื้อสัญญาเต็มที่แก้แล้ว) → superadmin รีวิว redline → อนุมัติ = นำไปใช้
export async function actRequestContractEdit(contractId: string, reason: string, proposedBodyHtml?: string) {
  const session = await gateAdmin();
  const c = await prisma.rentalContract.findFirst({
    where: { id: contractId, orgId: session.user.org_id },
    select: { id: true, tenantSigned: true, editStatus: true },
  });
  if (!c) throw new Error("ไม่พบสัญญา หรือไม่มีสิทธิ์");
  if (!c.tenantSigned) throw new Error("สัญญายังไม่ถูกเซ็น แก้ไขได้เลย ไม่ต้องขออนุมัติ");
  if (c.editStatus === "pending") throw new Error("มีคำขอแก้ไขที่รออนุมัติอยู่แล้ว");
  const r = (reason || "").trim();
  if (r.length < 3) throw new Error("กรุณาระบุเหตุผลที่ต้องแก้ไขสัญญา");
  const proposed = (proposedBodyHtml || "").trim() || null;
  await prisma.rentalContract.update({
    where: { id: contractId },
    data: {
      editStatus: "pending",
      editRequestReason: r,
      editProposedBodyHtml: proposed,
      editRequestedBy: session.user.id,
      editRequestedAt: new Date(),
      editDecidedBy: null,
      editDecidedAt: null,
      editDecisionNote: null,
    },
  });
  await logAudit(session, "RENTSPACE_CONTRACT_SAVED", "rental_contract", contractId, { action: "request_edit", reason: r, withProposal: !!proposed });
  revalidatePath("/rentspace/contracts");
  revalidatePath(`/rentspace/contracts/${contractId}`);
  return { ok: true };
}

/** อนุมัติ/ปฏิเสธคำขอแก้สัญญา — checker ต้องไม่ใช่ผู้ขอ (super_admin อนุมัติเองได้)
 *  อนุมัติ + มี "ข้อความที่ขอแก้" (editProposedBodyHtml) → นำไปแทน customTermsHtml + ออกฉบับแก้ไข + เซ็นใหม่ */
export async function actDecideContractEdit(contractId: string, decision: "approve" | "reject", note?: string) {
  const session = await gateAdmin();
  const c = await prisma.rentalContract.findFirst({
    where: { id: contractId, orgId: session.user.org_id },
    select: {
      id: true,
      editStatus: true,
      editRequestedBy: true,
      editProposedBodyHtml: true,
      customTermsHtml: true,
      _count: { select: { addenda: true } },
    },
  });
  if (!c) throw new Error("ไม่พบสัญญา หรือไม่มีสิทธิ์");
  if (c.editStatus !== "pending") throw new Error("ไม่มีคำขอแก้ไขที่รออนุมัติ");
  if (c.editRequestedBy === session.user.id && !isSuperAdmin(session.user.role)) {
    throw new Error("ต้องให้แอดมินอีกคนเป็นผู้อนุมัติคำขอแก้สัญญา (กันการอนุมัติเอง)");
  }
  const n = (note || "").trim() || null;

  // อนุมัติ + มีข้อความที่ขอแก้ → applied: แทนเนื้อสัญญา + ออก addendum (เก็บของเดิม) + ล้างลายเซ็นเพื่อเซ็นใหม่
  if (decision === "approve" && c.editProposedBodyHtml?.trim()) {
    const token = randomBytes(24).toString("base64url");
    await prisma.$transaction([
      prisma.rentalContractAddendum.create({
        data: {
          id: randomUUID(),
          orgId: session.user.org_id,
          contractId,
          seq: c._count.addenda + 1,
          summary: `แก้ไขเนื้อสัญญาตามคำขอ (ฉบับแก้ไขที่ ${c._count.addenda + 1})${n ? ` — ${n}` : ""}`,
          bodyHtml: c.customTermsHtml ?? null, // สแนปช็อตเนื้อเดิมก่อนแก้
          createdBy: session.user.id,
        },
      }),
      prisma.rentalContract.update({
        where: { id: contractId },
        data: {
          customTermsHtml: c.editProposedBodyHtml,
          editProposedBodyHtml: null,
          editStatus: "none",
          editRequestReason: null,
          editDecidedBy: session.user.id,
          editDecidedAt: new Date(),
          editDecisionNote: n,
          // เซ็นใหม่ (ไม่ลบลายเซ็นเดิมเงียบ ๆ — เก็บใน addendum แล้ว)
          tenantSigned: false,
          signedAt: null,
          signatureDataUrl: null,
          signerName: null,
          signToken: token,
        },
      }),
    ]);
    await logAudit(session, "RENTSPACE_CONTRACT_SAVED", "rental_contract", contractId, { action: "approve_edit_applied", note: n });
    revalidatePath("/rentspace/contracts");
    revalidatePath(`/rentspace/contracts/${contractId}`);
    return { ok: true, applied: true, reSignRequired: true };
  }

  // ปฏิเสธ หรือ อนุมัติแบบไม่มีข้อความเสนอ (legacy: ให้แอดมินไปแก้เองในฟอร์ม)
  await prisma.rentalContract.update({
    where: { id: contractId },
    data: {
      editStatus: decision === "approve" ? "approved" : "rejected",
      editProposedBodyHtml: decision === "reject" ? null : c.editProposedBodyHtml,
      editDecidedBy: session.user.id,
      editDecidedAt: new Date(),
      editDecisionNote: n,
    },
  });
  await logAudit(session, "RENTSPACE_CONTRACT_SAVED", "rental_contract", contractId, { action: `${decision}_edit`, note: n });
  revalidatePath("/rentspace/contracts");
  revalidatePath(`/rentspace/contracts/${contractId}`);
  return { ok: true };
}

// ───────── ลบสัญญา (ต้องเปิดสิทธิ์ contractDeleteUnlocked · super_admin ทะลุ · กันลบที่มีบิล) ─────────
export async function actDeleteContract(contractId: string) {
  const session = await gateAdmin();
  const c = await prisma.rentalContract.findFirst({
    where: { id: contractId, orgId: session.user.org_id },
    select: {
      id: true,
      unitId: true,
      status: true,
      project: { select: { contractDeleteUnlocked: true } },
      _count: { select: { bills: true } },
    },
  });
  if (!c) throw new Error("ไม่พบสัญญา หรือไม่มีสิทธิ์");
  if (!c.project.contractDeleteUnlocked && !isSuperAdmin(session.user.role)) {
    throw new Error('การลบสัญญาถูกปิดอยู่ — เปิดสิทธิ์ "ลบสัญญา" ในหน้าตั้งค่าก่อน');
  }
  // กันลบประวัติเงิน: สัญญาที่มีบิลแล้วให้ "ยกเลิกสัญญา" แทน (บิลผูก onDelete cascade)
  if (c._count.bills > 0) {
    throw new Error("สัญญานี้มีบิลผูกอยู่แล้ว ลบไม่ได้ — ใช้ “ยกเลิกสัญญา” แทนเพื่อเก็บประวัติ");
  }
  await prisma.rentalContract.delete({ where: { id: contractId } });
  if (c.status === "active") {
    await prisma.rentalUnit.update({ where: { id: c.unitId }, data: { status: "vacant" } }).catch(() => {});
  }
  await logAudit(session, "RENTSPACE_CONTRACT_TERMINATED", "rental_contract", contractId, { deleted: true });
  revalidatePath("/rentspace/contracts");
  revalidatePath("/rentspace");
  return { ok: true };
}
