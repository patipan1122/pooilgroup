// POST /api/cashhub/tea/pull
// ดึง IV ของร้านชาไข่มุก 1 สาขา จาก TRCloud → เซฟลง cashhub_tea_daily (cache กัน 429).
// ฝั่ง UI เรียกทีละสาขา หน่วงเวลา → กระจาย call ไม่ชน rate-limit. body = { branchCode, from, to }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { teaBranchByCode, fetchTeaIvs, teaTrcloudConfigured } from "@/lib/cashhub/tea-trcloud";
import { upsertTeaIvs } from "@/lib/cashhub/tea-data";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const orgId = gate.session.user.org_id;
  const admin = adminClient();

  if (!teaTrcloudConfigured())
    return NextResponse.json({ error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_*)" }, { status: 503 });

  let body: { branchCode?: string; from?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const cfg = teaBranchByCode(body.branchCode ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const from = body.from ?? "";
  const to = body.to ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return NextResponse.json({ error: "ระบุช่วงวันให้ถูกต้อง (YYYY-MM-DD)" }, { status: 400 });

  const { ivs, error } = await fetchTeaIvs(cfg, from, to);
  if (error) return NextResponse.json({ error }, { status: 502 });

  const { saved, error: saveErr } = await upsertTeaIvs(admin, orgId, cfg, from, to, ivs);
  if (saveErr) return NextResponse.json({ error: `เซฟไม่สำเร็จ: ${saveErr}` }, { status: 500 });

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "PULL_TEA_IV",
    resourceType: "cashhub_tea_daily",
    diff: { new: { branchCode: cfg.code, days: saved, ivCount: ivs.length, from, to } },
  });

  return NextResponse.json({ ok: true, branchCode: cfg.code, ivCount: ivs.length, saved });
}
