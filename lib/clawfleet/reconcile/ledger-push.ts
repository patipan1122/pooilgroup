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
  /** ใบที่ส่งเข้า ledger ไปแล้ว (ไม่นับใน readyCount) — โชว์ให้รู้ว่างานเดินไปแล้วจริง */
  alreadySentCount: number;
};

/** source_ref ของใบฝากใน ledger — deterministic ผูกกับ depositId (กันส่งซ้ำระดับ DB) */
function depositSourceRef(depositId: string): string {
  return `clawfleet-deposit-${depositId}`;
}

/**
 * ใบฝากไหน "ส่งเข้า ledger ไปแล้ว" — เทียบด้วย source_ref ที่มีอยู่จริงใน ledger_revenue_entry.
 * คืน Set ของ depositId ที่เจอแล้ว. graceful: query ล้ม → Set ว่าง (ถือว่ายังไม่ส่ง · กดส่งซ้ำได้
 * ปลอดภัยอยู่แล้วเพราะ ON CONFLICT กันซ้ำที่ระดับ DB — เลือก fail-safe ทางที่ไม่ทำให้เงินหาย).
 * ⚠️ ต้องใส่ ::text[]/::uuid ให้ชัด — Prisma ส่งพารามิเตอร์แบบไม่ระบุชนิด (untyped).
 */
async function loadSentDepositIds(
  orgId: string,
  companyId: string,
  depositIds: string[],
): Promise<Set<string>> {
  if (depositIds.length === 0) return new Set();
  try {
    const refs = depositIds.map(depositSourceRef);
    const rows = await prisma.$queryRaw<{ source_ref: string }[]>`
      SELECT source_ref
        FROM ledger_revenue_entry
       WHERE org_id = ${orgId}::uuid
         AND company_id = ${companyId}::uuid
         AND source_type = 'CLAWFLEET'
         AND source_ref = ANY(${refs}::text[])`;
    const sent = new Set<string>();
    for (const r of rows) {
      // ตัด prefix กลับเป็น depositId ("clawfleet-deposit-" = 18 ตัวอักษร)
      sent.add(r.source_ref.slice("clawfleet-deposit-".length));
    }
    return sent;
  } catch {
    return new Set();
  }
}

/**
 * สรุปสถานะฝากของสาขา — READ-ONLY ใช้เรนเดอร์หน้าจอ
 *
 * "พร้อมส่ง N ใบ" ต้องหมายถึง "ยังไม่ได้ส่ง" จริง ๆ — เดิมนับใบที่ส่งไปแล้วซ้ำทุกครั้ง ทำให้
 * ตัวเลขไม่เคยลดลงหลังกดส่งสำเร็จ · คนคุมเงินเห็นเลขเดิมค้าง เลยคิดว่าล้มเหลวแล้วกดซ้ำไปเรื่อย ๆ
 * (และข้อความตอบกลับก็บอก "ส่งแล้ว N ใบ" เท่าเดิมทุกครั้ง ยิ่งตอกย้ำว่าไม่สำเร็จ).
 */
export async function getBranchReconcileSummary(
  orgId: string,
  branchId: string,
): Promise<BranchReconcileSummary> {
  const config = await prisma.cfBranchReconcileConfig.findFirst({
    where: { branchId, orgId },
    select: { companyId: true, bankAccountId: true },
  });

  const [readyRows, pendingReviewCount, rejectedCount] = await Promise.all([
    prisma.cfCashDeposit.findMany({
      where: { orgId, branchId, approvalStatus: { in: ["NONE", "APPROVED"] } },
      select: { id: true, amountCents: true },
    }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "PENDING" } }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "REJECTED" } }),
  ]);

  // ยังไม่ได้ตั้งค่าบริษัท/บัญชี → ส่งไม่ได้อยู่แล้ว · ไม่ต้องไปถาม ledger (ไม่มี companyId ให้เทียบ)
  const companyId = config?.companyId ?? null;
  const sent = companyId
    ? await loadSentDepositIds(orgId, companyId, readyRows.map((r) => r.id))
    : new Set<string>();

  const notSent = readyRows.filter((r) => !sent.has(r.id));

  return {
    configured: Boolean(config?.companyId && config?.bankAccountId),
    companyId,
    bankAccountId: config?.bankAccountId ?? null,
    readyCount: notSent.length,
    readyAmountBaht: Math.round(notSent.reduce((s, r) => s + r.amountCents, 0) / 100),
    pendingReviewCount,
    rejectedCount,
    alreadySentCount: readyRows.length - notSent.length,
  };
}

