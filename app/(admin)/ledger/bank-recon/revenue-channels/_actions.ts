"use server";

// LedgerLine — Revenue channel → GL config server actions.
//
// Sets, per business, "เงินเข้าช่องทางไหน → ลงผังบัญชีไหน" (channel→GL mapping)
// that the Wave-1 foundation (lib/ledger/revenue-channel.ts) reads to STAMP an
// immutable GL snapshot on each revenue entry. Editing config here only changes
// FUTURE stamps — it never touches ledger_revenue_entry, so historical revenue
// keeps its original GL (QA gate AG-3).
//
// NOTE: a "use server" file may ONLY export async functions (Turbopack build fails
// otherwise even though tsc passes). ref memory feedback-use-server-only-async-2026-06-02.
//
// Prisma runs as the postgres role (rolbypassrls=TRUE) → RLS is NOT a backstop.
// Every query self-scopes org_id AND company_id (org-only leaks JP Sync↔Pooil).
// ref memory feedback-ledger-query-must-filter-companyid.

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isRevenueChannel } from "@/lib/ledger/revenue-channel";

// ── 1. Upsert one channel→GL mapping (super_admin ONLY — accountant audit lens) ──

export async function upsertRevenueChannelGlAction(params: {
  companyId: string;
  channelCode: string;
  glClearing: string;
  glIncome?: string;
  glFee?: string;
  categoryId?: string;
  label?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  const { companyId } = params;

  if (!companyId) return { ok: false, error: "ไม่พบบริษัท" };
  if (!isRevenueChannel(params.channelCode)) {
    return { ok: false, error: "ช่องทางการรับเงินไม่ถูกต้อง" };
  }

  // Normalize: trim everything; treat blanks as NULL (clearing is the only required field).
  const glClearing = params.glClearing?.trim() || "";
  const glIncome = params.glIncome?.trim() || null;
  const glFee = params.glFee?.trim() || null;
  const label = params.label?.trim() || null;
  const categoryId = params.categoryId?.trim() || null;

  if (!glClearing) {
    return { ok: false, error: "ต้องระบุผังบัญชีที่เงินเข้า (เช่น 1110)" };
  }

  // If an income category was picked, verify it belongs to THIS company (no
  // cross-entity id injection) — Prisma bypasses RLS so we check explicitly.
  if (categoryId) {
    const cat = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ledger_category
      WHERE id = ${categoryId}::uuid
        AND org_id = ${orgId}::uuid
        AND company_id = ${companyId}::uuid
      LIMIT 1
    `;
    if (!cat.length) return { ok: false, error: "ไม่พบหมวดรายได้ที่เลือก" };
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO ledger_revenue_channel_gl
        (org_id, company_id, channel_code, gl_clearing, gl_income, gl_fee, category_id, label, is_active, updated_at)
      VALUES
        (${orgId}::uuid, ${companyId}::uuid, ${params.channelCode},
         ${glClearing}, ${glIncome}, ${glFee}, ${categoryId}::uuid, ${label}, true, now())
      ON CONFLICT (org_id, company_id, channel_code) DO UPDATE SET
        gl_clearing = EXCLUDED.gl_clearing,
        gl_income   = EXCLUDED.gl_income,
        gl_fee      = EXCLUDED.gl_fee,
        category_id = EXCLUDED.category_id,
        label       = EXCLUDED.label,
        is_active   = true,
        updated_at  = now()
    `;
  } catch {
    return { ok: false, error: "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }
  return { ok: true };
}

// ── 2. List income categories for the income-GL picker (org+company scoped) ──

export async function listIncomeCategoriesAction(
  companyId: string,
): Promise<{ id: string; name: string; trcloudAccCode: string | null }[]> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  const orgId = session.user.org_id;
  if (!companyId) return [];

  return prisma.$queryRaw<{ id: string; name: string; trcloudAccCode: string | null }[]>`
    SELECT id::text as id, name, trcloud_acc_code as "trcloudAccCode"
    FROM ledger_category
    WHERE org_id = ${orgId}::uuid
      AND company_id = ${companyId}::uuid
      AND kind = 'income'
      AND active = true
    ORDER BY sort, name
  `;
}
