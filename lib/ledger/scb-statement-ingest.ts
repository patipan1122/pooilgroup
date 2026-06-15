// lib/ledger/scb-statement-ingest.ts
//
// Auto-import SCB Business Anywhere "Historical Statement" (รายการเดินบัญชีย้อนหลัง)
// from Gmail. SCB emails a password-protected ZIP daily; inside is ONE CSV that may
// carry several accounts (HISTSTMT multi-account). We decrypt, parse, split by
// account, and land each account's rows into bank-recon as its own import batch.
//
// Reuses everything that already exists:
//   • token + Gmail REST    → lib/ledger/gmail.ts (the receipt-scan OAuth mailbox)
//   • CSV → normalized rows → lib/ledger/bank-adapters (scbAdapter, multi-account)
//   • dedup hash + atomic    → computeLineHash + RPC ledger_bank_insert_batch
//   • per-email dedup        → ledger_email_message (same table the receipt scan uses)
//
// Read-only on Gmail. NO new table / migration / UI — the CEO connects the mailbox
// with the existing "เชื่อม Google" button; the ZIP password lives in an env var.

import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { detectAndParse } from "@/lib/ledger/bank-adapters";
import type { NormalizedRow } from "@/lib/ledger/bank-adapters/types";
import { computeLineHash } from "@/lib/ledger/bank-statement-reconcile";
import { decryptZipToTextFiles } from "@/lib/ledger/scb-zip";
import {
  isGmailOAuthConfigured,
  getMailboxAccessToken,
  searchMailboxMessages,
  fetchGmailMessageFull,
  downloadAttachment,
  getHeader,
  type GmailFullMessage,
} from "@/lib/ledger/gmail";

// SCB Business Anywhere sends statements from contact_business@email.scb.co.th
// (domain email.scb.co.th). We match the whole scb.co.th domain to be resilient.
const SEARCH_WINDOW_DAYS = 90; // CEO 2026-06-15: keep ~3 months so backfill is automatic
const MAX_LIST_RESULTS = 150;  // one page big enough for ~3 months of daily SCB emails
const MAX_NEW_PER_RUN = 50;    // process at most N NEW emails per run (timeout guard);
                               // dedup means the rest are picked up next run/click
const MAX_ZIP_BYTES = 15 * 1024 * 1024; // SCB statement ZIPs are ~1MB; guard runaway

function zipPassword(): string {
  const pw = process.env.LEDGER_SCB_ZIP_PASSWORD;
  if (!pw) throw new Error("LEDGER_SCB_ZIP_PASSWORD env var is required");
  return pw;
}

// ── Gmail: find .zip attachments in a message ────────────────────────────────
interface GmailPartLike {
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPartLike[];
}
function findZipAttachments(
  msg: GmailFullMessage,
): Array<{ filename: string; attachmentId: string; sizeBytes: number }> {
  const out: Array<{ filename: string; attachmentId: string; sizeBytes: number }> = [];
  function walk(parts: GmailPartLike[] | undefined) {
    if (!parts) return;
    for (const p of parts) {
      const fn = (p.filename ?? "").toLowerCase();
      const mt = p.mimeType ?? "";
      const isZip =
        fn.endsWith(".zip") ||
        mt === "application/zip" ||
        mt === "application/x-zip-compressed" ||
        mt === "application/octet-stream"; // SCB sometimes labels the ZIP generically
      if (isZip && fn.endsWith(".zip") && p.body?.attachmentId) {
        out.push({
          filename: p.filename || "statement.zip",
          attachmentId: p.body.attachmentId,
          sizeBytes: p.body.size ?? 0,
        });
      }
      walk(p.parts);
    }
  }
  walk(msg.payload?.parts);
  return out;
}

// ── Resolve which seeded SCB account a file account-number belongs to ────────
type ScbAccount = { id: string; accountNo: string; companyId: string };
const digitsOnly = (s: string) => s.replace(/\D/g, "");

async function loadScbAccounts(orgId: string): Promise<Map<string, ScbAccount>> {
  const rows = await prisma.$queryRaw<ScbAccount[]>`
    SELECT a.id::text AS id, a.account_no AS "accountNo", ac.company_id::text AS "companyId"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.org_id = ${orgId}::uuid AND a.bank_code = 'SCB'
      AND ac.can_import = true AND a.is_active = true
  `;
  const byLast4 = new Map<string, ScbAccount>();
  for (const a of rows) {
    const l4 = digitsOnly(a.accountNo).slice(-4);
    if (l4.length === 4) byLast4.set(l4, a);
  }
  return byLast4;
}

