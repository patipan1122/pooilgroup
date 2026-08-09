"use server";

// CashHub Hotel — ปุ่ม "ดึงจากชีตเดี๋ยวนี้" (บังคับซิงค์ข้าม throttle)
//   ผู้บริหาร/บัญชีเท่านั้น · guard cross-org (branch ต้องเป็นโรงแรมในองค์กรตัวเอง)

import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { maybeSyncHotelSheet } from "@/lib/cashhub/hotel-sheet-sync";
import { revalidatePath } from "next/cache";

export async function syncHotelNowAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);

  const branchId = String(formData.get("branchId") ?? "");
  const monthStr = String(formData.get("month") ?? "");
  const [yy, mm] = monthStr.split("-").map((x) => Number.parseInt(x, 10));
  if (!branchId || !yy || !mm || mm < 1 || mm > 12) return;

  const admin = adminClient();

  // guard: branch ต้องเป็นโรงแรมในองค์กรของผู้ใช้ (กัน IDOR/cross-org)
  const { data: branch } = await admin
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .eq("business_type", "hotel")
    .maybeSingle();
  if (!branch) return;

  await maybeSyncHotelSheet({
    admin,
    branchId,
    year: yy,
    month: mm,
    userId: session.user.id,
    force: true,
  });

  revalidatePath("/cashhub/hotel");
}
