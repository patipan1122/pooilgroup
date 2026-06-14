// POST /api/cashhub/hotel/trcloud-pull — ดึง IV โรงแรมจาก TRCloud (อ่านอย่างเดียว)
// แสดง: IV ครบทุกวัน/กะไหม (completeness) + ยอด IV ต่อกะ + เทียบกับ Excel ที่มีแล้ว.
// ยังไม่เขียน DB (รอ migration iv_number + อนุมัติ) — เป็น preview/ตรวจ.
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { fetchHotelIvs, matchIvsToDays } from "@/lib/cashhub/hotel-trcloud";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;

  let body: { year?: number; month?: number; branchId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const year = Number(body.year);
  const month = Number(body.month);
  if (!year || !month || month < 1 || month > 12)
    return NextResponse.json({ error: "ระบุปี/เดือนให้ถูกต้อง" }, { status: 400 });

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(
    new Date(year, month, 0).getDate(),
  ).padStart(2, "0")}`;

  const { ivs, error, availableMonths } = await fetchHotelIvs(start, end);
  if (error) return NextResponse.json({ error }, { status: 502 });
  const completeness = matchIvsToDays(ivs, year, month);

  // เทียบกับ Excel ที่มีแล้ว (สาขาที่เลือก) — ยอดขายตรงกันไหม
  const excelByKey = new Map<string, number>();
  if (body.branchId) {
    const { data } = await adminClient()
      .from("cashhub_hotel_daily")
      .select("sales_date, shift, total_sales")
      .eq("branch_id", body.branchId)
      .gte("sales_date", start)
      .lte("sales_date", end);
    for (const r of (data ?? []) as Array<{
      sales_date: string;
      shift: string;
      total_sales: number | null;
    }>) {
      excelByKey.set(`${r.sales_date}|${r.shift}`, Number(r.total_sales ?? 0));
    }
  }

  const days = completeness.days.map((d) => {
    const mk = `${d.date}|morning`;
    const ek = `${d.date}|evening`;
    return {
      day: d.day,
      morning: d.morning
        ? {
            ivNo: d.morning.ivNo,
            total: d.morning.total,
            status: d.morning.status,
            excel: excelByKey.get(mk) ?? null,
            match: excelByKey.has(mk)
              ? Math.abs((excelByKey.get(mk) ?? 0) - d.morning.total) < 1
              : null,
          }
        : null,
      evening: d.evening
        ? {
            ivNo: d.evening.ivNo,
            total: d.evening.total,
            status: d.evening.status,
            excel: excelByKey.get(ek) ?? null,
            match: excelByKey.has(ek)
              ? Math.abs((excelByKey.get(ek) ?? 0) - d.evening.total) < 1
              : null,
          }
        : null,
    };
  });

  void session;
  return NextResponse.json({
    ok: true,
    availableMonths: availableMonths ?? [],
    summary: {
      ivCount: completeness.ivCount,
      expectedShifts: completeness.expectedShifts,
      missingShifts: completeness.missingShifts,
      unknownShift: completeness.unknownShift.length,
      ivTotal: ivs.reduce((s, x) => s + x.total, 0),
    },
    days,
  });
}
