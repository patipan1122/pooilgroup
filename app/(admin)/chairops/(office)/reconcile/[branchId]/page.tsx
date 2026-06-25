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
import {
  ReconcileShell,
  normalizeView,
} from "../_components/reconcile-shell";
import { WriteOffForm } from "./write-off-form";

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
    from?: string;
    to?: string;
    missingSlip?: string;
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
  // Bangkok "today" — default + max for the write-off "ตั้งต้น ณ วันที่" picker.
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  return (
    <>
      <ReconcileShell
        orgId={orgId}
        branchId={branchId}
        branchName={branch.name}
        view={view}
        from={sp.from}
        to={sp.to}
        missingSlip={sp.missingSlip === "1"}
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
            ตัดเงินขาด/เกิน · ตั้งต้นใหม่
          </h2>
          <span className="chip chip-accent" style={{ fontSize: 11 }}>
            BR15 maker-checker
          </span>
        </div>
        <p className="text-3" style={{ fontSize: 12, marginBottom: 12 }}>
          เลือกวันตั้งต้น → ระบบคิดยอดหาย/เกินสะสมถึงวันนั้นให้ · ส่งเป็นคำขออนุมัติ
          (&lt;500฿ ใช้ MANAGER · ≥500฿ ต้องให้ CEO) · อนุมัติแล้วยอดเริ่มนับใหม่จากวันนั้น
        </p>
        <WriteOffForm branchId={branchId} today={today} />
      </section>
    </>
  );
}
