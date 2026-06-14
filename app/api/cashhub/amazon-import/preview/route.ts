// POST /api/cashhub/amazon-import/preview
// รับไฟล์ POS Café Amazon (.xlsx) → parse รายวัน + คำนวณ IV (VAT 7% + c-vars) + เช็คว่าวันไหนคีย์ IV แล้ว
// แสดง preview ก่อน push เสมอ (pool-csv-import-must-diff-before-write). ไม่สร้าง IV ในขั้นนี้.
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { parseAmazonPos } from "@/lib/cashhub/amazon-parse";
import {
  branchByStoreCode,
  fetchAmazonIvs,
  amazonTrcloudConfigured,
} from "@/lib/cashhub/amazon-trcloud";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ต้องส่งเป็นไฟล์แนบ" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob))
    return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });

  // อ่าน xlsx → matrix
  let matrix: unknown[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: "",
    }) as unknown[][];
  } catch {
    return NextResponse.json({ error: "อ่านไฟล์ Excel ไม่ได้" }, { status: 400 });
  }

  const parsed = parseAmazonPos(matrix);
  if (parsed.error)
    return NextResponse.json({ error: parsed.error }, { status: 400 });

  const cfg = branchByStoreCode(parsed.storeCode);
  if (!cfg)
    return NextResponse.json(
      {
        error: `ยังไม่รองรับสาขานี้ (${parsed.storeLabel ?? parsed.storeCode ?? "ไม่ทราบ"}) — ตอนนี้รองรับเฉพาะ ชุมชนหัวทะเล (5157). แจ้งผู้ดูแลเพิ่มสาขา`,
        store: { label: parsed.storeLabel, code: parsed.storeCode },
      },
      { status: 400 },
    );

  // เช็ค IV ที่คีย์แล้วใน TRCloud (dedup status) — ช่วงวันของไฟล์
  const dates = parsed.rows.map((r) => r.date).sort();
  const existingDates = new Set<string>();
  let ivWarn: string | null = null;
  if (dates.length && amazonTrcloudConfigured()) {
    const { ivs, error } = await fetchAmazonIvs(cfg, dates[0]!, dates[dates.length - 1]!);
    if (error) ivWarn = error;
    for (const iv of ivs) if (iv.date) existingDates.add(iv.date);
  }

  const rows = parsed.rows.map((r) => ({
    ...r,
    alreadyKeyed: existingDates.has(r.date),
  }));

  return NextResponse.json({
    store: { label: parsed.storeLabel, code: parsed.storeCode },
    branch: { label: cfg.label, type: cfg.type, project: cfg.project },
    rows,
    ivWarn,
    summary: {
      days: rows.length,
      ready: rows.filter((r) => r.balanced && !r.alreadyKeyed).length,
      alreadyKeyed: rows.filter((r) => r.alreadyKeyed).length,
      blocked: rows.filter((r) => !r.balanced).length,
    },
  });
}
