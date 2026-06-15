"use server";

// LedgerLine — Bank movement actions (PEAK "ทำรายการ" menu per movement).
//   • โอนเงิน        — โยกเงินบัญชีนี้ → อีกบัญชี (internal transfer, ออกจากการกระทบยอด)
//   • บันทึกรายได้    — credit → สร้าง revenue entry + กระทบยอดทันที
//   • บันทึกค่าใช้จ่าย — debit → สร้าง expense + กระทบยอดทันที
//   • แก้ไข / ลบ      — รายการที่เพิ่มเอง
//
// Separate file from _actions.ts (avoids clashing with the parallel TRCloud work).
// Every export is an async function (use-server rule). Self-scopes org_id (Prisma bypasses RLS).

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

// ── helper: load a bank txn (org-scoped, not locked, unmatched) ────────────────
async function loadTxn(orgId: string, bankTxnId: string) {
  const rows = await prisma.$queryRaw<{
    amountSatang: number; companyId: string; bankAccountId: string;
    locked: boolean; state: string; sourceType: string;
  }[]>`
    SELECT t.amount_satang as "amountSatang", t.company_id as "companyId",
           t.bank_account_id as "bankAccountId", (b.locked_at IS NOT NULL) as locked,
           t.match_state as "state", t.source_type as "sourceType"
    FROM ledger_bank_txn t JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE t.id = ${bankTxnId}::uuid AND t.org_id = ${orgId}::uuid LIMIT 1`;
  return rows[0] ?? null;
}

