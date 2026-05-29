// Inbox channel crypto — self-contained (envelope AES-256-GCM + webhook HMAC).
// Decoupled from the Recruit env: key source order is
//   RECRUIT_CHANNEL_KEY (base64 of 32 bytes)  → preferred if ever set
//   SUPABASE_SERVICE_ROLE_KEY                  → always present in prod (sha256→32B)
//   NEXTAUTH_SECRET / AUTH_SECRET / DATABASE_URL → dev fallbacks
// Encrypt + decrypt run in the same deployment env, so tokens round-trip fine.

import crypto from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12; // GCM standard

function getKey(): Buffer {
  const raw = process.env.RECRUIT_CHANNEL_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  const fallback =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.DATABASE_URL;
  if (!fallback) {
    throw new Error(
      "inbox crypto: no key source (set RECRUIT_CHANNEL_KEY or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("base64")}:${tag.toString("hex")}`;
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  // Backwards-compat: rows written before encryption stored raw token.
  if (!stored.includes(":")) return stored;
  try {
    const [ivHex, encB64, tagHex] = stored.split(":");
    if (!ivHex || !encB64 || !tagHex) return null;
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const enc = Buffer.from(encB64, "base64");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch (e) {
    console.error("[inbox crypto] decrypt failed", e);
    return null;
  }
}

/** LINE: base64 HMAC-SHA256 in X-Line-Signature. */
export function verifyLineSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const computed = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(computed, signature);
}

/** FB: "sha256=<hex>" in X-Hub-Signature-256. */
export function verifyFacebookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  if (!signature.startsWith("sha256=")) return false;
  const expectedHex = signature.slice("sha256=".length);
  const computed = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(computed, expectedHex);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
