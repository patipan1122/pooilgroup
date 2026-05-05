// Selected-company context — global filter that lives in a cookie
// Used by all CashHub pages (and beyond) to scope data by legal entity.
//
// "all" or empty = show everything for the org.
// {companyId} = show only that company.

import { cookies } from "next/headers";
import { adminClient } from "../db/server";
import {
  COMPANY_COOKIE_NAME as COOKIE_NAME,
  COMPANY_COOKIE_MAX_AGE as COOKIE_MAX_AGE,
} from "./company-context-shared";

export async function readCompanyCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const v = jar.get(COOKIE_NAME)?.value;
  if (!v || v === "all") return undefined;
  return v;
}

/**
 * Resolve the active company filter. Precedence:
 *   explicit URL param > cookie > undefined (= all)
 */
export async function resolveCompanyFilter(
  urlParam: string | undefined,
): Promise<string | undefined> {
  if (urlParam === "all") return undefined;
  if (urlParam) return urlParam;
  return readCompanyCookie();
}

export async function loadCompaniesForOrg(
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

// Re-export shared constants for backwards compatibility (callers can also import from -shared)
export {
  COMPANY_COOKIE_NAME,
  COMPANY_COOKIE_MAX_AGE,
} from "./company-context-shared";
