/**
 * ตู้คีบ OS — ฝากเงิน (Cash Deposit → Bank)
 * ปิดจุดบอด "มือพนักงาน → ธนาคาร": พิสูจน์ว่าเงินที่แม่บ้านเก็บได้ ถูกฝากเข้าธนาคารครบ.
 * Server: โหลด "รอบที่เก็บแล้วยังไม่ฝาก" (getPendingDeposits) + "ประวัติใบฝาก" (getDepositHistory)
 *         + orgId/currentUserName จาก session (ใช้ผูกกับปุ่มถ่ายสลิป + stamp ผู้ฝาก) ใน try/catch.
 * ถ้า table ยังว่าง/ยังไม่ migrate → ลิสต์เป็น [] → client โชว์ empty state (ไม่มี sample หลอกตา).
 * การ์ด gate สิทธิ์จริง (module + role) อยู่ที่ layout เดิม — action ฝั่ง server เช็ก branch-scope เอง.
 */
import { requireCfSession } from "@/lib/clawfleet/role-guard";
import {
  getPendingDeposits,
  getDepositHistory,
  type PendingDepositRow,
  type DepositRow,
} from "@/lib/clawfleet/deposit-queries";
import { DepositsClient } from "./deposits-client";

export const dynamic = "force-dynamic";

export default async function DepositsPage() {
  let pending: PendingDepositRow[] = [];
  let history: DepositRow[] = [];
  let orgId = "";
  let currentUserName = "";

  try {
    const session = await requireCfSession();
    orgId = session.user.org_id;
    currentUserName = session.user.name ?? "";
  } catch {
    // graceful: ถ้าดึง session ไม่ได้ layout จะ redirect อยู่แล้ว
  }

  try {
    pending = await getPendingDeposits();
  } catch {
    // graceful: table ยังไม่ถูก migrate / DB ว่าง → client โชว์ empty state
    pending = [];
  }

  try {
    history = await getDepositHistory({ limit: 100 });
  } catch {
    history = [];
  }

  return (
    <DepositsClient
      pending={pending}
      history={history}
      orgId={orgId}
      currentUserName={currentUserName}
    />
  );
}
