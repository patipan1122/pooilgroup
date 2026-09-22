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

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * CEO 2026-09-22 — เปลี่ยนจาก "กั้นเงิน" เป็น "ปล่อยเงินไหล แล้วติดสีให้เห็น":
 *   "ยอดไหน กรอกมา ฝากมา ขึ้นเลย ขึ้นโชว์มาเลย อาจจะติดสีที่ตัวเลข เพื่อโชว์ความผิดปกติเฉย ๆ
 *    แล้วกดที่ตรงนั้นให้แอดมินยืนยันตรวจสอบได้"
 *
 * เดิม (preventive): ใบยอดไม่ตรง/AI ติดธง → approvalStatus=PENDING → **ไม่ถูกส่งเข้า ledger เลย**
 *   จนกว่าจะมีคนที่ 2 อนุมัติ. สาขาที่มีพนักงานคนเดียวจึงไม่มีใครอนุมัติได้ → เงินค้างเงียบ
 *   ไม่เข้าบัญชีกระทบยอดตลอดไป และ **ไม่มีใครเห็นด้วยซ้ำว่ามีใบนี้อยู่**.
 * ตอนนี้ (detective): ทุกใบที่บันทึกฝากแล้วไหลเข้า ledger หมด (ยกเว้นใบที่ถูก "ตีกลับ" =
 *   โมฆะจริง ๆ) · ความผิดปกติยังถูกคำนวณ + บันทึกครบเหมือนเดิมทุกประการ (status SHORT/OVER,
 *   varianceCents, ocrFlagReason) แล้วโชว์เป็น "สีบนตัวเลข" ให้แอดมินกดตรวจทีหลัง.
 *   → ตรวจจับโกงได้ **ดีกว่าเดิม** เพราะของเดิมใบผิดปกติหายเงียบไม่เข้าบัญชี ไม่มีใครเห็น.
 */
const LEDGER_ELIGIBLE_APPROVAL = ["NONE", "APPROVED", "PENDING"] as const;

