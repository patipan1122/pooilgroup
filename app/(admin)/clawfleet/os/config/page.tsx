/**
 * ตู้คีบ OS — ตั้งค่าตู้ (Machine Config approval queue)
 * Server: โหลดรายชื่อสาขา (context) + คำขอตั้งค่าตู้จริง (cf_config_requests) ใน try/catch.
 * ถ้า table ยังไม่ migrate → requests = [] → client โชว์ empty state (ไม่มี sample หลอกตา).
 */
import { getV2Branches } from "@/lib/clawfleet/queries";
import { getCfConfigRequests, type CfConfigRequestView } from "@/lib/clawfleet/config-requests";
import { ConfigClient } from "./config-client";
import { requireSession } from "@/lib/auth/session";
import { resolveCompanyFilter } from "@/lib/auth/company-context";

export const dynamic = "force-dynamic";

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const sp = await searchParams;
  let branches: Awaited<ReturnType<typeof getV2Branches>> = [];
  let requests: CfConfigRequestView[] = [];

  // บริษัทที่เลือกไว้ (ตัวสลับบริษัท global) — เลือกทั้งหน้าตามบริษัทนี้ (CEO company-switcher Phase 4)
  let companyId: string | undefined;
  try {
    const s = await requireSession();
    companyId = await resolveCompanyFilter(s.user.org_id, sp.company);
  } catch {
    // graceful: ยังไม่ login → companyId undefined
  }

  try {
    branches = await getV2Branches(companyId);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → ไม่มี context สาขา (ไม่บล็อกหน้า)
  }

  try {
    requests = await getCfConfigRequests(companyId);
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
