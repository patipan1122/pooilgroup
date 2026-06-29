/**
 * ตู้คีบ OS — ตั้งค่าตู้ (Machine Config approval queue)
 * Server: โหลดรายชื่อสาขา (context) + คำขอตั้งค่าตู้จริง (cf_config_requests) ใน try/catch.
 * ถ้า table ยังไม่ migrate → requests = [] → client โชว์ empty state (ไม่มี sample หลอกตา).
 */
import { getV2Branches } from "@/lib/clawfleet/queries";
import { getCfConfigRequests, type CfConfigRequestView } from "@/lib/clawfleet/config-requests";
import { ConfigClient } from "./config-client";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  let branches: Awaited<ReturnType<typeof getV2Branches>> = [];
  let requests: CfConfigRequestView[] = [];

  try {
    branches = await getV2Branches();
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → ไม่มี context สาขา (ไม่บล็อกหน้า)
  }

  try {
    requests = await getCfConfigRequests();
  } catch {
    // graceful: table ยังไม่ถูก migrate → client โชว์ empty state
    requests = [];
  }

  return (
    <ConfigClient
      branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
      requests={requests}
    />
  );
}
