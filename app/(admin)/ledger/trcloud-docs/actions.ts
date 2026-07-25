"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { syncTrcloudDocs, type TrcloudDocSyncResult } from "@/lib/ledger/trcloud-docs";

// รีเฟรช: ดึง PO/AP ล่าสุดจาก TRCloud มาเก็บ snapshot (อ่านล้วนจาก TRCloud + เขียนแค่ตารางสำเนาเรา).
export async function actSyncTrcloudDocs(): Promise<TrcloudDocSyncResult> {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const res = await syncTrcloudDocs(session.user.org_id);
  revalidatePath("/ledger/trcloud-docs");
  return res;
}
