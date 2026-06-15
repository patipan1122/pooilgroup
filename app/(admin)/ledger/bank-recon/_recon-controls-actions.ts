"use server";

// LedgerLine — Bank-Recon Controls actions (bigfeature 2026-06-15).
//   • bulkUndoAction              — ย้อน/นำออกทั้งหมด (suggested ตรง · confirmed → super ตรง / อื่น ๆ ขออนุมัติ)
//   • requestRevertAction         — ขออนุมัติแก้ (ย้อนรายการที่ยืนยันแล้ว) สำหรับคนที่ไม่ใช่ super_admin
//   • approveRevertAction         — super_admin อนุมัติ → ย้อนจริง (atomic)
//   • rejectRevertAction          — super_admin ปฏิเสธคำขอ
//   • revertConfirmedGroupAction  — super_admin ย้อนรายการที่ยืนยันแล้วได้เลย
//   • createBankTransferAction    — โยกเงิน: จับคู่ 2 ขาข้ามบัญชี (ไม่นับ P&L)
//   • unExcludeAction             — เอารายการที่ "ข้าม/ไม่มีคู่" กลับมา
//   • getBankTxnRawAction         — ข้อมูลดิบจาก statement (row CSV)
//   • listUnmatchedMovementsAction— รายการธนาคารค้าง ต่อบัญชี (สำหรับเลือกขาโยกเงิน)
//
// Every export is an async function (use-server rule). Self-scopes org_id (Prisma bypasses RLS).
// Money state changes run in prisma.$transaction; audit + notify are best-effort post-commit
// (matches the rest of the ledger module — audit() uses the Supabase admin client, not the tx).

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { revertGroup } from "@/lib/ledger/recon-controls";
import { listBankMovements, type BankMovement } from "@/lib/ledger/bank-reconcile-board";
import { audit, type AuditAction } from "@/lib/audit/log";
import { sendNotification, sendNotificationToMany, getOrgAdminIds } from "@/lib/notifications/send";

// ── best-effort audit (never throws — a failed audit must not fail the action) ──
async function safeAudit(entry: {
  orgId: string; userId: string; action: AuditAction; resourceId: string;
  diff?: { old?: Record<string, unknown>; new?: Record<string, unknown> };
}) {
  try {
    await audit({ orgId: entry.orgId, userId: entry.userId, action: entry.action,
      resourceType: "ledger_bank_recon", resourceId: entry.resourceId, diff: entry.diff });
  } catch { /* best-effort */ }
}

// ── load a bank txn (org-scoped) with lock + state ─────────────────────────────
async function loadTxnLite(orgId: string, bankTxnId: string) {
  const rows = await prisma.$queryRaw<{
    amountSatang: number; companyId: string; bankAccountId: string; locked: boolean; state: string;
  }[]>`
    SELECT t.amount_satang as "amountSatang", t.company_id::text as "companyId",
           t.bank_account_id::text as "bankAccountId", (b.locked_at IS NOT NULL) as locked, t.match_state as "state"
    FROM ledger_bank_txn t JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE t.id = ${bankTxnId}::uuid AND t.org_id = ${orgId}::uuid LIMIT 1`;
  return rows[0] ?? null;
}

// ── load a confirmed/suggested group header (org-scoped) ───────────────────────
async function loadGroup(orgId: string, groupId: string) {
  const rows = await prisma.$queryRaw<{
    status: string; companyId: string; locked: boolean;
    bankTotalSatang: number; bookTotalSatang: number; deltaSatang: number;
  }[]>`
    SELECT g.status, g.company_id::text as "companyId",
           g.bank_total_satang as "bankTotalSatang", g.book_total_satang as "bookTotalSatang",
           g.delta_satang as "deltaSatang",
           COALESCE(BOOL_OR(b.locked_at IS NOT NULL), false) as locked
    FROM ledger_bank_match_group g
    LEFT JOIN ledger_bank_match_item mi ON mi.group_id=g.id AND mi.kind='bank'
    LEFT JOIN ledger_bank_txn t ON t.id=mi.bank_txn_id
    LEFT JOIN ledger_bank_import_batch b ON b.id=t.batch_id
    WHERE g.id=${groupId}::uuid AND g.org_id=${orgId}::uuid
    GROUP BY g.status, g.company_id, g.bank_total_satang, g.book_total_satang, g.delta_satang
    LIMIT 1`;
  return rows[0] ?? null;
}

