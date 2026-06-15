// LedgerLine Bank Recon — สมุดจำคีย์เวิร์ด (data layer · server)
//
// keyword "ในระบบ" = built-in ใน reconcile-match-keywords.ts (MATCH_CONCEPTS) — seed ทุกบัญชี.
// ตารางนี้ (ledger_bank_match_keyword) เก็บเฉพาะคีย์ที่ "เพิ่มเอง/เรียนรู้" ต่อบัญชี
// → matcher โหลดมาเป็น extraKeywords ต่อท้าย built-in (bankNameMatches).
//
// graceful: ถ้าตารางยังไม่ migrate → คืนค่าว่าง (deploy ก่อน migration ได้).
// ทุก query self-scope org_id (Prisma bypass RLS).

import { prisma } from "@/lib/prisma";
import { MATCH_CONCEPTS } from "@/lib/ledger/reconcile-match-keywords";

const ORG_DEFAULT = "00000000-0000-0000-0000-000000000000";

export interface KeywordRow {
  id: string;
  conceptKey: string;
  keyword: string;
  source: "seed" | "learned" | "manual";
  scope: "account" | "org";       // มาจากบัญชีนี้ หรือ org-default
  confirmedCount: number;
}

/** โหลดคีย์ที่เพิ่ม/เรียนรู้ (per บัญชี + org-default) → map concept_key → keywords[] (ป้อน matcher) */
export async function loadAccountKeywordMap(
  orgId: string,
  bankAccountId: string,
): Promise<Record<string, string[]>> {
  try {
    const rows = await prisma.$queryRaw<{ concept_key: string; keyword: string }[]>`
      SELECT concept_key, keyword FROM ledger_bank_match_keyword
      WHERE org_id = ${orgId}::uuid AND is_active
        AND (bank_account_id = ${bankAccountId}::uuid OR bank_account_id IS NULL)`;
    const map: Record<string, string[]> = {};
    for (const r of rows) (map[r.concept_key] ??= []).push(r.keyword);
    return map;
  } catch {
    return {}; // ตารางยังไม่มี → ใช้แค่ built-in
  }
}

/** รายการคีย์สำหรับหน้าสมุด (built-in + ที่เพิ่มเอง) ต่อบัญชี */
export async function listKeywordsForAccount(
  orgId: string,
  bankAccountId: string,
): Promise<{ builtin: { conceptKey: string; label: string; keywords: string[] }[]; custom: KeywordRow[] }> {
  const builtin = Object.values(MATCH_CONCEPTS)
    .filter((c) => c.keywords.length > 0)
    .map((c) => ({ conceptKey: c.key, label: c.label, keywords: c.keywords }));
  let custom: KeywordRow[] = [];
  try {
    const rows = await prisma.$queryRaw<{
      id: string; concept_key: string; keyword: string; source: string;
      confirmed_count: number; is_org: boolean;
    }[]>`
      SELECT id::text, concept_key, keyword, source, confirmed_count,
             (bank_account_id IS NULL) as is_org
      FROM ledger_bank_match_keyword
      WHERE org_id = ${orgId}::uuid AND is_active
        AND (bank_account_id = ${bankAccountId}::uuid OR bank_account_id IS NULL)
      ORDER BY concept_key, confirmed_count DESC, keyword`;
    custom = rows.map((r) => ({
      id: r.id, conceptKey: r.concept_key, keyword: r.keyword,
      source: r.source as KeywordRow["source"],
      scope: r.is_org ? "org" : "account",
      confirmedCount: Number(r.confirmed_count),
    }));
  } catch {
    /* ตารางยังไม่มี */
  }
  return { builtin, custom };
}

