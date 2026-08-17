// RentSpace — ประวัติการแก้ไขบิล (สร้าง/แก้ไข/ลบ/จ่ายเงิน/ออกใบกำกับ) อ่านจากตาราง audit_logs
// กลางเดิมของระบบ (resource_type="rental_bill") — ไม่มีตารางใหม่ ใช้ของที่มีอยู่แล้ว.
import { adminClient } from "@/lib/db/server";

export type BillHistoryEntry = {
  id: string;
  action: string;
  createdAt: string;
  userName: string | null;
  diff: { old?: Record<string, unknown>; new?: Record<string, unknown> } | null;
};

/** ทุกเหตุการณ์ของบิลใบเดียว เรียงล่าสุดก่อน — ใช้ได้แม้บิลถูกลบไปแล้ว (audit_logs แยกตาราง ไม่ผูก FK cascade). */
export async function getBillHistory(orgId: string, billId: string): Promise<BillHistoryEntry[]> {
  const admin = adminClient();
  const { data } = await admin
    .from("audit_logs")
    .select("id, action, created_at, diff, users(name)")
    .eq("org_id", orgId)
    .eq("resource_type", "rental_bill")
    .eq("resource_id", billId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      action: string;
      created_at: string;
      diff: BillHistoryEntry["diff"];
      users: { name: string | null } | { name: string | null }[] | null;
    };
    const userRow = Array.isArray(row.users) ? row.users[0] : row.users;
    return {
      id: row.id,
      action: row.action,
      createdAt: row.created_at,
      userName: userRow?.name ?? null,
      diff: row.diff ?? null,
    };
  });
}

/** billId ที่เคยถูก "แก้ไขรายการ" (RENTSPACE_BILL_UPDATED) อย่างน้อย 1 ครั้ง — query เดียว โหลดทั้งตาราง matrix ไม่ N+1. */
export async function getEditedBillIds(orgId: string, billIds: string[]): Promise<Set<string>> {
  if (billIds.length === 0) return new Set();
  const admin = adminClient();
  const { data } = await admin
    .from("audit_logs")
    .select("resource_id")
    .eq("org_id", orgId)
    .eq("resource_type", "rental_bill")
    .eq("action", "RENTSPACE_BILL_UPDATED")
    .in("resource_id", billIds);
  return new Set((data ?? []).map((r) => r.resource_id as string));
}