// ── Insert one account-group as a bank-recon import batch (idempotent RPC) ───
async function insertBatch(
  orgId: string,
  target: ScbAccount,
  rows: NormalizedRow[],
  filename: string,
): Promise<{ inserted: number; skipped: number }> {
  const batchId = randomUUID();
  const dates = rows.map((r) => r.txnDate).filter(Boolean).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  const txnRows = rows.map((row) => ({
    org_id: orgId,
    company_id: target.companyId,
    bank_account_id: target.id,
    line_hash: computeLineHash({
      accountNo: target.accountNo,
      txnDate: row.txnDate,
      amountSatang: row.amountSatang,
      balanceSatang: row.balanceSatang,
      ref1: row.ref1,
      rowIndex: row.rowIndex,
    }),
    txn_date: row.txnDate,
    value_date: row.valueDate,
    amount_satang: row.amountSatang,
    balance_satang: row.balanceSatang,
    ref1: row.ref1,
    ref2: row.ref2,
    description: row.description,
    channel: row.channel,
    source_type: "CSV", // chk_source_type CHECK (source_type IN ('CSV','EXCEL','MANUAL_BAAC'))
    row_index: row.rowIndex,
    raw_row_json: row.rawRow,
  }));

  const batchPayload = {
    id: batchId,
    org_id: orgId,
    company_id: target.companyId,
    bank_account_id: target.id,
    period_start: periodStart,
    period_end: periodEnd,
    batch_format_version: "SCB_CSV_v1",
    source_filename: filename,
    row_count: rows.length,
    uploaded_by: null, // system import (uploaded_by is nullable)
  };

  // Same atomic RPC the manual upload uses → ON CONFLICT (account, line_hash)
  // DO NOTHING makes a re-import a no-op. SECURITY DEFINER, callable via Prisma.
  const out = await prisma.$queryRaw<{ result: { inserted: number; skipped: number } }[]>`
    SELECT public.ledger_bank_insert_batch(
      ${JSON.stringify(batchPayload)}::jsonb,
      ARRAY(SELECT jsonb_array_elements(${JSON.stringify(txnRows)}::jsonb))
    ) AS result
  `;
  const r = out[0]?.result;
  return { inserted: Number(r?.inserted ?? 0), skipped: Number(r?.skipped ?? 0) };
}

// ── Parse one decrypted CSV and land every account-group it contains ─────────
async function ingestCsvContent(
  orgId: string,
  content: string,
  filename: string,
): Promise<{ batches: number; inserted: number; note: string }> {
  const parsed = detectAndParse(content);
  if (!parsed) return { batches: 0, inserted: 0, note: `${filename}: ไม่รู้จักรูปแบบ` };
  // Safety: this pipeline is SCB-only. Anything else is ignored, never mis-filed.
  if (parsed.bankCode !== "SCB")
    return { batches: 0, inserted: 0, note: `${filename}: ไม่ใช่ไฟล์ SCB (${parsed.bankCode})` };
  if (!parsed.rows.length) return { batches: 0, inserted: 0, note: `${filename}: ว่าง` };

  // Split rows by their per-row account number (HISTSTMT multi-account file).
  const buckets: Record<string, NormalizedRow[]> = {};
  for (const row of parsed.rows) {
    const key = row.accountNo || parsed.accountNo || "";
    (buckets[key] ??= []).push(row);
  }

  const accounts = await loadScbAccounts(orgId);
  let batches = 0;
  let insertedTotal = 0;
  const notes: string[] = [];

  for (const [fileAcct, rows] of Object.entries(buckets)) {
    const l4 = digitsOnly(fileAcct).slice(-4);
    const target = l4.length === 4 ? accounts.get(l4) : undefined;
    if (!target) {
      notes.push(`…${l4 || "?"}: ไม่พบบัญชีในระบบ (ข้าม ${rows.length} รายการ)`);
      continue;
    }
    const res = await insertBatch(orgId, target, rows, filename);
    batches += 1;
    insertedTotal += res.inserted;
    notes.push(`…${l4}: +${res.inserted} ใหม่ / ${res.skipped} ซ้ำ`);
  }

  return { batches, inserted: insertedTotal, note: notes.join(" · ") };
}

// ── Process one Gmail message (download → decrypt → ingest) ──────────────────
type MessageOutcome = {
  status: "imported" | "skipped" | "error";
  batches: number;
  inserted: number;
  note: string;
  subject: string | null;
  sender: string | null;
  receivedAt: Date | null;
};

