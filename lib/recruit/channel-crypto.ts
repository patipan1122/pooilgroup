// Envelope encryption for inbox channel access tokens
//
// Tokens stored as `<iv_hex>:<ciphertext_b64>:<auth_tag_hex>` so we can roll
// the wrapping key without losing old rows (re-encrypt on read).
//
// Key source: env `RECRUIT_CHANNEL_KEY` (base64 of 32 bytes).
// If env missing, we fall back to a deterministic dev key derived from
// NEXTAUTH_SECRET so local dev works without extra setup (warn in console).

import crypto from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12; // GCM standard

function getKey(): Buffer {
  const raw = process.env.RECRUIT_CHANNEL_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) {
      throw new Error("RECRUIT_CHANNEL_KEY must decode to 32 bytes (base64 of 32)");
    }
    return buf;
  }
  // Dev fallback — derive from NEXTAUTH_SECRET so dev environments work
  // without extra env. PROD MUST set RECRUIT_CHANNEL_KEY explicitly.
  const fallback = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!fallback) {
    throw new Error(
      "Missing RECRUIT_CHANNEL_KEY (or NEXTAUTH_SECRET fallback). " +
        "Generate: openssl rand -base64 32",
    );
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[channel-crypto] RECRUIT_CHANNEL_KEY not set — falling back to NEXTAUTH_SECRET derivation. " +
        "Set RECRUIT_CHANNEL_KEY explicitly in production.",
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
  // Backwards-compat: rows written before encryption was wired stored
  // raw token. Detect by absence of ":" pattern.
  if (!stored.includes(":")) {
    return stored;
  }
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
    console.error("[channel-crypto] decrypt failed", e);
    return null;
  }
}

/**
 * Verify HMAC-SHA256 signature for webhooks.
 * - LINE: signature is hex of HMAC-SHA256(rawBody, channelSecret) sent in X-Line-Signature
 *   (LINE uses base64, NOT hex — handled by `verifyLineSignature`)
 * - FB: signature is "sha256=<hex>" sent in X-Hub-Signature-256
 */
export function verifyLineSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  return safeEqual(computed, signature);
}

export function verifyFacebookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret) return false;
  if (!signature.startsWith("sha256=")) return false;
  const expectedHex = signature.slice("sha256=".length);
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(computed, expectedHex);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
