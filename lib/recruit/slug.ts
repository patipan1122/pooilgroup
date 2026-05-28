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

/** Convert Thai/English string to URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^฀-๿a-z0-9\s-]/g, "") // keep Thai, alphanum, space, dash
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
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