// ── file a PENDING revert request (unique index blocks dup) → true if filed ────
async function fileRevertRequest(args: {
  orgId: string; companyId: string; groupId: string; userId: string; reason: string;
  snapshot?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      INSERT INTO ledger_recon_edit_request
        (id, org_id, company_id, target_group_id, action, reason, status, requested_by, snapshot_json)
      VALUES (${randomUUID()}::uuid, ${args.orgId}::uuid, ${args.companyId}::uuid, ${args.groupId}::uuid,
        'revert', ${args.reason}, 'PENDING', ${args.userId}::uuid,
        ${JSON.stringify(args.snapshot ?? {})}::jsonb)`;
    return true;
  } catch {
    return false; // unique violation (already a pending request) or other
  }
}

async function notifyApprovers(orgId: string, title: string, body: string) {
  try {
    const ids = await getOrgAdminIds(orgId);
    if (ids.length) await sendNotificationToMany(ids, { orgId, type: "warning", module: "core", title, body, link: "/ledger/bank-recon/approvals" });
  } catch { /* best-effort */ }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Bulk undo
// ════════════════════════════════════════════════════════════════════════════
export async function bulkUndoAction(params: {
  bankAccountId: string; periodStart: string; periodEnd: string; scope: "suggested" | "all";
}): Promise<{ ok: boolean; revertedSuggested: number; revertedConfirmed: number; requestedForApproval: number; skippedLocked: number; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const isSuper = session.user.role === "super_admin";
  const { bankAccountId, periodStart, periodEnd, scope } = params;

  const groups = await prisma.$queryRaw<{ id: string; status: string; companyId: string; locked: boolean }[]>`
    SELECT g.id::text, g.status, g.company_id::text as "companyId", BOOL_OR(b.locked_at IS NOT NULL) as locked
    FROM ledger_bank_match_group g
    JOIN ledger_bank_match_item mi ON mi.group_id=g.id AND mi.kind='bank'
    JOIN ledger_bank_txn t ON t.id=mi.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id=t.batch_id
    WHERE g.org_id=${orgId}::uuid AND g.bank_account_id=${bankAccountId}::uuid
      AND g.status IN ('suggested','confirmed')
      AND t.txn_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    GROUP BY g.id, g.status, g.company_id`;

  let revertedSuggested = 0, revertedConfirmed = 0, requestedForApproval = 0, skippedLocked = 0;
  for (const g of groups) {
    if (g.locked) { skippedLocked++; continue; }
    if (g.status === "suggested") {
      const r = await revertGroup({ orgId, groupId: g.id, userId: session.user.id, reason: "ย้อนทั้งหมด (รอยืนยัน)" });
      if (r.ok) revertedSuggested++; else skippedLocked++;
    } else {
      if (scope !== "all") continue;
      if (isSuper) {
        const r = await revertGroup({ orgId, groupId: g.id, userId: session.user.id, reason: "ย้อนทั้งหมด (ยืนยันแล้ว · super_admin)" });
        if (r.ok) revertedConfirmed++; else skippedLocked++;
      } else {
        const filed = await fileRevertRequest({ orgId, companyId: g.companyId, groupId: g.id, userId: session.user.id, reason: "ขอย้อนทั้งหมด (ยืนยันแล้ว)" });
        if (filed) requestedForApproval++;
      }
    }
  }

  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_BULK_UNDO", resourceId: bankAccountId,
    diff: { new: { scope, revertedSuggested, revertedConfirmed, requestedForApproval, skippedLocked } } });
  if (requestedForApproval > 0) await notifyApprovers(orgId, "มีคำขอย้อนรายการกระทบยอด", `ขอย้อน ${requestedForApproval} รายการที่ยืนยันแล้ว`);
  return { ok: true, revertedSuggested, revertedConfirmed, requestedForApproval, skippedLocked };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Approval-to-revert (request / approve / reject) + super direct revert
// ════════════════════════════════════════════════════════════════════════════
export async function requestRevertAction(params: { groupId: string; reason: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const reason = params.reason.trim();
  if (reason.length < 3) return { ok: false, error: "กรุณาระบุเหตุผลที่ขอแก้" };
  const g = await loadGroup(orgId, params.groupId);
  if (!g) return { ok: false, error: "ไม่พบรายการ" };
  if (g.status !== "confirmed") return { ok: false, error: "รายการนี้ยังไม่ได้ยืนยัน — กด ‘นำออก’ ได้เลย" };
  if (g.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว — ต้องปลดล็อกงวดก่อน" };
  const filed = await fileRevertRequest({ orgId, companyId: g.companyId, groupId: params.groupId, userId: session.user.id, reason,
    snapshot: { bankTotalSatang: g.bankTotalSatang, bookTotalSatang: g.bookTotalSatang, deltaSatang: g.deltaSatang } });
  if (!filed) return { ok: false, error: "มีคำขอแก้รายการนี้ค้างอยู่แล้ว" };
  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_REVERT_REQUESTED", resourceId: params.groupId, diff: { new: { reason } } });
  await notifyApprovers(orgId, "มีคำขอย้อนรายการกระทบยอด", `${session.user.name ?? "พนักงาน"} ขอย้อน 1 รายการ · ${reason}`);
  return { ok: true };
}

export async function approveRevertAction(requestId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  const rows = await prisma.$queryRaw<{ groupId: string; requestedBy: string; status: string; reason: string }[]>`
    SELECT target_group_id::text as "groupId", requested_by::text as "requestedBy", status, reason
    FROM ledger_recon_edit_request WHERE id=${requestId}::uuid AND org_id=${orgId}::uuid LIMIT 1`;
  const req = rows[0];
  if (!req) return { ok: false, error: "ไม่พบคำขอ" };
  if (req.status !== "PENDING") return { ok: false, error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  if (req.requestedBy === session.user.id) return { ok: false, error: "ผู้ขอกับผู้อนุมัติต้องไม่ใช่คนเดียวกัน" };

  // execute the revert + flip the request status in ONE transaction (atomic)
  const flip = prisma.$executeRaw`
    UPDATE ledger_recon_edit_request SET status='APPROVED', decided_by=${session.user.id}::uuid,
      decided_at=now(), updated_at=now()
    WHERE id=${requestId}::uuid AND org_id=${orgId}::uuid AND status='PENDING'`;
  const r = await revertGroup({ orgId, groupId: req.groupId, userId: session.user.id, reason: `อนุมัติย้อน: ${req.reason}`, extraOps: [flip] });
  if (!r.ok) return r;

  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_REVERT_APPROVED", resourceId: requestId, diff: { new: { groupId: req.groupId } } });
  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_GROUP_REVERTED", resourceId: req.groupId, diff: { new: { via: "approval" } } });
  try { await sendNotification({ orgId, userId: req.requestedBy, type: "success", module: "core", title: "อนุมัติคำขอย้อนรายการแล้ว", body: "รายการกลับมาแก้ไขได้แล้ว", link: "/ledger/bank-recon" }); } catch { /* best-effort */ }
  return { ok: true };
}

export async function rejectRevertAction(params: { requestId: string; note: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  const note = params.note.trim();
  const rows = await prisma.$queryRaw<{ requestedBy: string; status: string }[]>`
    SELECT requested_by::text as "requestedBy", status FROM ledger_recon_edit_request
    WHERE id=${params.requestId}::uuid AND org_id=${orgId}::uuid LIMIT 1`;
  const req = rows[0];
  if (!req) return { ok: false, error: "ไม่พบคำขอ" };
  if (req.status !== "PENDING") return { ok: false, error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  const n = await prisma.$executeRaw`
    UPDATE ledger_recon_edit_request SET status='REJECTED', decided_by=${session.user.id}::uuid,
      decided_at=now(), decision_note=${note}, updated_at=now()
    WHERE id=${params.requestId}::uuid AND org_id=${orgId}::uuid AND status='PENDING'`;
  if (!n) return { ok: false, error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_REVERT_REJECTED", resourceId: params.requestId, diff: { new: { note } } });
  try { await sendNotification({ orgId, userId: req.requestedBy, type: "danger", module: "core", title: "คำขอย้อนรายการถูกปฏิเสธ", body: note || "ไม่ระบุเหตุผล", link: "/ledger/bank-recon" }); } catch { /* best-effort */ }
  return { ok: true };
}

export async function revertConfirmedGroupAction(params: { groupId: string; reason: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  if (session.user.role !== "super_admin") return { ok: false, error: "ต้องขออนุมัติก่อน — กดปุ่ม ‘ขออนุมัติแก้’" };
  const reason = params.reason.trim();
  if (reason.length < 3) return { ok: false, error: "กรุณาระบุเหตุผลที่ย้อนรายการ" };
  const g = await loadGroup(orgId, params.groupId);
  if (!g) return { ok: false, error: "ไม่พบรายการ" };
  if (g.status !== "confirmed") return { ok: false, error: "รายการนี้ยังไม่ได้ยืนยัน — กด ‘นำออก’ ได้เลย" };
  const r = await revertGroup({ orgId, groupId: params.groupId, userId: session.user.id, reason });
  if (!r.ok) return r;
  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_GROUP_REVERTED", resourceId: params.groupId, diff: { new: { via: "super_direct", reason } } });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. โยกเงิน — internal transfer (pair 2 legs across accounts)
// ════════════════════════════════════════════════════════════════════════════
export async function createBankTransferAction(params: {
  txnIdA: string; txnIdB: string; note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  if (params.txnIdA === params.txnIdB) return { ok: false, error: "เลือกคนละรายการ" };
  const a = await loadTxnLite(orgId, params.txnIdA);
  const b = await loadTxnLite(orgId, params.txnIdB);
  if (!a || !b) return { ok: false, error: "ไม่พบรายการ" };
  if (a.companyId !== b.companyId) return { ok: false, error: "ต้องเป็นบริษัทเดียวกัน" };
  if (a.bankAccountId === b.bankAccountId) return { ok: false, error: "ต้องเป็นคนละบัญชี (โยกเงินข้ามบัญชี)" };
  if (a.locked || b.locked) return { ok: false, error: "มีงวดที่ล็อกแล้ว — ปลดล็อกก่อน" };
  if (a.state !== "unmatched" || b.state !== "unmatched") return { ok: false, error: "มีรายการที่จัดการไปแล้ว" };
  if ((a.amountSatang > 0) === (b.amountSatang > 0)) return { ok: false, error: "ต้องเป็นเงินออก 1 ขา + เงินเข้า 1 ขา" };
  if (Math.abs(a.amountSatang) !== Math.abs(b.amountSatang)) return { ok: false, error: "ยอดทั้ง 2 ขาไม่เท่ากัน" };

  const groupId = randomUUID();
  const note = (params.note ?? "").trim() || "โยกเงินภายใน";
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match_group
        (id, org_id, company_id, bank_account_id, status, match_kind, match_type,
         bank_total_satang, book_total_satang, delta_satang, note, created_by, confirmed_by, confirmed_at)
      VALUES (${groupId}::uuid, ${orgId}::uuid, ${a.companyId}::uuid, NULL,
        'confirmed', 'manual', 'transfer', 0, 0, 0, ${note}, ${session.user.id}::uuid, ${session.user.id}::uuid, now())`,
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match_item (id, group_id, org_id, kind, bank_txn_id, amount_satang)
      VALUES (gen_random_uuid(), ${groupId}::uuid, ${orgId}::uuid, 'bank', ${params.txnIdA}::uuid, ${a.amountSatang})`,
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match_item (id, group_id, org_id, kind, bank_txn_id, amount_satang)
      VALUES (gen_random_uuid(), ${groupId}::uuid, ${orgId}::uuid, 'bank', ${params.txnIdB}::uuid, ${b.amountSatang})`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='confirmed' WHERE org_id=${orgId}::uuid AND id IN (${params.txnIdA}::uuid, ${params.txnIdB}::uuid)`,
  ]);
  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_TRANSFER_CREATED", resourceId: groupId,
    diff: { new: { txnA: params.txnIdA, txnB: params.txnIdB, amountSatang: Math.abs(a.amountSatang), note } } });
  return { ok: true };
}

export async function listUnmatchedMovementsAction(params: {
  bankAccountId: string; companyId: string;
}): Promise<{ ok: boolean; movements: BankMovement[]; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  // window: last 180 days (transfers can be any recent date)
  const end = new Date();
  const start = new Date(end.getTime() - 180 * 24 * 3600 * 1000);
  try {
    const movements = await listBankMovements({
      orgId, companyId: params.companyId, bankAccountId: params.bankAccountId,
      periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10),
    });
    return { ok: true, movements };
  } catch (e) {
    return { ok: false, movements: [], error: e instanceof Error ? e.message : "โหลดรายการไม่สำเร็จ" };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Un-exclude (เอารายการที่ "ข้าม/ไม่มีคู่" กลับมา)
// ════════════════════════════════════════════════════════════════════════════
export async function unExcludeAction(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const rows = await prisma.$queryRaw<{ bankTxnId: string; status: string; matchType: string; locked: boolean }[]>`
    SELECT m.bank_txn_id::text as "bankTxnId", m.status, m.match_type as "matchType", (b.locked_at IS NOT NULL) as locked
    FROM ledger_bank_match m
    JOIN ledger_bank_txn t ON t.id=m.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id=t.batch_id
    WHERE m.id=${matchId}::uuid AND m.org_id=${orgId}::uuid LIMIT 1`;
  const m = rows[0];
  if (!m) return { ok: false, error: "ไม่พบรายการ" };
  if (m.matchType !== "exclusion" || m.status !== "confirmed") return { ok: false, error: "รายการนี้ไม่ใช่รายการที่ข้ามไว้" };
  if (m.locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE ledger_bank_match SET status='reversed', reversed_by=${session.user.id}::uuid, reversed_at=now(), updated_at=now()
      WHERE id=${matchId}::uuid AND org_id=${orgId}::uuid AND status='confirmed'`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='unmatched' WHERE id=${m.bankTxnId}::uuid AND org_id=${orgId}::uuid`,
  ]);
  await safeAudit({ orgId, userId: session.user.id, action: "LEDGER_RECON_UNEXCLUDED", resourceId: matchId, diff: { new: { bankTxnId: m.bankTxnId } } });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Raw statement row (full CSV detail for the row expander)
// ════════════════════════════════════════════════════════════════════════════
export async function getBankTxnRawAction(txnId: string): Promise<{ ok: boolean; raw?: Record<string, unknown>; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const rows = await prisma.$queryRaw<{ raw: unknown }[]>`
    SELECT raw_row_json as raw FROM ledger_bank_txn WHERE id=${txnId}::uuid AND org_id=${orgId}::uuid LIMIT 1`;
  if (!rows.length) return { ok: false, error: "ไม่พบรายการ" };
  const raw = rows[0].raw;
  return { ok: true, raw: (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {} };
}
