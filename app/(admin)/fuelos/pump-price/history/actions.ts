"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/fuelos/auth";
import { snapshotPumpPrices } from "@/lib/fuelos/pump-price-history";

// บันทึกราคาหน้าปั๊มของวันนี้ทันที (กันต้องรอ cron รอบเช้า) — ใครก็กดได้ (อ่านข้อมูลสาธารณะ)
export async function snapshotPumpPricesNow(): Promise<{ ok: boolean; saved: number; error?: string }> {
  await requireUser();
  const r = await snapshotPumpPrices();
  revalidatePath("/fuelos/pump-price/history");
  return r;
}
