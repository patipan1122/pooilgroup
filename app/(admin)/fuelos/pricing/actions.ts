"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import { startOfToday } from "@/lib/fuelos/pricing-data";
import type { ProductType } from "@/lib/generated/prisma/enums";

async function requireEditor() {
  const user = await requireUser();
  if (!atLeast(user.role, "SALES_HEAD")) {
    throw new Error("ไม่มีสิทธิ์แก้ราคา (เฉพาะหัวหน้าขายขึ้นไป)");
  }
  return user;
}

export async function saveDepotCosts(
  depotName: string,
  rows: { product: ProductType; cost: number }[],
): Promise<{ ok: boolean }> {
  const user = await requireEditor();
  const date = startOfToday();
  for (const r of rows) {
    if (!Number.isFinite(r.cost) || r.cost <= 0) continue;
    await prisma.depotPrice.upsert({
      where: {
        orgId_date_depotName_productType: {
          orgId: user.orgId, date, depotName, productType: r.product,
        },
      },
      create: {
        orgId: user.orgId, date, depotName, productType: r.product,
        costPerL: r.cost, enteredById: user.id,
      },
      update: { costPerL: r.cost, enteredById: user.id },
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "PRICE_SET", entity: "DepotPrice", meta: { depotName, count: rows.length } });
  revalidatePath("/fuelos/pricing");
  return { ok: true };
}

export async function saveZoneSettings(
  zone: string,
  rows: { product: ProductType; transport: number; base: number; min: number }[],
): Promise<{ ok: boolean }> {
  const user = await requireEditor();
  for (const r of rows) {
    if (!Number.isFinite(r.base)) continue;
    await prisma.zoneMargin.upsert({
      where: {
        orgId_zoneName_productType: { orgId: user.orgId, zoneName: zone, productType: r.product },
      },
      create: {
        orgId: user.orgId, zoneName: zone, productType: r.product,
        transportCost: Number.isFinite(r.transport) ? r.transport : 0,
        baseMargin: r.base, minMargin: r.min, isActive: true,
      },
      update: {
        transportCost: Number.isFinite(r.transport) ? r.transport : 0,
        baseMargin: r.base, minMargin: r.min, isActive: true,
      },
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "MARGIN_SET", entity: "ZoneMargin", meta: { zone, count: rows.length } });
  revalidatePath("/fuelos/pricing");
  return { ok: true };
}

// ---- จัดการคลัง (depot config) ----
export async function addDepot(name: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireEditor();
  const n = name.trim();
  if (!n) return { ok: false, error: "กรอกชื่อคลัง" };
  const exists = await prisma.fuelDepot.findFirst({ where: { orgId: user.orgId, name: n }, select: { id: true } });
  if (exists) return { ok: false, error: "มีคลังชื่อนี้แล้ว" };
  const count = await prisma.fuelDepot.count({ where: { orgId: user.orgId } });
  await prisma.fuelDepot.create({ data: { orgId: user.orgId, name: n, sort: count } });
  await audit({ orgId: user.orgId, userId: user.id, action: "DEPOT_ADD", entity: "FuelDepot", meta: { name: n } });
  revalidatePath("/fuelos/pricing");
  return { ok: true };
}

export async function renameDepot(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireEditor();
  const n = name.trim();
  if (!n) return { ok: false, error: "กรอกชื่อคลัง" };
  await prisma.fuelDepot.update({ where: { id, orgId: user.orgId }, data: { name: n } });
  revalidatePath("/fuelos/pricing");
  return { ok: true };
}

export async function toggleDepot(id: string, isActive: boolean): Promise<{ ok: boolean }> {
  const user = await requireEditor();
  await prisma.fuelDepot.update({ where: { id, orgId: user.orgId }, data: { isActive } });
  revalidatePath("/fuelos/pricing");
  return { ok: true };
}
