// Ledger · รายจ่าย — multi-pane review workspace.
//   LEFT  : filterable list (company/branch via header · category/status/search here)
//   RIGHT : selected receipt image + edit form + Recheck + draft→confirm
// URL state: ?company=&branch=&status=&category=&q=&selected=
//
// NEVER auto-post: rows arrive as `draft`; the accountant confirms explicitly
// in ExpenseReviewPane. Bulk-confirm only flips rows that already pass recheck.
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { CompanyBranchPicker } from "../_components/CompanyBranchPicker";
import { ExpenseSearch } from "./_components/ExpenseSearch";
import { listExpensesSummary, getExpense, listCategories, summarizeCompleteness } from "../_data";
import { listLedgerProjects } from "@/lib/ledger/projects";
import { ExpenseList } from "./_components/ExpenseList";
import { ExpenseStatusTabs } from "./_components/ExpenseStatusTabs";
import { CompletenessSummaryStrip } from "./_components/CompletenessSummaryStrip";
import { ExpensePaneClient } from "./_components/ExpensePaneClient";
import { UploadReceiptButton } from "./_components/UploadReceiptButton";
import { NoReceiptButton } from "./_components/NoReceiptButton";
import { ExportButton } from "./_components/ExportButton";
import { HeaderToolsMenu } from "./_components/HeaderToolsMenu";
import { ledgerQuotationV1, ledgerSlipV1, ledgerPayreqV1, ledgerStockinV1 } from "@/lib/ledger/flags";
import { TrcloudButton } from "@/components/ledger/TrcloudButton";
import { isTrcloudSendable, isTrcloudSent } from "@/lib/ledger/trcloud-state";
import { expenseConfirmability } from "@/lib/ledger/confirmability";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";
import { LedgerViewToggle } from "./_receipt-review/LedgerViewToggle";
import { ReceiptReviewWorkspace } from "./_receipt-review/ReceiptReviewWorkspace";
import type { ReceiptReviewData } from "./_receipt-review/types";

export const dynamic = "force-dynamic";

const STATUS_VALUES: LedgerStatusValue[] = ["draft", "confirmed", "locked", "void"];

