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
import { createBillForContract, recomputeBillTotals } from "@/lib/rentspace/billing";

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
  };
  let id = input.id;
  if (id) {
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
    await prisma.rentalUnit.update({ where: { id }, data });
  } else {
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
      prisma.rentalUnit.update({
        where: { id: p.id },
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
  await gateSuper();
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
    rentSchedule: input.rentSchedule ? (input.rentSchedule as never) : undefined,
    customTermsHtml: input.customTermsHtml ?? null,
    note: input.note ?? null,
    status: (input.activate ? "active" : "draft") as "active" | "draft",
  };
  let id = input.id;
  if (id) {
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

export async function actGenerateSignLink(contractId: string) {
  await gateAdmin();
  const token = randomBytes(24).toString("base64url");
  await prisma.rentalContract.update({ where: { id: contractId }, data: { signToken: token } });
  revalidatePath(`/rentspace/contracts/${contractId}`);
  return { token };
}

export async function actTerminateContract(contractId: string, note?: string) {
  const session = await gateAdmin();
  const c = await prisma.rentalContract.update({
    where: { id: contractId },
    data: { status: "terminated", note: note ?? null },
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
}) {
  const session = await gateAdmin();
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
  const usage = Math.max(0, toNum(input.currReading) - prevReading);
  const amountThb = Math.round(usage * toNum(rate) * 100) / 100;
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

export async function actVoidBill(billId: string) {
  const session = await gateAdmin();
  await prisma.rentalBill.update({ where: { id: billId }, data: { status: "void" } });
  await logAudit(session, "RENTSPACE_BILL_VOIDED", "rental_bill", billId);
  revalidatePath("/rentspace/bills");
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
  const paidAmount = toNum(bill.paidAmount) + input.amountThb;
  await prisma.rentalBill.update({ where: { id: bill.id }, data: { paidAmount } });
  await recomputeBillTotals(bill.id);
  await logAudit(session, "RENTSPACE_PAYMENT_RECORDED", "rental_bill", bill.id, { amount: input.amountThb });
  revalidatePath("/rentspace/payments");
  revalidatePath("/rentspace/bills");
  revalidatePath(`/rentspace/bills/${bill.id}`);
  revalidatePath("/rentspace");
  return { ok: true };
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
  const base = toNum(bill.rentAmount) + toNum(bill.electricAmount) + toNum(bill.waterAmount) + toNum(bill.otherAmount);
  const computedAmount =
    input.kind === "percent" ? Math.round(base * (input.value / 100) * 100) / 100 : input.value;
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

/** Approve/reject a discount. Approval requires admin tier (not program_admin). */
export async function actDecideDiscount(discountId: string, decision: "approved" | "rejected", note?: string) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) throw new Error("เฉพาะผู้ดูแล (admin) ขึ้นไปอนุมัติส่วนลดได้");
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
