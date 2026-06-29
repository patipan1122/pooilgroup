/**
 * ตู้คีบ OS — ตั้งค่าตู้ (Machine Config approval queue)
 * Server: โหลดรายชื่อสาขาไว้เป็น context (try/catch). ยังไม่มี query/table สำหรับ "คำขอตั้งค่าตู้"
 * → client ใช้ SAMPLE config requests (หน้านี้เป็น screen ใหม่ → sampling คาดไว้แล้ว).
 *
 * BACKEND GAP: ยังไม่มี `cf_config_request` table + query/action จริง (ดู RETURN).
 */
import { getV2Branches } from "@/lib/clawfleet/v2-queries";
import { ConfigClient } from "./config-client";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  let branches: Awaited<ReturnType<typeof getV2Branches>> = [];
  try {
    branches = await getV2Branches();
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ sample fallback
  }

  return (
    <ConfigClient
      branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
    />
  );
}
