// Resolve the active company/branch scope for a Ledger page from its
// searchParams (?company=&branch=). Falls back to the first company in the org
// so a page always has a concrete company_id to scope queries by.
//
// Used by every /ledger/* page. Multi-tenant: caller already has org_id from
// session; this only picks WHICH company/branch within that org.

import { listCompanies, listBranches } from "@/lib/ledger/queries";

export type LedgerScope = {
  orgId: string;
  companyId: string | null;
  branchId: string | null;
  companies: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string; businessType: string }>;
};

export async function resolveScope(
  orgId: string,
  sp: { company?: string; branch?: string },
): Promise<LedgerScope> {
  const companies = await listCompanies(orgId);

  // Pick company: explicit param (must be in org) > first company > null.
  let companyId: string | null = null;
  if (sp.company && companies.some((c) => c.id === sp.company)) {
    companyId = sp.company;
  } else if (companies.length > 0) {
    companyId = companies[0].id;
  }

  const branches = companyId ? await listBranches(orgId, companyId) : [];

  // Branch must belong to the selected company, else ignore (= all branches).
  const branchId =
    sp.branch && branches.some((b) => b.id === sp.branch) ? sp.branch : null;

  return { orgId, companyId, branchId, companies, branches };
}
