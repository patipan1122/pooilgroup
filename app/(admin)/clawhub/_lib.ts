// ClawHub admin — small server-side helpers shared across pages (formatting +
// the action authz guard). Pure utilities, no "use server" (imported by both
// Server Components and the "use server" actions file).

import { requireClawhubAdmin } from "@/lib/clawhub/access";
import type { Session } from "@/lib/auth/session";

/** Generic result shape every ClawHub admin server action returns. */
export type ActionResult = { ok: boolean; error?: string };

/**
 * Authorize a ClawHub admin server action. Server actions are direct POST
 * endpoints — the layout's gate does NOT protect them — so every action must
 * re-check. Returns the session; throws/redirects (via requireClawhubAdmin)
 * on failure exactly like the page gate.
 */
export async function authorizeAction(): Promise<Session> {
  return requireClawhubAdmin();
}

const BAHT = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const DT = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const DATE = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
});

export function fmtBaht(n: number | null | undefined): string {
  return BAHT.format(Number(n ?? 0));
}
export function fmtNum(n: number | null | undefined): string {
  return BAHT.format(Number(n ?? 0));
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DT.format(new Date(d));
}
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DATE.format(new Date(d));
}

/** Confidence (Decimal 0..1) → percent string, or "—" when null. */
export function fmtConfidence(c: unknown): string {
  if (c == null) return "—";
  const n = typeof c === "number" ? c : Number(c);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}
