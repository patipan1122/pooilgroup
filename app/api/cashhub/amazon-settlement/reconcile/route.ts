// POST /api/cashhub/amazon-settlement/reconcile — ส่งเงินเข้าจริงของเดือน → ledger_revenue_entry (super_admin)
// body = { storeCode, from, to }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { loadAmazonDays } from "@/lib/cashhub/amazon-data";
import {
  loadChannelConfig,
  sendDaysToReconcile,
} from "@/lib/cashhub/amazon-settlement-data";
import { branchByStoreCode } from "@/lib/cashhub/amazon-trcloud";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ส่งเข้า reconcile ได้" }, { status: 403 });

  let body: { storeCode?: string; storeLabel?: string; from?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  // store_code จริงจากแถวที่เซฟ (ไม่ใช่ cfg.storeCode ที่อาจว่างสำหรับสาขาจับคู่ด้วยชื่อ)
  const storeCode = (body.storeCode ?? "").trim();
  if (!storeCode) return NextResponse.json({ error: "ไม่มีรหัสสาขา" }, { status: 400 });
  const cfg = branchByStoreCode(storeCode, body.storeLabel ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const from = body.from ?? "";
  const to = body.to ?? "";
  if (!from || !to) return NextResponse.json({ error: "ระบุช่วงวัน" }, { status: 400 });

  const orgId = session.user.org_id;
  const admin = adminClient();
  const days = await loadAmazonDays(admin, orgId, storeCode, from, to);
  // ใช้ค่าตั้งของสาขานี้ถ้ามี (ไม่งั้น fallback ค่าเริ่มต้นทุกสาขา)
  const configs = await loadChannelConfig(admin, orgId, storeCode);

  // ต้องตั้งบริษัทอย่างน้อย 1 ช่องก่อน (ไม่งั้นไม่มีอะไรเข้า reconcile)
  if (!configs.some((c) => c.isSettle && c.companyId))
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าบริษัท/บัญชีปลายทาง — ไปที่ ตั้งค่าช่องทาง ก่อน" },
      { status: 400 },
    );

  const res = await sendDaysToReconcile(orgId, storeCode, cfg.label, days, configs);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId,
    userId: session.user.id,
    action: "SEND_AMAZON_RECONCILE",
    resourceType: "ledger_revenue_entry",
    diff: { new: { storeCode, from, to, inserted: res.inserted, skipped: res.skippedNoConfig } },
  });
  return NextResponse.json({ ok: true, ...res });
}
