// LedgerLine · Gmail connection (multi-mailbox per company).
//
// W-024: reuse the CLIENT code, not the connection ROW. The low-level OAuth +
// crypto helpers are imported from the ChairOps Gmail client (same Google app,
// same AES-256-GCM key). Connection rows live in the NEW, company-scoped,
// multi-mailbox table public.ledger_email_connection — NOT ChairopsGmailConnection
// (which is org-only and owned by ChairOps).
//
// Scope: gmail.readonly — read-only; we never send or delete mail.

import { prisma } from "@/lib/prisma";
import {
  GMAIL_SCOPE,
  isGmailOAuthConfigured,
  encryptToken,
  decryptToken,
  exchangeCodeForTokens,
  searchMessages,
  downloadAttachment,
} from "@/lib/chairops/email/gmail";

// re-export the shared primitives so callers in lib/ledger don't reach into chairops
export {
  GMAIL_SCOPE,
  isGmailOAuthConfigured,
  encryptToken,
  decryptToken,
  exchangeCodeForTokens,
  searchMessages,
  downloadAttachment,
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Consent URL for connecting a Gmail mailbox to LedgerLine.
 *  include_granted_scopes=true so re-consent on a Google account that already
 *  granted Drive (drive.file) does NOT narrow the existing grant (W-025). */
export function buildLedgerGmailConsentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// in-process access-token cache (Google tokens last ~1h) keyed by refresh token
const tokenCache = new Map<string, { token: string; exp: number }>();

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.exp > Date.now() + 120_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  const exp = Date.now() + (j.expires_in ?? 3600) * 1000;
  tokenCache.set(refreshToken, { token: j.access_token, exp });
  return j.access_token;
}

export type LedgerMailbox = {
  id: string;
  gmailEmail: string;
  scopes: string | null;
  filterSenders: string[];
  suppressedSenders: string[];
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncCount: number;
  firstScanDone: boolean;
  active: boolean;
};

/** List connected mailboxes for a company (no secrets returned). */
export async function listLedgerMailboxes(
  orgId: string,
  companyId: string,
): Promise<LedgerMailbox[]> {
  return prisma.ledgerEmailConnection.findMany({
    where: { orgId, companyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      gmailEmail: true,
      scopes: true,
      filterSenders: true,
      suppressedSenders: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      lastSyncCount: true,
      firstScanDone: true,
      active: true,
    },
  });
}

/** Resolve a usable access token for one connected mailbox (or null if revoked). */
export async function getMailboxAccessToken(connectionId: string): Promise<string | null> {
  const conn = await prisma.ledgerEmailConnection.findUnique({
    where: { id: connectionId },
    select: { refreshTokenEnc: true },
  });
  if (!conn) return null;
  const refreshToken = decryptToken(conn.refreshTokenEnc);
  if (!refreshToken) return null;
  return refreshAccessToken(refreshToken);
}

// ---------------------------------------------------------------------------
// Smart receipt filter — the CEO doesn't hand-list senders. We lean on Gmail's
// OWN categorisation: drop the Promotions + Social buckets (ads/junk) and look
// at attachment-bearing mail. An optional sender allow-list narrows further; the
// self-learning suppress-list subtracts senders the accountant marked "not an
// expense". v1 = attachment-bearing (image/pdf); body-HTML deferred (D3).
// ---------------------------------------------------------------------------

export function buildSmartReceiptQuery(opts: {
  senders?: string[];
  suppressed?: string[];
  afterUnixSec?: number;
}): string {
  const parts: string[] = [
    "-category:promotions", // Gmail already sorts ads here → skip
    "-category:social",
    "has:attachment", // v1: receipts that arrive as a file (image/pdf)
  ];
  const senders = (opts.senders ?? []).filter(Boolean);
  if (senders.length > 0) {
    parts.push("(" + senders.map((s) => `from:${s}`).join(" OR ") + ")");
  }
  for (const s of opts.suppressed ?? []) {
    if (s) parts.push(`-from:${s}`);
  }
  if (opts.afterUnixSec) parts.push(`after:${opts.afterUnixSec}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Gmail message helpers (full message w/ headers — chairops getMessage omits
// headers from its type, so we fetch our own typed shape here).
// ---------------------------------------------------------------------------

interface GmailPartLike {
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPartLike[];
}

export interface GmailFullMessage {
  id: string;
  internalDate?: string;
  payload?: {
    mimeType?: string;
    filename?: string;
    headers?: Array<{ name: string; value: string }>;
    body?: { attachmentId?: string; size?: number };
    parts?: GmailPartLike[];
  };
}

export async function fetchGmailMessageFull(
  accessToken: string,
  messageId: string,
): Promise<GmailFullMessage | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  return res.json() as Promise<GmailFullMessage>;
}

export function getHeader(msg: GmailFullMessage, name: string): string | null {
  const h = msg.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? null;
}

/** Find receipt attachments (image/* or application/pdf) in a message. */
export function findReceiptAttachments(msg: GmailFullMessage): Array<{
  filename: string;
  attachmentId: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const out: Array<{ filename: string; attachmentId: string; mimeType: string; sizeBytes: number }> = [];

  function isReceiptPart(part: GmailPartLike): boolean {
    const fn = (part.filename ?? "").toLowerCase();
    const mt = part.mimeType ?? "";
    return (
      mt.startsWith("image/") ||
      mt === "application/pdf" ||
      fn.endsWith(".pdf") ||
      fn.endsWith(".jpg") ||
      fn.endsWith(".jpeg") ||
      fn.endsWith(".png") ||
      fn.endsWith(".webp") ||
      fn.endsWith(".heic")
    );
  }

  function walk(parts: GmailPartLike[] | undefined) {
    if (!parts) return;
    for (const part of parts) {
      if (isReceiptPart(part) && part.body?.attachmentId) {
        const isPdf =
          (part.mimeType ?? "") === "application/pdf" ||
          (part.filename ?? "").toLowerCase().endsWith(".pdf");
        out.push({
          filename: part.filename || (isPdf ? "receipt.pdf" : "receipt.jpg"),
          attachmentId: part.body.attachmentId,
          mimeType: part.mimeType || (isPdf ? "application/pdf" : "image/jpeg"),
          sizeBytes: part.body.size ?? 0,
        });
      }
      walk(part.parts);
    }
  }

  walk(msg.payload?.parts);
  return out;
}
