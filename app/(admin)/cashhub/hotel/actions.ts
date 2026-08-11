"use server";

// CashHub Hotel — ปุ่ม "ดึงจากชีตเดี๋ยวนี้" (บังคับซิงค์ข้าม throttle)
//   ผู้บริหาร/บัญชีเท่านั้น · guard cross-org (branch ต้องเป็นโรงแรมในองค์กรตัวเอง)

import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { maybeSyncHotelSheet } from "@/lib/cashhub/hotel-sheet-sync";
import { revalidatePath } from "next/cache";

export type SyncHotelNowState = { ok: boolean; message: string } | null;

export async function syncHotelNowAction(
  _prevState: SyncHotelNowState,
  formData: FormData,
): Promise<SyncHotelNowState> {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);

  const branchId = String(formData.get("branchId") ?? "");
  const monthStr = String(formData.get("month") ?? "");
  const [yy, mm] = monthStr.split("-").map((x) => Number.parseInt(x, 10));
  if (!branchId || !yy || !mm || mm < 1 || mm > 12) {
    return { ok: false, message: "ข้อมูลสาขา/เดือนไม่ถูกต้อง" };
  }

  const admin = adminClient();

  // guard: branch ต้องเป็นโรงแรมในองค์กรของผู้ใช้ (กัน IDOR/cross-org)
  const { data: branch } = await admin
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .eq("business_type", "hotel")
    .maybeSingle();
  if (!branch) return { ok: false, message: "ไม่พบสาขานี้ในองค์กรของคุณ" };

  const res = await maybeSyncHotelSheet({
    admin,
    branchId,
    year: yy,
    month: mm,
    userId: session.user.id,
    force: true,
  });

  revalidatePath("/cashhub/hotel");

  if (!res) return { ok: false, message: "สาขานี้ยังไม่ได้ผูกชีต Google ไว้ (หรือปิด auto-sync)" };
  return { ok: res.status !== "error", message: res.message };
}
