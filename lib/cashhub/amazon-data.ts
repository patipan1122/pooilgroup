// CashHub Café Amazon — data layer (เซฟ POS รายวัน + เทียบ POS↔TRCloud IV)
// ตาราง cashhub_amazon_daily. ทุก query scope org_id เสมอ (Prisma/Supabase service-role bypass RLS).
import type { adminClient } from "@/lib/db/server";
import type { AmazonDayRow } from "./amazon-parse";
import type { AmazonIv } from "./amazon-trcloud";
import { SETTLEMENT_GROUPS } from "./amazon-settlement";
import { prisma } from "@/lib/prisma";

type Admin = ReturnType<typeof adminClient>;

// source_ref suffix (key) → ช่องทาง (cvar) ที่อยู่ในก้อนนั้น — ใช้ทาสี "แมตช์แล้ว" กลับเป็นราย-คอลัมน์
// key "qr" = c2+c13+c14 (โอนรวมก้อนเดียว) · key อื่น = cvar เดี่ยว
function cvarsForSendKey(key: string): string[] {
  const g = SETTLEMENT_GROUPS.find((x) => x.key === key);
  return g ? g.cvars : [key];
}

export type SavedAmazonDay = {
  sales_date: string;
  gross: number;
  total: number | null;
  vat: number | null;
  channels: Record<string, number> | null;
  balanced: boolean;
  block_reason: string | null;
  iv_doc_no: string | null;
  iv_doc_id: string | null;
  iv_status: string; // none | posted
  iv_gross: number | null;
  iv_channels: Record<string, number> | null; // ไส้ในรายช่องทางในใบ TRCloud (c1..c40) — เทียบรายช่อง
  iv_pre_vat: number | null; // ยอดก่อน VAT ในใบ → vat_iv = iv_gross − iv_pre_vat
  match_state: string | null; // match | mismatch | no_iv
  iv_checked_at: string | null;
};

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(x) ? x : null;
}

