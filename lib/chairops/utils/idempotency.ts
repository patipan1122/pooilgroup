// Idempotency key helper for maid mobile submissions.
//
// Each cash collection submission gets a unique client-generated key so that
// retries (offline → online, double-tap, network blip) don't create duplicates.
//
// Server side: lookup `idempotency_key` column on the row before inserting;
// if a row with the same key exists for this maid → return existing id.
//
// TODO[claude-design]: real impl wires to ChairopsCashCollection.idempotencyKey
// column (Wave 2 migration · BR9 follow-up). Wave 1: key is generated + passed
// through, server logs it in audit metadata for now.

/**
 * Generate a 21-char URL-safe idempotency key (nanoid-style).
 * No external dep — uses crypto.getRandomValues when available.
 */
export function newIdempotencyKey(): string {
  const ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const LEN = 21;
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    "getRandomValues" in globalThis.crypto
  ) {
    const bytes = new Uint8Array(LEN);
    globalThis.crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < LEN; i++) {
      const byte = bytes[i] ?? 0;
      out += ALPHABET[byte & 63];
    }
    return out;
  }
  // Fallback — non-cryptographic, should never run in modern browsers
  let out = "";
  for (let i = 0; i < LEN; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Validate an idempotency key shape (21 chars · URL-safe alphabet).
 * Server-side guard against garbage from untrusted clients.
 */
export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{21}$/.test(key);
}
