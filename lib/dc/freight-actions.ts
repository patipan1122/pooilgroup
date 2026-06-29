"use server";

// DC คลังกลาง · ตั้งเรตค่าขนส่งต่อคิว (m³) แยกรถ/เรือ — สำหรับหน้า settings (#4)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { DcShipmentMode } from "@/lib/generated/prisma/enums";

export type FreightRateSettings = {
  truckPerCbmSatang: number;
  seaPerCbmSatang: number;
};

export async function getFreightRateSettings(): Promise<FreightRateSettings> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return { truckPerCbmSatang: 0, seaPerCbmSatang: 0 };
  const orgId = session.user.org_id;
  const rows = await prisma.dcFreightRate.findMany({
    where: { orgId },
    select: { mode: true, ratePerCbmSatang: true },
  });
  let truck = 0;
  let sea = 0;
  for (const r of rows) {
    if (r.mode === DcShipmentMode.SEA) sea = r.ratePerCbmSatang;
    else truck = r.ratePerCbmSatang;
  }
  return { truckPerCbmSatang: truck, seaPerCbmSatang: sea };
}

export async function setFreightRate(input: {
  mode: "TRUCK" | "SEA";
  ratePerCbmSatang: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ตั้งเรตค่าขนส่ง" };
  const orgId = session.user.org_id;
  const userId = session.user.id;
  const mode = input.mode === "SEA" ? DcShipmentMode.SEA : DcShipmentMode.TRUCK;
  const rate =
    Number.isFinite(input.ratePerCbmSatang) && input.ratePerCbmSatang >= 0
      ? Math.trunc(input.ratePerCbmSatang)
      : 0;

  await prisma.dcFreightRate.upsert({
    where: { orgId_mode: { orgId, mode } },
    update: { ratePerCbmSatang: rate, updatedByUserId: userId },
    create: { orgId, mode, ratePerCbmSatang: rate, updatedByUserId: userId },
  });
  revalidatePath("/dc/office/purchasing");
  revalidatePath("/dc/office/settings");
  return { ok: true };
}
