"use server";

// LedgerLine — สมุดจำคีย์เวิร์ดต่อบัญชี: เพิ่ม/ลบ keyword ที่ใช้จับคู่ "ดูชื่อ".
// write = super_admin (mirror revenue-channels). ทุก action self-scope org_id (Prisma bypass RLS).
//
// NOTE: "use server" → export async functions เท่านั้น (Turbopack). ref feedback-use-server-only-async-2026-06-02.

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { upsertKeyword, deleteKeyword } from "@/lib/ledger/reconcile-keyword-dict";

// ยืนยันว่า bankAccountId เป็นของ org นี้จริง (กัน id ข้าม org)
async function assertAccountInOrg(orgId: string, bankAccountId: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM ledger_bank_account WHERE id = ${bankAccountId}::uuid AND org_id = ${orgId}::uuid LIMIT 1`;
  return r.length > 0;
}

export async function addBankKeywordAction(params: {
  bankAccountId: string;
  conceptKey: string;
  keyword: string;
  orgWide: boolean; // true = ใช้ทุกบัญชี (org default) · false = เฉพาะบัญชีนี้
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  if (!(await assertAccountInOrg(orgId, params.bankAccountId))) {
    return { ok: false, error: "ไม่พบบัญชี" };
  }
  return upsertKeyword({
    orgId,
    bankAccountId: params.orgWide ? null : params.bankAccountId,
    conceptKey: params.conceptKey,
    keyword: params.keyword,
    createdBy: session.user.id,
  });
}

export async function removeBankKeywordAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin");
  return deleteKeyword(session.user.org_id, id);
}
