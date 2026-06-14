// POST /api/cashhub/tea/import
// รับยอดขายรายวันจากไฟล์ Foodstory (parse แล้วฝั่ง client) → เซฟลง cashhub_tea_daily
//   1 ไฟล์ "มีได้หลายสาขา" → รับ branches[] นำเข้าทุกสาขาทีเดียว.
//   เติมเฉพาะ POS (pos_gross/pos_channels) ไม่แตะ iv_* · recompute match · idempotent (org,สาขา,วัน).
// body = { fileName, branches: [{ branchCode, rows: [{ date, gross, channels }] }] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { teaBranchByCode } from "@/lib/cashhub/tea-trcloud";
import { upsertTeaPos } from "@/lib/cashhub/tea-data";
import type { TeaChannelCode } from "@/lib/cashhub/tea-channels";

export const runtime = "nodejs";
export const maxDuration = 30;

type InRow = { date?: string; gross?: number; channels?: Partial<Record<TeaChannelCode, number>> };
type Body = {
  fileName?: string;
  branches?: { branchCode?: string; rows?: InRow[] }[];
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

  if (!Array.isArray(body.branches) || body.branches.length === 0)
    return NextResponse.json({ error: "ไม่พบข้อมูลสาขาในไฟล์" }, { status: 400 });
  if (body.branches.length > 30)
    return NextResponse.json({ error: "สาขามากเกินไป (เกิน 30)" }, { status: 400 });

  const fileName = String(body.fileName ?? "Foodstory").slice(0, 200);
  const sanitizeRows = (rows: InRow[] | undefined) =>
    (rows ?? [])
      .map((r) => ({
        date: String(r?.date ?? ""),
        gross: Number(r?.gross),
        channels: (r?.channels ?? {}) as Partial<Record<TeaChannelCode, number>>,
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.gross) && r.gross >= 0);

  const results: {
    branchCode: string;
    label: string;
    saved: number;
    matched: number;
    mismatch: number;
    noIv: number;
  }[] = [];
  const skipped: string[] = [];

  for (const b of body.branches) {
    const cfg = teaBranchByCode(b.branchCode ?? null);
    if (!cfg) {
      if (b.branchCode) skipped.push(b.branchCode);
      continue;
    }
    const rows = sanitizeRows(b.rows);
    if (rows.length === 0) {
      skipped.push(cfg.code);
      continue;
    }
    if (rows.length > 200) {
      return NextResponse.json({ error: `${cfg.label}: ข้อมูลเกิน 200 วัน` }, { status: 400 });
    }
    const res = await upsertTeaPos(admin, orgId, cfg, rows, fileName);
    if (res.error)
      return NextResponse.json({ error: `${cfg.label}: ${res.error}` }, { status: 500 });
    results.push({
      branchCode: cfg.code,
      label: cfg.label,
      saved: res.saved,
      matched: res.matched,
      mismatch: res.mismatch,
      noIv: res.noIv,
    });
  }

  if (results.length === 0)
    return NextResponse.json(
      { error: "ไม่มีสาขาที่นำเข้าได้ (เลือกสาขาให้ถูกต้องก่อน)" },
      { status: 400 },
    );

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "IMPORT_TEA_POS",
    resourceType: "cashhub_tea_daily",
    diff: { new: { fileName, branches: results.map((r) => ({ code: r.branchCode, saved: r.saved })) } },
  });

  const totals = results.reduce(
    (a, r) => ({
      saved: a.saved + r.saved,
      matched: a.matched + r.matched,
      mismatch: a.mismatch + r.mismatch,
      noIv: a.noIv + r.noIv,
    }),
    { saved: 0, matched: 0, mismatch: 0, noIv: 0 },
  );

  return NextResponse.json({ ok: true, results, totals, skipped });
}
