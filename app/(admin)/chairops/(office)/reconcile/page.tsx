// Reconcile v2 — ORG view ("ทุกสาขารวม").
//
// Full mockup-v2 layout (reconcile-v2.jsx): 2-column workspace · branch sidebar
// + main (breadcrumb · title · freshness · cumulative-drift hero · Ledger /
// Timeline / Periods tabs). Tab is URL-driven via ?view=. The old sortable
// drift table is replaced by the Ledger tab.
//
// Side-effects (kept GET-driven for back-compat with header buttons):
//   ?recompute=1 → recomputeAllDrifts() then redirect clean
// CSV export lives in ./export/route.ts (Route Handler · streams text/csv).
//
// DISPLAY ONLY · does not touch the drift formula
// ([[chairops-no-cumulative-shortage]]). requireRole("OFFICE").

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { recomputeAllDrifts } from "@/lib/chairops/reconcile/drift-engine";
import {
  ReconcileShell,
  normalizeView,
} from "./_components/reconcile-shell";
import { ClosePeriodButton } from "./_components/close-period-button";

export default async function ReconcileOrgPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    recompute?: string;
    from?: string;
    to?: string;
    missingSlip?: string;
    all?: string;
    page?: string;
    day?: string;
  }>;
}) {
  const session = await requireRole("OFFICE");
  const orgId = session.poolUser.org_id;
  const sp = await searchParams;

  if (sp.recompute === "1") {
    await recomputeAllDrifts(orgId);
    redirect("/chairops/reconcile");
  }

  const view = normalizeView(sp.view);
  const canClosePeriod = isSuperAdmin(session.poolUser.role);

  return (
    <div className="chairops-scope space-y-3">
      {canClosePeriod && (
        <div className="px-4 pt-4 sm:px-6">
          <ClosePeriodButton />
        </div>
      )}
      <ReconcileShell
        orgId={orgId}
        branchId={null}
        branchName={null}
        view={view}
        from={sp.from}
        to={sp.to}
        missingSlip={sp.missingSlip === "1"}
        allTime={sp.all === "1"}
        page={sp.page ? Number(sp.page) : 0}
        day={sp.day}
      />
    </div>
  );
}
