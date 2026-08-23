// ClawFleet → LedgerLine bridge: ส่งยอดฝากสาขาเข้า ledger_revenue_entry เพื่อรอ
// จับคู่กับ statement ธนาคารจริง (bank-recon) — mirror 1:1 ของ
// lib/chairops/reconcile/ledger-push.ts: source_type discriminator + deterministic
// source_ref + INSERT...ON CONFLICT WHERE match_state='unmatched' (กันส่งซ้ำ
// อะตอมมิก · กดกี่ครั้งก็ได้ · ไม่แตะรายการที่จับคู่แล้ว).
//
// 'CLAWFLEET' อยู่ใน source_type CHECK ของ ledger_revenue_entry ตั้งแต่ migration
// แรก (20260612005000_ledger_revenue_entry.sql) — ไม่ต้องแก้ schema ฝั่ง ledger เลย.
//
// ยอดที่ส่ง = CfCashDeposit.amountCents ("เงินที่ฝากจริง จากสลิป") ไม่ใช่ยอดเก็บจริง
// (cashCountedCents) — เพราะยอดนี้คือเงินที่เข้าบัญชีธนาคารจริงตามที่ statement จะโชว์
// (ถ้าขาด/เกิน สองยอดนี้ต่างกัน · reconcile ต้องเทียบกับยอดที่เข้าบัญชีจริง).

import { prisma } from "@/lib/prisma";

export type BranchReconcileSummary = {
  configured: boolean;
  companyId: string | null;
  bankAccountId: string | null;
  readyCount: number;
  readyAmountBaht: number;
  pendingReviewCount: number;
  rejectedCount: number;
};

/** สรุปสถานะฝากของสาขา — READ-ONLY ใช้เรนเดอร์หน้าจอ */
export async function getBranchReconcileSummary(
  orgId: string,
  branchId: string,
): Promise<BranchReconcileSummary> {
  const config = await prisma.cfBranchReconcileConfig.findFirst({
    where: { branchId, orgId },
    select: { companyId: true, bankAccountId: true },
  });

  const [readyAgg, pendingReviewCount, rejectedCount] = await Promise.all([
    prisma.cfCashDeposit.aggregate({
      where: { orgId, branchId, approvalStatus: { in: ["NONE", "APPROVED"] } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "PENDING" } }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "REJECTED" } }),
  ]);

  return {
    configured: Boolean(config?.companyId && config?.bankAccountId),
    companyId: config?.companyId ?? null,
    bankAccountId: config?.bankAccountId ?? null,
    readyCount: readyAgg._count._all,
    readyAmountBaht: Math.round((readyAgg._sum.amountCents ?? 0) / 100),
    pendingReviewCount,
    rejectedCount,
  };
}

export type PushResult = {
  ok: boolean;
  inserted: number;
  alreadySent: number;
  pendingReviewSkipped: number;
  error?: string;
};

/** ส่งยอดฝากทั้งหมดของสาขา (approvalStatus NONE/APPROVED เท่านั้น — ข้าม PENDING/REJECTED)
 *  เข้า ledger_revenue_entry · กดซ้ำได้ไม่จำกัด — source_ref ผูกกับ depositId เสมอ ทำให้
 *  ON CONFLICT กันซ้ำอัตโนมัติในระดับฐานข้อมูล (แถวที่จับคู่ statement แล้วจะไม่ถูกแตะ) */
export async function pushBranchDepositsToLedger(
  orgId: string,
  branchId: string,
): Promise<PushResult> {
  const [branch, config] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { name: true } }),
    prisma.cfBranchReconcileConfig.findFirst({
      where: { branchId, orgId },
      select: { companyId: true, bankAccountId: true },
    }),
  ]);
  if (!branch) {
    return { ok: false, inserted: 0, alreadySent: 0, pendingReviewSkipped: 0, error: "ไม่พบสาขา" };
  }
  if (!config?.companyId || !config?.bankAccountId) {
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
      pendingReviewSkipped: 0,
      error: "ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคารของสาขานี้ — ตั้งค่าก่อนแล้วค่อยส่ง",
    };
  }

  const [deposits, pendingReviewSkipped] = await Promise.all([
    prisma.cfCashDeposit.findMany({
      where: { orgId, branchId, approvalStatus: { in: ["NONE", "APPROVED"] } },
      select: { id: true, amountCents: true, depositedAt: true, depositedByName: true },
    }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "PENDING" } }),
  ]);

  if (deposits.length === 0) {
    return { ok: true, inserted: 0, alreadySent: 0, pendingReviewSkipped };
  }

  let inserted = 0;
  try {
    for (const d of deposits) {
      const sourceRef = `clawfleet-deposit-${d.id}`;
      const description = `ClawFleet ฝากเงิน · ${branch.name} · ${d.depositedByName}`;
      // amount_satang: ledger เก็บหน่วยสตางค์ · CfCashDeposit.amountCents เก็บหน่วย
      // สตางค์อยู่แล้ว (ชื่อ "Cents" ในโค้ดนี้ = สตางค์ ไม่ใช่บาทเต็มแบบ ChairOps) → ส่งตรงไม่คูณ
      const res = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_revenue_entry
          (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
           description, customer_name, payment_channel, channel_code, match_state,
           expected_bank_account_id)
        VALUES (
          ${orgId}::uuid, ${config.companyId}::uuid, ${d.depositedAt}::date,
          ${d.amountCents}, 'CLAWFLEET', ${sourceRef},
          ${description}, ${branch.name}, 'เงินสด', 'cash', 'unmatched',
          ${config.bankAccountId}::uuid
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
