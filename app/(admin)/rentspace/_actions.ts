"use server";

import { randomUUID, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { putObject } from "@/lib/r2/upload";
import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/log";
import { toNum } from "@/lib/rentspace/format";
import { createBillForContract, recomputeBillTotals, computeMeterUsage, round2 } from "@/lib/rentspace/billing";
import { getBaseUrl } from "@/lib/utils/base-url";
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

async function gateSuper() {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) throw new Error("เฉพาะเจ้าของระบบ (super_admin) เท่านั้น");
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
      contracts: { where: { status: { in: ["active", "expiring"] } }, take: 1, orderBy: { startDate: "desc" }, include: { tenant: true } },
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
  lateFeeType?: "none" | "fixed" | "percent_total" | "per_day";
  lateFeeValue?: number;
  lateFeeGraceDays?: number;
  billDueDay?: number;
  autoBillEnabled?: boolean;
  view3dEnabled?: boolean;
  // ── tax-header (ผู้ให้เช่า) — shown on the bill so corporate tenants get a ใบกำกับภาษี
  billCompanyName?: string;
  billTaxId?: string;
  billBranch?: string;
  billAddress?: string;
}) {
  const session = await gateSuper();
  const data = {
    name: input.name.trim(),
    slug: input.slug.trim() || "default",
    address: input.address ?? null,
    description: input.description ?? null,
    planImageUrl: input.planImageUrl ?? null,
    electricRate: input.electricRate ?? 7,
    waterRate: input.waterRate ?? 18,
    vatPercent: input.vatPercent ?? 0,
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
    where: { unitId: id, status: { in: ["active", "expiring"] } },
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
    where: { tenantId: id, status: { in: ["active", "expiring"] } },
  });
  if (active > 0) throw new Error("ลบไม่ได้ — ผู้เช่ามีสัญญาที่ยังใช้งานอยู่");
  await prisma.rentalTenant.update({ where: { id }, data: { isActive: false } });
  await logAudit(session, "RENTSPACE_TENANT_DELETED", "rental_tenant", id);
  revalidatePath("/rentspace/tenants");
  return { ok: true };
}

// ───────── contract template ─────────
export async function actSaveTemplate(input: { id?: string; name: string; bodyHtml: string; isDefault?: boolean }) {
  const session = await gateSuper();
  let id = input.id;
  if (input.isDefault) {
    await prisma.rentalContractTemplate.updateMany({
      where: { orgId: session.user.org_id, isDefault: true },
      data: { isDefault: false },
    });
  }
  const data = { name: input.name.trim(), bodyHtml: input.bodyHtml, isDefault: !!input.isDefault };
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

export async function actDeleteTemplate(id: string) {
  const session = await gateSuper();
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
  startDate: string;
  endDate?: string;
  rentAmountThb: number;
  rentDueDay?: number;
  depositAmountThb?: number;
  depositMonths?: number;
  vatPercent?: number;
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
  activate?: boolean;
}) {
  const session = await gateAdmin();
  const data = {
    projectId: input.projectId,
    unitId: input.unitId,
    tenantId: input.tenantId,
    templateId: input.templateId ?? null,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    rentAmountThb: input.rentAmountThb,
    rentDueDay: input.rentDueDay ?? 5,
    depositAmountThb: input.depositAmountThb ?? 0,
    depositMonths: input.depositMonths ?? 0,
    vatPercent: input.vatPercent ?? 0,
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
  let id = input.id;
  if (id) {
    await ownGuard(prisma.rentalContract.findFirst({ where: { id, orgId: session.user.org_id }, select: { id: true } }), "สัญญา");
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
  // occupy the unit when activated
  if (input.activate) {
    await prisma.rentalUnit.update({ where: { id: input.unitId }, data: { status: "occupied" } });
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
  billIssueDay?: number | null;
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalContract.findFirst({ where: { id: input.contractId, orgId: session.user.org_id }, select: { id: true } }),
    "สัญญา",
  );
  await prisma.rentalContract.update({
    where: { id: input.contractId },
    data: {
      lateFeeType: input.lateFeeType,
      lateFeeValue: input.lateFeeValue,
      lateFeeGraceDays: input.lateFeeGraceDays,
      promoDiscountThb: input.promoDiscountThb,
      promoMonths: input.promoMonths,
      billIssueDay: input.billIssueDay ?? null,
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
}) {
  const session = await gateAdmin();
  await ownGuard(
    prisma.rentalUnit.findFirst({ where: { id: input.unitId, orgId: session.user.org_id }, select: { id: true } }),
    "ห้อง",
  );
  // ensure a meter exists
  let meter = await prisma.rentalMeter.findUnique({
    where: { unitId_kind: { unitId: input.unitId, kind: input.kind } },
  });
  if (!meter) {
    meter = await prisma.rentalMeter.create({
      data: { id: randomUUID(), orgId: session.user.org_id, unitId: input.unitId, kind: input.kind },
    });
  }
  // previous reading = last reading before this period, else meter initial
  const prevRow = await prisma.rentalMeterReading.findFirst({
    where: { meterId: meter.id, period: { lt: input.period } },
    orderBy: { period: "desc" },
  });
  const prevReading = prevRow ? toNum(prevRow.currReading) : toNum(meter.initialReading);
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
  // ออกบิลได้เฉพาะสัญญาที่ยังใช้งานอยู่ (UI กรองแล้ว แต่ guard ฝั่ง server กัน API ตรง)
  if (!["active", "expiring"].includes(contract.status)) {
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
    where: { orgId: session.user.org_id, projectId, status: { in: ["active", "expiring"] } },
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
      select: { id: true },
    });
    if (existing) {
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
      status: { in: ["active", "expiring"] },
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
      select: { id: true },
    });
    if (existing) {
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
  const contracts = await prisma.rentalContract.findMany({
    where: { orgId: session.user.org_id, projectId, status: { in: ["active", "expiring"] } },
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
      status: { in: ["active", "expiring"] },
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
    select: { id: true, voidStatus: true, voidRequestedBy: true },
  });
  if (!bill) throw new Error("ไม่พบบิล หรือไม่มีสิทธิ์");
  if (bill.voidStatus !== "pending") throw new Error("ไม่มีคำขอยกเลิกที่รออนุมัติ");
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
  // กันรับชำระซ้ำ (double-click / network retry / หลายแท็บ): บิล+ยอด+วิธี+วันเดียวกัน ภายใน 2 นาที = ซ้ำ
  const dupSince = new Date(Date.now() - 120_000);
  const dup = await prisma.rentalPayment.findFirst({
    where: {
      billId: bill.id,
      amountThb: input.amountThb,
      method: input.method ?? "transfer",
      paidOn: new Date(input.paidOn),
      createdAt: { gte: dupSince },
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
  });
  if (!bill) throw new Error("ไม่พบบิล");
  // ฐานส่วนลด = ผลรวมรายการบิลจริง (rent+ไฟ+น้ำ+ค่าปรับ) ตรงกับที่ recomputeBillTotals เฉลี่ยส่วนลด — otherAmount ยังไม่มี line item จึงไม่รวม
  const base = toNum(bill.rentAmount) + toNum(bill.electricAmount) + toNum(bill.waterAmount) + toNum(bill.lateFeeAmount);
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
    data: {
      publicToken: token,
      sentAt: new Date(),
      sentChannel: "link",
    },
  });

  await logAudit(session, "RENTSPACE_BILL_CREATED", "rental_bill", bill.id, { sent: true, channel: "link" });
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${bill.id}`);
  return { ok: true, token, url: publicBillUrl(token) };
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
