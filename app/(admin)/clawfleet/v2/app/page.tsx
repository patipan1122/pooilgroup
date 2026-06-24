/**
 * ClawFleet v2 — STAFF MOBILE APP, web-playable ("ลองใช้จริงในเว็บ").
 *
 * CEO ask (2026-06-23): "ทำหน้าพนักงานมือถือ — กดผ่านมือถือ ดูขั้นตอนตามมือถือที่เห็น
 * แต่กดเล่นได้จริงในเว็บด้วย · เลือกสาขาลองใช้จริงได้เลย · แยกหน้าบ้าน(พนักงาน) กับ
 * หลังบ้าน(แอดมิน) ให้ชัด".
 *
 * FRONT-OF-HOUSE surface. Lives under (admin) for auth (admin/super can open it to
 * test; staff too), but renders FULL-SCREEN inside a phone frame with NO admin sidebar —
 * it is a separate surface from the back-office.
 *
 * REUSE, not rewrite: this drives the SAME real staff flow as the LIFF entry — same
 * loader (getGroupCollectData) and same client (CollectGroupClient) — so the anti-fraud
 * core (5 photos · 3-way cross-check · coin/doll/cash variance · segregation of duties)
 * stays 100% intact. We only wrap it in a phone shell + an optional demo PIN screen.
 */
import { getGroupCollectData } from "@/lib/clawfleet/v2-group-data";
import { StaffAppFrame } from "./staff-app-frame";

export const dynamic = "force-dynamic";

export default async function ClawfleetStaffAppPage() {
  const data = await getGroupCollectData();
  return (
    <StaffAppFrame orgId={data.orgId} branches={data.branches} skus={data.skus} />
  );
}
