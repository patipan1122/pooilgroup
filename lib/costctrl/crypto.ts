// CostCtrl crypto envelope (AES-256-GCM)
// Separate key from Inbox/Recruit per blast-radius principle:
// rotating COSTCTRL_CRYPTO_KEY only bricks provider tokens (re-pasteable),
// NOT 43 channel tokens like RECRUIT_CHANNEL_KEY would.
//
// Key resolution order:
//   COSTCTRL_CRYPTO_KEY (base64 of 32 bytes)  → preferred
//   SUPABASE_SERVICE_ROLE_KEY                  → derived fallback (always present in prod)
//   NEXTAUTH_SECRET / AUTH_SECRET / DATABASE_URL → dev fallback

import crypto from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;

let warnedFallback = false;

function getKey(): Buffer {
  const raw = process.env.COSTCTRL_CRYPTO_KEY;
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
      "costctrl crypto: no key source (set COSTCTRL_CRYPTO_KEY or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  if (
    !warnedFallback &&
    process.env.NODE_ENV === "production" &&
    !process.env.COSTCTRL_CRYPTO_KEY
  ) {
    warnedFallback = true;
    console.warn(
      "[costctrl crypto] COSTCTRL_CRYPTO_KEY missing in prod — using derived key fallback. " +
        "Rotating SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL will brick every stored provider token.",
    );
  }
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptCredential(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("base64")}:${tag.toString("hex")}`;
}

export function decryptCredential(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.includes(":")) return stored; // backwards-compat
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
    console.error("[costctrl crypto] decrypt failed", e);
    return null;
  }
}

/** Mask a token for display: first 4 + last 4 chars · stars in between */
export function maskCredential(plaintext: string): string {
  if (!plaintext) return "—";
  if (plaintext.length <= 10) return "•".repeat(plaintext.length);
  return `${plaintext.slice(0, 4)}${"•".repeat(Math.min(plaintext.length - 8, 24))}${plaintext.slice(-4)}`;
}
