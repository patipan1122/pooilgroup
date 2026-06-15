// CashHub ร้านชาไข่มุก — data layer (เซฟ IV ที่ดึงจาก TRCloud + เทียบ POS Foodstory)
// ตาราง cashhub_tea_daily. ทุก query scope org_id เสมอ (service-role bypass RLS).
import type { adminClient } from "@/lib/db/server";
import type { TeaBranchCfg, TeaIv } from "./tea-trcloud";
import {
  TEA_CHANNELS,
  defaultTeaChannelConfigs,
  type TeaChannelConfig,
  type TeaChannelCode,
} from "./tea-channels";

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
  pos_channels: Partial<Record<TeaChannelCode, number>> | null; // ยอดแยกช่องทาง
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
      "branch_code, branch_label, sales_date, iv_doc_no, iv_doc_id, iv_gross, iv_total, iv_vat, iv_status, iv_project, pos_gross, pos_channels, match_state, iv_checked_at",
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
    pos_channels:
      (d.pos_channels as Partial<Record<TeaChannelCode, number>> | null) ?? null,
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

/**
 * เติมยอด POS Foodstory ลง DB (1 แถว/สาขา/วัน) แล้ว recompute match_state เทียบกับ IV ที่ดึงไว้.
 * idempotent บน (org, branch, date). ⚠️ ไม่แตะคอลัมน์ iv_* — upsert ส่งเฉพาะคอลัมน์ POS
 *   → PostgREST อัปเดตเฉพาะคอลัมน์ที่ส่ง (iv_* ของแถวเดิมคงอยู่). วันที่ยังไม่มี IV → match = no_iv.
 */
export async function upsertTeaPos(
  admin: Admin,
  orgId: string,
  cfg: { code: string; label: string },
  rows: { date: string; gross: number; channels?: Partial<Record<TeaChannelCode, number>> }[],
  fileName: string,
): Promise<{ saved: number; matched: number; mismatch: number; noIv: number; error?: string }> {
  const clean = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (clean.length === 0) return { saved: 0, matched: 0, mismatch: 0, noIv: 0 };

  // อ่าน iv_gross เดิมของช่วงที่ครอบ เพื่อ recompute match_state โดยไม่ทับ IV
  const dates = clean.map((r) => r.date).sort();
  const existing = await loadTeaDays(admin, orgId, dates[0], dates[dates.length - 1], cfg.code);
  const ivByDate = new Map(existing.map((d) => [d.sales_date, d.iv_gross]));
  const now = new Date().toISOString();

  let matched = 0;
  let mismatch = 0;
  let noIv = 0;
  const payload = clean.map((r) => {
    const iv = ivByDate.get(r.date) ?? null;
    const state = computeTeaMatch(iv, r.gross);
    if (state === "match") matched++;
    else if (state === "mismatch") mismatch++;
    else if (state === "no_iv") noIv++;
    return {
      org_id: orgId,
      branch_code: cfg.code,
      branch_label: cfg.label,
      sales_date: r.date,
      pos_gross: r.gross,
      pos_channels: (r.channels ?? {}) as Record<string, number>,
      pos_source: fileName.slice(0, 200),
      match_state: state,
      updated_at: now,
    };
  });

  const { error } = await admin
    .from("cashhub_tea_daily")
    .upsert(payload, { onConflict: "org_id,branch_code,sales_date", ignoreDuplicates: false });
  if (error) return { saved: 0, matched: 0, mismatch: 0, noIv: 0, error: error.message };
  return { saved: payload.length, matched, mismatch, noIv };
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

// ── ตั้งค่าช่องทาง → บัญชี/บริษัท (เตรียม reconcile) ─────────────────────────
/** รายชื่อสาขาร้านชาทั้งหมดที่เคยมีข้อมูล (สำหรับ dropdown ตั้งค่าแยกสาขา) */
export async function listTeaBranches(
  admin: Admin,
  orgId: string,
): Promise<{ code: string; label: string }[]> {
  const { data } = await admin
    .from("cashhub_tea_daily")
    .select("branch_code, branch_label")
    .eq("org_id", orgId);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const code = String(r.branch_code);
    if (!m.has(code)) m.set(code, (r.branch_label as string | null) || code);
  }
  return [...m.entries()].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label, "th"));
}

