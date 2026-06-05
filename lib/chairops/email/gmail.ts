// ChairOps · Gmail client for StarThing XLSX auto-import (CEO 2026-06-05).
//
// Pure REST (fetch) — no googleapis npm. Stores refresh token AES-256-GCM
// encrypted in ChairopsGmailConnection (same pattern as Drive client).
//
// Scope: gmail.readonly — read-only access; we never send or delete mail.
// Auth: same GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET as Drive.
//
// The refresh token is per-org, stored encrypted. Access tokens are cached
// in-process for ~55 min (Google tokens last 1 hour).

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function isGmailOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// ---------------------------------------------------------------------------
// Encrypt / decrypt (same logic as drive.ts — reuse key derivation)
// ---------------------------------------------------------------------------

const ALG = "aes-256-gcm";
const IV_LEN = 12;

function cryptoKey(): Buffer {
  const raw = process.env.CHAIROPS_DRIVE_CRYPTO_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  const fallback =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.DATABASE_URL;
  if (!fallback) throw new Error("chairops gmail: no crypto key source");
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptToken(plaintext: string): string {
  const key = cryptoKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("base64")}:${tag.toString("hex")}`;
}

export function decryptToken(stored: string): string | null {
  try {
    const [ivHex, encB64, tagHex] = stored.split(":");
    if (!ivHex || !encB64 || !tagHex) return null;
    const decipher = crypto.createDecipheriv(ALG, cryptoKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth2 consent URL builder
// ---------------------------------------------------------------------------

export function buildGmailConsentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; scope: string } | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.error("[chairops gmail] code exchange failed, status", res.status);
    return null;
  }
  const j = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };
  if (!j.refresh_token || !j.access_token) return null;
  return {
    refreshToken: j.refresh_token,
    accessToken: j.access_token,
    scope: j.scope ?? GMAIL_SCOPE,
  };
}

// ---------------------------------------------------------------------------
// Access token cache + refresh
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export async function getGmailConnection(orgId: string) {
  return prisma.chairopsGmailConnection.findUnique({ where: { orgId } });
}

export async function getAccessToken(orgId: string): Promise<string | null> {
  const conn = await getGmailConnection(orgId);
  if (!conn) return null;
  const refreshToken = decryptToken(conn.refreshTokenEnc);
  if (!refreshToken) return null;
  return refreshAccessToken(refreshToken);
}

// ---------------------------------------------------------------------------
// Gmail REST API helpers
// ---------------------------------------------------------------------------

/** Search Gmail messages. Returns message IDs + thread IDs. */
export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults = 20,
): Promise<Array<{ id: string; threadId: string }>> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    console.error("[chairops gmail] searchMessages failed", res.status);
    return [];
  }
  const j = (await res.json()) as { messages?: Array<{ id: string; threadId: string }> };
  return j.messages ?? [];
}

interface GmailPart {
  partId: string;
  mimeType: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  payload?: {
    mimeType: string;
    parts?: GmailPart[];
    filename?: string;
    body?: { attachmentId?: string; data?: string };
  };
}

/** Fetch message metadata (headers + part list, no attachment bytes). */
export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  return res.json() as Promise<GmailMessage>;
}

/** Download an attachment by attachmentId. Returns raw bytes as Buffer. */
export async function downloadAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: string };
  if (!j.data) return null;
  // Gmail uses URL-safe base64 (RFC 4648 §5)
  const standard = j.data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64");
}

/** Find all XLSX attachments in a message. */
export function findXlsxAttachments(msg: GmailMessage): Array<{
  filename: string;
  attachmentId: string;
  sizeBytes: number;
}> {
  const results: Array<{ filename: string; attachmentId: string; sizeBytes: number }> = [];

  function walkParts(parts: GmailPart[] | undefined) {
    if (!parts) return;
    for (const part of parts) {
      const fn = part.filename ?? "";
      const isXlsx =
        fn.toLowerCase().endsWith(".xlsx") ||
        fn.toLowerCase().endsWith(".xls") ||
        part.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        part.mimeType === "application/vnd.ms-excel";
      if (isXlsx && part.body?.attachmentId) {
        results.push({
          filename: fn || "attachment.xlsx",
          attachmentId: part.body.attachmentId,
          sizeBytes: part.body.size ?? 0,
        });
      }
      walkParts(part.parts);
    }
  }

  walkParts(msg.payload?.parts);
  return results;
}
