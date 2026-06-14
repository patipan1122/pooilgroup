// POST /api/cashhub/amazon-import/match
// ดึง IV จาก TRCloud มาเทียบกับยอด POS ที่เซฟไว้ → อัปเดต iv_gross/iv_status/match_state ลง DB
// body = { storeCode, from, to }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { loadAmazonDays, applyIvMatch } from "@/lib/cashhub/amazon-data";
import { branchByStoreCode, fetchAmazonIvs } from "@/lib/cashhub/amazon-trcloud";

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
  const cfg = branchByStoreCode(body.storeCode ?? null, body.storeLabel ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const from = body.from ?? "";
  const to = body.to ?? "";
  if (!from || !to)
    return NextResponse.json({ error: "ระบุช่วงวัน" }, { status: 400 });

  const { ivs, error } = await fetchAmazonIvs(cfg, from, to);
  if (error) return NextResponse.json({ error }, { status: 502 });

  const savedDays = await loadAmazonDays(admin, orgId, cfg.storeCode, from, to);
  const { updated } = await applyIvMatch(admin, orgId, cfg.storeCode, savedDays, ivs);

  return NextResponse.json({ ok: true, updated, ivCount: ivs.length });
}
