// Server-side helper that returns badge counts for the sidebar.
// One round-trip to compute everything the shell needs to render in headers.
//
// Add new counts here, then surface them in admin-shell SidebarBody.

import { unstable_cache } from "next/cache";
import { adminClient } from "@/lib/db/server";

export interface NavCounts {
  /** register_requests with status='pending' — admin should approve. */
  pendingRegisterRequests: number;
  /** branches that don't have a branch_manager — every branch should have one. */
  branchesMissingMgr: number;
  /** daily_reports awaiting manager approval (CashHub) — feeds Quick Approve Bar. */
  pendingCashReports: number;
}

/** Cache tags emitted per-org. Mutations that change badge counts should
 *  call `revalidateTag(navCountsTag(orgId))`. */
export function navCountsTag(orgId: string): string {
  return `nav-counts:${orgId}`;
}

async function loadNavCountsUncached(orgId: string): Promise<NavCounts> {
  const admin = adminClient();

  const [requestsQ, branchesQ, ubQ, pendingReportsQ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("register_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("branches")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_active", true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("user_branches")
      .select("user_id, branch_id, is_active, users!inner(role)")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .eq("users.role", "branch_manager"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("daily_reports")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "submitted"),
  ]);

  const branches = (branchesQ.data ?? []) as Array<{ id: string }>;
  const userBranchRows = (ubQ.data ?? []) as Array<{ branch_id: string }>;

  const branchHasMgr = new Set<string>();
  for (const r of userBranchRows) branchHasMgr.add(r.branch_id);

  const branchesMissingMgr = branches.filter(
    (b) => !branchHasMgr.has(b.id),
  ).length;

  return {
    pendingRegisterRequests: requestsQ.count ?? 0,
    branchesMissingMgr,
    pendingCashReports: pendingReportsQ.count ?? 0,
  };
}

// 30-second TTL — sidebar badges are tolerant of slight staleness and the
// underlying mutations (approve report, accept register request, set branch
// manager) revalidate the tag explicitly.
export async function loadNavCounts(orgId: string): Promise<NavCounts> {
  return unstable_cache(
    () => loadNavCountsUncached(orgId),
    ["nav-counts", orgId],
    { revalidate: 30, tags: [navCountsTag(orgId)] },
  )();
}
