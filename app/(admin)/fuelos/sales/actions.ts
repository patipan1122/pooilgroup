"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/fuelos/auth";
import { syncRecentSales, type SalesSyncResult } from "@/lib/fuelos/trcloud-sales";

// ดึงยอดขายล่าสุดจาก TRCloud บริษัท 44 (ปุ่ม "ดึงเดี๋ยวนี้" + auto-refresh)
// สิทธิ์: ระดับการเงินขึ้นไป (OWNER/ADMIN/SALES_HEAD/FINANCE)
export async function actSyncSalesNow(): Promise<SalesSyncResult> {
  const user = await requireRole("OWNER", "ADMIN", "SALES_HEAD", "FINANCE");
  const res = await syncRecentSales(user.orgId);
  revalidatePath("/fuelos/sales");
  return res;
}
