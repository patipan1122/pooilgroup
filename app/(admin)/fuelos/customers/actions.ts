"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";

export async function createCustomer(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const c = await prisma.customer.create({
    data: {
      orgId: user.orgId,
      name,
      legalName: String(formData.get("legalName") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      zone: String(formData.get("zone") ?? "") || null,
      province: String(formData.get("province") ?? "") || null,
      creditLimit: formData.get("creditLimit") ? Number(formData.get("creditLimit")) : null,
      paymentTerms: formData.get("paymentTerms") ? Number(formData.get("paymentTerms")) : null,
      normalCadenceDays: formData.get("cadence") ? Number(formData.get("cadence")) : null,
      assignedSalesId: user.id,
    },
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "CUSTOMER_CREATE", entity: "Customer", entityId: c.id });
  revalidatePath("/fuelos/customers");
  redirect(`/fuelos/customers/${c.id}`);
}

export async function updateCustomer(id: string, data: { notes?: string; cadence?: number | null; creditLimit?: number | null; assignedSalesId?: string | null }) {
  const user = await requireUser();
  // scope ด้วย orgId เสมอ (ไม่มี RLS → ป้องกันแก้ข้อมูลข้ามองค์กร)
  const r = await prisma.customer.updateMany({
    where: { id, orgId: user.orgId },
    data: {
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.cadence !== undefined ? { normalCadenceDays: data.cadence, cadenceManual: true } : {}),
      ...(data.creditLimit !== undefined ? { creditLimit: data.creditLimit } : {}),
      ...(data.assignedSalesId !== undefined ? { assignedSalesId: data.assignedSalesId } : {}),
    },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบลูกค้า" };
  await audit({ orgId: user.orgId, userId: user.id, action: "CUSTOMER_UPDATE", entity: "Customer", entityId: id, meta: data });
  revalidatePath(`/fuelos/customers/${id}`);
  return { ok: true };
}

export async function addFollowUp(customerId: string, note: string, dueDate: string) {
  const user = await requireUser();
  // กันสร้าง follow-up ให้ลูกค้าข้ามองค์กร (fuel ไม่มี RLS)
  const customer = await prisma.customer.findFirst({ where: { id: customerId, orgId: user.orgId }, select: { id: true } });
  if (!customer) return { ok: false, error: "ไม่พบลูกค้า" };
  await prisma.followUp.create({
    data: { orgId: user.orgId, customerId, salesId: user.id, note, dueDate: new Date(dueDate), kind: "manual" },
  });
  revalidatePath(`/fuelos/customers/${customerId}`);
  return { ok: true };
}

export async function doneFollowUp(id: string, customerId: string) {
  const user = await requireUser();
  const r = await prisma.followUp.updateMany({ where: { id, orgId: user.orgId }, data: { status: "DONE" } });
  if (r.count === 0) return { ok: false, error: "ไม่พบรายการติดตาม" };
  revalidatePath(`/fuelos/customers/${customerId}`);
  return { ok: true };
}
