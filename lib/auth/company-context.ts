// Selected-company context — global filter that lives in a cookie
// Used by all CashHub pages (and beyond) to scope data by legal entity.
//
// CEO decision 2026-10-10: there is no "all/none" state anymore — every page
// must always be scoped to exactly one concrete company, no combined view
// survives anywhere (previously "all"/empty cookie meant "show everything").
// readCompanyCookie() stays a raw, possibly-undefined primitive (first login,
// before the switcher has ever been touched). resolveCompanyFilter() is the
// "always concrete" entrypoint pages should use — it falls back to the first
// company in the org (by code) when nothing is selected yet, mirroring the
// same fallback app/(admin)/ledger/_scope.ts already uses.

import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { adminClient } from "../db/server";
import { COMPANY_COOKIE_NAME as COOKIE_NAME } from "./company-context-shared";

export async function readCompanyCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const v = jar.get(COOKIE_NAME)?.value;
  if (!v || v === "all") return undefined;
  return v;
}

/**
 * Resolve the active company filter — ALWAYS a concrete company id (never
 * "all"/undefined). Precedence:
 *   explicit URL param (if it's a real company in this org) >
 *   cookie (if it's a real company in this org) >
 *   first company in the org, ordered by code (same tie-break as
 *   app/(admin)/ledger/_scope.ts's resolveScope()).
 *
 * Returns "" only when the org has zero active companies configured at all
 * (not a real scenario for Pooilgroup today — 2 companies always exist —
 * but kept so a brand-new/mid-setup org degrades to an empty result instead
 * of throwing). Callers should treat "" as "nothing to show yet".
 */
export async function resolveCompanyFilter(
  orgId: string,
  urlParam: string | undefined,
): Promise<string> {
  const companies = await loadCompaniesForOrg(orgId);
  if (companies.length === 0) return "";

  const cookieVal = await readCompanyCookie();
  const candidate = urlParam && urlParam !== "all" ? urlParam : cookieVal;
  if (candidate && companies.some((c) => c.id === candidate)) return candidate;
  return companies[0].id;
}

async function _loadCompaniesForOrg(
  orgId: string,
): Promise<Array<{ id: string; code: string; name: string }>> {
  try {
    const admin = adminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (admin.from as any)("companies")
      .select("id, code, name")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("code");
    return res.data ?? [];
  } catch {
    return [];
  }
}

// Cached: companies change rarely (5 entities at Pooilgroup). Mutations
// in /companies routes must call revalidateTag(`companies-${orgId}`).
export const loadCompaniesForOrg = unstable_cache(
  _loadCompaniesForOrg,
  ["companies-for-org"],
  { revalidate: 3600, tags: ["companies"] },
);

export function companiesCacheTag(orgId: string) {
  return `companies-${orgId}`;
}

// Re-export shared constants for backwards compatibility (callers can also import from -shared)
export {
  COMPANY_COOKIE_NAME,
  COMPANY_COOKIE_MAX_AGE,
} from "./company-context-shared";
