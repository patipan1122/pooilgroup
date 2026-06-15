"use server";

// LedgerLine · connect/disconnect a Gmail mailbox (multi-mailbox per company, D1).
// admin tier only. startLedgerGmailConnect(companyId) returns the Google consent
// URL; the callback /api/ledger/email/oauth/callback finishes the handshake and
// upserts public.ledger_email_connection. Reuses the same Google OAuth app as
// ChairOps/Drive — no new Google Cloud setup.

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isGmailOAuthConfigured, buildLedgerGmailConsentUrl } from "@/lib/ledger/gmail";
import { OAUTH_STATE_COOKIE, callbackRedirectUri } from "@/lib/ledger/gmail-oauth";
import { isDriveOAuthConfigured, buildConsentUrl } from "@/lib/chairops/storage/drive";
import { DRIVE_OAUTH_STATE_COOKIE, driveCallbackRedirectUri } from "@/lib/ledger/drive-oauth";
import { scanMailbox } from "@/lib/ledger/email-scan";
import { autoImportScbStatements } from "@/lib/ledger/scb-statement-ingest";

export async function startLedgerGmailConnect(
  companyId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // เชื่อม/จัดการ Google (Drive + Gmail) = โครงสร้างเจ้าของระบบ → super_admin เท่านั้น
  const session = await requireRole("super_admin");
  if (!isGmailOAuthConfigured()) {
    return {
      ok: false,
      error: "ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET ใน Vercel",
    };
  }
  if (!companyId) return { ok: false, error: "ไม่พบบริษัทที่จะเชื่อม" };

  // defense-in-depth: the company must belong to the session's org
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "บริษัทไม่ถูกต้อง" };

  const nonce = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, `${nonce}:${companyId}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  const url = buildLedgerGmailConsentUrl(await callbackRedirectUri(), nonce);
  return { ok: true, url };
}

/** Connect Google Drive (org-level, shared) so receipts archive automatically.
 *  Reuses the same ChairopsDriveConnection that lib/ledger/drive.ts reads. */
export async function startLedgerDriveConnect(
  companyId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // เชื่อม/จัดการ Google (Drive + Gmail) = โครงสร้างเจ้าของระบบ → super_admin เท่านั้น
  const session = await requireRole("super_admin");
  if (!isDriveOAuthConfigured()) {
    return {
      ok: false,
      error: "ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET ใน Vercel",
    };
  }
  if (!companyId) return { ok: false, error: "ไม่พบบริษัทที่จะเชื่อม" };

  // P1#40 DRIVE CONNECT COMPANY CHECK — verify the companyId belongs to the
  // session's org before embedding it in the OAuth state cookie. Without this,
  // a caller who guesses another org's companyId could link Drive storage to
  // a company they don't own (cross-org Drive connection via forged callback).
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "บริษัทไม่ถูกต้อง" };

  const nonce = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(DRIVE_OAUTH_STATE_COOKIE, `${nonce}:${companyId ?? ""}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  // buildConsentUrl (ChairOps Drive) already sets include_granted_scopes=true
  const url = buildConsentUrl(await driveCallbackRedirectUri(), nonce);
  return { ok: true, url };
}

/** Manually scan a mailbox now ("สแกนเลย") — dogfood before the daily cron. */
export async function scanMailboxNow(
  connectionId: string,
): Promise<
  | { ok: true; imported: number; needsManual: number; skipped: number }
  | { ok: false; error: string }
> {
  // เชื่อม/จัดการ Google (Drive + Gmail) = โครงสร้างเจ้าของระบบ → super_admin เท่านั้น
  const session = await requireRole("super_admin");
  const conn = await prisma.ledgerEmailConnection.findFirst({
    where: { id: connectionId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!conn) return { ok: false, error: "ไม่พบการเชื่อมต่อ" };

  const res = await scanMailbox(connectionId);
  if (!res.ok) return res;
  revalidatePath("/ledger/settings/google");
  return {
    ok: true,
    imported: res.imported,
    needsManual: res.needsManual,
    skipped: res.skipped,
  };
}

/** Pull SCB Business Anywhere statement ZIPs from the connected mailbox(es) NOW
 *  ("ดึง statement เดี๋ยวนี้") — dogfood the daily cron from the settings page. */
export async function scanScbStatementsNow(): Promise<
  | { ok: true; rows: number; batches: number; importedMessages: number; note: string }
  | { ok: false; error: string }
> {
  const session = await requireRole("super_admin");
  if (!process.env.LEDGER_SCB_ZIP_PASSWORD) {
    return { ok: false, error: "ยังไม่ได้ตั้งรหัส ZIP (LEDGER_SCB_ZIP_PASSWORD) ใน Vercel" };
  }
  const results = await autoImportScbStatements({ orgId: session.user.org_id });
  const rows = results.reduce((s, r) => s + r.insertedRows, 0);
  const batches = results.reduce((s, r) => s + r.batches, 0);
  const importedMessages = results.reduce((s, r) => s + r.importedMessages, 0);
  const errs = results.map((r) => r.error).filter((e): e is string => Boolean(e));
  revalidatePath("/ledger/settings/google");
  return { ok: true, rows, batches, importedMessages, note: errs.join("; ") };
}

export async function updateMailboxFilters(
  connectionId: string,
  filters: {
    filterSenders: string[];
    suppressedSenders: string[];
    gmailLabel: string | null;
    filterKeywords: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // เชื่อม/จัดการ Google (Drive + Gmail) = โครงสร้างเจ้าของระบบ → super_admin เท่านั้น
  const session = await requireRole("super_admin");
  const conn = await prisma.ledgerEmailConnection.findFirst({
    where: { id: connectionId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!conn) return { ok: false, error: "ไม่พบการเชื่อมต่อ" };
  await prisma.ledgerEmailConnection.update({
    where: { id: connectionId },
    data: {
      filterSenders: filters.filterSenders,
      suppressedSenders: filters.suppressedSenders,
      gmailLabel: filters.gmailLabel || null,
      filterKeywords: filters.filterKeywords,
    },
  });
  revalidatePath("/ledger/settings/google");
  return { ok: true };
}

export async function disconnectLedgerMailbox(
  connectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // เชื่อม/จัดการ Google (Drive + Gmail) = โครงสร้างเจ้าของระบบ → super_admin เท่านั้น
  const session = await requireRole("super_admin");
  try {
    // scope the delete to the session org — never touch another org's row
    await prisma.ledgerEmailConnection.deleteMany({
      where: { id: connectionId, orgId: session.user.org_id },
    });
    revalidatePath("/ledger/settings/google");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ" };
  }
}
