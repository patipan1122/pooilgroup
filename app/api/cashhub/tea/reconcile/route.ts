// POST /api/cashhub/tea/reconcile — ส่งยอดเข้าจริงของเดือน (net ต่อช่องทาง) → ledger_revenue_entry (super_admin)
// body = { branchCode, from, to } → นักบัญชีกระทบกับ statement ในหน้า bank-recon → หน้า tea ขึ้นเขียว
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { TEA_BRANCHES } from "@/lib/cashhub/tea-trcloud";
import { loadTeaDays, loadTeaChannelConfig } from "@/lib/cashhub/tea-data";
import { sendTeaDaysToReconcile } from "@/lib/cashhub/tea-settlement-data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ส่งเข้า reconcile ได้" }, { status: 403 });

  let body: { branchCode?: string; from?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const branchCode = String(body.branchCode ?? "");
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!branchCode || !from || !to)
    return NextResponse.json({ error: "ระบุสาขา/ช่วงวัน" }, { status: 400 });

  const branch = TEA_BRANCHES.find((b) => b.code === branchCode);
  if (!branch) return NextResponse.json({ error: "ไม่พบสาขาร้านชานี้" }, { status: 404 });

  const orgId = session.user.org_id;
  const admin = adminClient();

  // ใช้ค่าตั้งของสาขานี้ถ้ามี (ไม่งั้น fallback ค่าเริ่มต้นทุกสาขา)
  const configs = await loadTeaChannelConfig(admin, orgId, branchCode);
  if (!configs.some((c) => c.isSettle && c.companyId && c.bankAccountId))
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าช่องทาง→บัญชีปลายทาง (ไปที่ ⚙ ตั้งค่าบัญชี)" },
      { status: 400 },
    );

  const savedDays = await loadTeaDays(admin, orgId, from, to, branchCode);
  const days = savedDays.map((d) => ({ date: d.sales_date, posChannels: d.pos_channels }));
  const res = await sendTeaDaysToReconcile(orgId, branchCode, branch.label, days, configs);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId,
    userId: session.user.id,
    action: "SEND_TEA_RECONCILE",
    resourceType: "ledger_revenue_entry",
    diff: {
      new: { branchCode, branchLabel: branch.label, from, to, inserted: res.inserted, skipped: res.skippedNoConfig },
    },
  });
  return NextResponse.json({ ok: true, ...res });
}