/** เซฟ/อัปเดตแถวรายวันจากไฟล์ POS (idempotent บน org+store+date — re-import ทับยอด POS แต่คง iv_*) */
export async function upsertAmazonDays(
  admin: Admin,
  meta: {
    orgId: string;
    storeCode: string;
    branchLabel: string | null;
    sourceFile: string | null;
    importedBy: string | null;
  },
  rows: AmazonDayRow[],
): Promise<{ saved: number; error?: string }> {
  if (rows.length === 0) return { saved: 0 };
  // อ่านยอดเดิมก่อน เพื่อ "ล้างสถานะ match เก่า" เฉพาะวันที่ยอด POS เปลี่ยน (กันเขียวลวงหลัง re-import)
  const dates = rows.map((r) => r.date);
  const { data: existingRows } = await admin
    .from("cashhub_amazon_daily")
    .select("sales_date, gross")
    .eq("org_id", meta.orgId)
    .eq("store_code", meta.storeCode)
    .in("sales_date", dates);
  const oldGross = new Map(
    ((existingRows ?? []) as Record<string, unknown>[]).map((e) => [
      String(e.sales_date).slice(0, 10),
      n(e.gross) ?? 0,
    ]),
  );
  const payload = rows.map((r) => ({
    org_id: meta.orgId,
    store_code: meta.storeCode,
    branch_label: meta.branchLabel,
    sales_date: r.date,
    gross: r.gross,
    total: r.total,
    vat: r.vat,
    channels: r.cvars,
    balanced: r.balanced,
    block_reason: r.blockReason,
    raw_json: r as unknown as Record<string, unknown>,
    source_file: meta.sourceFile,
    imported_by: meta.importedBy,
    imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  // ไม่แตะ iv_* (เก็บค่าเดิมไว้) — upsert เฉพาะฟิลด์ POS + meta
  const { error } = await admin
    .from("cashhub_amazon_daily")
    .upsert(payload, { onConflict: "org_id,store_code,sales_date", ignoreDuplicates: false });
  if (error) return { saved: 0, error: error.message };

  // วันที่ยอด POS เปลี่ยน → ใบ IV เดิม (ถ้ามี) อาจไม่ตรงแล้ว → ล้าง match_state ให้กลับไป "ยังไม่เทียบ"
  // (คง iv_doc_no/iv_status ไว้ — ใบยังอยู่ใน TRCloud · กด "เทียบกับ TRCloud" จะคำนวณ match ใหม่ถูกต้อง)
  const changed = rows
    .filter((r) => oldGross.has(r.date) && Math.abs((oldGross.get(r.date) ?? 0) - r.gross) >= 1)
    .map((r) => r.date);
  if (changed.length) {
    const now = new Date().toISOString();
    await admin
      .from("cashhub_amazon_daily")
      .update({ match_state: null, iv_checked_at: null, updated_at: now })
      .eq("org_id", meta.orgId)
      .eq("store_code", meta.storeCode)
      .in("sales_date", changed);
  }
  return { saved: rows.length };
}

/** โหลดแถวที่เซฟไว้ (แสดงผลตลอด ไม่ต้องอัปไฟล์ซ้ำ) */
export async function loadAmazonDays(
  admin: Admin,
  orgId: string,
  storeCode: string,
  from: string,
  to: string,
): Promise<SavedAmazonDay[]> {
  const BASE_SEL =
    "sales_date, gross, total, vat, channels, balanced, block_reason, iv_doc_no, iv_doc_id, iv_status, iv_gross, match_state, iv_checked_at";
  const q = (sel: string) =>
    admin
      .from("cashhub_amazon_daily")
      .select(sel)
      .eq("org_id", orgId)
      .eq("store_code", storeCode)
      .gte("sales_date", from)
      .lte("sales_date", to)
      .order("sales_date");
  // ลองดึงพร้อมไส้ใน (iv_channels/iv_pre_vat) ก่อน · ถ้าคอลัมน์ยังไม่มี (migration ยังไม่ลง) → fallback ไม่ให้หน้าพัง
  let res = await q(`${BASE_SEL}, iv_channels, iv_pre_vat`);
  if (res.error) res = await q(BASE_SEL);
  const data = res.data;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((d) => ({
    sales_date: String(d.sales_date).slice(0, 10),
    gross: n(d.gross) ?? 0,
    total: n(d.total),
    vat: n(d.vat),
    channels: (d.channels as Record<string, number> | null) ?? null,
    balanced: Boolean(d.balanced),
    block_reason: (d.block_reason as string | null) ?? null,
    iv_doc_no: (d.iv_doc_no as string | null) ?? null,
    iv_doc_id: (d.iv_doc_id as string | null) ?? null,
    iv_status: String(d.iv_status ?? "none"),
    iv_gross: n(d.iv_gross),
    iv_channels: (d.iv_channels as Record<string, number> | null) ?? null,
    iv_pre_vat: n(d.iv_pre_vat),
    match_state: (d.match_state as string | null) ?? null,
    iv_checked_at: (d.iv_checked_at as string | null) ?? null,
  }));
}

/** ดึง store_code ที่เคยเซฟไว้ (ให้หน้าเลือกสาขา) */
export async function listAmazonStores(
  admin: Admin,
  orgId: string,
): Promise<Array<{ store_code: string; branch_label: string | null }>> {
  const { data } = await admin
    .from("cashhub_amazon_daily")
    .select("store_code, branch_label")
    .eq("org_id", orgId);
  const seen = new Map<string, string | null>();
  for (const d of (data ?? []) as Record<string, unknown>[]) {
    const code = String(d.store_code);
    if (!seen.has(code)) seen.set(code, (d.branch_label as string | null) ?? null);
  }
  return [...seen.entries()].map(([store_code, branch_label]) => ({ store_code, branch_label }));
}

/** เทียบ POS↔TRC: เอา IV ที่ดึงจาก TRCloud มา set iv_gross/iv_status/match_state ต่อวัน แล้วเซฟ */
export async function applyIvMatch(
  admin: Admin,
  orgId: string,
  storeCode: string,
  savedDays: SavedAmazonDay[],
  ivs: AmazonIv[],
): Promise<{ updated: number }> {
  const ivByDate = new Map<string, AmazonIv>();
  for (const iv of ivs) if (iv.date) ivByDate.set(iv.date, iv);
  const now = new Date().toISOString();
  let updated = 0;
  for (const day of savedDays) {
    const iv = ivByDate.get(day.sales_date);
    let match_state: string;
    const patch: Record<string, unknown> = { iv_checked_at: now, updated_at: now };
    if (iv) {
      patch.iv_doc_no = iv.ivNo;
      patch.iv_doc_id = iv.ivId;
      patch.iv_status = "posted";
      patch.iv_gross = iv.gross;
      // เก็บไส้ในรายช่องทาง + ยอดก่อน VAT จากใบจริง → เทียบรายช่องในตาราง (ทาเหลืองช่องที่เพี้ยน)
      patch.iv_channels = Object.keys(iv.channels).length ? iv.channels : null;
      patch.iv_pre_vat = iv.preVat || null;
      match_state = Math.abs(iv.gross - day.gross) < 1 ? "match" : "mismatch";
    } else {
      patch.iv_gross = null;
      patch.iv_status = "none";
      patch.iv_channels = null;
      patch.iv_pre_vat = null;
      match_state = "no_iv";
    }
    patch.match_state = match_state;
    const run = (p: Record<string, unknown>) =>
      admin
        .from("cashhub_amazon_daily")
        .update(p)
        .eq("org_id", orgId)
        .eq("store_code", storeCode)
        .eq("sales_date", day.sales_date);
    let { error } = await run(patch);
    if (error) {
      // คอลัมน์ไส้ใน (iv_channels/iv_pre_vat) ยังไม่มี (migration ยังไม่ลง) → อัปเดตแบบไม่มีไส้ใน
      // กัน "เทียบกับ TRCloud" พังทั้งหมด (ยอดรวม/สถานะยังอัปเดตได้)
      const { iv_channels: _c, iv_pre_vat: _v, ...rest } = patch;
      void _c;
      void _v;
      ({ error } = await run(rest));
    }
    if (!error) updated++;
  }
  return { updated };
}

export type ImportHistoryRow = {
  at: string;
  days: number;
  file: string | null;
  storeCode: string | null;
  by: string;
};

/** ประวัติการนำเข้าไฟล์ (จาก audit_logs IMPORT_AMAZON_SALES) */
export async function loadImportHistory(
  admin: Admin,
  orgId: string,
  limit = 15,
): Promise<ImportHistoryRow[]> {
  const { data } = await admin
    .from("audit_logs")
    .select("created_at, user_id, diff")
    .eq("org_id", orgId)
    .eq("action", "IMPORT_AMAZON_SALES")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean) as string[])];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: users } = await admin
      .from("users")
      .select("id, name")
      .in("id", userIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>)
      nameById.set(u.id, u.name);
  }
  return rows.map((r) => {
    const di = (r.diff as { new?: Record<string, unknown> } | null)?.new ?? {};
    const uid = r.user_id ? String(r.user_id) : null;
    return {
      at: String(r.created_at ?? ""),
      days: Number(di.days ?? 0),
      file: (di.file as string | null) ?? null,
      storeCode: (di.storeCode as string | null) ?? null,
      by: (uid ? nameById.get(uid) : null) ?? "—",
    };
  });
}

