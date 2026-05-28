import { z } from "zod";

// Lenient UUID validator — accepts any 36-char hex UUID format including
// non-RFC seed placeholders like `00000000-0000-0000-0000-0000000000a1`
// (Pooilgroup uses these for company seed IDs: Pooil Oil = ...0a1, etc.).
//
// Zod v4+ tightened the built-in uuid validator to enforce RFC 4122 version
// bit (1-8) and variant bit (8/9/a/b), which rejects our seed UUIDs and breaks
// every API route that validates a company_id / branch_id coming from the DB.
// Use zUUID() project-wide until the seed scheme is migrated.
//
// Safety: loose format check is OK because Supabase RLS + DB foreign keys are
// the real validation layer — a malformed UUID would fail the DB query anyway.
const UUID_LENIENT_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function zUUID(message?: string) {
  return z.string().regex(UUID_LENIENT_RE, message ?? "Invalid UUID");
}
