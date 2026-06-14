// POST /api/cashhub/hotel/ttb-upload — อัปโหลดไฟล์ธนาคาร TTB Smart Shop (รหัส 3468)
// → QR เงินเข้าจริงต่อวัน (group Success ตาม Payment Date) → เติม qr_banked + ส่วนต่าง QR
// ลงแถวกะเช้า (ค่าระดับวัน) ของ source=trcloud_iv. แก้ปัญหา QR ตัดเที่ยงคืน.
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { parseTtbQr, csvToMatrix } from "@/lib/cashhub/ttb-qr";

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
  // 🔑 ตรวจชนิดไฟล์จาก "ลายเซ็น" ไม่ใช่นามสกุล: xlsx = ZIP ขึ้นต้นด้วย "PK" (0x50 0x4B)
  // ไฟล์ CSV จริงของ TTB มี field ที่มี newline/quote ในชื่อคนจ่าย → XLSX.read ตัดจบกลางทาง
  // (อ่านได้แค่ ~285/492 แถว) → ต้องใช้ตัวอ่าน CSV เอง (csvToMatrix) จึงจะครบทุกแถว
  let matrix: (string | number | null)[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" = xlsx
    if (isZip) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null }) as (
        | string
        | number
        | null
      )[][];
    } else {
      // ไฟล์ข้อความ (CSV) — เดา encoding จาก BOM: Excel/Windows ไทยมักเป็น UTF-16
      // (BOM FF FE / FE FF) → ถ้า decode เป็น utf8 ตรง ๆ ภาษาไทยจะเพี้ยน → ใช้ TextDecoder
      let enc = "utf-8";
      if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) enc = "utf-16le";
      else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) enc = "utf-16be";
      const text = new TextDecoder(enc).decode(buf);
      matrix = csvToMatrix(text);
    }
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

  // 🔁 ตรวจซ้ำ: เคยอัปไฟล์ที่ "เนื้อหาเหมือนกัน" (จำนวนรายการ + ยอดรวมทั้งไฟล์) แล้วหรือยัง
  // (CEO: "ให้ตรวจข้อมูลซ้ำด้วยจะได้ไม่อัพซ้ำ") — เตือนได้ แต่ไม่บล็อก เพราะการเติมเป็น overwrite
  // (idempotent) อัปซ้ำไฟล์เดิมไม่ทำให้ยอดเพี้ยน
  let duplicateOf: { at: string; fileName: string } | null = null;
  {
    const { data: priorLogs } = await admin
      .from("audit_logs")
      .select("created_at, diff")
      .eq("org_id", orgId)
      .eq("action", "IMPORT_HOTEL_SALES")
      .order("created_at", { ascending: false })
      .limit(40);
    for (const l of (priorLogs ?? []) as Array<{ created_at: string; diff: unknown }>) {
      const n = ((l.diff as { new?: Record<string, unknown> } | null)?.new ?? {}) as Record<
        string,
        unknown
      >;
      if (
        n.kind === "ttb" &&
        n.branchId === branchId &&
        Number(n.successCount ?? -1) === ttb.successCount &&
        Number(n.fileTotal ?? -1) === ttb.total
      ) {
        duplicateOf = { at: l.created_at, fileName: String(n.fileName ?? "TTB file") };
        break;
      }
    }
  }

  // โหลดแถวของเดือนนั้น (เพื่อหา qr_total รวมต่อวัน + แถวกะเช้า)
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const { data: rows } = await admin
    .from("cashhub_hotel_daily")
    .select("id, sales_date, shift, qr_total")
    .eq("org_id", orgId) // scope ชัด (admin client bypass RLS — กัน cross-org)
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

  let unmatched = 0,
    totalBanked = 0;
  const now = new Date().toISOString();
  // เก็บ 2 ฐานต่อวัน:
  //   • qr_banked  = ยอดเข้าบัญชี (ตัด 23:00) → ตรง statement ธนาคาร
  //   • qr_scan_total / qr_overnight = ยอดสแกนรวม + ช่วง 00:00–07:00 (ตามวันสแกน)
  //     → หน้าเว็บคิด "ฐานกะ" ตอนอ่าน = สแกน(N) − ดึก(N) + ดึก(N+1) ให้ตรงยอดที่พนักงานคีย์
  // ⚡ อัปเดตพร้อมกัน (parallel) กัน serverless timeout
  const dateSet = new Set<string>();
  for (const [d] of inMonth) dateSet.add(d);
  for (const d of Object.keys(ttb.byScanDate))
    if (d.startsWith(`${year}-${mm}`)) dateSet.add(d);

  const updates: Array<PromiseLike<{ error: unknown }>> = [];
  for (const date of dateSet) {
    const banked = ttb.byDate[date] ?? null; // settlement (ตัด 23:00)
    const band = ttb.byScanDate[date] ?? null; // {total, overnight} ตามวันสแกน
    if (banked != null) totalBanked += banked;
    const e = byDateRows.get(date);
    if (!e?.morningId) {
      unmatched++;
      continue;
    }
    updates.push(
      admin
        .from("cashhub_hotel_daily")
        .update({
          qr_banked: banked,
          qr_scan_total: band ? band.total : null,
          qr_overnight: band ? band.overnight : null,
          qr_late: band ? band.late : null, // 23:00–00:00 (ธนาคารดันไปวันถัดไป)
          qr_diff: null, // ส่วนต่างรายวันคิดฐานกะตอนอ่าน (apples-to-apples)
          updated_at: now,
        })
        .eq("id", e.morningId)
        .eq("org_id", orgId) // B-018: update by id ต้อง re-scope org (admin bypass RLS)
        .eq("branch_id", branchId) as PromiseLike<{ error: unknown }>,
    );
  }
  const results = await Promise.all(updates);
  const updated = results.filter((r) => !r.error).length;

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
        successCount: ttb.successCount, // ทั้งไฟล์ (ใช้ตรวจซ้ำ)
        fileTotal: ttb.total, // ยอดรวมทั้งไฟล์ (ใช้ตรวจซ้ำ)
      },
    },
  });

  return NextResponse.json({
    ok: true,
    successCount: ttb.successCount,
    fileTotal: ttb.total, // ยอดรวมทั้งไฟล์ (ก่อนกรองเดือน)
    skipped: ttb.skipped,
    totalBanked,
    totalRecorded, // QR บันทึก (ตามกะ) รวมทั้งเดือน
    monthDiff: totalBanked - totalRecorded, // reconcile ระดับเดือน
    daysInFile: inMonth.length,
    firstDate,
    lastDate,
    updated,
    unmatched,
    duplicate: duplicateOf, // เคยอัปไฟล์เนื้อหาเดียวกันแล้วหรือยัง (เตือน ไม่บล็อก)
  });
}
