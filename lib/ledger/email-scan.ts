// LedgerLine · email-scan orchestrator.
//
// scanMailbox(connectionId): smart-filter Gmail → for each NEW message (dedup by
// gmailMessageId BEFORE any AI = cost gate) → pull receipt attachments → store to
// R2 → AI-parse (images only in v1; PDFs PARKED to needs-manual per D3) → create a
// DRAFT expense (golden rule: never auto-post) scoped to the mailbox's company →
// record ledger_email_message (audit + dedup + suppress driver). createDraftExpenseSystem
// also dedups by sha256 (cross-channel: same bytes from LINE + email collapse).
//
// Mirrors the LINE webhook ingest mapping. Decisions: docs/WORKSHOP_ledger-email-scan.md.

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseReceipt, AiBudgetError } from "@/lib/ledger/ai-parse";
import { createDraftExpenseSystem } from "@/lib/ledger/actions";
import { storeReceiptImage, sha256Hex } from "@/lib/ledger/storage";
import {
  getMailboxAccessToken,
  buildSmartReceiptQuery,
  searchMessages,
  fetchGmailMessageFull,
  getHeader,
  findReceiptAttachments,
  downloadAttachment,
} from "@/lib/ledger/gmail";

const FIRST_SCAN_DAYS = 30; // D4: first scan looks back 30 days, then incremental
const DAY_MS = 24 * 60 * 60 * 1000;

export type ScanResult =
  | { ok: false; error: string }
  | {
      ok: true;
      scanned: number;
      imported: number;
      needsManual: number;
      skipped: number;
      errors: number;
    };

