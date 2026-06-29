/**
 * ตู้คีบ OS — แอปพนักงาน (หน้าบ้าน · mobile employee app)
 * Server: ลองโหลดสาขา/กลุ่ม/ตู้/SKU จริงด้วย getGroupCollectData() ใน try/catch.
 * ถ้าว่าง (DB ยังไม่ seed / ยังไม่ migrate) → client ใช้ demo fallback (id ขึ้นต้น "demo-").
 * หน้านี้แสดงทั้งใน back-office (กรอบมือถือ) และใช้เต็มจอบนมือถือจริง (component เดียว render สองที่).
 */
import { getGroupCollectData } from "@/lib/clawfleet/group-data";
import { StaffAppClient } from "./staff-app-client";
import type { GroupCollectBranch, CollectSku } from "@/lib/clawfleet/group-data";

export const dynamic = "force-dynamic";

export default async function StaffAppPage() {
  let orgId = "";
  let branches: GroupCollectBranch[] = [];
  let skus: CollectSku[] = [];
  try {
    const data = await getGroupCollectData();
    orgId = data.orgId;
    branches = data.branches;
    skus = data.skus;
  } catch {
    // graceful: ยังไม่ migrate / DB ว่าง → client จะ demo fallback เอง
  }

  return <StaffAppClient orgId={orgId} branches={branches} skus={skus} />;
}
