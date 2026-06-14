// POST /api/cashhub/hotel/ttb-upload — อัปโหลดไฟล์ธนาคาร TTB Smart Shop (รหัส 3468)
// → QR เงินเข้าจริงต่อวัน (group Success ตาม Payment Date) → เติม qr_banked + ส่วนต่าง QR
// ลงแถวกะเช้า (ค่าระดับวัน) ของ source=trcloud_iv. แก้ปัญหา QR ตัดเที่ยงคืน.
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { parseTtbQr } from "@/lib/cashhub/ttb-qr";

export const runtime = "nodejs";

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
    return NextResponse.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
  }
  const file = form.get("file");
  const branchId = String(form.get("branchId") ?? "");
  const year = Number.parseInt(String(form.get("year") ?? ""), 10);
  const month = Number.parseInt(String(form.get("month") ?? ""), 10);
  const source = String(form.get("source") ?? "trcloud_iv"); // เติมเข้าชุดไหน

  if (!(file instanceof Blob))
    return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });
  if (!branchId || !year || !month)
    return NextResponse.json({ error: "ระบุสาขา/ปี/เดือน" }, { status: 400 });

  const { data: branch } = await admin
    .from("branches")
    .select("id, business_type")
    .eq("id", branchId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!branch || (branch as { business_type: string }).business_type !== "hotel")
    return NextResponse.json({ error: "ไม่พบสาขาโรงแรมนี้" }, { status: 404 });

  // อ่านไฟล์ (รับทั้ง xlsx + csv)
  let matrix: (string | number | null)[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null }) as (
      | string
      | number
      | null
    )[][];
  } catch {
    return NextResponse.json({ error: "อ่านไฟล์ไม่ได้" }, { status: 400 });
  }

  const ttb = parseTtbQr(matrix);
  if (ttb.error)
    return NextResponse.json({ error: ttb.error }, { status: 422 });

  // กรองเฉพาะวันในเดือนที่เลือก
  const mm = String(month).padStart(2, "0");
  const inMonth = Object.entries(ttb.byDate).filter(([d]) =>
    d.startsWith(`${year}-${mm}`),
  );
  if (inMonth.length === 0)
    return NextResponse.json(
      { error: `ไฟล์นี้ไม่มี QR ของเดือน ${mm}/${year}` },
      { status: 422 },
    );

  // โหลดแถวของเดือนนั้น (เพื่อหา qr_total รวมต่อวัน + แถวกะเช้า)
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const { data: rows } = await admin
    .from("cashhub_hotel_daily")
    .select("id, sales_date, shift, qr_total")
    .eq("branch_id", branchId)
    .eq("source", source)
    .gte("sales_date", from)
    .lte("sales_date", to);
  const byDateRows = new Map<string, { morningId?: string; recorded: number }>();
  for (const r of (rows ?? []) as Array<{
    id: string;
    sales_date: string;
    shift: string;
    qr_total: number | null;
  }>) {
    const e = byDateRows.get(r.sales_date) ?? { recorded: 0 };
    e.recorded += Number(r.qr_total ?? 0);
    if (r.shift === "morning") e.morningId = r.id;
    byDateRows.set(r.sales_date, e);
  }

  // recorded รวมทั้งเดือน (ตามกะ) — ใช้ reconcile ระดับเดือน (รายวันคนละฐานเวลา ไม่เทียบ)
  let totalRecorded = 0;
  for (const e of byDateRows.values()) totalRecorded += e.recorded;

  let updated = 0,
    unmatched = 0,
    totalBanked = 0;
  const now = new Date().toISOString();
  for (const [date, banked] of inMonth) {
    totalBanked += banked;
    const e = byDateRows.get(date);
    if (!e?.morningId) {
      unmatched++;
      continue;
    }
    // เติม "เข้าบัญชีจริง" (qr_banked) ต่อวัน — ตัด 23:00 ตรง statement.
    // qr_diff = null: ไม่โชว์ส่วนต่างรายวัน (บันทึกตามกะ vs เข้าจริงตัด 23:00 คนละฐาน)
    const { error } = await admin
      .from("cashhub_hotel_daily")
      .update({ qr_banked: banked, qr_diff: null, updated_at: now })
      .eq("id", e.morningId);
    if (!error) updated++;
  }

  const dates = inMonth.map(([d]) => d).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates[dates.length - 1] ?? null;
  const fileName = file instanceof File ? file.name : "TTB file";

  await audit({
    orgId,
    userId: session.user.id,
    action: "IMPORT_HOTEL_SALES",
    resourceType: "cashhub_hotel_daily",
    diff: {
      new: {
        kind: "ttb",
        branchId,
        fileName,
        month: `${year}-${mm}`,
        firstDate,
        lastDate,
        daysInFile: inMonth.length,
        updated,
        totalBanked,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    successCount: ttb.successCount,
    skipped: ttb.skipped,
    totalBanked,
    totalRecorded, // QR บันทึก (ตามกะ) รวมทั้งเดือน
    monthDiff: totalBanked - totalRecorded, // reconcile ระดับเดือน
    daysInFile: inMonth.length,
    firstDate,
    lastDate,
    updated,
    unmatched,
  });
}
