// FuelOS GPS · xsense credential crypto — envelope AES-256-GCM.
// RULE J: owns key `FUELOS_XSENSE_CRYPTO_KEY`. DECRYPT tries every candidate so
// rotating the key never bricks stored secrets. Falls back to a derived key when
// the dedicated env isn't set (works before it's configured in Vercel).
import crypto from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;

function b64Key32(v: string | undefined): Buffer | null {
  if (!v) return null;
  const buf = Buffer.from(v, "base64");
  return buf.length === 32 ? buf : null;
}

function candidateKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const own = b64Key32(process.env.FUELOS_XSENSE_CRYPTO_KEY);
  if (own) keys.push(own);
  const derivedSrc =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.DATABASE_URL;
  if (derivedSrc) keys.push(crypto.createHash("sha256").update(derivedSrc).digest());
  return keys;
}

export function encryptCredential(plaintext: string): string {
  if (!plaintext) return "";
  const [key] = candidateKeys();
  if (!key) throw new Error("fuelos gps crypto: no key source (set FUELOS_XSENSE_CRYPTO_KEY or SUPABASE_SERVICE_ROLE_KEY)");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("base64")}:${tag.toString("hex")}`;
}

export function decryptCredential(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.includes(":")) return stored;
  const [ivHex, encB64, tagHex] = stored.split(":");
  if (!ivHex || !encB64 || !tagHex) return null;
  const iv = Buffer.from(ivHex, "hex");
  const enc = Buffer.from(encB64, "base64");
  const tag = Buffer.from(tagHex, "hex");
  for (const key of candidateKeys()) {
    try {
      const d = crypto.createDecipheriv(ALG, key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
    } catch {
      /* try next */
    }
  }
  console.error("[fuelos gps crypto] decrypt failed under all keys — re-save the api key.");
  return null;
}