export async function scanMailbox(
  connectionId: string,
  opts?: { maxMessages?: number },
): Promise<ScanResult> {
  const conn = await prisma.ledgerEmailConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || !conn.active) return { ok: false, error: "ไม่พบการเชื่อมต่อ หรือถูกปิดอยู่" };

  // filters are mandatory? v1 smart-default always drops promos + needs attachment,
  // so a scan is safe even with no sender allow-list. (Cron gating is enforced by
  // the caller; manual scan is allowed.)
  const token = await getMailboxAccessToken(connectionId);
  if (!token) {
    await prisma.ledgerEmailConnection.update({
      where: { id: connectionId },
      data: { lastSyncStatus: "error: ต้องเชื่อมใหม่ (token หมดอายุ)", active: false },
    });
    return { ok: false, error: "เชื่อมต่อหมดอายุ — กรุณาเชื่อม Gmail ใหม่" };
  }

  const afterUnixSec =
    conn.firstScanDone && conn.lastSyncAt
      ? Math.floor(conn.lastSyncAt.getTime() / 1000)
      : Math.floor((Date.now() - FIRST_SCAN_DAYS * DAY_MS) / 1000);

  const q = buildSmartReceiptQuery({
    senders: conn.filterSenders,
    suppressed: conn.suppressedSenders,
    afterUnixSec,
    label: conn.gmailLabel,
    keywords: conn.filterKeywords,
  });

  const messages = await searchMessages(token, q, opts?.maxMessages ?? 25);
  const scanRunId = crypto.randomUUID();

  let imported = 0;
  let needsManual = 0;
  let skipped = 0;
  let errors = 0;

  for (const { id: gmailMessageId } of messages) {
    // dedup gate (BEFORE any AI): processed already?
    const seen = await prisma.ledgerEmailMessage.findUnique({
      where: { connectionId_gmailMessageId: { connectionId, gmailMessageId } },
      select: { id: true },
    });
    if (seen) {
      skipped++;
      continue;
    }

    try {
      const full = await fetchGmailMessageFull(token, gmailMessageId);
      if (!full) {
        errors++;
        continue;
      }
      const senderEmail = getHeader(full, "From");
      const subject = getHeader(full, "Subject");
      const receivedAt = full.internalDate ? new Date(Number(full.internalDate)) : null;

      const attachments = findReceiptAttachments(full);
      if (attachments.length === 0) {
        await recordMessage(conn.orgId, conn.companyId, connectionId, gmailMessageId, {
          status: "skipped",
          senderEmail,
          subject,
          receivedAt,
          scanRunId,
          note: "ไม่มีไฟล์แนบ",
        });
        skipped++;
        continue;
      }

      let madeDraft = false;
      let anyNeedsManual = false;
      let lastExpenseId: string | null = null;

      for (const att of attachments) {
        const bytes = await downloadAttachment(token, gmailMessageId, att.attachmentId);
        if (!bytes) continue;

        const storageId = crypto.randomUUID();
        const stored = await storeReceiptImage({
          orgId: conn.orgId,
          companySlug: conn.companyId,
          expenseId: storageId,
          buffer: bytes,
          contentType: att.mimeType,
        });

        // v1: parse images with AI; PDFs are PARKED to needs-manual (D3) until the
        // Thai-tax-invoice-PDF smoke-test passes — keep the file, don't guess.
        const isPdf =
          att.mimeType === "application/pdf" ||
          att.filename.toLowerCase().endsWith(".pdf");

        let parsed: Awaited<ReturnType<typeof parseReceipt>> | null = null;
        if (!isPdf) {
          try {
            parsed = await parseReceipt(stored.originalUrl, null, conn.orgId);
          } catch (e) {
            if (!(e instanceof AiBudgetError)) {
              console.error("[ledger:email-scan] parse failed", e);
            }
            parsed = null;
          }
        }

        const parseEmpty = !parsed || (!parsed.total && !parsed.vendor);

        const res = await createDraftExpenseSystem(conn.orgId, {
          companyId: conn.companyId,
          source: "email",
          vendor: parsed?.vendor ?? null,
          docType: parsed?.docType ?? undefined,
          vendorTaxId: parsed?.vendorTaxId ?? null,
          buyerTaxIdOnDoc: parsed?.buyerTaxIdOnDoc ?? null,
          rawText: parsed?.raw ?? null,
          vendorDocNumber: parsed?.vendorDocNumber ?? null,
          vendorAddress: parsed?.vendorAddress ?? null,
          docDate: parsed?.docDate ?? null,
          subtotal: parsed?.subtotal ?? 0,
          discount: parsed?.discount ?? 0,
          vat: parsed?.vat ?? 0,
          wht: parsed?.wht ?? 0,
          total: parsed?.total ?? 0,
          paymentMethod: parsed?.paymentMethod ?? null,
          originalUrl: stored.originalUrl,
          thumbUrl: stored.thumbUrl ?? stored.originalUrl,
          sha256: stored.sha256,
          ocrModel: parsed?.ocrModel ?? null,
          ocrConfidence: parsed?.confidence ?? null,
          items: parsed?.items ?? [],
          note: subject ? `อีเมล: ${subject}`.slice(0, 480) : "นำเข้าจากอีเมล",
          createdById: null,
        });

        if (res.ok) {
          madeDraft = true;
          lastExpenseId = res.data.id;
          if (isPdf || parseEmpty) anyNeedsManual = true;
        } else {
          errors++;
        }
      }

      await recordMessage(conn.orgId, conn.companyId, connectionId, gmailMessageId, {
        status: madeDraft ? (anyNeedsManual ? "needs_manual" : "imported") : "error",
        senderEmail,
        subject,
        receivedAt,
        scanRunId,
        expenseId: lastExpenseId,
      });

      if (madeDraft) {
        if (anyNeedsManual) needsManual++;
        else imported++;
      }
    } catch (e) {
      console.error("[ledger:email-scan] message failed", gmailMessageId, e);
      errors++;
    }
  }

  await prisma.ledgerEmailConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: `ok: เจอ ${imported + needsManual} ใบ`,
      lastSyncCount: imported + needsManual,
      firstScanDone: true,
    },
  });

  return { ok: true, scanned: messages.length, imported, needsManual, skipped, errors };
}

async function recordMessage(
  orgId: string,
  companyId: string,
  connectionId: string,
  gmailMessageId: string,
  data: {
    status: string;
    senderEmail?: string | null;
    subject?: string | null;
    receivedAt?: Date | null;
    scanRunId?: string | null;
    expenseId?: string | null;
    note?: string | null;
  },
) {
  try {
    await prisma.ledgerEmailMessage.upsert({
      where: { connectionId_gmailMessageId: { connectionId, gmailMessageId } },
      create: {
        orgId,
        companyId,
        connectionId,
        gmailMessageId,
        status: data.status,
        senderEmail: data.senderEmail ?? null,
        subject: data.subject ?? null,
        receivedAt: data.receivedAt ?? null,
        scanRunId: data.scanRunId ?? null,
        expenseId: data.expenseId ?? null,
        note: data.note ?? null,
      },
      update: {
        status: data.status,
        expenseId: data.expenseId ?? null,
        note: data.note ?? null,
      },
    });
  } catch (e) {
    console.error("[ledger:email-scan] recordMessage failed", e);
  }
}
