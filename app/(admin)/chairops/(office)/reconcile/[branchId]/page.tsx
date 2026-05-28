// Reconcile v2 — BRANCH view (scoped to one branch).
//
// Renders the SAME mockup-v2 workspace as the org page (ReconcileShell) but
// scoped to the selected branch: sidebar with this branch active, freshness +
// cumulative-drift hero for the branch, and Ledger / Timeline / Periods tabs
// (URL ?view=). Below the workspace we keep the existing write-off request form
// (target of the Periods "สร้าง write-off" button via #write-off) and the
// recompute action — so the operator flow is preserved end-to-end.
//
// Side-effects:
//   ?recompute=1 → recompute this branch then redirect clean
// CSV export → ../export/route.ts?branchId=...
//
// DISPLAY ONLY for the reconcile math ([[chairops-no-cumulative-shortage]]).
// requireRole("OFFICE").

import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { requestWriteOff } from "../../../reconcile/actions";
import {
  ReconcileShell,
  normalizeView,
} from "../_components/reconcile-shell";

export default async function ReconcileBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{
    view?: string;
    recompute?: string;
    error?: string;
    disputed?: string;
  }>;
}) {
  const session = await requireRole("OFFICE");
  const orgId = session.poolUser.org_id;
  const { branchId } = await params;
  const sp = await searchParams;

  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId },
    select: { id: true, name: true },
  });
  if (!branch) notFound();

  if (sp.recompute === "1") {
    await recomputeDriftForBranch(branchId);
    redirect(`/chairops/reconcile/${branchId}`);
  }

  const view = normalizeView(sp.view);

  return (
    <>
      <ReconcileShell
        orgId={orgId}
        branchId={branchId}
        branchName={branch.name}
        view={view}
      />

      {/* error / success ribbons (preserve old dispute/write-off feedback) */}
      <div style={{ padding: "0 22px" }}>
        {sp.error && (
          <div
            className="card"
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderColor: "var(--crit-border)",
              background: "var(--crit-soft)",
              color: "var(--crit)",
              fontSize: 13,
            }}
          >
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.disputed && (
          <div
            className="card"
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderColor: "var(--ok-border)",
              background: "var(--ok-soft)",
              color: "var(--ok)",
              fontSize: 13,
            }}
          >
            บันทึก dispute เรียบร้อย · log ไปที่ผู้ที่เกี่ยวข้องแล้ว
          </div>
        )}
      </div>

      {/* Write-off request form — target of Periods "สร้าง write-off" button */}
      <section
        id="write-off"
        className="card"
        style={{ margin: "16px 22px 32px", padding: 18, maxWidth: 520 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>
            ขอตัดเงินขาด · write-off
          </h2>
          <span className="chip chip-accent" style={{ fontSize: 11 }}>
            BR15 maker-checker
          </span>
        </div>
        <p className="text-3" style={{ fontSize: 12, marginBottom: 12 }}>
          ใช้เมื่อ drift หาคืนไม่ได้ · &lt;500฿ ใช้ MANAGER อนุมัติ · ≥500฿
          ต้องให้ CEO
        </p>
        <form action={requestWriteOff} aria-label="แบบฟอร์มขอตัดเงินขาด">
          <input type="hidden" name="branchId" value={branchId} />
          <label
            htmlFor="wo-amount"
            className="text-2"
            style={{ display: "block", fontSize: 12, fontWeight: 600 }}
          >
            จำนวนเงิน (บาท)
          </label>
          <input
            id="wo-amount"
            type="number"
            name="amount"
            min={1}
            max={1_000_000}
            required
            className="input mono"
            style={{ margin: "4px 0 12px" }}
          />
          <label
            htmlFor="wo-reason"
            className="text-2"
            style={{ display: "block", fontSize: 12, fontWeight: 600 }}
          >
            เหตุผล
          </label>
          <textarea
            id="wo-reason"
            name="reason"
            required
            rows={3}
            minLength={5}
            maxLength={500}
            placeholder="เช่น แม่บ้านลาออก · ยอดหายไป · POS รายงานผิด"
            className="input"
            style={{ margin: "4px 0 12px", resize: "vertical" }}
          />
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            ส่งคำขอ
          </button>
        </form>
      </section>
    </>
  );
}