const KW_RE = /^[\p{L}\p{N}][\p{L}\p{N} .&'\-]{1,118}$/u;

/** เพิ่ม/แก้คีย์เอง (manual · super_admin) */
export async function upsertKeyword(params: {
  orgId: string; bankAccountId: string | null; conceptKey: string; keyword: string; createdBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const keyword = params.keyword.trim().toLowerCase();
  if (!keyword || keyword.length < 2) return { ok: false, error: "คำหลักสั้นเกินไป" };
  if (!KW_RE.test(keyword)) return { ok: false, error: "คำหลักมีอักขระไม่ถูกต้อง" };
  if (!MATCH_CONCEPTS[params.conceptKey]) return { ok: false, error: "ประเภทไม่ถูกต้อง" };
  try {
    await prisma.$executeRaw`
      INSERT INTO ledger_bank_match_keyword
        (org_id, bank_account_id, concept_key, keyword, source, confirmed_count, created_by)
      VALUES (${params.orgId}::uuid, ${params.bankAccountId}::uuid, ${params.conceptKey},
              ${keyword}, 'manual', 0, ${params.createdBy}::uuid)
      ON CONFLICT (org_id, COALESCE(bank_account_id, ${ORG_DEFAULT}::uuid), concept_key, lower(keyword))
      DO UPDATE SET is_active = true, updated_at = now()`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

/** ลบคีย์ (soft → is_active=false · org-scoped) */
export async function deleteKeyword(orgId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$executeRaw`
      UPDATE ledger_bank_match_keyword SET is_active = false, updated_at = now()
      WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
}

// คำทั่วไป/คำธนาคาร ที่ไม่ใช่ชื่อคู่ค้า → ห้ามเรียนรู้เป็นคีย์ (กัน over-match)
const STOPWORDS = new Set([
  "จาก", "รับโอนเงิน", "รับเงิน", "โอนไป", "โอนเข้า", "เพื่อชำระ", "ref", "บจก", "บมจ", "หจก",
  "ธนาคาร", "เงินโอน", "เงิน", "บัญชี", "สาขา", "รหัสอ้างอิง", "ฝากเงินสด", "เต็มจำนวน",
  "ผ่อนชำระ", "คะแนนสะสม", "หักบัญชีอัตโนมัติ", "ตู้เติมเงิน", "โมบาย", "แอปพลิเคชัน",
  "thai", "qr", "payment", "internet", "mobile", "นครราชสีมา", "การขาย", "ด้วย",
  "ktb", "kbank", "scb", "bbl", "ttb", "uobt", "citi", "bay", "gsb", "baac", "kb",
]);

/** สกัด "ชื่อคู่ค้า" จากข้อความธนาคาร — คืน null ถ้าไม่มั่นใจ (กันคีย์ขยะ) */
export function extractCounterpartyKeyword(bankTextLower: string): string | null {
  const tokens = bankTextLower
    .replace(/[()฿,]/g, " ")
    .split(/[\s.·/]+/)
    .map((t) => t.replace(/\+/g, "").trim())
    .filter(Boolean);
  const cands = tokens.filter(
    (t) =>
      t.length >= 3 &&
      !STOPWORDS.has(t) &&
      !/^[a-z]?\d{2,}$/.test(t) && // x3812 / k0974743 / เลขบัญชี
      !/^\d+$/.test(t) &&
      /[\p{L}]{3,}/u.test(t), // มีตัวอักษร ≥3
  );
  if (!cands.length) return null;
  // เลือกตัวที่ยาวสุด (โดดเด่นสุด) — มักเป็นชื่อร้าน/แพลตฟอร์ม
  const best = cands.sort((a, b) => b.length - a.length)[0];
  return best.length >= 3 && best.length <= 60 ? best : null;
}

/** เรียนรู้จากการยืนยันแมตช์ — best-effort (ห้าม throw · ห้ามทำ confirm พัง) */
export async function learnFromConfirm(params: {
  orgId: string; bankAccountId: string; bankTextLower: string; conceptKey: string;
}): Promise<void> {
  try {
    if (params.conceptKey === "cash" || params.conceptKey === "other") return; // เงินสด/อื่น ไม่ต้องจำชื่อ
    if (!MATCH_CONCEPTS[params.conceptKey]) return;
    const kw = extractCounterpartyKeyword(params.bankTextLower);
    if (!kw) return;
    // ถ้า built-in รู้จักคำนี้อยู่แล้ว ไม่ต้องจำซ้ำ
    if (MATCH_CONCEPTS[params.conceptKey].keywords.some((k) => kw.includes(k.toLowerCase()) || k.toLowerCase().includes(kw)))
      return;
    await prisma.$executeRaw`
      INSERT INTO ledger_bank_match_keyword
        (org_id, bank_account_id, concept_key, keyword, source, confirmed_count)
      VALUES (${params.orgId}::uuid, ${params.bankAccountId}::uuid, ${params.conceptKey}, ${kw}, 'learned', 1)
      ON CONFLICT (org_id, COALESCE(bank_account_id, ${ORG_DEFAULT}::uuid), concept_key, lower(keyword))
      DO UPDATE SET confirmed_count = ledger_bank_match_keyword.confirmed_count + 1,
                    is_active = true, updated_at = now()`;
  } catch {
    /* best-effort — never break confirm */
  }
}