/** เช็คว่าสาขานี้ตั้งค่าเอง (ไม่อิงค่าเริ่มต้น) ไหม — ใช้โชว์ใน UI */
export async function teaBranchHasOwnConfig(
  admin: Admin,
  orgId: string,
  branchCode: string,
): Promise<boolean> {
  if (!branchCode) return false;
  const { count } = await admin
    .from("cashhub_tea_channel_config")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("branch_code", branchCode);
  return (count ?? 0) > 0;
}

/** โหลด config ต่อช่องทาง (merge กับ default — ช่องที่ยังไม่ตั้งใช้ค่าเริ่มต้น)
 *  branchCode="" → ค่าเริ่มต้นทุกสาขา · ระบุสาขา → ใช้ค่าสาขานั้นถ้ามี ไม่งั้น fallback ค่าเริ่มต้น */
export async function loadTeaChannelConfig(
  admin: Admin,
  orgId: string,
  branchCode = "",
): Promise<TeaChannelConfig[]> {
  const { data } = await admin
    .from("cashhub_tea_channel_config")
    .select("branch_code, channel_code, label, is_settle, fee_percent, min_settle_satang, company_id, bank_account_id")
    .eq("org_id", orgId);
  const orgDefault = new Map<string, Record<string, unknown>>();
  const branchRows = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const bc = String(r.branch_code ?? "");
    if (bc === "") orgDefault.set(String(r.channel_code), r);
    else if (bc === branchCode) branchRows.set(String(r.channel_code), r);
  }
  return defaultTeaChannelConfigs().map((d) => {
    const s = branchRows.get(d.code) ?? orgDefault.get(d.code);
    if (!s) return d;
    return {
      code: d.code,
      label: (s.label as string) ?? d.label,
      isSettle: s.is_settle == null ? d.isSettle : Boolean(s.is_settle),
      feePercent: s.fee_percent != null ? Number(s.fee_percent) : d.feePercent,
      minSettleBaht:
        s.min_settle_satang != null ? Number(s.min_settle_satang) / 100 : d.minSettleBaht,
      companyId: (s.company_id as string | null) ?? null,
      bankAccountId: (s.bank_account_id as string | null) ?? null,
    };
  });
}

/** บันทึก config (super_admin) — upsert ต่อช่องทาง. คืนเฉพาะ code ที่รู้จัก
 *  ⚠️ validate company_id/bank_account_id ว่าเป็นขององค์กรนี้จริง (กันชี้ข้ามองค์กร) — service-role bypass RLS */
export async function saveTeaChannelConfig(
  admin: Admin,
  orgId: string,
  configs: TeaChannelConfig[],
  branchCode = "",
): Promise<{ ok: boolean; error?: string }> {
  const valid = new Set(TEA_CHANNELS.map((c) => c.code));
  // โหลด id ที่เป็นของ org นี้เท่านั้น → null ค่าที่แปลกปลอม
  const [co, bank] = await Promise.all([
    admin.from("companies").select("id").eq("org_id", orgId),
    admin.from("ledger_bank_account").select("id").eq("org_id", orgId),
  ]);
  const validCo = new Set((co.data ?? []).map((r) => String((r as { id: unknown }).id)));
  const validBank = new Set((bank.data ?? []).map((r) => String((r as { id: unknown }).id)));
  const now = new Date().toISOString();
  const rows = configs
    .filter((c) => valid.has(c.code))
    .map((c) => ({
      org_id: orgId,
      branch_code: branchCode,
      channel_code: c.code,
      label: c.label,
      is_settle: c.isSettle,
      fee_percent: c.feePercent,
      min_settle_satang: Math.round((c.minSettleBaht ?? 0) * 100),
      company_id: c.companyId && validCo.has(c.companyId) ? c.companyId : null,
      bank_account_id: c.bankAccountId && validBank.has(c.bankAccountId) ? c.bankAccountId : null,
      updated_at: now,
    }));
  if (rows.length === 0) return { ok: true };
  const { error } = await admin
    .from("cashhub_tea_channel_config")
    .upsert(rows, { onConflict: "org_id,branch_code,channel_code" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
