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
  fetchGmailMessageFull,
  getHeader,
  findReceiptAttachments,
  downloadAttachment,
} from "@/lib/ledger/gmail";

const FIRST_SCAN_DAYS = 30; // D4: first scan looks back 30 days, then incremental
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 10_000_000; // P0#14: skip attachments >10MB
const DEBOUNCE_MS = 5 * 60 * 1000; // P1#5: skip mailbox if synced <5min ago
const MAX_PAGINATION_EMAILS = 200; // P2#24: pagination hard cap to prevent timeout

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

// ---------------------------------------------------------------------------
// P2#24: Paginated Gmail search — fetches all pages up to MAX_PAGINATION_EMAILS.
// The shared searchMessages helper only fetches one page; we call the REST API
// directly here to handle nextPageToken across pages.
// ---------------------------------------------------------------------------
async function searchAllMessages(
  accessToken: string,
  query: string,
  initialMaxResults: number,
): Promise<Array<{ id: string; threadId: string }>> {
  const all: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(initialMaxResults, 100)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      console.error("[ledger:email-scan] searchMessages page failed", res.status);
      break;
    }

    const j = (await res.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    };

    if (j.messages) all.push(...j.messages);
    pageToken = j.nextPageToken;
  } while (pageToken && all.length < MAX_PAGINATION_EMAILS);

  return all.slice(0, MAX_PAGINATION_EMAILS);
}

export async function scanMailbox(
  connectionId: string,
  opts?: { maxMessages?: number },
): Promise<ScanResult> {
  const conn = await prisma.ledgerEmailConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || !conn.active) return { ok: false, error: "ไม่พบการเชื่อมต่อ หรือถูกปิดอยู่" };

  // P1#5: Debounce — skip if this mailbox was synced in the last 5 minutes.
  // Prevents cron + manual trigger from double-processing the same messages.
  if (conn.lastSyncAt && Date.now() - conn.lastSyncAt.getTime() < DEBOUNCE_MS) {
    return { ok: false, error: "sync ล่าสุดเกิดขึ้นเมื่อ <5 นาทีที่แล้ว — ข้ามเพื่อป้องกันการทำซ้ำ" };
  }

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

  // P2#24: Use paginated search instead of single-page searchMessages.
  const messages = await searchAllMessages(token, q, opts?.maxMessages ?? 25);
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
        // P2#5: Update lastSyncAt after each processed message so a mid-run crash
        // doesn't re-process already-handled messages on the next run.
        await prisma.ledgerEmailConnection.update({
          where: { id: connectionId },
          data: { lastSyncAt: new Date() },
        });
        continue;
      }

      let madeDraft = false;
      let anyNeedsManual = false;
      let lastExpenseId: string | null = null;

      for (const att of attachments) {
        // P0#14: SIZE GATE — skip attachments larger than 10MB before downloading.
        if (att.sizeBytes > MAX_ATTACHMENT_BYTES) {
          console.warn(
            `[ledger:email-scan] attachment too large, skipping (${att.sizeBytes} bytes, file: ${att.filename})`,
          );
          continue;
        }

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
            // P1#14: Pass in-memory bytes as a data URL directly to parseReceipt
            // instead of re-fetching from R2. This avoids a redundant network round-
            // trip for bytes we already have in memory.
            const dataUrl = `data:${att.mimeType};base64,${bytes.toString("base64")}`;
            parsed = await parseReceipt(dataUrl, null, conn.orgId);
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
          purchaseType: parsed?.purchaseType ?? null,
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

    // P2#5: Checkpoint lastSyncAt after each message so crashes mid-batch
    // don't cause already-processed messages to be re-fetched on the next run.
    await prisma.ledgerEmailConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });
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