async function processMessage(
  orgId: string,
  accessToken: string,
  messageId: string,
): Promise<MessageOutcome> {
  const msg = await fetchGmailMessageFull(accessToken, messageId);
  if (!msg) throw new Error("โหลดอีเมลไม่สำเร็จ");

  const subject = getHeader(msg, "Subject");
  const sender = getHeader(msg, "From");
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;

  const zips = findZipAttachments(msg);
  if (!zips.length) {
    return { status: "skipped", batches: 0, inserted: 0, note: "ไม่มีไฟล์ ZIP", subject, sender, receivedAt };
  }

  let batches = 0;
  let inserted = 0;
  const notes: string[] = [];

  for (const z of zips) {
    if (z.sizeBytes > MAX_ZIP_BYTES) {
      notes.push(`${z.filename}: ใหญ่เกิน ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)}MB`);
      continue;
    }
    const bytes = await downloadAttachment(accessToken, messageId, z.attachmentId);
    if (!bytes) {
      notes.push(`${z.filename}: ดาวน์โหลดไม่สำเร็จ`);
      continue;
    }
    const csvFiles = await decryptZipToTextFiles(new Uint8Array(bytes), zipPassword(), {
      filter: (n) => /\.csv$/i.test(n),
    });
    if (!csvFiles.length) {
      notes.push(`${z.filename}: ไม่มี CSV ข้างใน (อาจเป็นรายงาน PDF)`);
      continue;
    }
    for (const csv of csvFiles) {
      const r = await ingestCsvContent(orgId, csv.content, csv.filename);
      batches += r.batches;
      inserted += r.inserted;
      notes.push(r.note);
    }
  }

  return {
    status: batches > 0 ? "imported" : "skipped",
    batches,
    inserted,
    note: notes.join(" | "),
    subject,
    sender,
    receivedAt,
  };
}

// ── Per-connection scan ──────────────────────────────────────────────────────
export type ScbConnectionResult = {
  connectionId: string;
  gmailEmail: string;
  scanned: number;
  importedMessages: number;
  batches: number;
  insertedRows: number;
  skippedMessages: number;
  remaining: number; // NEW emails left unprocessed this run (hit the per-run cap)
  error?: string;
};

type ConnRow = { id: string; orgId: string; companyId: string; gmailEmail: string };

