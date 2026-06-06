// Ledger · รายจ่าย — multi-pane review workspace.
//   LEFT  : filterable list (company/branch via header · category/status/search here)
//   RIGHT : selected receipt image + edit form + Recheck + draft→confirm
// URL state: ?company=&branch=&status=&category=&q=&selected=
//
// NEVER auto-post: rows arrive as `draft`; the accountant confirms explicitly
// in ExpenseReviewPane. Bulk-confirm only flips rows that already pass recheck.
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { listExpensesSummary, getExpense, listCategories, summarizeCompleteness } from "../_data";
import type { ComponentProps, FC } from "react";
import { ExpenseList } from "./_components/ExpenseList";
import { CompletenessSummaryStrip } from "./_components/CompletenessSummaryStrip";
import { ExpensePaneClient } from "./_components/ExpensePaneClient";
import { UploadReceiptButton } from "./_components/UploadReceiptButton";
import { ExportButton } from "./_components/ExportButton";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";

export const dynamic = "force-dynamic";

const STATUS_VALUES: LedgerStatusValue[] = ["draft", "confirmed", "locked", "void"];

// D4 source tabs: all / สแกนจาก LINE / เพิ่มเอง / ส่วนตัว(=createdBy self).
export type ExpenseTab = "all" | "line" | "web" | "mine";
const TAB_VALUES: ExpenseTab[] = ["all", "line", "web", "mine"];

// CONTRACT for the UI agent (C1) that owns ExpenseList: add these two props to the
// ExpenseList signature (import the types from this page) so the source-tab strip
// renders. `tab` = active tab · `tabCounts` = DB-accurate badge counts per tab.
export interface ExpenseListTabProps {
  tab: ExpenseTab;
  tabCounts: Record<ExpenseTab, number>;
}

// Until the C1 UI agent widens ExpenseList's own signature with ExpenseListTabProps,
// reference it through a typed alias that ADDS the two source-tab props. This keeps
// the page compiling AND hands the UI agent an exact, importable prop contract — no
// `any`, no `@ts-ignore`. When ExpenseList declares the props itself, this alias is
// a harmless no-op (structurally identical) and can be inlined back to <ExpenseList>.
const ExpenseListWithTabs = ExpenseList as FC<
  ComponentProps<typeof ExpenseList> & ExpenseListTabProps
>;

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
    tab?: string; // source tab: "all" | "line" | "web" | "mine"
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
  const tab: ExpenseTab =
    sp.tab && TAB_VALUES.includes(sp.tab as ExpenseTab) ? (sp.tab as ExpenseTab) : "all";

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

  const [allRows, categories, completenessSummary] = await Promise.all([
    listExpensesSummary({
      ...summaryFilter,
      completeness: cc,
      take: 300,
    }),
    listCategories(scope.orgId, scope.companyId),
    summarizeCompleteness(summaryFilter),
  ]);

  // D4 source tabs — narrow the SCOPE rows by the active tab's source/owner
  // predicate (rows already carry `source` + `createdBy` from the summary select).
  const matchesTab = (r: { source: string; createdBy: string | null }): boolean => {
    if (tab === "line") return r.source === "line";
    if (tab === "web") return r.source === "web";
    if (tab === "mine") return r.createdBy === session.user.id;
    return true; // "all"
  };
  const rows = allRows.filter(matchesTab);

  // Per-tab badge counts — DB-accurate (NOT the 300-capped row list), using the
  // SAME company+actor+filter scope MINUS the tab predicate so badges never
  // miscount. completeness(cc) is part of the shared scope, so counts respect it.
  const tabCountWhere: Prisma.LedgerExpenseWhereInput = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    ...(status ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(trcloudPushed !== undefined
      ? { trcloudDocId: trcloudPushed ? { not: null } : null }
      : {}),
    ...(cc
      ? {
          completenessStatus:
            cc === "green" ? "green_full" : cc === "yellow" ? "yellow_partial" : "red_invalid",
        }
      : {}),
    ...(q
      ? {
          OR: [
            { vendor: { contains: q, mode: "insensitive" } },
            { docCode: { contains: q, mode: "insensitive" } },
            { vendorTaxId: { contains: q } },
          ],
        }
      : {}),
  };
  const [countAll, countLine, countWeb, countMine] = await Promise.all([
    prisma.ledgerExpense.count({ where: tabCountWhere }),
    prisma.ledgerExpense.count({ where: { ...tabCountWhere, source: "line" } }),
    prisma.ledgerExpense.count({ where: { ...tabCountWhere, source: "web" } }),
    prisma.ledgerExpense.count({ where: { ...tabCountWhere, createdBy: session.user.id } }),
  ]);
  const tabCounts: Record<ExpenseTab, number> = {
    all: countAll,
    line: countLine,
    web: countWeb,
    mine: countMine,
  };

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
  if (tab !== "all") baseParams.set("tab", tab);

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
        {/* LEFT — list + filters + bulk-confirm. Mobile master-detail: hide list when a receipt is open (?selected). */}
        <div className={selected ? "hidden lg:block" : "block"}>
        <ExpenseListWithTabs
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
          tab={tab}
          tabCounts={tabCounts}
        />
        </div>

        {/* RIGHT — review pane. Mobile: hidden until a receipt is selected (master-detail). */}
        <div
          className={`min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 ${
            selected ? "block" : "hidden lg:block"
          }`}
        >
          {selected && (
            <Link
              href={`/ledger/expenses?${baseParams.toString()}`}
              className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] lg:hidden"
            >
              ← กลับไปรายการ
            </Link>
          )}
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
              currentUserId={session.user.id}
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
