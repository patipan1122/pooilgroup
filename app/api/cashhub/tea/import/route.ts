// POST /api/cashhub/tea/import
// รับยอดขายรายวันจากไฟล์ Foodstory (parse แล้วฝั่ง client) → เซฟลง cashhub_tea_daily
//   1 ไฟล์ "มีได้หลายสาขา" → รับ branches[] นำเข้าทุกสาขาทีเดียว.
//   เติมเฉพาะ POS (pos_gross/pos_channels) ไม่แตะ iv_* · match_state คิดที่ DB (trigger) · idempotent.
// body = { fileName, branches: [{ branchCode, rows: [{ date, gross, channels }] }] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { teaBranchByCode, type TeaBranchCfg } from "@/lib/cashhub/tea-trcloud";
import { upsertTeaPos } from "@/lib/cashhub/tea-data";
import { TEA_CHANNELS, type TeaChannelCode } from "@/lib/cashhub/tea-channels";

export const runtime = "nodejs";
export const maxDuration = 30;

const CHANNEL_CODES = new Set(TEA_CHANNELS.map((c) => c.code));

type InRow = { date?: string; gross?: number; channels?: Record<string, unknown> };
type Body = {
  fileName?: string;
  branches?: { branchCode?: string; rows?: InRow[] }[];
};

type CleanRow = { date: string; gross: number; channels: Partial<Record<TeaChannelCode, number>> };

/** เก็บเฉพาะวันถูกต้อง + ยอด ≥0 + ช่องทางที่รู้จัก (coerce เลข ≥0) */
function sanitizeRows(rows: InRow[] | undefined): CleanRow[] {
  return (rows ?? [])
    .map((r) => {
      const channels: Partial<Record<TeaChannelCode, number>> = {};
      for (const [k, v] of Object.entries(r?.channels ?? {})) {
        if (!CHANNEL_CODES.has(k as TeaChannelCode)) continue; // ทิ้ง key แปลกปลอม
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) channels[k as TeaChannelCode] = Math.round(n * 100) / 100;
      }
      return { date: String(r?.date ?? ""), gross: Number(r?.gross), channels };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.gross) && r.gross >= 0);
}

/** รวมหลาย section ที่ลงสาขาเดียวกัน → 1 ชุด (บวกยอด/รวมช่องทางต่อวัน) กันเขียนทับ */
function mergeByDate(a: CleanRow[], b: CleanRow[]): CleanRow[] {
  const m = new Map<string, CleanRow>();
  for (const r of [...a, ...b]) {
    const cur = m.get(r.date);
    if (!cur) {
      m.set(r.date, { date: r.date, gross: r.gross, channels: { ...r.channels } });
    } else {
      cur.gross = Math.round((cur.gross + r.gross) * 100) / 100;
      for (const [k, v] of Object.entries(r.channels) as [TeaChannelCode, number][])
        cur.channels[k] = Math.round(((cur.channels[k] ?? 0) + v) * 100) / 100;
    }
  }
  return [...m.values()].sort((x, y) => x.date.localeCompare(y.date));
}

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
  if (body.branches.length > 60)
    return NextResponse.json({ error: "สาขามากเกินไป (เกิน 60 section)" }, { status: 400 });

  const fileName = String(body.fileName ?? "Foodstory").slice(0, 200);

  // ── 1) validate + coalesce ทั้งหมดก่อน (ยังไม่เขียน DB เลย) ──
  const byBranch = new Map<string, { cfg: TeaBranchCfg; rows: CleanRow[] }>();
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
    const cur = byBranch.get(cfg.code);
    byBranch.set(cfg.code, { cfg, rows: cur ? mergeByDate(cur.rows, rows) : rows });
  }
  if (byBranch.size === 0)
    return NextResponse.json(
      { error: "ไม่มีสาขาที่นำเข้าได้ (เลือกสาขาให้ถูกต้องก่อน)" },
      { status: 400 },
    );
  for (const { cfg, rows } of byBranch.values())
    if (rows.length > 200)
      return NextResponse.json({ error: `${cfg.label}: ข้อมูลเกิน 200 วัน` }, { status: 400 });

  // ── 2) เขียน DB ทีละสาขา (ผ่าน validate หมดแล้ว → ไม่ค้างกลางทาง) ──
  const results: { branchCode: string; label: string; saved: number; matched: number; mismatch: number; noIv: number }[] = [];
  for (const { cfg, rows } of byBranch.values()) {
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

  const totals = results.reduce(
    (a, r) => ({
      saved: a.saved + r.saved,
      matched: a.matched + r.matched,
      mismatch: a.mismatch + r.mismatch,
      noIv: a.noIv + r.noIv,
    }),
    { saved: 0, matched: 0, mismatch: 0, noIv: 0 },
  );
  // ยอดรวมบาทของไฟล์นี้ (จากแถวที่ผ่าน validate แล้ว) — เก็บไว้โชว์ในประวัติการอัป
  const totalBaht =
    Math.round(
      [...byBranch.values()].reduce(
        (s, b) => s + b.rows.reduce((a, r) => a + r.gross, 0),
        0,
      ) * 100,
    ) / 100;

  // เก็บประวัติการอัปลง audit_logs (อ่านกลับด้วย loadTeaImportHistory) — field ชื่อ file/days ตรงกับ Amazon
  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "IMPORT_TEA_POS",
    resourceType: "cashhub_tea_daily",
    diff: {
      new: {
        file: fileName,
        days: totals.saved,
        baht: totalBaht,
        matched: totals.matched,
        mismatch: totals.mismatch,
        noIv: totals.noIv,
        branches: results.map((r) => ({ code: r.branchCode, label: r.label, saved: r.saved })),
      },
    },
  });

  return NextResponse.json({ ok: true, results, totals, skipped });
}
