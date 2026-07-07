// Recruit — slug + ref-id generators
// slug = public link path (e.g. "driver-pooil-may2026-x4f2")
// refId = human-readable application ID (e.g. "APP-2026-A7K9X3M2")
//
// SECURITY (quality pass 2026-05-28): refId acts as a bearer token for
// /my/[refId] (no auth · ใครก็ดูสถานะใบสมัครได้ถ้ามี refId). Math.random()
// gives only ~20 bits of effective entropy — guessable in seconds.
// Switched to crypto.randomBytes for ~40 bits via 8 base32-ish chars.

import { randomBytes } from "node:crypto";

// Base32 (Crockford-ish · ไม่มี I/L/O/U/0/1 เพื่อลด typo confusion)
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomSuffix(len = 4): string {
  // Used for slug · low-stakes (slug also bounded by uniqueness on insert).
  // Keep crypto for consistency / no Math.random in security-adjacent code.
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length]!;
  }
  return out.toLowerCase();
}

function cryptoRandomCode(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length]!;
  }
  return out;
}

// Thai → Latin transliteration (readability only · uniqueness comes from the
// random suffix). Rough RTGS-ish char map — NOT linguistically perfect, just
// enough for a readable ASCII slug. Tone marks / unknown Thai chars → dropped.
//
// WHY ASCII-ONLY (2026-07-07): Next.js on Vercel does NOT match dynamic route
// segments that contain non-ASCII (Thai) chars → /apply/<thai-slug> 404s at the
// routing layer before the page ever runs. Keeping Thai in the slug (old regex
// `[^฀-๿a-z0-9\s-]`) made every Thai-titled posting's apply link dead. So we
// romanize Thai → ASCII here and strip anything non-[a-z0-9-].
// NOTE: keys are quoted string literals on purpose — bare Thai vowel/tone-mark
// keys (combining marks) are not valid JS identifiers and the SWC lexer (Node
// strip-types + Vercel/Next build) rejects them.
const THAI_TO_LATIN: Record<string, string> = {
  // consonants
  "ก": "k", "ข": "kh", "ฃ": "kh", "ค": "kh", "ฅ": "kh", "ฆ": "kh", "ง": "ng",
  "จ": "ch", "ฉ": "ch", "ช": "ch", "ซ": "s", "ฌ": "ch", "ญ": "y",
  "ฎ": "d", "ฏ": "t", "ฐ": "th", "ฑ": "th", "ฒ": "th", "ณ": "n",
  "ด": "d", "ต": "t", "ถ": "th", "ท": "th", "ธ": "th", "น": "n",
  "บ": "b", "ป": "p", "ผ": "ph", "ฝ": "f", "พ": "ph", "ฟ": "f", "ภ": "ph", "ม": "m",
  "ย": "y", "ร": "r", "ฤ": "rue", "ล": "l", "ฦ": "lue", "ว": "w",
  "ศ": "s", "ษ": "s", "ส": "s", "ห": "h", "ฬ": "l", "อ": "o", "ฮ": "h",
  // vowels + carriers
  "ะ": "a", "ั": "a", "า": "a", "ำ": "am", "ิ": "i", "ี": "i", "ึ": "ue", "ื": "ue",
  "ุ": "u", "ู": "u", "เ": "e", "แ": "ae", "โ": "o", "ใ": "ai", "ไ": "ai", "ๅ": "a",
  // thai digits
  "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
  "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
};

function romanizeThai(input: string): string {
  // Leading vowels (เ แ โ ใ ไ) are written before their consonant but spoken
  // after it — swap so the romanization reads in spoken order (แม่ → mae).
  const reordered = input.replace(/([เแโใไ])([ก-ฮ])/g, "$2$1");
  let out = "";
  for (const ch of reordered) {
    if (ch >= "฀" && ch <= "๿") {
      out += THAI_TO_LATIN[ch] ?? ""; // tone marks / unmapped Thai → drop
    } else {
      out += ch; // latin / digits / space / dash pass through
    }
  }
  return out;
}

/** Convert Thai/English string to an ASCII-safe URL slug. */
export function slugify(input: string): string {
  return romanizeThai(input.normalize("NFC"))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // ASCII only — non-ASCII paths 404 on Vercel
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Generate a unique slug from title + random suffix. */
export function makePostingSlug(title: string): string {
  const base = slugify(title);
  const suffix = randomSuffix(4);
  return base ? `${base}-${suffix}` : `post-${Date.now()}-${suffix}`;
}

/**
 * Generate application ref ID — acts as a bearer token for the public
 * /my/[refId] page so MUST be unguessable.
 *
 * Format: `APP-<YYYY>-<8 char base32>` → ~40 bits entropy.
 * Example: `APP-2026-A7K9X3M2`
 */
export function makeApplicationRefId(): string {
  const year = new Date().getFullYear();
  return `APP-${year}-${cryptoRandomCode(8)}`;
}

/**
 * Format check for `APP-YYYY-XXXXXXXX` ref IDs.
 * Backwards-compat: legacy 6-digit numeric refIds (`APP-YYYY-NNNNNN`) still pass.
 * Also passes inbox-anchor refIds (`INBOX-YYYY-NNNNNN`).
 */
export function isValidApplicationRefId(input: string): boolean {
  if (typeof input !== "string") return false;
  if (input.length > 32 || input.length < 10) return false;
  return /^(APP|INBOX)-\d{4}-[A-Z0-9]{6,10}$/i.test(input);
}
