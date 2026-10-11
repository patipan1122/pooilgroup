// Hotfix 2026-10-11: resolveCompanyFilter() (Phase 1 of the company-isolation
// project, commit 5d2c3af2) stopped returning undefined for "all companies" —
// it now always resolves to one concrete company. RecruitJobPosting.companyId
// is deliberately NULLABLE by original design ("optional · CEO said 'use
// together'") — 32 of 52 real postings have no company at all. A plain
// `{ companyId: companyFilter }` equality filter never matches NULL in SQL,
// so those 32 postings (62%) silently vanished under EVERY company selection
// after Phase 1 shipped. These helpers restore "company-specific postings
// filtered correctly, company-less postings always visible" — the actual
// intended behavior, not a return to "no filter at all."
export function postingCompanyScope(companyFilter: string) {
  return companyFilter
    ? { OR: [{ companyId: companyFilter }, { companyId: null }] }
    : {};
}

// Same shape, for queries that filter through a relation to the posting
// (e.g. recruitApplication.posting.companyId) rather than the posting table
// directly.
export function relatedPostingCompanyScope(companyFilter: string) {
  return companyFilter
    ? { posting: { OR: [{ companyId: companyFilter }, { companyId: null }] } }
    : {};
}
