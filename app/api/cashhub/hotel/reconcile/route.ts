// POST /api/cashhub/hotel/reconcile — ส่งยอดเข้าจริงของเดือน (QR/เงินสด) → ledger_revenue_entry (super_admin)
// body = { branchId, from, to } → นักบัญชีกระทบกับ statement ในหน้า bank-recon → หน้า hotel ขึ้นเขียว
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  loadHotelChannelConfig,
  computeHotelDeposits,
  sendHotelDaysToReconcile,
} from "@/lib/cashhub/hotel-settlement-data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ส่งเข้า reconcile ได้" }, { status: 403 });

  let body: { branchId?: string; from?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const branchId = String(body.branchId ?? "");
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!branchId || !from || !to)
    return NextResponse.json({ error: "ระบุสาขา/ช่วงวัน" }, { status: 400 });

  const orgId = session.user.org_id;
  const admin = adminClient();

  const { data: branch } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("id", branchId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!branch || (branch as { business_type: string }).business_type !== "hotel")
    return NextResponse.json({ error: "ไม่พบสาขาโรงแรมนี้" }, { status: 404 });
  const b = branch as { code: string; name: string };

  // ใช้ค่าตั้งของสาขานี้ถ้ามี (ไม่งั้น fallback ค่าเริ่มต้นทุกสาขา) — branch_code ของ hotel = branch_id
  const configs = await loadHotelChannelConfig(admin, orgId, branchId);
  if (!configs.some((c) => c.isSettle && c.companyId && c.bankAccountId))
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าช่องทาง→บัญชีปลายทาง" },
      { status: 400 },
    );

  const deposits = await computeHotelDeposits(admin, orgId, branchId, from, to);
  const res = await sendHotelDaysToReconcile(orgId, b.code, b.name, deposits, configs);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId,
    userId: session.user.id,
    action: "SEND_HOTEL_RECONCILE",
    resourceType: "ledger_revenue_entry",
    diff: {
      new: { branchId, branchCode: b.code, from, to, inserted: res.inserted, skipped: res.skippedNoConfig },
    },
  });
  return NextResponse.json({ ok: true, ...res });
}