export type PushResult = {
  ok: boolean;
  /** ใบที่ "เพิ่งเข้า ledger รอบนี้จริง" (แถวใหม่) — กดซ้ำรอบสองจะเป็น 0 */
  inserted: number;
  alreadySent: number;
  pendingReviewSkipped: number;
  /** ใบยอด ฿0 หรือติดลบที่ข้ามไว้ (ledger ไม่รับ · ถ้าปล่อยเข้าไปจะทำให้ทั้งชุดล้ม) */
  zeroSkipped: number;
  error?: string;
};

/** ส่งยอดฝากทั้งหมดของสาขา (approvalStatus NONE/APPROVED เท่านั้น — ข้าม PENDING/REJECTED)
 *  เข้า ledger_revenue_entry · กดซ้ำได้ไม่จำกัด — source_ref ผูกกับ depositId เสมอ ทำให้
 *  ON CONFLICT กันซ้ำอัตโนมัติในระดับฐานข้อมูล (แถวที่จับคู่ statement แล้วจะไม่ถูกแตะ)
 *
 *  🔒 ทั้งชุดอยู่ใน $transaction เดียว = "สำเร็จทั้งหมด หรือไม่เข้าเลย".
 *     เดิมเป็น loop ธรรมดา: ถ้าใบที่ 5 จาก 10 ล้ม (เช่น ยอด ฿0 ที่ ledger ปฏิเสธ) ใบ 1-4
 *     ถูกเขียนค้างไว้แล้ว แต่ผู้ใช้เห็นแค่ "ส่งไม่สำเร็จ" ลอย ๆ → เงินครึ่งหนึ่งเข้าบัญชีกระทบยอด
 *     อีกครึ่งไม่เข้า โดยไม่มีใครรู้ว่าครึ่งไหน. */
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
    return { ok: false, inserted: 0, alreadySent: 0, pendingReviewSkipped: 0, zeroSkipped: 0, error: "ไม่พบสาขา" };
  }
  if (!config?.companyId || !config?.bankAccountId) {
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
      pendingReviewSkipped: 0,
      zeroSkipped: 0,
      error: "ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคารของสาขานี้ — ตั้งค่าก่อนแล้วค่อยส่ง",
    };
  }

  const [allDeposits, pendingReviewSkipped] = await Promise.all([
    prisma.cfCashDeposit.findMany({
      where: { orgId, branchId, approvalStatus: { in: ["NONE", "APPROVED"] } },
      select: { id: true, amountCents: true, depositedAt: true, depositedByName: true },
    }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "PENDING" } }),
  ]);

  // ใบยอด ฿0/ติดลบ: recordCashDeposit กันไว้ที่ต้นทางแล้ว (amountCents ต้อง > 0) แต่ยังกันไว้อีกชั้น
  // เผื่อข้อมูลเก่า/นำเข้าทางอื่น — ledger มี CHECK (amount_satang > 0) ถ้าหลุดเข้าไปจะทำให้
  // ทั้งทรานแซกชันล้มและไม่มีใบไหนเข้าเลย. ข้ามเฉพาะใบเสีย ดีกว่าพาทั้งสาขาตกรถ.
  const deposits = allDeposits.filter((d) => d.amountCents > 0);
  const zeroSkipped = allDeposits.length - deposits.length;

  if (deposits.length === 0) {
    return { ok: true, inserted: 0, alreadySent: 0, pendingReviewSkipped, zeroSkipped };
  }

  let inserted = 0;
  try {
    // 🔒 all-or-nothing: ใบใดใบหนึ่งล้ม → rollback ทั้งชุด ไม่มีเงินค้างเขียนครึ่งทาง
    await prisma.$transaction(async (tx) => {
      let insertedInTx = 0;
      for (const d of deposits) {
        const sourceRef = depositSourceRef(d.id);
        const description = `ClawFleet ฝากเงิน · ${branch.name} · ${d.depositedByName}`;
        // amount_satang: ledger เก็บหน่วยสตางค์ · CfCashDeposit.amountCents เก็บหน่วย
        // สตางค์อยู่แล้ว (ชื่อ "Cents" ในโค้ดนี้ = สตางค์ ไม่ใช่บาทเต็มแบบ ChairOps) → ส่งตรงไม่คูณ
        //
        // 🕐 entry_date = "วันตามปฏิทินไทย" ไม่ใช่ UTC ดิบ.
        //   depositedAt เก็บเป็น instant (เที่ยงคืนไทย = 17:00Z ของ "เมื่อวาน") → โค้ดเดิมที่ cast
        //   เป็น ::date ตรง ๆ อ่านวันจากตัวอักษรนำหน้าของ ISO string (session TimeZone = UTC)
        //   → ได้วันก่อนหน้า 1 วันเสมอ. ยืนยันกับ DB จริง (read-only): ผู้ใช้เลือก 20 ก.ย.
        //   → เขียน 19 ก.ย. · เลือก 1 ก.ย. → เขียน 31 ส.ค.
        //   ผลจริงที่เจ็บ: ยอดที่ฝากวันที่ 1 ของเดือนตกไปอยู่เดือนก่อน แล้วหายจากหน้ากระทบยอด
        //   ธนาคาร (lib/ledger/bank-reconcile-board.ts:89 กรองเป็นรายเดือนปฏิทิน).
        //   แก้ตาม convention เดิมของเรโป (lib/clawfleet/matrix-queries.ts:160,
        //   lib/ledger/recon-controls.ts:136): แปลงเป็นเวลาไทยก่อน แล้วค่อยตัดเป็นวัน.
        //   ต้องใส่ ::timestamptz ให้ชัด เพราะ Prisma ส่งพารามิเตอร์แบบไม่ระบุชนิด (untyped)
        //   ให้ Postgres เดาจากบริบท — ไม่ใส่แล้ว AT TIME ZONE จะตีความผิดทิศ.
        //
        // (xmax = 0) = "แถวนี้เพิ่งถูก INSERT จริง" · ไม่ใช่ 0 = ไปโดน DO UPDATE (เคยส่งแล้ว).
        //   สำนวนมาตรฐานของ Postgres สำหรับแยก insert ออกจาก upsert-update — ทำให้เลข
        //   "ส่งแล้ว N ใบ" ที่เด้งให้ผู้ใช้ดูเป็นความจริง: กดซ้ำรอบสองต้องได้ 0 ไม่ใช่ N เท่าเดิม.
        const res = await tx.$queryRaw<{ id: string; is_new: boolean }[]>`
          INSERT INTO ledger_revenue_entry
            (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
             description, customer_name, payment_channel, channel_code, match_state,
             expected_bank_account_id)
          VALUES (
            ${orgId}::uuid, ${config.companyId}::uuid,
            ((${d.depositedAt}::timestamptz) AT TIME ZONE 'Asia/Bangkok')::date,
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
          RETURNING id, (xmax = 0) AS is_new`;
        if (res.length && res[0]?.is_new) insertedInTx++;
      }
      inserted = insertedInTx;
    });
  } catch (e) {
    // rollback แล้ว — ไม่มีแถวไหนเข้า ledger เลย จึงรายงาน inserted = 0 ให้ตรงความจริง
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
      pendingReviewSkipped,
      zeroSkipped,
      error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ",
    };
  }

  return {
    ok: true,
    inserted,
    alreadySent: deposits.length - inserted,
    pendingReviewSkipped,
    zeroSkipped,
  };
}
