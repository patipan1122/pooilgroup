// Repair — ticket code generator + tracking helpers
// Format: RP-{พ.ศ. YYYY}-{NNNN}  e.g. RP-2569-0001
// Generation is delegated to the DB function `repair_next_ticket_code(org)` for
// atomic per-org sequencing. This file holds the JS-side fallback + parsers.

import crypto from "node:crypto";

export function buddhistYear(date: Date = new Date()): string {
  return (date.getFullYear() + 543).toString();
}

/** JS fallback (only used if DB RPC is unreachable in tests). */
export function makeTicketCodeFallback(seq: number, date: Date = new Date()): string {
  return `RP-${buddhistYear(date)}-${seq.toString().padStart(4, "0")}`;
}

const TICKET_CODE_RE = /^RP-(\d{4})-(\d{4,6})$/;

/** Validate user-entered ticket code (loose). */
export function parseTicketCode(input: string): { year: string; seq: number } | null {
  const m = TICKET_CODE_RE.exec(input.trim().toUpperCase());
  if (!m) return null;
  return { year: m[1], seq: parseInt(m[2], 10) };
}

/** Normalize input to canonical RP-YYYY-NNNN form (or null if invalid). */
export function normalizeTicketCode(input: string): string | null {
  const parsed = parseTicketCode(input);
  if (!parsed) return null;
  return `RP-${parsed.year}-${parsed.seq.toString().padStart(4, "0")}`;
}

/** Random URL-safe token (vendor magic link, tracking session). */
export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Loose Thai phone validation — 9-10 digit numbers, optional country code. */
const PHONE_RE = /^(?:\+?66|0)?(\d{8,9})$/;

export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  const m = PHONE_RE.exec(cleaned);
  if (!m) return null;
  // Always store as 0xxxxxxxxx (Thai local format) for matching
  return "0" + m[1];
}
