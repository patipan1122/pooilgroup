// Ledger · รายจ่าย — multi-pane review workspace.
//   LEFT  : filterable list (company/branch via header · category/status/search here)
//   RIGHT : selected receipt image + edit form + Recheck + draft→confirm
// URL state: ?company=&branch=&status=&category=&q=&selected=
//
// NEVER auto-post: rows arrive as `draft`; the accountant confirms explicitly
// in ExpenseReviewPane. Bulk-confirm only flips rows that already pass recheck.
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listExpensesSummary, getExpense, listCategories, summarizeCompleteness } from "../_data";
import { ExpenseList } from "./_components/ExpenseList";
import { CompletenessSummaryStrip } from "./_components/CompletenessSummaryStrip";
import { ExpensePaneClient } from "./_components/ExpensePaneClient";
import { UploadReceiptButton } from "./_components/UploadReceiptButton";
import { ExportButton } from "./_components/ExportButton";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";

export const dynamic = "force-dynamic";

const STATUS_VALUES: LedgerStatusValue[] = ["draft", "confirmed", "locked", "void"];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    branch?: string;
    status?: string;
    category?: string;
    q?: string;
    selected?: string;
    tr?: string; // TRCloud send filter: "sent" | "unsent"
    cc?: string; // ภาษีซื้อ color filter: "green" | "yellow" | "red"
  }>;
}) {
  // Page-level role gate. This review workspace exposes the FULL company-wide
  // expense ledger (every vendor / total / branch / tax id) plus Confirm / Bulk /
  // Void / Export / Voucher controls. requireSession() alone let ANY role holding
  // the ledger module grant reach it by typing the URL (nav merely hides the
  // link). We gate to the financial-view tier (matching the dashboard's "front-
  // line roles must not see org-wide P&L" rationale). Staff capture is LIFF-only
  // (LINE front-line), so staff are intentionally excluded from this web pane;
  // the per-action gates (confirm/void/export = accountant) remain the backstop.
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
  );
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="รายจ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const status =
    sp.status && STATUS_VALUES.includes(sp.status as LedgerStatusValue)
      ? (sp.status as LedgerStatusValue)
      : undefined;
  const categoryId = sp.category || undefined;
  const q = sp.q?.trim() || undefined;
  const selected = sp.selected?.trim() || undefined;
  const tr = sp.tr === "sent" || sp.tr === "unsent" ? sp.tr : undefined;
  const trcloudPushed = tr === "sent" ? true : tr === "unsent" ? false : undefined;
  const cc =
    sp.cc === "green" || sp.cc === "yellow" || sp.cc === "red" ? sp.cc : undefined;

  // ภาษีซื้อ summary uses the SAME scope (+ status/category/tr/search) so the strip
  // counts match the list — but NOT the cc filter itself (the strip shows the full mix).
  const summaryFilter = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    status,
    categoryId,
    trcloudPushed,
    search: q,
  };

  // นักบัญชี/แอดมิน-เท่านั้น ที่ปรับ "ขอคืนได้?" + override + แนบใบทดแทน (gate เดียวกับ confirm).
  const canEditClaimability = await ledgerWebCanForRole(
    scope.orgId,
    session.user.role,
    "expense.confirm",
  );

  const [rows, categories, completenessSummary] = await Promise.all([
    listExpensesSummary({
      ...summaryFilter,
      completeness: cc,
      take: 300,
    }),
    listCategories(scope.orgId, scope.companyId),
    summarizeCompleteness(summaryFilter),
  ]);

  const selectedExpense = selected
    ? await getExpense({
        orgId: scope.orgId,
        companyId: scope.companyId,
        id: selected,
      })
    : null;

  // ถ้าใบที่เลือกมีใบทดแทน → โหลดใบทดแทนมาโชว์รูปคู่กัน (ใบเดิม + ใบใหม่).
  const replacementExpense = selectedExpense?.replacedById
    ? await getExpense({
        orgId: scope.orgId,
        companyId: scope.companyId,
        id: selectedExpense.replacedById,
      })
    : null;

  // Preserve scope params on links from the list.
  const baseParams = new URLSearchParams();
  if (sp.company) baseParams.set("company", sp.company);
  if (sp.branch) baseParams.set("branch", sp.branch);
  if (status) baseParams.set("status", status);
  if (categoryId) baseParams.set("category", categoryId);
  if (tr) baseParams.set("tr", tr);
  if (cc) baseParams.set("cc", cc);
  if (q) baseParams.set("q", q);

  const draftIds = rows.filter((r) => r.status === "draft").map((r) => r.id);
  // Confirmed/locked rows not yet in TRCloud → bulk-sendable.
  const sendableIds = rows
    .filter((r) => (r.status === "confirmed" || r.status === "locked") && !r.trcloudDocId)
    .map((r) => r.id);

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="รายจ่าย"
        subtitle={`${rows.length} รายการ`}
        scope={scope}
        right={
          <>
            <ExportButton companyId={scope.companyId} />
            <UploadReceiptButton
              companyId={scope.companyId}
              branchId={scope.branchId}
              baseParams={baseParams.toString()}
            />
          </>
        }
      />

      {/* ภาษีซื้อ — แถบสรุปสถานะสี (เขียว/เหลือง/แดง) + ยอด VAT ที่ยังติด */}
      <CompletenessSummaryStrip
        summary={completenessSummary}
        baseParams={baseParams.toString()}
        selectedId={selected}
        cc={cc}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* LEFT — list + filters + bulk-confirm */}
        <ExpenseList
          rows={rows}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            sort: c.sort,
          }))}
          selectedId={selected}
          baseParams={baseParams.toString()}
          status={status}
          categoryId={categoryId}
          tr={tr}
          cc={cc}
          q={q}
          draftIds={draftIds}
          sendableIds={sendableIds}
          companyId={scope.companyId}
        />

        {/* RIGHT — review pane */}
        <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
          {selectedExpense ? (
            <ExpensePaneClient
              expense={selectedExpense}
              replacement={replacementExpense}
              categories={categories.map((c) => ({
                id: c.id,
                name: c.name,
                color: c.color,
                sort: c.sort,
              }))}
              branches={scope.branches}
              canEditClaimability={canEditClaimability}
            />
          ) : (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="grid size-16 place-items-center rounded-2xl bg-[var(--color-brand-50)] text-3xl">
                🧾
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-zinc-800">
                  {rows.length === 0
                    ? "ยังไม่มีใบเสร็จในบริษัทนี้"
                    : "เลือกใบเสร็จเพื่อตรวจและยืนยัน"}
                </p>
                <p className="text-sm text-zinc-500">
                  {rows.length === 0
                    ? "อัปโหลดใบเสร็จด้านบน หรือถ่ายในกลุ่ม LINE — AI จะอ่านให้แล้วรอบัญชียืนยัน"
                    : "คลิกรายการจากซ้าย — รูป + ค่าที่ AI อ่านได้จะขึ้นตรงนี้ให้ตรวจก่อนยืนยัน"}
                </p>
              </div>
              {rows.length > 0 && (
                <Link
                  href={`/ledger/expenses?${baseParams.toString()}${baseParams.toString() ? "&" : ""}status=draft`}
                  className="text-sm font-medium text-[var(--color-brand-600)] hover:underline"
                >
                  ดูเฉพาะที่รอยืนยัน →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
