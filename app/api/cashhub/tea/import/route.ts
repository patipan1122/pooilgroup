// POST /api/cashhub/tea/import
// รับยอดขายรายวันจากไฟล์ Foodstory (parse แล้วฝั่ง client) → เซฟลง cashhub_tea_daily
//   แล้ว recompute match_state เทียบ IV. ไม่แตะ iv_* (เติมเฉพาะ POS). idempotent ต่อ (org,สาขา,วัน).
// body = { branchCode, fileName, rows: [{ date: "YYYY-MM-DD", gross: number }] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { teaBranchByCode } from "@/lib/cashhub/tea-trcloud";
import { upsertTeaPos } from "@/lib/cashhub/tea-data";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  branchCode?: string;
  fileName?: string;
  rows?: { date?: string; gross?: number }[];
};

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const orgId = gate.session.user.org_id;
  const admin = adminClient();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }

  const cfg = teaBranchByCode(body.branchCode ?? null);
  if (!cfg) return NextResponse.json({ error: "กรุณาเลือกสาขาให้ถูกต้อง" }, { status: 400 });

  if (!Array.isArray(body.rows) || body.rows.length === 0)
    return NextResponse.json({ error: "ไม่พบรายการยอดขายในไฟล์" }, { status: 400 });
  if (body.rows.length > 200)
    return NextResponse.json({ error: "ข้อมูลมากเกินไป (เกิน 200 วัน)" }, { status: 400 });

  // sanitize: เก็บเฉพาะวันที่รูปแบบถูกต้อง + ยอดเป็นตัวเลข ≥ 0
  const rows = body.rows
    .map((r) => ({ date: String(r?.date ?? ""), gross: Number(r?.gross) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.gross) && r.gross >= 0);
  if (rows.length === 0)
    return NextResponse.json({ error: "ไม่มีรายการที่ถูกต้องในไฟล์" }, { status: 400 });

  const fileName = String(body.fileName ?? "Foodstory").slice(0, 200);

  const { saved, matched, mismatch, noIv, error } = await upsertTeaPos(
    admin,
    orgId,
    cfg,
    rows,
    fileName,
  );
  if (error) return NextResponse.json({ error: `เซฟไม่สำเร็จ: ${error}` }, { status: 500 });

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "IMPORT_TEA_POS",
    resourceType: "cashhub_tea_daily",
    diff: { new: { branchCode: cfg.code, fileName, saved, matched, mismatch, noIv } },
  });

  return NextResponse.json({ ok: true, branchCode: cfg.code, saved, matched, mismatch, noIv });
}
