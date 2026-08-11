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
      .eq("org_id", session.user.org_id) // scope ชัด — กัน IDOR อ่านข้ามองค์กร (admin bypass RLS)
      .eq("branch_id", body.branchId)
      .neq("source", "trcloud_iv") // เทียบกับชีตจริงเท่านั้น — กัน IV เก่าที่เคยบันทึกไว้ปนมาเป็น "excel"
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

  const shiftOut = (
    iv: (typeof completeness.days)[number]["morning"],
    key: string,
  ) =>
    iv
      ? {
          ivId: iv.ivId,
          ivNo: iv.ivNo,
          total: iv.total,
          status: iv.status,
          cash: iv.cash, // c1 เงินสด (= ยอดส่งเงินสด)
          qr: iv.qr, // c2 QR (= ยอดรวม QR)
          over: iv.overAmt,
          short: iv.shortAmt,
          excel: excelByKey.get(key) ?? null,
          match: excelByKey.has(key)
            ? Math.abs((excelByKey.get(key) ?? 0) - iv.total) < 1
            : null,
        }
      : null;

  const days = completeness.days.map((d) => ({
    day: d.day,
    morning: shiftOut(d.morning, `${d.date}|morning`),
    evening: shiftOut(d.evening, `${d.date}|evening`),
  }));

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