// ── helper: create a CONFIRMED group linking one bank txn to (optional) one book entry ──
async function confirmedLink(params: {
  orgId: string; companyId: string; bankAccountId: string; bankTxnId: string;
  bankAmountSatang: number; userId: string;
  book?: { type: "revenue" | "expense"; id: string; amountSatang: number; docNo: string };
  note: string; bankState: "confirmed" | "excluded";
}) {
  const { orgId, companyId, bankAccountId, bankTxnId, bankAmountSatang, userId, book, note, bankState } = params;
  const groupId = randomUUID();
  const bookTotal = book ? book.amountSatang : 0;
  const delta = bankAmountSatang - bookTotal;
  const ops = [
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match_group
        (id, org_id, company_id, bank_account_id, status, match_kind,
         bank_total_satang, book_total_satang, delta_satang, note, created_by, confirmed_by, confirmed_at)
      VALUES (${groupId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankAccountId}::uuid,
        'confirmed', 'manual', ${bankAmountSatang}, ${bookTotal}, ${delta}, ${note},
        ${userId}::uuid, ${userId}::uuid, now())`,
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match_item (id, group_id, org_id, kind, bank_txn_id, amount_satang)
      VALUES (gen_random_uuid(), ${groupId}::uuid, ${orgId}::uuid, 'bank', ${bankTxnId}::uuid, ${bankAmountSatang})`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state=${bankState} WHERE id=${bankTxnId}::uuid AND org_id=${orgId}::uuid`,
  ];
  if (book) {
    ops.push(prisma.$executeRaw`
      INSERT INTO ledger_bank_match_item (id, group_id, org_id, kind, book_type, book_id, book_doc_no, amount_satang)
      VALUES (gen_random_uuid(), ${groupId}::uuid, ${orgId}::uuid, 'book', ${book.type}, ${book.id}::uuid, ${book.docNo}, ${book.amountSatang})`);
    if (book.type === "revenue") {
      ops.push(prisma.$executeRaw`
        UPDATE ledger_revenue_entry SET match_state='matched', bank_txn_id=${bankTxnId}::uuid, updated_at=now()
        WHERE id=${book.id}::uuid AND org_id=${orgId}::uuid`);
    }
  }
  await prisma.$transaction(ops);
}

// ── list other accounts for the transfer target dropdown ──────────────────────
export async function listTransferTargetsAction(
  companyId: string, excludeAccountId: string,
): Promise<{ id: string; bankCode: string; accountNo: string; accountName: string }[]> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const rows = await prisma.$queryRaw<{ id: string; bankCode: string; accountNo: string; accountName: string }[]>`
    SELECT a.id::text, a.bank_code as "bankCode", a.account_no as "accountNo", a.account_name as "accountName"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.org_id=${orgId}::uuid AND ac.company_id=${companyId}::uuid AND a.is_active=true
      AND a.id <> ${excludeAccountId}::uuid
    ORDER BY a.bank_code, a.account_no`;
  return rows;
}

// ── โอนเงิน: mark movement as internal transfer to another account ─────────────
export async function transferMovementAction(params: {
  bankTxnId: string; targetAccountId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const txn = await loadTxn(orgId, params.bankTxnId);
  if (!txn) return { ok: false, error: "ไม่พบรายการ" };
  if (txn.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  if (txn.state !== "unmatched") return { ok: false, error: "รายการนี้จัดการไปแล้ว" };

  const target = await prisma.$queryRaw<{ name: string; no: string; code: string }[]>`
    SELECT account_name as name, account_no as no, bank_code as code FROM ledger_bank_account
    WHERE id=${params.targetAccountId}::uuid AND org_id=${orgId}::uuid LIMIT 1`;
  if (!target.length) return { ok: false, error: "ไม่พบบัญชีปลายทาง" };
  const dir = txn.amountSatang < 0 ? "โอนไป" : "รับโอนจาก";
  const note = `${dir} ${target[0].code} …${target[0].no.slice(-4)} (${target[0].name})`;

  await confirmedLink({
    orgId, companyId: txn.companyId, bankAccountId: txn.bankAccountId, bankTxnId: params.bankTxnId,
    bankAmountSatang: txn.amountSatang, userId: session.user.id, note, bankState: "excluded",
  });
  return { ok: true };
}

// ── บันทึกรายได้จากรายการ (credit) ────────────────────────────────────────────
export async function createRevenueFromMovementAction(params: {
  bankTxnId: string; description?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const txn = await loadTxn(orgId, params.bankTxnId);
  if (!txn) return { ok: false, error: "ไม่พบรายการ" };
  if (txn.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  if (txn.state !== "unmatched") return { ok: false, error: "รายการนี้จัดการไปแล้ว" };
  if (txn.amountSatang <= 0) return { ok: false, error: "รายการเงินออก ใช้บันทึกค่าใช้จ่ายแทน" };

  const meta = await prisma.$queryRaw<{ d: string; desc: string }[]>`
    SELECT txn_date::text as d, COALESCE(NULLIF(ref2,''), NULLIF(description,''),'รายได้') as desc
    FROM ledger_bank_txn WHERE id=${params.bankTxnId}::uuid LIMIT 1`;
  const revId = randomUUID();
  const desc = params.description?.trim() || meta[0]?.desc || "รายได้";
  await prisma.$executeRaw`
    INSERT INTO ledger_revenue_entry
      (id, org_id, company_id, entry_date, amount_satang, source_type, description)
    VALUES (${revId}::uuid, ${orgId}::uuid, ${txn.companyId}::uuid, ${meta[0].d}::date,
      ${txn.amountSatang}, 'MANUAL', ${desc})`;
  await confirmedLink({
    orgId, companyId: txn.companyId, bankAccountId: txn.bankAccountId, bankTxnId: params.bankTxnId,
    bankAmountSatang: txn.amountSatang, userId: session.user.id,
    book: { type: "revenue", id: revId, amountSatang: txn.amountSatang, docNo: desc.slice(0, 80) },
    note: "บันทึกรายได้จากรายการธนาคาร", bankState: "confirmed",
  });
  return { ok: true };
}

// ── บันทึกค่าใช้จ่ายจากรายการ (debit) ─────────────────────────────────────────
export async function createExpenseFromMovementAction(params: {
  bankTxnId: string; vendor?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const txn = await loadTxn(orgId, params.bankTxnId);
  if (!txn) return { ok: false, error: "ไม่พบรายการ" };
  if (txn.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  if (txn.state !== "unmatched") return { ok: false, error: "รายการนี้จัดการไปแล้ว" };
  if (txn.amountSatang >= 0) return { ok: false, error: "รายการเงินเข้า ใช้บันทึกรายได้แทน" };

  const meta = await prisma.$queryRaw<{ d: string; vendor: string }[]>`
    SELECT txn_date::text as d, COALESCE(NULLIF(ref2,''), NULLIF(description,''),'ค่าใช้จ่าย') as vendor
    FROM ledger_bank_txn WHERE id=${params.bankTxnId}::uuid LIMIT 1`;
  const absSatang = Math.abs(txn.amountSatang);
  const expId = randomUUID();
  const docCode = `EXP-BANK-${Date.now().toString().slice(-8)}`;
  const vendor = params.vendor?.trim() || meta[0]?.vendor || "ค่าใช้จ่าย";
  await prisma.$executeRaw`
    INSERT INTO ledger_expense
      (id, org_id, company_id, doc_code, doc_type, doc_date, vendor, total, payment_status, status)
    VALUES (${expId}::uuid, ${orgId}::uuid, ${txn.companyId}::uuid, ${docCode}, 'other',
      ${meta[0].d}::date, ${vendor}, ${absSatang / 100}, 'paid', 'confirmed')`;
  await confirmedLink({
    orgId, companyId: txn.companyId, bankAccountId: txn.bankAccountId, bankTxnId: params.bankTxnId,
    bankAmountSatang: txn.amountSatang, userId: session.user.id,
    book: { type: "expense", id: expId, amountSatang: -absSatang, docNo: docCode },
    note: "บันทึกค่าใช้จ่ายจากรายการธนาคาร", bankState: "confirmed",
  });
  return { ok: true };
}

// ── แก้ไข / ลบ รายการที่เพิ่มเอง ──────────────────────────────────────────────
export async function editMovementAction(params: {
  bankTxnId: string; date: string; amountSatang: number; description: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  if (!Number.isInteger(params.amountSatang) || params.amountSatang === 0) return { ok: false, error: "จำนวนเงินไม่ถูกต้อง" };
  const txn = await loadTxn(orgId, params.bankTxnId);
  if (!txn) return { ok: false, error: "ไม่พบรายการ" };
  if (txn.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  if (txn.sourceType !== "MANUAL_BAAC") return { ok: false, error: "แก้ไขได้เฉพาะรายการที่เพิ่มเอง" };
  if (txn.state !== "unmatched") return { ok: false, error: "รายการนี้จัดการไปแล้ว" };

  await prisma.$executeRaw`
    UPDATE ledger_bank_txn SET txn_date=${params.date}::date, amount_satang=${params.amountSatang},
      description=${params.description || "เพิ่มเอง"}
    WHERE id=${params.bankTxnId}::uuid AND org_id=${orgId}::uuid`;
  return { ok: true };
}

export async function deleteMovementAction(bankTxnId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const txn = await loadTxn(orgId, bankTxnId);
  if (!txn) return { ok: false, error: "ไม่พบรายการ" };
  if (txn.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  if (txn.sourceType !== "MANUAL_BAAC") return { ok: false, error: "ลบได้เฉพาะรายการที่เพิ่มเอง (statement ลบไม่ได้)" };
  if (txn.state !== "unmatched") return { ok: false, error: "ต้องนำออกจากการกระทบยอดก่อนลบ" };

  await prisma.$executeRaw`DELETE FROM ledger_bank_txn WHERE id=${bankTxnId}::uuid AND org_id=${orgId}::uuid`;
  return { ok: true };
}

// ── ล้างรายการซ้ำ (double-import) — super_admin · CEO กดยืนยันก่อนลบ ─────────────
// ซ้ำ = (วันที่ + ยอด + ref1 + ref2) เหมือนกัน. ลบเฉพาะ "ใบเกิน" ที่:
//   match_state='unmatched' + ไม่อยู่ในคู่ที่จับแล้ว + งวดไม่ล็อก. เก็บ 1 ใบ (เลือกใบที่จับแล้ว/แรกสุด).
// แตะเฉพาะบัญชี+org นี้.
async function duplicateExtraIds(orgId: string, bankAccountId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT z.id FROM (
      SELECT t.id::text AS id, t.match_state AS state, t.batch_id,
             ROW_NUMBER() OVER (
               PARTITION BY t.txn_date, t.amount_satang, COALESCE(t.ref1,''), COALESCE(t.ref2,'')
               ORDER BY (t.match_state <> 'unmatched') DESC, t.row_index, t.id
             ) AS rn
      FROM ledger_bank_txn t
      WHERE t.bank_account_id = ${bankAccountId}::uuid AND t.org_id = ${orgId}::uuid
    ) z
    JOIN ledger_bank_import_batch b ON b.id = z.batch_id
    WHERE z.rn > 1 AND z.state = 'unmatched' AND b.locked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.bank_txn_id = z.id::uuid)`;
  return rows.map((r) => r.id);
}

/** ตรวจรายการซ้ำ (พรีวิวก่อนลบ) — คืนจำนวนใบเกิน + ตัวอย่างกลุ่มซ้ำ */
export async function findBankDuplicatesAction(bankAccountId: string): Promise<{
  ok: boolean; extraCount: number;
  sample: { date: string; amountSatang: number; ref: string; copies: number }[];
  error?: string;
}> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  try {
    const ids = await duplicateExtraIds(orgId, bankAccountId);
    const sample = await prisma.$queryRaw<{ date: string; amt: number; ref: string; copies: number }[]>`
      SELECT t.txn_date::text AS "date", t.amount_satang::int AS amt,
             MAX(COALESCE(NULLIF(t.ref2,''), NULLIF(t.ref1,''), '')) AS ref, COUNT(*)::int AS copies
      FROM ledger_bank_txn t
      WHERE t.bank_account_id = ${bankAccountId}::uuid AND t.org_id = ${orgId}::uuid
        AND t.match_state = 'unmatched'
      GROUP BY t.txn_date, t.amount_satang, COALESCE(t.ref1,''), COALESCE(t.ref2,'')
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, t.txn_date DESC
      LIMIT 20`;
    return {
      ok: true,
      extraCount: ids.length,
      sample: sample.map((s) => ({ date: s.date, amountSatang: Number(s.amt), ref: s.ref, copies: Number(s.copies) })),
    };
  } catch (e) {
    return { ok: false, extraCount: 0, sample: [], error: e instanceof Error ? e.message : "ตรวจไม่สำเร็จ" };
  }
}

/** ลบรายการซ้ำจริง — เก็บ 1 ใบ/กลุ่ม · ลบเฉพาะใบเกินที่ยังไม่แมตช์+ไม่ล็อก */
export async function purgeBankDuplicatesAction(bankAccountId: string): Promise<{
  ok: boolean; deleted: number; error?: string;
}> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  try {
    const ids = await duplicateExtraIds(orgId, bankAccountId);
    if (ids.length === 0) return { ok: true, deleted: 0 };
    await prisma.$executeRaw`
      DELETE FROM ledger_bank_txn
      WHERE org_id = ${orgId}::uuid AND bank_account_id = ${bankAccountId}::uuid
        AND id = ANY(${ids}::uuid[])
        AND match_state = 'unmatched'
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.bank_txn_id = ledger_bank_txn.id)`;
    return { ok: true, deleted: ids.length };
  } catch (e) {
    return { ok: false, deleted: 0, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
}
