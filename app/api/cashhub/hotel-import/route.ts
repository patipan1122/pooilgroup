// POST /api/cashhub/hotel-import — นำเข้ายอดขายโรงแรมจากชีต Excel เข้า cashhub_hotel_daily
// แยกขาดจาก ev-import. admin/บัญชีเท่านั้น. แสดง preview (diff) ก่อน commit เสมอ
// (ตาม pool-csv-import-must-diff-before-write). idempotent upsert บน (branch,date,shift).
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { parseHotelSheet, type HotelParsedRow } from "@/lib/cashhub/hotel-parse";
import { TH_MONTHS } from "@/lib/cashhub/hotel";

export const runtime = "nodejs";

function pickSheet(wb: XLSX.WorkBook, month: number): string {
  // tab ชื่อมักมีตัวย่อเดือนไทย เช่น "เม.ย.69" — match ก่อน, ไม่งั้นใช้แผ่นแรก
  const abbr = TH_MONTHS[month - 1];
  const found = wb.SheetNames.find((n) => n.includes(abbr));
  return found ?? wb.SheetNames[0]!;
}

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  const orgId = session.user.org_id;
  const admin = adminClient();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ต้องส่งเป็นไฟล์แนบ" }, { status: 400 });
  }
  const file = form.get("file");
  const branchId = String(form.get("branchId") ?? "");
  const year = Number.parseInt(String(form.get("year") ?? ""), 10);
  const month = Number.parseInt(String(form.get("month") ?? ""), 10);
  const commit = String(form.get("commit") ?? "") === "true";
  const sheetNameIn = String(form.get("sheet") ?? "");

  if (!(file instanceof Blob))
    return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });
  if (!branchId || !year || !month || month < 1 || month > 12)
    return NextResponse.json({ error: "ระบุสาขา/ปี/เดือนให้ถูกต้อง" }, { status: 400 });

  // ยืนยันสาขาเป็นโรงแรมในองค์กรนี้ (กัน IDOR/cross-org)
  const { data: branch } = await admin
    .from("branches")
    .select("id, company_id, business_type")
    .eq("id", branchId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!branch || (branch as { business_type: string }).business_type !== "hotel")
    return NextResponse.json({ error: "ไม่พบสาขาโรงแรมนี้" }, { status: 404 });
  const companyId = (branch as { company_id: string }).company_id;

  // อ่าน xlsx → matrix
  let matrix: (string | number | null)[][];
  let sheetName: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    sheetName = sheetNameIn && wb.SheetNames.includes(sheetNameIn)
      ? sheetNameIn
      : pickSheet(wb, month);
    const ws = wb.Sheets[sheetName];
    matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as (string | number | null)[][];
  } catch {
    return NextResponse.json({ error: "อ่านไฟล์ Excel ไม่ได้" }, { status: 400 });
  }

  const parsed = parseHotelSheet(matrix, year, month);
  if (parsed.rows.length === 0)
    return NextResponse.json(
      { error: "ไม่พบข้อมูลในชีต", warnings: parsed.warnings, sheetName },
      { status: 422 },
    );

  // diff-before-write: เทียบกับของเดิมในเดือนนี้
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(
    new Date(year, month, 0).getDate(),
  ).padStart(2, "0")}`;
  const { data: existingRows } = await admin
    .from("cashhub_hotel_daily")
    .select("sales_date, shift, total_sales")
    .eq("branch_id", branchId)
    .gte("sales_date", from)
    .lte("sales_date", to);
  const existing = new Map<string, number | null>();
  for (const r of (existingRows ?? []) as Array<{
    sales_date: string;
    shift: string;
    total_sales: number | null;
  }>) {
    existing.set(`${r.sales_date}|${r.shift}`, r.total_sales);
  }

  let isNew = 0,
    changed = 0,
    same = 0;
  for (const r of parsed.rows) {
    const key = `${r.sales_date}|${r.shift}`;
    if (!existing.has(key)) isNew++;
    else if (Number(existing.get(key) ?? 0) !== Number(r.total_sales ?? 0)) changed++;
    else same++;
  }

  const diff = { new: isNew, changed, same, total: parsed.rows.length };

  if (!commit) {
    // preview เท่านั้น — ส่งตัวอย่าง + ผลรวมให้ผู้ใช้เทียบยอดท้ายชีต
    return NextResponse.json({
      ok: true,
      preview: true,
      sheetName,
      sheetNames: undefined,
      diff,
      totals: parsed.totals,
      warnings: parsed.warnings,
      sample: parsed.rows.slice(0, 6),
    });
  }

  // commit → upsert
  const now = new Date().toISOString();
  const payloads = parsed.rows.map((r: HotelParsedRow) => ({
    org_id: orgId,
    company_id: companyId,
    branch_id: branchId,
    sales_date: r.sales_date,
    shift: r.shift,
    rooms: r.rooms,
    room_revenue: r.room_revenue,
    fine: r.fine,
    tip: r.tip,
    goods_sales: r.goods_sales,
    total_sales: r.total_sales,
    cash_to_remit: r.cash_to_remit,
    cash_pool: r.cash_pool,
    cash_deposited: r.cash_deposited,
    cash_diff: r.cash_diff,
    advance: r.advance,
    qr_morning: r.qr_morning,
    qr_after2330: r.qr_after2330,
    qr_total: r.qr_total,
    qr_banked: r.qr_banked,
    qr_diff: r.qr_diff,
    ota_agoda: r.ota_agoda,
    ota_agoda_banked: r.ota_agoda_banked,
    ota_expedia: r.ota_expedia,
    ota_expedia_banked: r.ota_expedia_banked,
    ota_booking: r.ota_booking,
    ota_booking_banked: r.ota_booking_banked,
    staff_name: r.staff_name,
    note: r.note,
    over_short: r.over_short,
    source: "xlsx_import",
    imported_by: session.user.id,
    imported_at: now,
    updated_at: now,
  }));

  const { error } = await admin
    .from("cashhub_hotel_daily")
    .upsert(payloads, { onConflict: "branch_id,sales_date,shift" });
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
    diff: { new: { branchId, year, month, ...diff } },
  });

  return NextResponse.json({ ok: true, committed: true, diff, sheetName });
}
