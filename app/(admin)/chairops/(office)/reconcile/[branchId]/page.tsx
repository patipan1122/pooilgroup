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
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { getBranchReconcileSummary } from "@/lib/chairops/reconcile/ledger-push";
import { adminClient } from "@/lib/db/server";
import { listCompanies, listBankAccounts } from "@/lib/cashhub/amazon-settlement-data";
import { thaiDate } from "@/lib/chairops/utils/format";
import {
  ReconcileShell,
  normalizeView,
} from "../_components/reconcile-shell";
import { WriteOffForm } from "./write-off-form";
import { ReconcileAccountSection } from "./reconcile-account-section";

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
    all?: string;
    page?: string;
    day?: string;
    pcv?: string;
    chair?: string;
    month?: string;
    reconcileConfigSaved?: string;
    reconcileSent?: string;
    reconcileSkippedReview?: string;
  }>;
}) {
  const session = await requireRole("OFFICE");
  const orgId = session.poolUser.org_id;
  const { branchId } = await params;
  const sp = await searchParams;

  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId },
    select: {
      id: true,
      name: true,
      reconcileCompanyId: true,
      reconcileBankAccountId: true,
    },
  });
  if (!branch) notFound();

  // CEO 2026-08-15: บริษัท/บัญชีธนาคาร + สรุปยอดฝากที่พร้อมส่งเข้า reconcile
  const admin = adminClient();
  const [companies, bankAccounts, reconcileSummary] = await Promise.all([
    listCompanies(admin, orgId),
    listBankAccounts(admin, orgId),
    getBranchReconcileSummary(orgId, branchId),
  ]);

  if (sp.recompute === "1") {
    await recomputeDriftForBranch(branchId);
    redirect(`/chairops/reconcile/${branchId}`);
  }

  const view = normalizeView(sp.view);
  // Bangkok "today" — default + max for the write-off "ตั้งต้น ณ วันที่" picker.
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  // Write-off log for THIS branch — surfaced on the page so an approved
  // "ตั้งต้น" that pulls the drift to 0 is EXPLAINED (CEO 2026-06-25: "อยู่ดี ๆ
  // ทำไมเป็น 0 — ต้องเคลียร์ว่ามีการตัดเงิน เหตุผลอะไร"). Org-scoped.
  const branchWriteOffs = await prisma.chairopsWriteOff.findMany({
    where: { branchId, orgId, status: { in: ["PENDING", "APPROVED"] } },
    orderBy: [{ effectiveDate: "desc" }, { makerAt: "desc" }],
    take: 20,
    select: {
      id: true,
      amount: true,
      direction: true,
      effectiveDate: true,
      reason: true,
      status: true,
      makerAt: true,
      approverAt: true,
      maker: { select: { displayName: true } },
      approver: { select: { displayName: true } },
    },
  });

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
        allTime={sp.all === "1"}
        page={sp.page ? Number(sp.page) : 0}
        day={sp.day}
        perChairView={
          sp.pcv === "summary"
            ? "summary"
            : sp.pcv === "activity"
              ? "activity"
              : "daily"
        }
        chair={sp.chair}
        canManage={isSuperAdmin(session.poolUser.role)}
        month={sp.month}
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
        {sp.reconcileConfigSaved && (
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
            บันทึกบริษัท/บัญชีธนาคารของสาขานี้แล้ว
          </div>
        )}
        {sp.reconcileSent != null && (
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
            ส่งเข้าบัญชี reconcile แล้ว {sp.reconcileSent} ใบ
            {Number(sp.reconcileSkippedReview ?? 0) > 0
              ? ` · ข้าม ${sp.reconcileSkippedReview} ใบ (รอตรวจสอบ requiresReview ก่อน)`
              : ""}
          </div>
        )}
      </div>

      {/* CEO 2026-08-15: ส่งยอดฝากเข้าบัญชี reconcile (LedgerLine bank-recon) —
          ตั้งค่าบริษัท/บัญชีธนาคาร แล้วกดส่งทั้งสาขา · กันส่งซ้ำอัตโนมัติ.
          CEO 2026-08-16: ย้ายขึ้นมาไว้บนสุด (เดิมอยู่ล่างสุดหลัง write-off —
          CEO เปิดหน้าแล้วไม่เจอเพราะต้องเลื่อนผ่านตารางยาว+write-off ก่อน). */}
      <section
        className="card"
        style={{ margin: "16px 22px 0", padding: 18, maxWidth: 520 }}
      >
        <ReconcileAccountSection
          branchId={branchId}
          companies={companies}
          bankAccounts={bankAccounts}
          currentCompanyId={branch.reconcileCompanyId}
          currentBankAccountId={branch.reconcileBankAccountId}
          summary={reconcileSummary}
        />
      </section>

      {/* Write-off LOG — explains why the drift jumped / hit 0 (CEO 2026-06-25).
          Shows this branch's approved + pending write-offs with date·amount·
          direction·reason·approver so a "ตั้งต้น" is never a mystery. */}
      {branchWriteOffs.length > 0 && (
        <section
          className="card"
          style={{ margin: "16px 22px 0", padding: 18, maxWidth: 720 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>
              🧾 รายการตัดเงิน / ตั้งต้น (สาขานี้)
            </h2>
            <span className="chip chip-accent" style={{ fontSize: 11 }}>
              {branchWriteOffs.length} รายการ
            </span>
          </div>
          <p className="text-3" style={{ fontSize: 12, marginBottom: 12 }}>
            ยอดหายเปลี่ยน/เป็น 0 เพราะรายการพวกนี้ — ตัดเงิน &quot;ตั้งต้น&quot; ณ วันไหน
            เท่าไร เหตุผลอะไร ใครอนุมัติ ·{" "}
            <span style={{ fontWeight: 600 }}>กดที่แต่ละรายการเพื่อกางดูรายละเอียด</span>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* CEO 2026-06-29: กดกางดูรายละเอียดในที่เดิม (native details — ไม่
                ต้องเปิดหน้าใหม่ ไม่บานเบ้อ · ปิดไว้ก่อน กดทีละอันที่อยากดู). */}
            {branchWriteOffs.map((w) => {
              const isOver = w.direction === "OVER";
              const approved = w.status === "APPROVED";
              return (
                <details
                  key={w.id}
                  style={{
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: "1px solid",
                    borderColor: approved ? "var(--ok-border)" : "var(--crit-border)",
                    background: approved ? "var(--ok-soft)" : "var(--crit-soft)",
                  }}
                >
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        verticalAlign: "middle",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        ตั้งต้น {thaiDate(w.effectiveDate ?? w.makerAt)}
                      </span>
                      <span
                        className="chip"
                        style={{
                          fontSize: 10,
                          color: isOver ? "var(--accent)" : "var(--crit)",
                        }}
                      >
                        {isOver ? "เงินเกิน" : "เงินขาด"}
                      </span>
                      <strong className="mono" style={{ fontSize: 14 }}>
                        {w.amount.toLocaleString()} ฿
                      </strong>
                      <span
                        className="chip"
                        style={{
                          fontSize: 10,
                          whiteSpace: "nowrap",
                          color: approved ? "var(--ok)" : "var(--crit)",
                        }}
                      >
                        {approved ? "อนุมัติแล้ว · มีผลกับยอด" : "รออนุมัติ"}
                      </span>
                    </span>
                  </summary>
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: "1px dashed var(--border)",
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div className="text-2" style={{ fontSize: 12.5 }}>
                      เหตุผล: {w.reason}
                    </div>
                    <div className="text-3" style={{ fontSize: 11.5 }}>
                      ขอโดย {w.maker.displayName} · {thaiDate(w.makerAt)}
                    </div>
                    {approved && w.approver && (
                      <div className="text-3" style={{ fontSize: 11.5 }}>
                        อนุมัติโดย {w.approver.displayName}
                        {w.approverAt ? ` · ${thaiDate(w.approverAt)}` : ""}
                      </div>
                    )}
                    <div className="text-3" style={{ fontSize: 11.5 }}>
                      ตั้งต้นยอดใหม่ ณ {thaiDate(w.effectiveDate ?? w.makerAt)}
                      {approved
                        ? " · ยอดหายสะสมถูกปรับตามรายการนี้แล้ว"
                        : " · ยังไม่อนุมัติ — ยังไม่กระทบยอด"}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

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
