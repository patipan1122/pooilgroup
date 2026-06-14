// POST /api/cashhub/amazon-import/preview
// รับไฟล์ POS Café Amazon (.xlsx) → parse รายวัน + คำนวณ IV (VAT 7% + c-vars) + เช็คว่าวันไหนคีย์ IV แล้ว
// แสดง preview ก่อน push เสมอ (pool-csv-import-must-diff-before-write). ไม่สร้าง IV ในขั้นนี้.
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { parseAmazonPos } from "@/lib/cashhub/amazon-parse";
import {
  upsertAmazonDays,
  loadAmazonDays,
  applyIvMatch,
} from "@/lib/cashhub/amazon-data";
import {
  branchByStoreCode,
  fetchAmazonIvs,
  amazonTrcloudConfigured,
} from "@/lib/cashhub/amazon-trcloud";

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

  // ── เซฟลง DB (เก็บถาวร · แสดงตลอดไม่ต้องอัปซ้ำ) — idempotent บน org+store+date ──
  const fileName =
    file instanceof File && typeof file.name === "string" ? file.name : null;
  const { saved, error: saveErr } = await upsertAmazonDays(
    admin,
    {
      orgId,
      storeCode: parsed.storeCode!,
      branchLabel: parsed.storeLabel ?? cfg.label,
      sourceFile: fileName,
      importedBy: session.user.id,
    },
    parsed.rows,
  );
  if (saveErr)
    return NextResponse.json(
      { error: `เซฟไม่สำเร็จ: ${saveErr}` },
      { status: 500 },
    );

  await audit({
    orgId,
    userId: session.user.id,
    action: "IMPORT_AMAZON_SALES",
    resourceType: "cashhub_amazon_daily",
    diff: { new: { storeCode: parsed.storeCode, days: saved, file: fileName } },
  });

  // เช็ค IV ที่คีย์แล้วใน TRCloud (dedup status) — ช่วงวันของไฟล์
  const dates = parsed.rows.map((r) => r.date).sort();
  let ivWarn: string | null = null;
  if (dates.length && amazonTrcloudConfigured()) {
    const { ivs, error } = await fetchAmazonIvs(cfg, dates[0]!, dates[dates.length - 1]!);
    if (error) ivWarn = error;
    else {
      // อัปเดตสถานะ match ทันทีหลัง import (POS↔TRC)
      const savedDays = await loadAmazonDays(
        admin,
        orgId,
        parsed.storeCode!,
        dates[0]!,
        dates[dates.length - 1]!,
      );
      await applyIvMatch(admin, orgId, parsed.storeCode!, savedDays, ivs);
    }
  }

  return NextResponse.json({
    ok: true,
    saved,
    store: { label: parsed.storeLabel, code: parsed.storeCode },
    branch: { label: cfg.label, type: cfg.type, project: cfg.project },
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    ivWarn,
  });
}