async function scanConnection(conn: ConnRow): Promise<ScbConnectionResult> {
  const base: ScbConnectionResult = {
    connectionId: conn.id,
    gmailEmail: conn.gmailEmail,
    scanned: 0,
    importedMessages: 0,
    batches: 0,
    insertedRows: 0,
    skippedMessages: 0,
    remaining: 0,
  };

  const accessToken = await getMailboxAccessToken(conn.id);
  if (!accessToken) return { ...base, error: "ต่อ Gmail ไม่ได้ (อาจถูกเพิกถอนสิทธิ์)" };

  const afterSec = Math.floor((Date.now() - SEARCH_WINDOW_DAYS * 86_400_000) / 1000);
  // Broad-but-safe: any SCB sender with an attachment. We DON'T use `filename:zip`
  // (Gmail's filename operator is unreliable for uppercase ".ZIP") — the code filters
  // to .zip attachments + decrypts, so non-statement mail is skipped harmlessly.
  const query = `from:scb.co.th has:attachment after:${afterSec}`;
  const messages = await searchMailboxMessages(accessToken, conn.gmailEmail, query, MAX_LIST_RESULTS);
  console.log(`[ledger:scb-import] ${conn.gmailEmail}: query="${query}" → ${messages.length} messages`);
  base.scanned = messages.length;
  if (!messages.length) return base;

  // Per-email dedup: skip messages already imported for this connection.
  const done = await prisma.ledgerEmailMessage.findMany({
    where: {
      connectionId: conn.id,
      gmailMessageId: { in: messages.map((m) => m.id) },
      status: "imported",
    },
    select: { gmailMessageId: true },
  });
  const doneSet = new Set(done.map((d) => d.gmailMessageId));

  // Only NEW (not-yet-imported) emails need work; cap per run to avoid timeouts.
  const pending = messages.filter((m) => !doneSet.has(m.id));
  base.skippedMessages = messages.length - pending.length;
  const toProcess = pending.slice(0, MAX_NEW_PER_RUN);
  base.remaining = pending.length - toProcess.length;

  for (const m of toProcess) {
    try {
      const outcome = await processMessage(conn.orgId, accessToken, m.id);
      if (outcome.status === "imported") {
        base.importedMessages += 1;
        base.batches += outcome.batches;
        base.insertedRows += outcome.inserted;
      }
      await recordMessage(conn, m.id, outcome.status, outcome.note, outcome.subject, outcome.sender, outcome.receivedAt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      // Don't mark 'imported' → a transient failure retries next run (lineHash keeps it safe).
      await recordMessage(conn, m.id, "error", msg, null, null, null);
    }
  }

  // Touch the connection so the settings UI can show last activity.
  await prisma.ledgerEmailConnection
    .update({
      where: { id: conn.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncCount: base.importedMessages },
    })
    .catch(() => undefined);

  return base;
}

async function recordMessage(
  conn: ConnRow,
  gmailMessageId: string,
  status: string,
  note: string,
  subject: string | null,
  sender: string | null,
  receivedAt: Date | null,
) {
  try {
    await prisma.ledgerEmailMessage.upsert({
      where: { connectionId_gmailMessageId: { connectionId: conn.id, gmailMessageId } },
      create: {
        orgId: conn.orgId,
        companyId: conn.companyId,
        connectionId: conn.id,
        gmailMessageId,
        status,
        senderEmail: sender,
        subject,
        receivedAt,
        note: note.slice(0, 1000),
      },
      update: { status, note: note.slice(0, 1000) },
    });
  } catch (e) {
    console.error("[ledger:scb-import] recordMessage failed", e);
  }
}

// ── Diagnostic: probe several Gmail queries to pinpoint why 0 were found ──────
// Returns a human-readable line per connected mailbox with hit-counts, so a "0 found"
// can be traced to (a) Gmail read broken, (b) wrong sender filter, or (c) Spam/elsewhere.
export async function diagnoseScbSearch(orgId?: string): Promise<string> {
  const conns = await prisma.ledgerEmailConnection.findMany({
    where: { active: true, ...(orgId ? { orgId } : {}) },
    select: { id: true, gmailEmail: true, scopes: true },
  });
  if (!conns.length) return "ไม่พบกล่องเมลที่เชื่อม";

  const lines: string[] = [];
  for (const c of conns) {
    const hasGmailScope = (c.scopes ?? "").includes("gmail.readonly");
    const token = await getMailboxAccessToken(c.id);
    if (!token) {
      lines.push(`${c.gmailEmail}: ⚠️ ต่อ Gmail ไม่ได้ (token พัง/เพิกถอน) · gmail-scope=${hasGmailScope}`);
      continue;
    }
    const probe = async (q: string) =>
      (await searchMailboxMessages(token, c.gmailEmail, q, 5)).length;
    const anyMail = await probe("newer_than:1y");
    const anyAtt = await probe("has:attachment newer_than:1y");
    const fromScb = await probe("from:scb.co.th");
    const fromExact = await probe("from:contact_business@email.scb.co.th");
    const subj = await probe("subject:(SCB Business Anywhere)");
    const anywhere = await probe("from:scb.co.th in:anywhere");
    lines.push(
      `${c.gmailEmail} [gmail-scope=${hasGmailScope}]: เมลทั้งหมด(1ปี)=${anyMail} · มีไฟล์แนบ=${anyAtt} · from:scb.co.th=${fromScb} · from:เป๊ะ=${fromExact} · subject=${subj} · scb+spam/all=${anywhere}`,
    );
  }
  return lines.join(" || ");
}

// ── Entry point: scan connected mailboxes for SCB statements ─────────────────
// opts.orgId restricts to one org (used by the manual "ดึงเดี๋ยวนี้" button);
// the daily cron calls it with no orgId to cover every org.
export async function autoImportScbStatements(
  opts?: { orgId?: string },
): Promise<ScbConnectionResult[]> {
  if (!isGmailOAuthConfigured()) {
    console.warn("[ledger:scb-import] Google OAuth not configured — skipping");
    return [];
  }
  if (!process.env.LEDGER_SCB_ZIP_PASSWORD) {
    console.warn("[ledger:scb-import] LEDGER_SCB_ZIP_PASSWORD not set — skipping");
    return [];
  }

  const connections = await prisma.ledgerEmailConnection.findMany({
    where: { active: true, ...(opts?.orgId ? { orgId: opts.orgId } : {}) },
    select: { id: true, orgId: true, companyId: true, gmailEmail: true },
  });

  const results: ScbConnectionResult[] = [];
  for (const conn of connections) {
    try {
      results.push(await scanConnection(conn));
    } catch (e) {
      results.push({
        connectionId: conn.id,
        gmailEmail: conn.gmailEmail,
        scanned: 0,
        importedMessages: 0,
        batches: 0,
        insertedRows: 0,
        skippedMessages: 0,
        remaining: 0,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return results;
}