export type ReconcileDayStatus = {
  sentSatang: number; // รวมเงินเข้าจริงที่ส่งเข้า reconcile แล้ว (วันนั้น)
  matchedSatang: number; // ส่วนที่บัญชีแมตช์ยอดแล้ว
  n: number; // จำนวนรายการ (ช่องทาง) ที่ส่ง
  nMatched: number; // จำนวนที่แมตช์แล้ว
  matchedCvars: string[]; // cvar ของช่องทางที่แมตช์ยอดแล้ว (ทาสีรุ้งราย-คอลัมน์)
  diffBaht: number | null; // ส่วนต่าง = เงินเข้าจริง(ธนาคาร) − ที่ควรได้(สุทธิ) · null = ยังไม่มีคู่แมตช์ · <0 = เงินขาด
};
export type ReconcileStatus = {
  byDate: Record<string, ReconcileDayStatus>;
  totalSent: number; // รวมทั้งเดือน (บาท)
  totalMatched: number;
  totalDiff: number; // รวมส่วนต่างทั้งเดือน (บาท · <0 = ขาดสุทธิ)
};

/** อ่านสถานะ reconcile กลับมา: รายการ CASHHUB_AMAZON ใน ledger_revenue_entry แมตช์ไปเท่าไหร่ */
export async function loadReconcileStatus(
  admin: Admin,
  orgId: string,
  storeCode: string,
  from: string,
  to: string,
): Promise<ReconcileStatus> {
  const { data } = await admin
    .from("ledger_revenue_entry")
    .select("entry_date, amount_satang, match_state, source_ref")
    .eq("org_id", orgId)
    .eq("source_type", "CASHHUB_AMAZON")
    .like("source_ref", `amz-${storeCode}-%`)
    .gte("entry_date", from)
    .lte("entry_date", to);
  const byDate: Record<string, ReconcileDayStatus> = {};
  let totalSent = 0,
    totalMatched = 0;
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const d = String(r.entry_date).slice(0, 10);
    const amt = (n(r.amount_satang) ?? 0) / 100;
    const matched = String(r.match_state) === "matched";
    const cur = (byDate[d] ??= { sentSatang: 0, matchedSatang: 0, n: 0, nMatched: 0, matchedCvars: [], diffBaht: null });
    cur.sentSatang += amt;
    cur.n += 1;
    totalSent += amt;
    if (matched) {
      cur.matchedSatang += amt;
      cur.nMatched += 1;
      totalMatched += amt;
      // source_ref = amz-<store>-<date>-<key> → key = ส่วนท้าย (ไม่มี '-') → ช่องทางที่แมตช์
      const key = String(r.source_ref ?? "").split("-").pop() ?? "";
      for (const cv of cvarsForSendKey(key))
        if (!cur.matchedCvars.includes(cv)) cur.matchedCvars.push(cv);
    }
  }
  // ส่วนต่างจริง: เทียบยอดที่ส่ง (สุทธิ) กับเงินเข้าธนาคารที่จับคู่แล้ว → delta จาก match group
  //   delta_satang = bank_total − book_total (ลบ = เงินขาด · บวก = เกิน) · นับ 1 ครั้ง/กลุ่ม กันซ้ำ N:M
  let totalDiff = 0;
  try {
    const diffRows = await prisma.$queryRaw<{ d: string; delta: bigint | null }[]>`
      SELECT to_char(x.entry_date,'YYYY-MM-DD') AS d, SUM(x.delta)::bigint AS delta
      FROM (
        SELECT g.id, MIN(re.entry_date) AS entry_date, MAX(g.delta_satang) AS delta
        FROM ledger_bank_match_group g
        JOIN ledger_bank_match_item mi
          ON mi.group_id = g.id AND mi.kind = 'book' AND mi.book_type = 'revenue'
        JOIN ledger_revenue_entry re ON re.id = mi.book_id
        WHERE re.org_id = ${orgId}::uuid
          AND re.source_type = 'CASHHUB_AMAZON'
          AND re.source_ref LIKE ${`amz-${storeCode}-%`}
          AND re.entry_date BETWEEN ${from}::date AND ${to}::date
          AND g.status IN ('suggested', 'confirmed')
        GROUP BY g.id
      ) x
      GROUP BY 1`;
    for (const r of diffRows) {
      const d = String(r.d).slice(0, 10);
      const diff = Number(r.delta ?? 0) / 100;
      const cur = (byDate[d] ??= { sentSatang: 0, matchedSatang: 0, n: 0, nMatched: 0, matchedCvars: [], diffBaht: null });
      cur.diffBaht = diff;
      totalDiff += diff;
    }
  } catch {
    // ถ้าตาราง match group ยังไม่มี/อ่านไม่ได้ → ปล่อย diff เป็น null (ไม่ทำให้หน้าพัง)
  }
  return {
    byDate,
    totalSent: Math.round(totalSent * 100) / 100,
    totalMatched: Math.round(totalMatched * 100) / 100,
    totalDiff: Math.round(totalDiff * 100) / 100,
  };
}

