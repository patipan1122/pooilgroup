/**
 * ตู้คีบ OS — แจ้งซ่อม / ตู้เสีย (Repair tickets)
 * Server: gate ด้วย layout เดิม (module + role) + คำนวณสิทธิ์ "ปิดงาน/ยกเลิก/ปิดตู้" (ผจก.+แอดมิน)
 * แล้วโหลดตั๋วซ่อมจริงจาก listRepairTickets() ใน try/catch → ส่งให้ client.
 * ถ้า table ยังว่าง/ยังไม่ migrate → tickets = [] → client โชว์ empty state (ไม่มี sample หลอกตา).
 */
import { requireCfSession, cfHasAdminPower, isCfBranchManager } from "@/lib/clawfleet/role-guard";
import { listRepairTickets, type RepairTicketRow } from "@/lib/clawfleet/repair-queries";
import { RepairsClient } from "./repairs-client";

export const dynamic = "force-dynamic";

export default async function RepairsPage() {
  let tickets: RepairTicketRow[] = [];
  let canManage = false;
  let currentUserName = "";

  try {
    const session = await requireCfSession();
    // "ปิดงาน / ยกเลิก / ปิดตู้ชั่วคราว" = ผจก.สาขา + แอดมิน (รวม program_admin grant)
    // admin-power (แอดมิน+program_admin) หรือ ผจก.สาขา เห็นปุ่มจัดการ · viewer ไม่เห็น (read-only)
    // (scope สาขาต่อใบเช็กจริงใน 3 action ฝั่ง server — หน้านี้แค่ตัดสินว่าโชว์ปุ่มไหม)
    canManage = (await cfHasAdminPower(session)) || isCfBranchManager(session.user.role);
    currentUserName = session.user.name ?? "";
  } catch {
    // graceful: ถ้าดึง session ไม่ได้ layout จะ redirect อยู่แล้ว → ปล่อยให้เป็น read-only
  }

  try {
    tickets = await listRepairTickets();
  } catch {
    // graceful: table ยังไม่ถูก migrate / DB ว่าง → client โชว์ empty state
    tickets = [];
  }

  return (
    <RepairsClient
      tickets={tickets}
      canManage={canManage}
      currentUserName={currentUserName}
    />
  );
}