// D4 source tabs: all / สแกนจาก LINE / เพิ่มเอง / ส่วนตัว(=createdBy self).
export type ExpenseTab = "all" | "line" | "email" | "web" | "mine";
const TAB_VALUES: ExpenseTab[] = ["all", "line", "email", "web", "mine"];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    branch?: string;
    status?: string;
    category?: string;
    project?: string; // filter by โครงการ (job-costing · F2)
    q?: string;
    selected?: string;
    tr?: string; // TRCloud send filter: "sent" | "unsent"
    ap?: string; // AP filter: "1" = แปลง PO → AP แล้ว (แท็บ "AP แล้ว")
    pv?: string; // PV filter: "1" = ออกใบสำคัญจ่าย (PV) เข้า TRCloud แล้ว (แท็บ "PV แล้ว")
    cc?: string; // ภาษีซื้อ color filter: "green" | "yellow" | "red"
    dt?: string; // docType filter: "quotation" (แท็บ "รอใบกำกับ" · D1)
    tab?: string; // source tab: "all" | "line" | "web" | "mine"
    sort?: string; // เรียงลำดับ: date-desc(ค่าเริ่มต้น) | date-asc | amount-desc | amount-asc
    nr?: string; // needsReview split: "1"=รอตรวจ · "0"=รอยืนยัน (ใช้กับ status=draft)
    pay?: string; // payment tab: "eligible"=ขอโอนได้ · "requested"=รอโอน · "paid"=โอนแล้ว
    view?: string; // "receipt-review" = โหมดตรวจใบเสร็จ (เวิร์กสเปซเต็มจอ) · ไม่ใส่ = โหมดรายการเดิม
    focus?: string; // "1" = โหมด "ใบเดียวโฟกัส" (เปิดจากปุ่ม LINE) · เหลือใบนี้ใบเดียว เมนูโปรแกรมยังครบ
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
      <div className="p-4 sm:px-6 sm:pt-4 sm:pb-6">
        <LedgerHeader title="รายจ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const status =
    sp.status && STATUS_VALUES.includes(sp.status as LedgerStatusValue)
      ? (sp.status as LedgerStatusValue)
      : undefined;
  // Default: hide void/cancelled rows — show only when explicitly filtered.
  const statusFilter: LedgerStatusValue | LedgerStatusValue[] =
    status ?? (["draft", "confirmed", "locked"] as LedgerStatusValue[]);
  const categoryId = sp.category || undefined;
  const projectId = sp.project || undefined;
  const q = sp.q?.trim() || undefined;
  const selected = sp.selected?.trim() || undefined;
  const tr = sp.tr === "sent" || sp.tr === "unsent" ? sp.tr : undefined;
  const trcloudPushed = tr === "sent" ? true : tr === "unsent" ? false : undefined;
  // แท็บ "AP แล้ว" (?ap=1) — ใบที่แปลง PO → AP แล้ว (CEO 2026-07-22). และแท็บ "ส่ง PO แล้ว"
  // (tr=sent) ต้องตัดใบที่เป็น AP ออก (apConverted=false) ไม่งั้นโชว์ซ้ำสองที่.
  const apTab = sp.ap === "1";
  const apConverted = apTab ? true : tr === "sent" ? false : undefined;
  // แท็บ "PV แล้ว" (?pv=1) — ใบที่ออกใบสำคัญจ่าย (PV) เข้า TRCloud แล้ว (CEO 2026-07-25).
  // PV ออกต่อ "คำขอโอน" (LedgerPaymentRequest.trcloudPvDocId · 1 โอน = 1 PV หลายบิล) ไม่ใช่ต่อบิล
  // และ LedgerExpense ไม่มี relation กลับไปคำขอ → ดึง expenseId ของบิลที่ผูกคำขอที่มี PV มาก่อน
  // ใช้ทั้งตัวนับแท็บ + กรองรายการ (แม่นยำระดับ DB · ไม่ cap 300 เหมือน pay tab).
  const pvTab = sp.pv === "1";
  const pvBillLinks = await prisma.ledgerPaymentRequestBill.findMany({
    where: {
      orgId: scope.orgId,
      companyId: scope.companyId,
      request: { trcloudPvDocId: { not: null } },
    },
    select: { expenseId: true },
  });
  const pvExpenseIds = [...new Set(pvBillLinks.map((b) => b.expenseId))];
  const cc =
    sp.cc === "green" || sp.cc === "yellow" || sp.cc === "red" ? sp.cc : undefined;
  // แท็บ "รอใบกำกับ" (D1) — เห็นเฉพาะตอนเปิด flag · กรองเป็นใบเสนอราคา.
  const quotationTabOn = ledgerQuotationV1();
  const docType = quotationTabOn && sp.dt === "quotation" ? ("quotation" as const) : undefined;
  const slipOn = ledgerSlipV1();
  const tab: ExpenseTab =
    sp.tab && TAB_VALUES.includes(sp.tab as ExpenseTab) ? (sp.tab as ExpenseTab) : "all";
  // เรียงลำดับ — undefined = "อัจฉริยะ" (งานค้างลอยบนสุด · ค่าตั้งต้นใหม่ CEO 2026-06-11).
  // date-desc = ใหม่→เก่า ตามวันที่บนเอกสาร (ค่าตั้งต้นเดิม · ตอนนี้เป็นตัวเลือกชัดเจน).
  const sort =
    sp.sort === "date-asc" ||
    sp.sort === "date-desc" ||
    sp.sort === "amount-desc" ||
    sp.sort === "amount-asc" ||
    sp.sort === "created-desc"
      ? sp.sort
      : undefined;
  // รอตรวจ vs รอยืนยัน split (both are draft) — only meaningful when status=draft.
  const nr = sp.nr === "1" ? true : sp.nr === "0" ? false : undefined;
  // สถานะการโอน (?pay=) — eligible=ขอโอนได้ · requested=รอโอน(มีคำขอเปิด) · paid=โอนแล้ว.
  const pay =
    sp.pay === "eligible" || sp.pay === "requested" || sp.pay === "paid" ? sp.pay : undefined;
  // โหมดมุมมอง — "receipt-review" = เวิร์กสเปซตรวจใบเสร็จเต็มจอ (โหมดใหม่) · อื่น ๆ = รายการเดิม.
  const view = sp.view === "receipt-review" ? "receipt-review" : "list";
  // โหมด "ใบเดียวโฟกัส" (?focus=1) — เปิดจากปุ่ม LINE "ใส่หมวด/สาขา" (CEO 2026-07-26):
  // เนื้อหาเหลือใบนี้ใบเดียว ไม่มีคลังบิล/แถบกรองมาบัง แต่ยังอยู่ใน AdminShell → เมนู
  // โปรแกรมครบ (hamburger/sidebar) กดไปหน้าอื่น/กลับรายการได้ (ไม่ให้เป็นหน้าตัน).
  const focus = sp.focus === "1";

  // ภาษีซื้อ summary uses the SAME scope (+ status/category/tr/search) so the strip
  // counts match the list — but NOT the cc filter itself (the strip shows the full mix).
  const summaryFilter = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    status: statusFilter,
    categoryId,
    projectId,
    trcloudPushed,
    apConverted,
    pvExpenseIds: pvTab ? pvExpenseIds : undefined,
    search: q,
  };

  // นักบัญชี/แอดมิน-เท่านั้น ที่ปรับ "ขอคืนได้?" + override + แนบใบทดแทน (gate เดียวกับ confirm).
  const canEditClaimability = await ledgerWebCanForRole(
    scope.orgId,
    session.user.role,
    "expense.confirm",
  );

  const [expensesResult, categories, completenessSummary, projectRows] = await Promise.all([
    listExpensesSummary({
      ...summaryFilter,
      completeness: cc,
      docType,
      sort,
      needsReview: nr,
      take: 300,
      withPayState: ledgerPayreqV1(),
    }),
    listCategories(scope.orgId, scope.companyId),
    summarizeCompleteness(summaryFilter),
    // โครงการ active — ใช้เป็นตัวเลือก picker (แท็กบิล) + id→name map (chip อ่านอย่างเดียวในรายการ).
    listLedgerProjects(scope.orgId, scope.companyId, { includeArchived: false }).catch(() => []),
  ]);
  const { expenses: allRows } = expensesResult;
  const projectOptions = projectRows.map((p) => ({ value: p.id, label: p.name }));
  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name] as const));

  // D4 source tabs — narrow the SCOPE rows by the active tab's source/owner
  // predicate (rows already carry `source` + `createdBy` from the summary select).
  const matchesTab = (r: { source: string; createdBy: string | null }): boolean => {
    if (tab === "line") return r.source === "line";
    if (tab === "email") return r.source === "email";
    if (tab === "web") return r.source === "web";
    if (tab === "mine") return r.createdBy === session.user.id;
    return true; // "all"
  };

  // สถานะการโอนต่อใบ (payState จาก query + gate หมวด/สาขา): eligible=ขอโอนได้(เขียว) ·
  // blocked=ขอไม่ได้(แดง · ขาดสาขา/หมวด) · requested=รอโอน · paid=โอนแล้ว.
  const payOf = (r: (typeof allRows)[number]): "paid" | "requested" | "eligible" | "blocked" => {
    if (r.payState === "paid") return "paid";
    if (r.payState === "requested") return "requested";
    return expenseConfirmability({ branchId: r.branchId, categoryId: r.categoryId }).ok
      ? "eligible"
      : "blocked";
  };
  const tabRows = allRows.filter(matchesTab);
  const rowsBase = pay ? tabRows.filter((r) => payOf(r) === pay) : tabRows;
  // resolve ชื่อโครงการให้แต่ละแถว (queries ไม่ join relation → เติมจาก map ที่ดึงมาแล้ว · ถูก).
  const rows = rowsBase.map((r) =>
    r.projectId ? { ...r, projectName: projectNameById.get(r.projectId) ?? null } : r,
  );
  const payCounts = { eligible: 0, requested: 0, paid: 0 };
  for (const r of tabRows) {
    const p = payOf(r);
    if (p !== "blocked") payCounts[p] += 1;
  }

  // PRIMARY status-strip counts — DB-accurate (NOT the 300-capped list). Scope =
  // company + branch + the active source(tab)/หมวด/ภาษีซื้อ/ค้นหา filters, MINUS the
  // status & tr axes so each tab counts its own slice. VISIBLE = non-void default set.
  const VISIBLE_STATUSES: LedgerStatusValue[] = ["draft", "confirmed", "locked"];
  const statusCountWhere: Prisma.LedgerExpenseWhereInput = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(cc
      ? {
          completenessStatus:
            cc === "green" ? "green_full" : cc === "yellow" ? "yellow_partial" : "red_invalid",
        }
      : {}),
    ...(tab === "line" ? { source: "line" } : {}),
    ...(tab === "email" ? { source: "email" } : {}),
    ...(tab === "web" ? { source: "web" } : {}),
    ...(tab === "mine" ? { createdBy: session.user.id } : {}),
    ...(q
      ? {
          OR: [
            { vendor: { contains: q, mode: "insensitive" } },
            { docCode: { contains: q, mode: "insensitive" } },
            // ค้นด้วยชื่อเรียกใบที่ผู้ใช้ตั้งเอง (ให้ตัวนับแท็บตรงกับผลค้นในลิสต์).
            { title: { contains: q, mode: "insensitive" } },
            { vendorTaxId: { contains: q } },
          ],
        }
      : {}),
  };
  const [scAll, scReview, scDraft, scConfirmed, scSent, scUnsent, scAp, scPv] = await Promise.all([
    prisma.ledgerExpense.count({ where: { ...statusCountWhere, status: { in: VISIBLE_STATUSES } } }),
    prisma.ledgerExpense.count({ where: { ...statusCountWhere, status: "draft", needsReview: true } }),
    prisma.ledgerExpense.count({ where: { ...statusCountWhere, status: "draft", needsReview: false } }),
    prisma.ledgerExpense.count({ where: { ...statusCountWhere, status: "confirmed" } }),
    // ส่ง PO แล้ว = REAL doc id only (exclude null + "pending"/"error" sentinels — else a
    // failed push inflates this count, the 2026-06-15 false-sent-display bug). AND ยังไม่แปลง AP
    // (trcloudApDocId ว่าง) — ใบที่เป็น AP แล้วย้ายไปแท็บ "AP แล้ว" (CEO 2026-07-22 กันโชว์ซ้ำ).
    prisma.ledgerExpense.count({
      where: {
        ...statusCountWhere,
        status: { in: VISIBLE_STATUSES },
        trcloudDocId: { not: null, notIn: ["pending", "error"] },
        trcloudApDocId: null,
      },
    }),
    // ยังไม่ส่ง PO (CEO 2026-06-10 tab) — never pushed (null) OR last push FAILED
    // ("error") so failed bills surface here for retry instead of hiding as "sent".
    // AND-wrapped so it composes with the search OR that statusCountWhere may carry.
    prisma.ledgerExpense.count({
      where: {
        ...statusCountWhere,
        status: { in: VISIBLE_STATUSES },
        AND: [{ OR: [{ trcloudDocId: null }, { trcloudDocId: "error" }] }],
      },
    }),
    // AP แล้ว — แปลง PO → AP เรียบร้อย (ลงบัญชีจริงแล้ว · CEO 2026-07-22).
    prisma.ledgerExpense.count({
      where: {
        ...statusCountWhere,
        status: { in: VISIBLE_STATUSES },
        trcloudApDocId: { not: null },
      },
    }),
    // PV แล้ว — ออกใบสำคัญจ่าย (PV) เข้า TRCloud แล้ว (CEO 2026-07-25). ขั้นถัดจาก "โอนแล้ว".
    // PV ต่อ "คำขอโอน" → นับบิลที่ id อยู่ในชุด pvExpenseIds (บิลที่ผูกคำขอที่มี PV).
    prisma.ledgerExpense.count({
      where: {
        ...statusCountWhere,
        status: { in: VISIBLE_STATUSES },
        id: { in: pvExpenseIds },
      },
    }),
  ]);
  const statusCounts = {
    all: scAll,
    review: scReview,
    draft: scDraft,
    confirmed: scConfirmed,
    sent: scSent,
    unsent: scUnsent,
    ap: scAp,
    pv: scPv,
    // pay-tab counts from the 300-window (payState lives on the fetched rows, not a
    // cheap DB count — acceptable like the source tabs; capped at the list window).
    eligible: payCounts.eligible,
    requested: payCounts.requested,
    paid: payCounts.paid,
  };

  const selectedExpense = selected
    ? await getExpense({
        orgId: scope.orgId,
        companyId: scope.companyId,
        id: selected,
        withSlip: true, // โชว์สลิปโอนเงินในใบ (โอนแล้ว → ดู/ดาวน์โหลด/ส่งต่อ)
        withPayState: true, // ปุ่ม "โอนแล้ว" ต้องรู้ payState/activeRequestId
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

  // Stock-IN (LEDGER_STOCKIN_V1) — for a selected confirmed resale expense, load the
  // stock-tracked SKU options (for inline mapping) + whether it was already received.
  const stockinOn = ledgerStockinV1();
  let stockSkus: Array<{ id: string; productId: string; productName: string | null; businessGroup: string | null }> = [];
  let stockinNo: string | null = null;
  const canStockIn =
    stockinOn &&
    !!selectedExpense &&
    (selectedExpense.status === "confirmed" || selectedExpense.status === "locked");
  if (canStockIn && selected) {
    // กรอง SKU ตาม "สาขาของบิล" ก่อน (CEO 2026-06-10: เห็นเฉพาะสินค้าสต๊อกของสาขานั้น).
    // หาว่าสาขานี้ผูกสินค้าสต๊อกตัวไหนไว้ (LedgerSkuBranch); ถ้าสาขายังไม่ตั้ง → fallback ทั้งบริษัท
    // (กันรายการว่างจนผูกไม่ได้). server ยังกัน wrong_branch ตอน preview อยู่แล้ว.
    const billBranchId = selectedExpense?.branchId ?? null;
    let branchSkuIds: string[] = [];
    if (billBranchId) {
      const links = await prisma.ledgerSkuBranch.findMany({
        where: { orgId: scope.orgId, companyId: scope.companyId, branchId: billBranchId },
        select: { skuId: true },
      });
      branchSkuIds = links.map((l) => l.skuId);
    }
    const [skuRows, expRow] = await Promise.all([
      prisma.ledgerTrcloudSku.findMany({
        where: {
          orgId: scope.orgId,
          companyId: scope.companyId,
          stockTracked: true,
          ...(branchSkuIds.length > 0 ? { id: { in: branchSkuIds } } : {}),
        },
        select: { id: true, productId: true, productName: true, businessGroup: true },
        orderBy: [{ businessGroup: "asc" }, { productId: "asc" }],
        take: 500,
      }),
      prisma.ledgerExpense.findFirst({
        where: { id: selected, orgId: scope.orgId, companyId: scope.companyId },
        select: { trcloudStockinNo: true, trcloudStockinDocId: true },
      }),
    ]);
    stockSkus = skuRows;
    const did = expRow?.trcloudStockinDocId;
    stockinNo = expRow?.trcloudStockinNo ?? (did && did !== "pending" && did !== "error" ? "sent" : null);
  }

  // Preserve scope params on links from the list.
  const baseParams = new URLSearchParams();
  if (sp.company) baseParams.set("company", sp.company);
  if (sp.branch) baseParams.set("branch", sp.branch);
  if (status) baseParams.set("status", status);
  if (categoryId) baseParams.set("category", categoryId);
  if (projectId) baseParams.set("project", projectId);
  if (tr) baseParams.set("tr", tr);
  if (apTab) baseParams.set("ap", "1");
  if (pvTab) baseParams.set("pv", "1");
  if (cc) baseParams.set("cc", cc);
  if (docType) baseParams.set("dt", docType);
  if (q) baseParams.set("q", q);
  if (tab !== "all") baseParams.set("tab", tab);
  if (sort) baseParams.set("sort", sort);
  if (nr !== undefined) baseParams.set("nr", nr ? "1" : "0");
  if (pay) baseParams.set("pay", pay);

  // ลิงก์สลับแท็บ "รอใบกำกับ" — คงพารามิเตอร์ scope เดิมไว้ (company/branch) เท่านั้น.
  const quotationOnParams = new URLSearchParams();
  if (sp.company) quotationOnParams.set("company", sp.company);
  if (sp.branch) quotationOnParams.set("branch", sp.branch);
  const quotationOffParams = new URLSearchParams(quotationOnParams);
  quotationOnParams.set("dt", "quotation");

  const draftIds = rows.filter((r) => r.status === "draft").map((r) => r.id);
  // Confirmed/locked rows not yet in TRCloud → bulk-sendable. Includes rows whose
  // last push FAILED ("error") so they can be retried in bulk (isTrcloudSendable),
  // not just never-pushed rows (the old `!r.trcloudDocId` treated "error" as sent).
  const sendableIds = rows
    .filter((r) => (r.status === "confirmed" || r.status === "locked") && isTrcloudSendable(r.trcloudDocId))
    .map((r) => r.id);
  // แปลง AP ได้ = ยืนยันแล้ว + ส่ง PO เข้า TRCloud แล้ว + ยังไม่เป็น AP + มีสาขา/หมวดครบ
  // (gate.ok — หมวดต้องมีก่อน ไม่งั้น runApConversion เด้ง guard กันตกบัญชีถังรวม 5919999).
  const convertibleIds = rows
    .filter(
      (r) =>
        (r.status === "confirmed" || r.status === "locked") &&
        isTrcloudSent(r.trcloudDocId) &&
        !r.trcloudApDocId &&
        expenseConfirmability({ branchId: r.branchId, categoryId: r.categoryId }).ok,
    )
    .map((r) => r.id);

  // ── ปุ่มสลับมุมมอง (list ↔ receipt-review) — คงฟิลเตอร์เดิม + คงใบที่เลือก ──
  const listToggleHref = (() => {
    const p = new URLSearchParams(baseParams);
    if (selected) p.set("selected", selected);
    const s = p.toString();
    return s ? `/ledger/expenses?${s}` : "/ledger/expenses";
  })();
  const reviewToggleHref = (() => {
    const p = new URLSearchParams(baseParams);
    if (selected) p.set("selected", selected);
    p.set("view", "receipt-review");
    return `/ledger/expenses?${p.toString()}`;
  })();

  // ── โหมดตรวจใบเสร็จ (เวิร์กสเปซเต็มจอ) — ทางแยกเพิ่มเติม · โหมดเดิมด้านล่างไม่ถูกแตะ ──
  if (view === "receipt-review") {
    const reviewData: ReceiptReviewData = {
      orgId: scope.orgId,
      companyId: scope.companyId,
      branchId: scope.branchId,
      companies: scope.companies.map((c) => ({ id: c.id, name: c.name })),
      branches: scope.branches.map((b) => ({ id: b.id, name: b.name })),
      rows,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        sort: c.sort,
        active: c.active,
        trcloudAccCode: c.trcloudAccCode,
      })),
      projects: projectOptions,
      statusCounts,
      completenessSummary,
      selectedExpense,
      replacementExpense,
      canEditClaimability,
      currentUserId: session.user.id,
      payreqEnabled: ledgerPayreqV1(),
      baseParams: baseParams.toString(),
      filter: {
        status,
        categoryId,
        projectId,
        q,
        selected,
        tr,
        ap: apTab,
        pv: pvTab,
        cc,
        tab,
        sort,
        nr,
        pay,
      },
      draftIds,
      sendableIds,
      convertibleIds,
      selectedStock: selectedExpense
        ? {
            stockinNo,
            canStockIn,
            isStockCategory: categories.some(
              (c) => c.id === selectedExpense.categoryId && c.name === "สินค้าเพื่อขายแบบมีสต๊อก",
            ),
            stockSkus,
          }
        : null,
    };
    return <ReceiptReviewWorkspace data={reviewData} />;
  }

  // ── โหมด "ใบเดียวโฟกัส" (?focus=1 · เปิดจากปุ่ม LINE "ใส่หมวด/สาขา") ──
  // reuse ข้อมูล/props ของ pane ที่โหลดไว้แล้ว 100% (เหมือนโหมด receipt-review ด้านบน)
  // ต่างกันที่ layout: เหลือ "ใบนี้ใบเดียว" กลางจอ (ไม่มีคลังบิล/แถบกรอง) + ปุ่มกลับ
  // ชัด ๆ · AdminShell (เมนูโปรแกรม hamburger/sidebar) ยังครอบอยู่ → ไม่ใช่หน้าตัน
  // flow ในหน้า: หมวด+สาขา → บันทึก → ส่ง TRCloud (PO) → ขอโอน (gate PO ก่อนขอโอนอยู่ที่ server).
  if (focus && selectedExpense) {
    const backHref = `/ledger/expenses?${baseParams.toString()}`;
    return (
      <div className="p-4 sm:px-6 sm:pt-4 sm:pb-6">
        <div className="mx-auto max-w-3xl">
          <Link
            href={backHref}
            className="press mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)]"
          >
            ← กลับไปรายการบิล
          </Link>
          <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
            <ExpensePaneClient
              expense={selectedExpense}
              replacement={replacementExpense}
              categories={categories.map((c) => ({
                id: c.id,
                name: c.name,
                color: c.color,
                sort: c.sort,
                active: c.active,
                trcloudAccCode: c.trcloudAccCode,
              }))}
              branches={scope.branches}
              projects={projectOptions}
              canEditClaimability={canEditClaimability}
              currentUserId={session.user.id}
              payreqEnabled={ledgerPayreqV1()}
              showSendToTrcloud={false}
            />
            {/* ปุ่มเดียว "ส่งเข้า TRCloud" (PO) — ต้องส่งก่อนจึงขอโอนได้ (gate ที่ server) */}
            <TrcloudButton
              expenseId={selectedExpense.id}
              companyId={scope.companyId}
              status={selectedExpense.status}
              docType={selectedExpense.docType}
              trcloudDocId={selectedExpense.trcloudDocId}
              trcloudDocNo={selectedExpense.trcloudDocNo}
              trcloudError={selectedExpense.trcloudError}
              trcloudApDocId={selectedExpense.trcloudApDocId}
              trcloudApDocNo={selectedExpense.trcloudApDocNo}
              trcloudApError={selectedExpense.trcloudApError}
              stockinNo={stockinNo}
              stockSkus={stockSkus}
              stockInEnabled={canStockIn}
              isStockCategory={categories.some(
                (c) => c.id === selectedExpense.categoryId && c.name === "สินค้าเพื่อขายแบบมีสต๊อก",
              )}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:px-6 sm:pt-4 sm:pb-6">
      <LedgerHeader
        title="รายจ่าย"
        subtitle={`${rows.length} รายการ`}
        scope={scope}
        scopeInFilter
        right={
          <>
            {/* ค้นหา — อยู่ข้างหัว "รายจ่าย" (LeanUX · มือถือ = แถวบนสุด) */}
            <ExpenseSearch baseParams={baseParams.toString()} q={q} selectedId={selected} />
            {/* ปุ่มสลับมุมมอง — โหมดตรวจใบเสร็จ (เวิร์กสเปซเต็มจอ) */}
            <LedgerViewToggle current="list" listHref={listToggleHref} reviewHref={reviewToggleHref} />
            {/* สลิปรอจับคู่ + CSV + ไม่มีใบเสร็จ — secondary tools folded into a
                "⋯ เครื่องมือ" dropdown (desktop only; LeanUX wave B2 ①#1). Below lg
                they already move INTO the ตัวกรอง sheet (listActions), and the menu
                is lg-only, so they never double up. */}
            <HeaderToolsMenu>
              {slipOn && (
                <Link
                  href={`/ledger/reconcile?${quotationOffParams.toString()}`}
                  className="press inline-flex min-h-[40px] items-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  สลิปรอจับคู่
                </Link>
              )}
              <ExportButton companyId={scope.companyId} />
              <NoReceiptButton
                companyId={scope.companyId}
                branchId={scope.branchId}
                categories={categories.map((c) => ({ id: c.id, name: c.name, trcloudAccCode: c.trcloudAccCode }))}
                branches={scope.branches}
              />
            </HeaderToolsMenu>
            {/* On phones the bottom-nav camera FAB fires open-upload; hide the
                big duplicate button (keeps the modal + listener mounted). */}
            <UploadReceiptButton
              companyId={scope.companyId}
              branchId={scope.branchId}
              baseParams={baseParams.toString()}
              hideTriggerOnMobile
            />
          </>
        }
      />

      {/* ภาษีซื้อ — แถบสรุป VAT. LeanUX: เดสก์ท็อปเท่านั้น (มือถือ=กินที่ · ดูใน Dashboard/ตัวกรองสี). */}
      <div className="hidden sm:block">
        <CompletenessSummaryStrip
          summary={completenessSummary}
          baseParams={baseParams.toString()}
          selectedId={selected}
          cc={cc}
        />
      </div>

      {/* แท็บ "รอใบกำกับ" (D1) — เดสก์ท็อปเท่านั้น (มือถือยุบเข้าตัวกรอง · LeanUX). */}
      {quotationTabOn && (
        <div className="mb-3 hidden flex-wrap items-center gap-2 text-sm sm:flex">
          <Link
            href={`/ledger/expenses?${quotationOffParams.toString()}`}
            className={`press inline-flex min-h-[36px] items-center rounded-full border px-3 font-medium transition-colors ${
              docType
                ? "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                : "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
            }`}
          >
            ทั้งหมด
          </Link>
          <Link
            href={`/ledger/expenses?${quotationOnParams.toString()}`}
            className={`press inline-flex min-h-[36px] items-center rounded-full border px-3 font-medium transition-colors ${
              docType
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            รอใบกำกับ · ใบเสนอราคา
          </Link>
        </div>
      )}

      {/* แท็บสถานะ — แถบเต็มกว้างด้านบน (เดสก์ท็อปเท่านั้น · CEO 2026-06-09: ย้ายจากในคอลัมน์
          รายการ 420px มาใช้พื้นที่ว่างกว้าง ๆ ตรงดีไซน์ desktopA). มือถือ render ในคอลัมน์
          รายการ (ExpenseList → ExpenseStatusTabs lg:hidden) ที่ความกว้างเต็มอยู่แล้ว. */}
      <div className="mb-2 hidden rounded-2xl border border-zinc-200 bg-white p-2 lg:block">
        <ExpenseStatusTabs
          baseParams={baseParams.toString()}
          status={status}
          tr={tr}
          ap={apTab}
          pv={pvTab}
          nr={nr}
          pay={pay}
          payreqEnabled={ledgerPayreqV1()}
          statusCounts={statusCounts}
          selectedId={selected}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* LEFT — list + filters + bulk-confirm. Mobile master-detail: hide list when a receipt is open (?selected). */}
        <div className={selected ? "hidden lg:block" : "block"}>
        <ExpenseList
          rows={rows}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            sort: c.sort,
            active: c.active,
          }))}
          selectedId={selected}
          baseParams={baseParams.toString()}
          status={status}
          categoryId={categoryId}
          projectId={projectId}
          projects={projectOptions}
          tr={tr}
          cc={cc}
          q={q}
          draftIds={draftIds}
          sendableIds={sendableIds}
          convertibleIds={convertibleIds}
          companyId={scope.companyId}
          payreqEnabled={ledgerPayreqV1()}
          branches={scope.branches}
          isSuperAdmin={isSuperAdmin(session.user.role)}
          tab={tab}
          sort={sort}
          nr={nr}
          pay={pay}
          ap={apTab}
          pv={pvTab}
          statusCounts={statusCounts}
          scopePicker={
            <CompanyBranchPicker
              companies={scope.companies}
              branches={scope.branches}
              companyId={scope.companyId ?? ""}
              branchId={scope.branchId ?? ""}
            />
          }
          listActions={
            <>
              {slipOn && (
                <Link
                  href={`/ledger/reconcile?${quotationOffParams.toString()}`}
                  className="press inline-flex min-h-[40px] items-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  สลิปรอจับคู่
                </Link>
              )}
              <NoReceiptButton
                companyId={scope.companyId}
                branchId={scope.branchId}
                categories={categories.map((c) => ({ id: c.id, name: c.name, trcloudAccCode: c.trcloudAccCode }))}
                branches={scope.branches}
              />
            </>
          }
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
              className="press mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)] lg:hidden"
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
                active: c.active,
                trcloudAccCode: c.trcloudAccCode,
              }))}
              branches={scope.branches}
              projects={projectOptions}
              canEditClaimability={canEditClaimability}
              currentUserId={session.user.id}
              payreqEnabled={ledgerPayreqV1()}
              showSendToTrcloud={false}
            />
          ) : null}
          {/* ปุ่มเดียว "ส่งเข้า TRCloud" (CEO 2026-06-10) — ระบบแยกสินค้าสต๊อก/ค่าใช้จ่ายเอง
              จาก SKU · กดซ้ำ 2 ทางไม่ได้ (กันต้นทุนเบิ้ล). แทนที่ทั้งปุ่มส่ง TRCloud ในแผง
              และปุ่ม "รับเข้าคลัง" เดิม. */}
          {selectedExpense && (
            <TrcloudButton
              expenseId={selectedExpense.id}
              companyId={scope.companyId}
              status={selectedExpense.status}
              docType={selectedExpense.docType}
              trcloudDocId={selectedExpense.trcloudDocId}
              trcloudDocNo={selectedExpense.trcloudDocNo}
              trcloudError={selectedExpense.trcloudError}
              trcloudApDocId={selectedExpense.trcloudApDocId}
              trcloudApDocNo={selectedExpense.trcloudApDocNo}
              trcloudApError={selectedExpense.trcloudApError}
              stockinNo={stockinNo}
              stockSkus={stockSkus}
              stockInEnabled={canStockIn}
              isStockCategory={categories.some(
                (c) => c.id === selectedExpense.categoryId && c.name === "สินค้าเพื่อขายแบบมีสต๊อก",
              )}
            />
          )}
          {!selectedExpense && (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center animate-fade-in">
              <div className="grid size-16 place-items-center rounded-2xl bg-[var(--color-brand-50)] text-3xl">
                🧾
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-zinc-800">
                  {rows.length === 0
                    ? "ยังไม่มีใบเสร็จในบริษัทนี้"
                    : "เลือกใบเสร็จเพื่อตรวจและยืนยัน"}
                </p>
                <p className="text-sm leading-relaxed text-zinc-500">
                  {rows.length === 0
                    ? "อัปโหลดใบเสร็จด้านบน หรือถ่ายในกลุ่ม LINE (AI จะอ่านค่าให้ แล้วรอบัญชียืนยัน)"
                    : "คลิกรายการจากซ้าย รูปและค่าที่ AI อ่านได้จะขึ้นตรงนี้ให้ตรวจก่อนยืนยัน"}
                </p>
              </div>
              {rows.length > 0 && (
                <Link
                  href={`/ledger/expenses?${baseParams.toString()}${baseParams.toString() ? "&" : ""}status=draft`}
                  className="press text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)] hover:underline"
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
