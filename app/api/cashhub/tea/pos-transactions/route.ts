// GET /api/cashhub/tea/pos-transactions?branch=...&date=YYYY-MM-DD
// คืนไส้ใน (รายบิล) ของ (สาขา, วัน) เดียว — ใช้เปิดหน้าไส้ใน QR/ช่องทางอื่นจากตาราง CashHub Tea
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { loadTeaPosTransactions } from "@/lib/cashhub/tea-data";
import { TEA_CHANNEL_BY_CODE } from "@/lib/cashhub/tea-channels";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const orgId = gate.session.user.org_id;

  const branchCode = req.nextUrl.searchParams.get("branch") ?? "";
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!branchCode || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "ระบุสาขา + วันที่ (YYYY-MM-DD) ให้ถูกต้อง" }, { status: 400 });

  const rows = await loadTeaPosTransactions(adminClient(), orgId, branchCode, date);
  const items = rows.map((r) => ({
    ...r,
    label: TEA_CHANNEL_BY_CODE[r.channelCode]?.label ?? r.channelCode,
  }));
  return NextResponse.json({ ok: true, items });
}
