// POST /api/cashhub/amazon-import/match
// ดึง IV จาก TRCloud มาเทียบกับยอด POS ที่เซฟไว้ → อัปเดต iv_gross/iv_status/match_state ลง DB
// body = { storeCode, from, to }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { loadAmazonDays, applyIvMatch } from "@/lib/cashhub/amazon-data";
import { fetchAmazonIvs } from "@/lib/cashhub/amazon-trcloud";
import { findAmazonBranch } from "@/lib/cashhub/amazon-branch-data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const orgId = gate.session.user.org_id;
  const admin = adminClient();

  let body: { storeCode?: string; storeLabel?: string; from?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  // store_code จริงจากแถวที่เซฟ (ไม่ใช่ cfg.storeCode ที่อาจว่างสำหรับสาขาจับคู่ด้วยชื่อ)
  const storeCode = (body.storeCode ?? "").trim();
  if (!storeCode) return NextResponse.json({ error: "ไม่มีรหัสสาขา" }, { status: 400 });
  const cfg = await findAmazonBranch(admin, orgId, storeCode, body.storeLabel ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const from = body.from ?? "";
  const to = body.to ?? "";
  if (!from || !to)
    return NextResponse.json({ error: "ระบุช่วงวัน" }, { status: 400 });

  const { ivs, error } = await fetchAmazonIvs(cfg, from, to);
  if (error) return NextResponse.json({ error }, { status: 502 });

  const savedDays = await loadAmazonDays(admin, orgId, storeCode, from, to);
  const { updated } = await applyIvMatch(admin, orgId, storeCode, savedDays, ivs);

  return NextResponse.json({ ok: true, updated, ivCount: ivs.length });
}
