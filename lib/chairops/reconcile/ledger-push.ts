// ChairOps → LedgerLine bridge: ส่งยอดฝากสาขาเข้า ledger_revenue_entry เพื่อรอ
// จับคู่กับ statement ธนาคารจริง (bank-recon) — ใช้ pattern เดียวกับ
// lib/cashhub/amazon-settlement-data.ts (sendDaysToReconcile): source_type
// discriminator + deterministic source_ref + INSERT...ON CONFLICT WHERE
// match_state='unmatched' (กันส่งซ้ำ อะตอมมิก · กดกี่ครั้งก็ได้ · ไม่แตะรายการ
// ที่จับคู่แล้ว).
//
// 'CHAIROPS' อยู่ใน source_type CHECK ของ ledger_revenue_entry ตั้งแต่
// migration แรก (20260612005000_ledger_revenue_entry.sql) — ไม่ต้องแก้ schema
// ฝั่ง ledger เลย.

import { prisma } from "@/lib/prisma";

export type BranchReconcileSummary = {
  configured: boolean;
  companyId: string | null;
  bankAccountId: string | null;
  readyCount: number;
  readyAmountBaht: number;
  pendingReviewCount: number;
};

/** สรุปสถานะฝากของสาขา — READ-ONLY ใช้เรนเดอร์หน้าจอ */
export async function getBranchReconcileSummary(
  orgId: string,
  branchId: string,
): Promise<BranchReconcileSummary> {
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId },
    select: { reconcileCompanyId: true, reconcileBankAccountId: true },
  });

  const [readyAgg, pendingReviewCount] = await Promise.all([
    prisma.chairopsCashDeposit.aggregate({
      where: { orgId, branchId, requiresReview: false },
      _count: { _all: true },
      _sum: { depositedAmount: true },
    }),
    prisma.chairopsCashDeposit.count({
      where: { orgId, branchId, requiresReview: true },
    }),
  ]);

  return {
    configured: Boolean(branch?.reconcileCompanyId && branch?.reconcileBankAccountId),
    companyId: branch?.reconcileCompanyId ?? null,
    bankAccountId: branch?.reconcileBankAccountId ?? null,
    readyCount: readyAgg._count._all,
    readyAmountBaht: readyAgg._sum.depositedAmount ?? 0,
    pendingReviewCount,
  };
}

export type PushResult = {
  ok: boolean;
  inserted: number;
  alreadySent: number;
  pendingReviewSkipped: number;
  error?: string;
};

/** ส่งยอดฝากทั้งหมดของสาขา (ที่ไม่ติด requiresReview) เข้า ledger_revenue_entry
 *  กดซ้ำได้ไม่จำกัด — source_ref ผูกกับ depositId เสมอ ทำให้ ON CONFLICT
 *  กันซ้ำอัตโนมัติในระดับฐานข้อมูล (แถวที่จับคู่ statement แล้วจะไม่ถูกแตะ) */
export async function pushBranchDepositsToLedger(
  orgId: string,
  branchId: string,
): Promise<PushResult> {
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId },
    select: {
      name: true,
      reconcileCompanyId: true,
      reconcileBankAccountId: true,
    },
  });
  if (!branch) {
    return { ok: false, inserted: 0, alreadySent: 0, pendingReviewSkipped: 0, error: "ไม่พบสาขา" };
  }
  if (!branch.reconcileCompanyId || !branch.reconcileBankAccountId) {
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
      pendingReviewSkipped: 0,
      error: "ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคารของสาขานี้ — ตั้งค่าก่อนแล้วค่อยส่ง",
    };
  }

  const [deposits, pendingReviewSkipped] = await Promise.all([
    prisma.chairopsCashDeposit.findMany({
      where: { orgId, branchId, requiresReview: false },
      select: {
        id: true,
        depositedAmount: true,
        depositedAt: true,
        maid: { select: { displayName: true } },
      },
    }),
    prisma.chairopsCashDeposit.count({ where: { orgId, branchId, requiresReview: true } }),
  ]);

  if (deposits.length === 0) {
    return { ok: true, inserted: 0, alreadySent: 0, pendingReviewSkipped };
  }

  let inserted = 0;
  try {
    for (const d of deposits) {
      const sourceRef = `chairops-deposit-${d.id}`;
      const description = `ChairOps ฝากเงิน · ${branch.name} · ${d.maid.displayName}`;
      // amount_satang: ledger เก็บหน่วยสตางค์ · ChairopsCashDeposit.depositedAmount
      // เก็บหน่วยบาทเต็ม (zBaht = int ไม่มีทศนิยม) → คูณ 100 เสมอ
      const res = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_revenue_entry
          (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
           description, customer_name, payment_channel, channel_code, match_state,
           expected_bank_account_id)
        VALUES (
          ${orgId}::uuid, ${branch.reconcileCompanyId}::uuid, ${d.depositedAt}::date,
          ${d.depositedAmount * 100}, 'CHAIROPS', ${sourceRef},
          ${description}, ${branch.name}, 'เงินสด', 'cash', 'unmatched',
          ${branch.reconcileBankAccountId}::uuid
        )
        ON CONFLICT (org_id, company_id, source_type, source_ref)
          WHERE source_ref IS NOT NULL
        DO UPDATE SET
          amount_satang = EXCLUDED.amount_satang,
          expected_bank_account_id = EXCLUDED.expected_bank_account_id,
          description = EXCLUDED.description,
          updated_at = now()
        WHERE ledger_revenue_entry.match_state = 'unmatched'
        RETURNING id`;
      if (res.length) inserted++;
    }
  } catch (e) {
    return {
      ok: false,
      inserted,
      alreadySent: 0,
      pendingReviewSkipped,
      error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ",
    };
  }

  return {
    ok: true,
    inserted,
    alreadySent: deposits.length - inserted,
    pendingReviewSkipped,
  };
}
