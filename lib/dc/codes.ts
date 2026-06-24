// DC Warehouse · document code + idempotency-key generators.
// Pure helpers (no server-only imports) — safe to import anywhere.

function yymmdd(d = new Date()): string {
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function rand(n = 4): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Human-readable doc code · e.g. PO-260624-7K3M */
export function genCode(prefix: string): string {
  return `${prefix}-${yymmdd()}-${rand()}`;
}

export const poCode = () => genCode("PO");
export const grnCode = () => genCode("GRN");
export const transferCode = () => genCode("TF");
export const shipmentCode = () => genCode("SH");
export const warehouseCode = () => genCode("WH");

/**
 * Build a DB-level idempotency key for a stock movement.
 * Every movement carries one (unique per org). A retry/replay of the SAME
 * source op produces the SAME key → @@unique([orgId, sourceKey]) makes the
 * second insert a no-op (the precondition the workshop locked).
 */
export function sourceKey(...parts: (string | number)[]): string {
  return parts.map(String).join(":");
}
