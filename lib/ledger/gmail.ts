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
    // openid+email so the callback can read the connected address from the standard
    // userinfo endpoint (the per-company unique key). gmail.readonly alone made us
    // depend on the Gmail profile endpoint, which sometimes returns no address → no_email.
    scope: `openid email ${GMAIL_SCOPE}`,
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
  if (!res.ok) {
    // P2#23: clear stale cache entry on refresh failure (e.g. 400 invalid_grant)
    // so next call attempts a fresh refresh rather than reusing a cached token.
    tokenCache.delete(refreshToken);
    return null;
  }
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
  gmailLabel: string | null;
  filterKeywords: string[];
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
      gmailLabel: true,
      filterKeywords: true,
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
  label?: string | null;
  keywords?: string[];
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
  // P1#35: Gmail label sanitization — wrap in quotes when the label contains spaces,
  // colons, or forward slashes (all of which break Gmail's unquoted label: syntax).
  // Strip any embedded double-quotes from the label name before wrapping.
  const label = opts.label?.trim();
  if (label) {
    const cleanLabel = label.replace(/"/g, "");
    const needsQuotes = /[\s:\/]/.test(cleanLabel);
    parts.push(needsQuotes ? `label:"${cleanLabel}"` : `label:${cleanLabel}`);
  }
  // Subject keyword OR filter — AND with everything else in the query (Gmail default)
  const keywords = (opts.keywords ?? []).filter(Boolean);
  if (keywords.length > 0) {
    parts.push("subject:(" + keywords.join(" OR ") + ")");
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

// P1#16: fields= parameter limits payload size (60-90% bandwidth reduction).
// Only request the fields we actually use in findReceiptAttachments + getHeader.
const GMAIL_MESSAGE_FIELDS =
  "id,internalDate,snippet,payload(headers,mimeType,filename,body,parts)";

export async function fetchGmailMessageFull(
  accessToken: string,
  messageId: string,
): Promise<GmailFullMessage | null> {
  const params = new URLSearchParams({
    format: "full",
    fields: GMAIL_MESSAGE_FIELDS,
  });
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  return res.json() as Promise<GmailFullMessage>;
}

// P1#34 + P1#16: Quota-logged Gmail message list search with fields= restriction.
// Returns only message ids + nextPageToken (no full payloads in the list call).
export async function searchMailboxMessages(
  accessToken: string,
  emailAddr: string,
  query: string,
  maxResults = 50,
): Promise<Array<{ id: string }>> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    fields: "messages(id),nextPageToken", // P1#16: restrict list response fields
  });
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return [];
  const j = (await res.json()) as { messages?: Array<{ id: string }> };
  const msgs = j.messages ?? [];
  // P1#34: quota logging — helps monitor daily API unit consumption
  console.log(`[ledger:gmail] searched mailbox ${emailAddr}, got ${msgs.length} messages`);
  return msgs;
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