/** อัปเดตแถวหลังสร้าง/พบ IV (กดสร้างจากหน้า) — เทียบยอด IV จริงกับ POS เสมอ (ไม่เหมา match) */
export async function markIvPosted(
  admin: Admin,
  orgId: string,
  storeCode: string,
  salesDate: string,
  ivNo: string,
  ivId: string,
  ivGross: number,
  posGross: number,
): Promise<void> {
  const now = new Date().toISOString();
  // match จากการเทียบยอดจริง: ใบที่สร้างจาก POS → grand=gross=match · ใบที่ "พบซ้ำ" (คีย์มือ) อาจ mismatch
  const match_state = Math.abs(ivGross - posGross) < 1 ? "match" : "mismatch";
  const base = {
    iv_doc_no: ivNo,
    iv_doc_id: ivId,
    iv_status: "posted",
    iv_gross: ivGross,
    match_state,
    iv_checked_at: now,
    updated_at: now,
  };
  const run = (p: Record<string, unknown>) =>
    admin
      .from("cashhub_amazon_daily")
      .update(p)
      .eq("org_id", orgId)
      .eq("store_code", storeCode)
      .eq("sales_date", salesDate);
  // ล้างไส้ในเดิม → กด "เทียบกับ TRCloud" เพื่อดึงรายช่องทางของใบใหม่มาเทียบ (กันค่าเก่าค้าง)
  const { error } = await run({ ...base, iv_channels: null, iv_pre_vat: null });
  // คอลัมน์ไส้ในยังไม่มี (migration ยังไม่ลง) → อัปเดตแบบไม่มีไส้ใน (กันสร้าง IV แล้วสถานะไม่อัป)
  if (error) await run(base);
}