export type BranchReconcileSummary = {
  configured: boolean;
  companyId: string | null;
  bankAccountId: string | null;
  readyCount: number;
  readyAmountBaht: number;
  /** ใบติดธง (ยอดไม่ตรง/AI สงสัย) ที่ยังไม่มีใครกด "ตรวจแล้ว" — **รวมอยู่ใน readyCount แล้ว**
   *  (ไม่ได้กันออกอีกต่อไป · เป็นแค่ตัวเลขเตือนให้ไปกดตรวจที่หน้าฝากเงิน) */
  pendingReviewCount: number;
  /** ใบที่ถูกตีกลับ = โมฆะ · รอบถูกคืนไปฝากใหม่ → ไม่ส่งเข้า ledger (กันนับเงินซ้ำ) */
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
    // PENDING (ติดธง) รวมอยู่ด้วยแล้ว — เงินไหล ไม่ถูกกั้น (ดู LEDGER_ELIGIBLE_APPROVAL)
    prisma.cfCashDeposit.findMany({
      where: { orgId, branchId, approvalStatus: { in: [...LEDGER_ELIGIBLE_APPROVAL] } },
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
  /** ใบติดธงที่ **ส่งเข้าไปด้วย** (ไม่ได้ข้ามแล้ว) — บอกให้ไปกดตรวจที่หน้าฝากเงิน */
  flaggedIncluded: number;
  /** ใบยอด ฿0 หรือติดลบที่ข้ามไว้ (ledger ไม่รับ · ถ้าปล่อยเข้าไปจะทำให้ทั้งชุดล้ม) */
  zeroSkipped: number;
  error?: string;
};

/** ส่งยอดฝากของสาขาเข้า ledger_revenue_entry — **รวมใบติดธง (PENDING) ด้วย**
 *  ข้ามเฉพาะใบที่ถูก "ตีกลับ" (REJECTED = โมฆะ · รอบถูกคืนไปฝากใหม่แล้ว ถ้าส่งเข้าไปจะนับเงินซ้ำ).
 *  กดซ้ำได้ไม่จำกัด — source_ref ผูกกับ depositId เสมอ ทำให้ ON CONFLICT กันซ้ำอัตโนมัติ
 *  ในระดับฐานข้อมูล (แถวที่จับคู่ statement แล้วจะไม่ถูกแตะ)
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
    return { ok: false, inserted: 0, alreadySent: 0, flaggedIncluded: 0, zeroSkipped: 0, error: "ไม่พบสาขา" };
  }
  if (!config?.companyId || !config?.bankAccountId) {
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
      flaggedIncluded: 0,
      zeroSkipped: 0,
      error: "ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคารของสาขานี้ — ตั้งค่าก่อนแล้วค่อยส่ง",
    };
  }

  const [allDeposits, flaggedIncluded] = await Promise.all([
    // รวม PENDING (ติดธง) — เงินไหลก่อน ตรวจทีหลัง (ดู LEDGER_ELIGIBLE_APPROVAL)
    prisma.cfCashDeposit.findMany({
      where: { orgId, branchId, approvalStatus: { in: [...LEDGER_ELIGIBLE_APPROVAL] } },
      select: { id: true, amountCents: true, depositedAt: true, depositedByName: true },
    }),
    prisma.cfCashDeposit.count({ where: { orgId, branchId, approvalStatus: "PENDING" } }),
  ]);

  // ใบยอด ฿0/ติดลบ: recordCashDeposit กันไว้ที่ต้นทางแล้ว (amountCents ต้อง > 0) แต่ยังกันไว้อีกชั้น
  // เผื่อข้อมูลเก่า/นำเข้าทางอื่น — ledger มี CHECK (amount_satang > 0) ถ้าหลุดเข้าไปจะทำให้
  // ทั้งทรานแซกชันล้มและไม่มีใบไหนเข้าเลย. ข้ามเฉพาะใบเสีย ดีกว่าพาทั้งสาขาตกรถ.
  const positive = allDeposits.filter((d) => d.amountCents > 0);
  const zeroSkipped = allDeposits.length - positive.length;

  if (positive.length === 0) {
    return { ok: true, inserted: 0, alreadySent: 0, flaggedIncluded, zeroSkipped };
  }

  // ⏱️ ส่งเฉพาะใบที่ "ยังไม่เคยเข้า ledger" — ก่อนหน้านี้ upsert ใบเก่าซ้ำทุกใบที่สาขาเคยฝาก
  //   ทุกครั้งที่กดส่ง. หนึ่ง round-trip ต่อใบในทรานเดียว แปลว่าเวลาที่ใช้โตไปเรื่อย ๆ ตามอายุสาขา
  //   → ฝากวันละใบราว ๆ 1 ปี ทรานจะยาวเกิน timeout แล้ว **ส่งไม่ได้อีกเลยตลอดไป** (all-or-nothing:
  //   ใบใหม่ตกรถไปพร้อมใบเก่าทั้งหมด). loadSentDepositIds มีอยู่แล้วและ getBranchReconcileSummary
  //   ใช้นับ "พร้อมส่ง N ใบ" อยู่แล้ว — push แค่ไม่เคยเรียกมัน.
  //   graceful: query ล้ม → Set ว่าง → พฤติกรรมเท่าเดิม (ON CONFLICT ที่ระดับ DB ยังกันซ้ำให้อยู่).
  const sentBefore = await loadSentDepositIds(
    orgId,
    config.companyId,
    positive.map((d) => d.id),
  );
  const deposits = positive.filter((d) => !sentBefore.has(d.id));
  const alreadySentBefore = positive.length - deposits.length;

  if (deposits.length === 0) {
    return { ok: true, inserted: 0, alreadySent: alreadySentBefore, flaggedIncluded, zeroSkipped };
  }

  let inserted = 0;
  let attempted = deposits.length; // ใบที่ยังส่งได้จริงตอนเขียน (หักใบที่เพิ่งถูกตีกลับระหว่างทาง)
  try {
    // 🔒 all-or-nothing: ใบใดใบหนึ่งล้ม → rollback ทั้งชุด ไม่มีเงินค้างเขียนครึ่งทาง
    // ⏱️ timeout 30 วิ (ค่าเริ่มต้นของ Prisma คือ 5 วิ และ lib/prisma.ts ไม่ได้ตั้งค่าไว้) —
    //    สาขาที่ฝากค้างหลายสิบใบในรอบแรกจะเขียนไม่ทัน 5 วิแล้วล้มทั้งชุดโดยไม่มีใครเข้าใจว่าทำไม
    await prisma.$transaction(async (tx) => {
      // 🔒 กัน race "ส่งเข้า ledger" ชนกับ "ตีกลับ" —
      //   ก่อนหน้านี้ 2 งานนี้แตะคนละกลุ่มเสมอ (ส่งเฉพาะ NONE/APPROVED · ตีกลับได้เฉพาะ PENDING)
      //   พอ PENDING ไหลเข้า ledger ได้แล้ว ทั้งสองงานแย่งใบเดียวกัน: ถ้าอ่านรายการ (นอกทราน)
      //   ตอนที่ใบยัง PENDING แล้วอีกคนกดตีกลับสำเร็จก่อนเราเขียน → เราจะเขียนแถวให้ใบที่ถูก
      //   ตีกลับไปแล้ว (รอบถูกปลดไปฝากใหม่) = เงินก้อนเดียวถูกนับ 2 แถวในภายหลัง.
      //   อ่านซ้ำในทราน + FOR UPDATE → ถ้าอีกฝั่งกำลังตีกลับอยู่ เราจะรอจนเขา commit แล้วเห็น
      //   REJECTED จริง ๆ แล้วข้ามใบนั้นไป. (ลำดับล็อก cf_cash_deposits → ledger_revenue_entry
      //   ตรงกับฝั่งตีกลับเป๊ะ จึงไม่เกิด deadlock.)
      const ids = deposits.map((d) => d.id);
      const live = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id
          FROM cf_cash_deposits
         WHERE org_id = ${orgId}::uuid
           AND id = ANY(${ids}::uuid[])
           AND approval_status <> 'REJECTED'
         FOR UPDATE`;
      const stillEligible = new Set(live.map((r) => r.id));
      attempted = deposits.filter((d) => stillEligible.has(d.id)).length;

      let insertedInTx = 0;
      for (const d of deposits) {
        if (!stillEligible.has(d.id)) continue; // เพิ่งถูกตีกลับระหว่างทาง — ห้ามส่ง
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
    }, { timeout: 30_000 });
  } catch (e) {
    // rollback แล้ว — ไม่มีแถวไหนเข้า ledger เลย จึงรายงาน inserted = 0 ให้ตรงความจริง
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
      flaggedIncluded,
      zeroSkipped,
      error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ",
    };
  }

  return {
    ok: true,
    inserted,
    // "ส่งไปแล้วก่อนหน้านี้" = ใบที่กรองออกตั้งแต่ต้นเพราะมีแถวใน ledger อยู่แล้ว
    // + ใบที่พยายามเขียนจริงแต่ไม่เกิดแถวใหม่ (ON CONFLICT ไปโดน DO UPDATE ระหว่างทาง)
    // ไม่ใช่ deposits.length − inserted ซึ่งจะนับใบที่เพิ่งถูกตีกลับระหว่างทางเข้ามาผิด ๆ
    alreadySent: alreadySentBefore + (attempted - inserted),
    flaggedIncluded,
    zeroSkipped,
  };
}

// =============================================================
// ถอนใบฝากออกจาก ledger — ใช้ตอน "ตีกลับ" (REJECTED) เท่านั้น
// =============================================================
/**
 * ⚠️ ช่องโหว่ที่ "เปิดขึ้นใหม่" เพราะเปลี่ยนมาปล่อยเงินไหลก่อนตรวจ — ต้องปิดพร้อมกัน:
 *
 *   เดิม ใบ PENDING ไม่เคยเข้า ledger → ตีกลับได้อย่างปลอดภัย (ไม่มีอะไรให้ถอน).
 *   ตอนนี้ ใบ PENDING เข้า ledger แล้ว → ถ้าตีกลับแล้วปล่อยแถวใน ledger ค้างไว้:
 *     ตีกลับ → รอบถูกคืน (depositId=null) → พนักงานฝากใหม่เป็นใบใหม่ → กดส่งอีกครั้ง
 *     → **เงินก้อนเดียวกันอยู่ในบัญชีกระทบยอด 2 แถว** (ยอดรายได้บวมปลอม).
 *   จึงต้องถอนแถวเดิมออกในทรานเดียวกับการตีกลับเสมอ.
 *
 * กันพลาด: ถ้าแถวนั้น "จับคู่กับ statement ธนาคารแล้ว" = ธนาคารยืนยันแล้วว่าเงินเข้าจริง →
 *   **ห้ามถอน/ห้ามตีกลับ** (คืนค่า false) ให้ไปแก้ที่หน้ากระทบยอดก่อน. ไม่มี FK ใดชี้มาที่
 *   ledger_revenue_entry เลย (ยืนยันกับ DB จริง: pg_constraint contype='f' → 0 แถว) → ลบไปเฉย ๆ
 *   จะเหลือรายการจับคู่ลอยชี้แถวที่ไม่มีอยู่ โดย DB ไม่ร้องอะไรเลย.
 *
 * "จับคู่แล้ว" มี **3 รูปแบบ** ใน LedgerLine — ต้องเช็คให้ครบทั้งสาม (เดิมเช็คแค่สองแบบแรก):
 *   1. r.match_state <> 'unmatched'  — เขียนตอน confirm (bank-recon/_actions.ts:947)
 *   2. ledger_bank_match_item        — การจับคู่แบบ "กลุ่ม" (หลายรายการ ↔ หลายแถว)
 *   3. ledger_bank_match             — การจับคู่ 1:1 แบบเก่า ที่ยัง "แค่เสนอ" (status='suggested')
 *      ⚠️ ช่องที่หลุด: suggestMatchesAction ยิงอัตโนมัติหลังนำเข้า statement ทุกครั้ง
 *      (bank-recon/_actions.ts:817) แล้วเขียน ledger_bank_match(matched_revenue_id,'suggested')
 *      + อัปเดตแค่ ledger_bank_txn.match_state — **ไม่แตะ ledger_revenue_entry.match_state
 *      และไม่สร้าง match item** → ช่วงระหว่าง "นำเข้า statement" ถึง "กดยืนยันจับคู่" แถวของเรา
 *      อยู่ระหว่างกระทบยอดอยู่แท้ ๆ แต่มองไม่เห็นจากเงื่อนไข 1 และ 2 เลย.
 *      ยืนยันกับ DB จริง: CHECK chk_status = ('suggested','confirmed','reversed') และมี partial
 *      unique index ledger_bank_match_revenue_active_uidx บน matched_revenue_id เฉพาะสองสถานะแรก.
 *
 * 🔒 กัน race "ตีกลับ" ชนกับ "กดยืนยันจับคู่" — จุดที่เงินถูกนับซ้ำได้จริง:
 *   ของเดิมอ่านสถานะ แล้วค่อย DELETE ... AND match_state='unmatched' แต่ **ทิ้งจำนวนแถวที่ลบได้**
 *   แล้ว return true เสมอ. ถ้ามีคนกดยืนยันจับคู่คั่นกลางระหว่างสองคำสั่งนั้น: DELETE ลบได้ 0 แถว
 *   (แถวกลายเป็น matched ไปแล้ว) แต่เราคืน true → ตีกลับสำเร็จ → รอบถูกคืนไปฝากใหม่ → ส่งเข้า
 *   ledger อีกครั้งเป็นแถวใหม่ → **เงินก้อนเดียวมี 2 แถวในบัญชีกระทบยอด แถวเก่ายังผูกกับ statement อยู่ด้วย**.
 *   ตอนนี้: ล็อกแถวด้วย FOR UPDATE ก่อน (บล็อกจนคนที่กำลังยืนยันจับคู่ commit เสร็จ) แล้ว DELETE
 *   โดยยัดเงื่อนไข "ยังไม่จับคู่" ทั้งสามแบบไว้ในคำสั่งลบเอง และ **เทียบจำนวนแถวที่ลบได้จริง**
 *   ลบไม่ครบ = มีอะไรมาจับคู่ไปแล้ว → คืน false → ทั้งทรานของการตีกลับถูก rollback.
 *   (ลำดับล็อก cf_cash_deposits → ledger_revenue_entry ตรงกับฝั่ง push เป๊ะ จึงไม่เกิด deadlock.)
 *
 * คืน true = ถอนเรียบร้อย/ไม่มีอะไรต้องถอน · false = ถอนไม่ได้เพราะกระทบยอดไปแล้ว.
 */
export async function retractDepositFromLedger(
  tx: Prisma.TransactionClient,
  orgId: string,
  depositId: string,
): Promise<boolean> {
  const sourceRef = depositSourceRef(depositId);

  // 1) ล็อกแถวของใบฝากนี้ก่อน — ถ้ามีใครกำลังยืนยันจับคู่อยู่ คำสั่งนี้จะรอจนเขา commit
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id::text AS id
      FROM ledger_revenue_entry r
     WHERE r.org_id = ${orgId}::uuid
       AND r.source_type = 'CLAWFLEET'
       AND r.source_ref = ${sourceRef}
     FOR UPDATE`;

  if (locked.length === 0) return true; // ยังไม่เคยส่งเข้า ledger — ตีกลับได้เลย

  // 2) ลบเฉพาะแถวที่ "ยังไม่ถูกจับคู่" ครบทั้งสามแบบ ณ วินาทีที่ลบจริง (ไม่ใช่ตอนที่อ่านมาก่อนหน้า)
  const deleted = await tx.$executeRaw`
    DELETE FROM ledger_revenue_entry AS r
     WHERE r.org_id = ${orgId}::uuid
       AND r.source_type = 'CLAWFLEET'
       AND r.source_ref = ${sourceRef}
       AND r.match_state = 'unmatched'
       AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi
                        WHERE mi.book_type = 'revenue' AND mi.book_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM ledger_bank_match m
                        WHERE m.matched_revenue_id = r.id
                          AND m.status IN ('suggested', 'confirmed'))`;

  // ลบไม่ครบทุกแถวที่ล็อกไว้ = มีแถวที่กระทบยอดไปแล้ว → ตีกลับไม่ได้ (ทรานข้างนอกจะ rollback)
  return deleted === locked.length;
}
