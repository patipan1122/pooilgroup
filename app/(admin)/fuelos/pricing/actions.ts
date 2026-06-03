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

export async function saveZoneMargins(
  zone: string,
  rows: { product: ProductType; base: number; min: number }[],
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
        baseMargin: r.base, minMargin: r.min, isActive: true,
      },
      update: { baseMargin: r.base, minMargin: r.min },
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "MARGIN_SET", entity: "ZoneMargin", meta: { zone, count: rows.length } });
  revalidatePath("/fuelos/pricing");
  return { ok: true };
}
