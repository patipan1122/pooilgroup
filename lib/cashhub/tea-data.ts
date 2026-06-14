// CashHub ร้านชาไข่มุก — data layer (เซฟ IV ที่ดึงจาก TRCloud + เทียบ POS Foodstory)
// ตาราง cashhub_tea_daily. ทุก query scope org_id เสมอ (service-role bypass RLS).
import type { adminClient } from "@/lib/db/server";
import type { TeaBranchCfg, TeaIv } from "./tea-trcloud";

type Admin = ReturnType<typeof adminClient>;

export type SavedTeaDay = {
  branch_code: string;
  branch_label: string | null;
  sales_date: string;
  iv_doc_no: string | null;
  iv_doc_id: string | null;
  iv_gross: number | null;
  iv_total: number | null;
  iv_vat: number | null;
  iv_status: string; // none | posted
  iv_project: string | null;
  pos_gross: number | null;
  match_state: string | null; // match | mismatch | no_pos | no_iv
  iv_checked_at: string | null;
};

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(x) ? x : null;
}

/** สถานะการเทียบ POS↔IV (ฐานเดียวกัน = ยอดรวม VAT) */
export function computeTeaMatch(
  ivGross: number | null,
  posGross: number | null,
): string {
  if (ivGross == null && posGross == null) return "no_iv";
  if (ivGross == null) return "no_iv"; // มี POS แต่ไม่มี IV
  if (posGross == null) return "no_pos"; // มี IV แต่ยังไม่มี POS มาเทียบ
  return Math.abs(ivGross - posGross) < 1 ? "match" : "mismatch";
}

/** โหลดยอดที่เซฟไว้ (เปิดหน้าอ่านจาก DB — ไม่กวน TRCloud). branchCode = null → ทุกสาขา (matrix) */
export async function loadTeaDays(
  admin: Admin,
  orgId: string,
  from: string,
  to: string,
  branchCode?: string | null,
): Promise<SavedTeaDay[]> {
  let q = admin
    .from("cashhub_tea_daily")
    .select(
      "branch_code, branch_label, sales_date, iv_doc_no, iv_doc_id, iv_gross, iv_total, iv_vat, iv_status, iv_project, pos_gross, match_state, iv_checked_at",
    )
    .eq("org_id", orgId)
    .gte("sales_date", from)
    .lte("sales_date", to);
  if (branchCode) q = q.eq("branch_code", branchCode);
  const { data } = await q.order("sales_date");
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    branch_code: String(d.branch_code),
    branch_label: (d.branch_label as string | null) ?? null,
    sales_date: String(d.sales_date).slice(0, 10),
    iv_doc_no: (d.iv_doc_no as string | null) ?? null,
    iv_doc_id: (d.iv_doc_id as string | null) ?? null,
    iv_gross: n(d.iv_gross),
    iv_total: n(d.iv_total),
    iv_vat: n(d.iv_vat),
    iv_status: String(d.iv_status ?? "none"),
    iv_project: (d.iv_project as string | null) ?? null,
    pos_gross: n(d.pos_gross),
    match_state: (d.match_state as string | null) ?? null,
    iv_checked_at: (d.iv_checked_at as string | null) ?? null,
  }));
}

/**
 * ดึง IV จาก TRCloud → เซฟลง DB (1 แถว/สาขา/วัน). idempotent บน (org, branch, date).
 * preserve pos_gross เดิม (อ่านก่อนแล้ว recompute match_state) — re-pull ทับ IV ได้ไม่ลบยอด POS.
 */
export async function upsertTeaIvs(
  admin: Admin,
  orgId: string,
  cfg: TeaBranchCfg,
  from: string,
  to: string,
  ivs: TeaIv[],
): Promise<{ saved: number; error?: string }> {
  // รวมต่อวัน (กันกรณีมี >1 ใบ/วัน — ปกติ 1 ใบ แต่ถ้ามีหลายใบให้บวกยอด)
  const byDate = new Map<
    string,
    { gross: number; total: number; vat: number; no: string; id: string; project: string }
  >();
  for (const iv of ivs) {
    if (!iv.date) continue;
    const cur = byDate.get(iv.date);
    if (cur) {
      cur.gross += iv.gross;
      cur.total += iv.total;
      cur.vat += iv.vat;
      cur.no = `${cur.no}, ${iv.ivNo}`;
    } else {
      byDate.set(iv.date, {
        gross: iv.gross,
        total: iv.total,
        vat: iv.vat,
        no: iv.ivNo,
        id: iv.ivId,
        project: iv.project,
      });
    }
  }
  if (byDate.size === 0) return { saved: 0 };

  // อ่าน pos_gross เดิมของช่วงนี้ เพื่อ recompute match_state โดยไม่ทับยอด POS
  const existing = await loadTeaDays(admin, orgId, from, to, cfg.code);
  const posByDate = new Map(existing.map((d) => [d.sales_date, d.pos_gross]));
  const now = new Date().toISOString();

  const payload = [...byDate.entries()].map(([date, v]) => {
    const pos = posByDate.get(date) ?? null;
    return {
      org_id: orgId,
      branch_code: cfg.code,
      branch_label: cfg.label,
      sales_date: date,
      iv_doc_no: v.no,
      iv_doc_id: v.id,
      iv_gross: v.gross,
      iv_total: v.total,
      iv_vat: v.vat,
      iv_status: "posted",
      iv_project: v.project,
      match_state: computeTeaMatch(v.gross, pos),
      raw_json: { gross: v.gross, total: v.total, vat: v.vat, no: v.no, id: v.id } as Record<
        string,
        unknown
      >,
      iv_checked_at: now,
      updated_at: now,
    };
  });

  const { error } = await admin
    .from("cashhub_tea_daily")
    .upsert(payload, { onConflict: "org_id,branch_code,sales_date", ignoreDuplicates: false });
  if (error) return { saved: 0, error: error.message };
  return { saved: payload.length };
}

/** สรุปยอดต่อสาขาในช่วง (ไว้โชว์ KPI/หัวตาราง) */
export type TeaBranchSummary = {
  branch_code: string;
  days: number;
  ivTotal: number;
  mismatch: number;
  missingIv: number;
};

export function summarizeTea(days: SavedTeaDay[]): Map<string, TeaBranchSummary> {
  const m = new Map<string, TeaBranchSummary>();
  for (const d of days) {
    const s =
      m.get(d.branch_code) ??
      { branch_code: d.branch_code, days: 0, ivTotal: 0, mismatch: 0, missingIv: 0 };
    if (d.iv_gross != null) {
      s.days++;
      s.ivTotal += d.iv_gross;
    }
    if (d.match_state === "mismatch") s.mismatch++;
    if (d.match_state === "no_iv") s.missingIv++;
    m.set(d.branch_code, s);
  }
  return m;
}
