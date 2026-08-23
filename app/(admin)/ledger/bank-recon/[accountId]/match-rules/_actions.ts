"use server";

// LedgerLine — เงื่อนไขการแมตช์ (วันต้องตรงกัน + ยอดห่างกันได้กี่บาท) ต่อบัญชี
// write = super_admin. ทุก action self-scope org_id (Prisma bypass RLS).
//
// NOTE: "use server" → export async functions เท่านั้น (Turbopack).

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { saveAccountMatchRules } from "@/lib/ledger/reconcile-match-rule";

async function assertAccountInOrg(orgId: string, bankAccountId: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM ledger_bank_account WHERE id = ${bankAccountId}::uuid AND org_id = ${orgId}::uuid LIMIT 1`;
  return r.length > 0;
}

export async function saveMatchRuleAction(params: {
  bankAccountId: string;
  conceptKey: string;
  dateWindowDays: number | null;
  tolBaht: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  if (!(await assertAccountInOrg(orgId, params.bankAccountId))) {
    return { ok: false, error: "ไม่พบบัญชี" };
  }
  return saveAccountMatchRules(orgId, params.bankAccountId, session.user.id, [
    { conceptKey: params.conceptKey, dateWindowDays: params.dateWindowDays, tolBaht: params.tolBaht },
  ]);
}
