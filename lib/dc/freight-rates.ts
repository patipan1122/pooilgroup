// DC คลังกลาง · server util — อ่านเรตค่าขนส่งต่อคิว (m³) ของ org
//   (แยกจาก freight.ts ที่เป็น pure · แยกจาก freight-actions.ts ที่เป็น 'use server'
//    เพื่อให้ po-actions เรียกใช้ภายใน server context ได้โดยไม่กลายเป็น action)

import { prisma } from "@/lib/prisma";
import { ZERO_FREIGHT_RATES, type FreightRates } from "@/lib/dc/freight";

/** เรตค่าขนส่งต่อคิว (m³) ของ org — { TRUCK, SEA } สตางค์ (0 = ยังไม่ตั้ง) */
export async function loadFreightRates(orgId: string): Promise<FreightRates> {
  const rows = await prisma.dcFreightRate.findMany({
    where: { orgId },
    select: { mode: true, ratePerCbmSatang: true },
  });
  const out: FreightRates = { ...ZERO_FREIGHT_RATES };
  for (const r of rows) {
    if (r.mode === "SEA") out.SEA = r.ratePerCbmSatang;
    else out.TRUCK = r.ratePerCbmSatang;
  }
  return out;
}
