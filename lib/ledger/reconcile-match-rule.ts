// LedgerLine Bank Recon — override กฎแมตช์ (วันต้องตรงกัน + ยอดห่างกันได้กี่บาท) ต่อบัญชี (data layer)
// ตาราง ledger_bank_match_rule — mirror รูปแบบ reconcile-keyword-dict.ts (สมุดจำคีย์)
// ค่า default มาจาก MATCH_CONCEPTS (built-in, reconcile-match-keywords.ts) — ตารางนี้เก็บเฉพาะที่ตั้งเอง
//
// graceful: ถ้าตารางยังไม่ migrate → คืนค่าว่าง (deploy ก่อน migration ได้)
// ทุก query self-scope org_id (Prisma bypass RLS)

import { prisma } from "@/lib/prisma";
import { MATCH_CONCEPTS, type MatchRuleOverride } from "@/lib/ledger/reconcile-match-keywords";

/** โหลด override ต่อบัญชี (+ org-default ถ้ามี) → map concept_key → {dateWindowDays, tolBaht} */
export async function loadAccountMatchRules(
  orgId: string,
  bankAccountId: string,
): Promise<Record<string, MatchRuleOverride>> {
  try {
    const rows = await prisma.$queryRaw<
      { concept_key: string; date_window_days: number | null; tol_baht: number | null; is_account: boolean }[]
    >`
      SELECT concept_key, date_window_days, tol_baht, (bank_account_id = ${bankAccountId}::uuid) as is_account
      FROM ledger_bank_match_rule
      WHERE org_id = ${orgId}::uuid
        AND (bank_account_id = ${bankAccountId}::uuid OR bank_account_id IS NULL)`;
    // บัญชีเฉพาะ (is_account=true) ชนะ org-default เสมอ ถ้ามีทั้งคู่
    const map: Record<string, MatchRuleOverride> = {};
    for (const r of rows.sort((a, b) => Number(a.is_account) - Number(b.is_account))) {
      map[r.concept_key] = { dateWindowDays: r.date_window_days, tolBaht: r.tol_baht != null ? Number(r.tol_baht) : null };
    }
    return map;
  } catch {
    return {}; // ตารางยังไม่มี → ใช้แค่ built-in default
  }
}

/** รายการต่อ concept (built-in + override ปัจจุบันของบัญชีนี้) — ป้อนหน้าตั้งค่า */
export async function listMatchRulesForAccount(
  orgId: string,
  bankAccountId: string,
): Promise<{ conceptKey: string; label: string; defaultDateWindowDays: number; defaultTolBaht: number; override: MatchRuleOverride }[]> {
  const rules = await loadAccountMatchRules(orgId, bankAccountId);
  return Object.values(MATCH_CONCEPTS).map((c) => ({
    conceptKey: c.key,
    label: c.label,
    defaultDateWindowDays: c.dateWindowDays,
    defaultTolBaht: Math.round((c.tolAbsSatang / 100) * 100) / 100,
    override: rules[c.key] ?? { dateWindowDays: null, tolBaht: null },
  }));
}

/** บันทึก override ต่อบัญชี (super_admin) — ทั้ง 2 ค่า null = ลบ override (กลับไปใช้ default) */
export async function saveAccountMatchRules(
  orgId: string,
  bankAccountId: string,
  updatedBy: string,
  rules: { conceptKey: string; dateWindowDays: number | null; tolBaht: number | null }[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const r of rules) {
      if (!MATCH_CONCEPTS[r.conceptKey]) continue; // ทิ้ง concept แปลกปลอม
      if (r.dateWindowDays == null && r.tolBaht == null) {
        await prisma.$executeRaw`
          DELETE FROM ledger_bank_match_rule
          WHERE org_id = ${orgId}::uuid AND bank_account_id = ${bankAccountId}::uuid
            AND concept_key = ${r.conceptKey}`;
        continue;
      }
      const dw = r.dateWindowDays != null ? Math.max(0, Math.min(60, Math.round(r.dateWindowDays))) : null;
      const tol = r.tolBaht != null ? Math.max(0, Math.round(r.tolBaht * 100) / 100) : null;
      await prisma.$executeRaw`
        INSERT INTO ledger_bank_match_rule
          (org_id, bank_account_id, concept_key, date_window_days, tol_baht, updated_by)
        VALUES (${orgId}::uuid, ${bankAccountId}::uuid, ${r.conceptKey}, ${dw}, ${tol}, ${updatedBy}::uuid)
        ON CONFLICT (org_id, COALESCE(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid), concept_key)
        DO UPDATE SET date_window_days = EXCLUDED.date_window_days, tol_baht = EXCLUDED.tol_baht,
                      updated_by = EXCLUDED.updated_by, updated_at = now()`;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}
