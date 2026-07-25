"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { syncTrcloudDocs, type TrcloudDocSyncResult } from "@/lib/ledger/trcloud-docs";
import { readTrcloudDocDetail, type TrcloudDocDetail } from "@/lib/ledger/trcloud-doc-detail";

// รีเฟรช: ดึง PO/AP ล่าสุดจาก TRCloud มาเก็บ snapshot (อ่านล้วนจาก TRCloud + เขียนแค่ตารางสำเนาเรา).
export async function actSyncTrcloudDocs(): Promise<TrcloudDocSyncResult> {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const res = await syncTrcloudDocs(session.user.org_id);
  revalidatePath("/ledger/trcloud-docs");
  return res;
}

// เปิด "ไส้ใน" ของใบเดียวสด ๆ จาก TRCloud (อ่านอย่างเดียว · ตอนผู้ใช้คลิกใบในตาราง):
//   รายการสินค้า + การลงบัญชีจริง (Dr/Cr) + จับใบที่ตก 5919999.
export async function actReadTrcloudDocDetail(
  kind: "PO" | "AP",
  trcloudId: string,
  refNo: string | null,
): Promise<TrcloudDocDetail> {
  await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  return readTrcloudDocDetail(kind, trcloudId, refNo);
}
