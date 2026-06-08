// Inbox channel crypto — self-contained (envelope AES-256-GCM + webhook HMAC).
// RULE J (D-021): this module OWNS its key `INBOX_CHANNEL_KEY`, so another
// program's env change (e.g. adding RECRUIT_CHANNEL_KEY) can never flip inbox's
// key and brick its stored tokens again.
//
// Backward-compatible BY DESIGN — this is what guarantees no other channel/bot
// breaks: ENCRYPT always uses the preferred key, but DECRYPT tries EVERY
// candidate key in order until one verifies. So a secret written under an older
// key (RECRUIT_CHANNEL_KEY, or the SUPABASE-derived fallback) STILL decrypts —
// nothing already working breaks, and a secret stranded by a past key change is
// recovered automatically (no re-save needed). AES-GCM's auth tag guarantees
// only the correct key yields valid plaintext, so trying several is safe.
//
// Candidate order (ENCRYPT uses [0]; DECRYPT tries all):
//   1. INBOX_CHANNEL_KEY (base64 32B)            → this module's own key (preferred)
//   2. RECRUIT_CHANNEL_KEY (base64 32B)          → legacy shared key (decrypt compat)
//   3. sha256(SUPABASE_SERVICE_ROLE_KEY ?? NEXTAUTH_SECRET ?? AUTH_SECRET ?? DATABASE_URL)
//                                                → derived fallback (decrypt compat)

import crypto from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12; // GCM standard

let warnedNoOwnKey = false;

function b64Key32(v: string | undefined): Buffer | null {
  if (!v) return null;
  const buf = Buffer.from(v, "base64");
  return buf.length === 32 ? buf : null;
}

// Every key this deployment can use, most-preferred first. ENCRYPT uses the
// first; DECRYPT tries each so older ciphertext still opens (no breakage).
function candidateKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const own = b64Key32(process.env.INBOX_CHANNEL_KEY);
  if (own) keys.push(own);
  const shared = b64Key32(process.env.RECRUIT_CHANNEL_KEY);
  if (shared) keys.push(shared);
  const derivedSrc =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.DATABASE_URL;
  if (derivedSrc) {
    keys.push(crypto.createHash("sha256").update(derivedSrc).digest());
  }

  // Honest observability (CH-001): note when inbox isn't yet on its own key.
  if (
    !warnedNoOwnKey &&
    process.env.NODE_ENV === "production" &&
    !process.env.INBOX_CHANNEL_KEY
  ) {
    warnedNoOwnKey = true;
    console.warn(
      "[inbox crypto] INBOX_CHANNEL_KEY not set — new secrets encrypt under a " +
        "shared/derived key. Set INBOX_CHANNEL_KEY (base64 32B) so inbox owns its key (RULE J).",
    );
  }
  return keys;
}

function encryptKey(): Buffer {
  const [preferred] = candidateKeys();
  if (!preferred) {
    throw new Error(
      "inbox crypto: no key source (set INBOX_CHANNEL_KEY or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return preferred;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return "";
  const key = encryptKey();
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
  const [ivHex, encB64, tagHex] = stored.split(":");
  if (!ivHex || !encB64 || !tagHex) return null;
  const iv = Buffer.from(ivHex, "hex");
  const enc = Buffer.from(encB64, "base64");
  const tag = Buffer.from(tagHex, "hex");
  // Try every candidate key — only the one it was encrypted under passes the
  // GCM auth tag; wrong keys throw and are skipped. This is why deploying a new
  // key never breaks already-stored secrets.
  for (const key of candidateKeys()) {
    try {
      const decipher = crypto.createDecipheriv(ALG, key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString("utf8");
    } catch {
      /* wrong key — try the next candidate */
    }
  }
  console.error(
    "[inbox crypto] decrypt failed under ALL candidate keys — secret was encrypted " +
      "under a key this deployment no longer has. Re-save the channel secret.",
  );
  return null;
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
