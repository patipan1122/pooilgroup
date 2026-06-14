// POST /api/cashhub/hotel/iv-save — บันทึกข้อมูล IV ที่ดึงมาแล้ว ลง DB (source=trcloud_iv)
// เก็บแยกจาก Sheet (CEO: 2 ชุด). idempotent upsert บน (branch,date,shift,source).
// รับ rows ที่ client ดึง+แยกห้อง/ขนม/ทิป มาแล้ว → เขียนทีเดียว (ไม่เรียก TRCloud ซ้ำ)
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

export const runtime = "nodejs";

type InRow = {
  date: string; // YYYY-MM-DD
  shift: "morning" | "evening";
  total: number;
  cash?: number;
  qr?: number;
  over?: number;
  short?: number;
  room?: number | null;
  goods?: number | null;
  tip?: number | null;
  fine?: number | null;
  ivNo?: string;
  status?: string;
};

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  const orgId = session.user.org_id;
  const admin = adminClient();

  let body: { branchId?: string; rows?: InRow[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const branchId = String(body.branchId ?? "");
  const rows = body.rows ?? [];
  if (!branchId || rows.length === 0)
    return NextResponse.json({ error: "ไม่มีข้อมูลให้บันทึก" }, { status: 400 });

  // ยืนยันสาขาเป็นโรงแรมในองค์กรนี้
  const { data: branch } = await admin
    .from("branches")
    .select("id, company_id, business_type")
    .eq("id", branchId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!branch || (branch as { business_type: string }).business_type !== "hotel")
    return NextResponse.json({ error: "ไม่พบสาขาโรงแรมนี้" }, { status: 404 });
  const companyId = (branch as { company_id: string }).company_id;

  const now = new Date().toISOString();
  const payloads = rows.map((r) => ({
    org_id: orgId,
    company_id: companyId,
    branch_id: branchId,
    sales_date: r.date,
    shift: r.shift,
    room_revenue: r.room ?? null,
    goods_sales: r.goods ?? null,
    tip: r.tip ?? null,
    fine: r.fine ?? null,
    total_sales: r.total,
    cash_to_remit: r.cash ?? null,
    qr_total: r.qr ?? null,
    over_short: (r.over ?? 0) - (r.short ?? 0),
    iv_number: r.ivNo ?? null,
    iv_status: r.status ?? null,
    source: "trcloud_iv",
    imported_by: session.user.id,
    imported_at: now,
    updated_at: now,
  }));

  const { error } = await admin
    .from("cashhub_hotel_daily")
    .upsert(payloads, { onConflict: "branch_id,sales_date,shift,source" });
  if (error)
    return NextResponse.json(
      { error: `บันทึกไม่สำเร็จ: ${error.message}` },
      { status: 500 },
    );

  await audit({
    orgId,
    userId: session.user.id,
    action: "IMPORT_HOTEL_SALES",
    resourceType: "cashhub_hotel_daily",
    diff: { new: { branchId, source: "trcloud_iv", saved: payloads.length } },
  });

  return NextResponse.json({ ok: true, saved: payloads.length });
}
