// Reconcile v2 shell — the shared 2-column workspace rendered by BOTH the org
// page (/chairops/reconcile) and the branch page (/chairops/reconcile/[id]).
//
// LEFT  : ReconcileSidebar (280px · client live-search · branch nav)
// RIGHT : breadcrumb + title + freshness + hero + tab switcher + active view
//
// Tab is URL-driven (?view=ledger|timeline|periods · default ledger). Only the
// data the active tab needs is fetched (Ledger | Timeline | Periods), keeping
// each request lean. Server Component — sidebar is the only client island.

import Link from "next/link";
import { Download, RefreshCcw } from "lucide-react";
import {
  getReconcileSidebar,
  getReconcileOverview,
  getReconcileLedger,
  getReconcileTimeline,
  getReconcilePeriods,
  getReconcileDayDetail,
  getReconcilePerChairTW,
  getReconcilePerChairRoundsTW,
  getReconcilePerChairDetail,
  getReconcileActivity,
  getReconcileChecklist,
  getReconcileChecklistNumbers,
  ledgerTotals,
  type ReconcileDayDetail,
} from "@/lib/chairops/queries/reconcile-v2";
import { getCumulativeShortage } from "@/lib/chairops/queries/_cumulative-shortage";
import { ReconcileSidebar } from "./reconcile-sidebar";
import {
  FreshnessBar,
  DriftHero,
  ReconcileTabs,
  LedgerTab,
  LedgerPager,
  DayDetailPanel,
  TimelineTab,
  PeriodsTab,
  PerChairTab,
  PerChairDetailTab,
  PerChairViewToggle,
  ActivityTab,
  ChecklistTab,
  NumbersTab,
} from "./reconcile-views";
import { LedgerDateFilter } from "./ledger-date-filter";

// CEO 2026-06-25: page size for the ledger when showing wide / all-time ranges.
// Preset windows (7/30/90) are smaller than this so they render in one page.
const LEDGER_PAGE_SIZE = 120;

export type ReconcileView =
  | "ledger"
  | "timeline"
  | "periods"
  | "perchair"
  | "checklist";

export function normalizeView(raw: string | undefined): ReconcileView {
  return raw === "timeline" ||
    raw === "periods" ||
    raw === "perchair" ||
    raw === "checklist"
    ? raw
    : "ledger";
}

// CEO 2026-06-02: validate ?from / ?to in "YYYY-MM-DD" form. Anything else is
// dropped silently so a malformed URL never throws.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDate(raw: string | undefined): string | undefined {
  return raw && DATE_RE.test(raw) ? raw : undefined;
}

export async function ReconcileShell({
  orgId,
  branchId,
  branchName,
  view,
  from,
  to,
  missingSlip,
  allTime,
  page,
  day,
  perChairView = "daily",
  chair,
  canManage = false,
  month,
  checklistView = "dots",
  numbersBranch,
}: {
  orgId: string;
  /** null = org-level "ทุกสาขารวม" view */
  branchId: string | null;
  branchName: string | null;
  view: ReconcileView;
  from?: string;
  to?: string;
  /** F1 · audit MISS-04: filter Ledger to days where a CSV_IMPORT row has no slip. */
  missingSlip?: boolean;
  /** CEO 2026-06-25: "ทั้งหมด" preset → load the branch's full history. */
  allTime?: boolean;
  /** CEO 2026-06-25: ledger pagination page (0-based) for wide / all-time ranges. */
  page?: number;
  /** CEO 2026-06-25: drill-down — show one day's individual collection/deposit chunks
   *  (Ledger tab). Also reused by the checklist "numbers" sub-view (paired with
   *  `numbersBranch` below) since that grid is org-wide, not one branch's page. */
  day?: string;
  /** CEO 2026-06-29 + 07-01: per-chair sub-view — "daily" (per-day × per-chair matrix · default) · "summary" (window aggregate) · "activity" (ใครทำอะไร). */
  perChairView?: "daily" | "summary" | "activity";
  /** CEO 2026-06-29: drill — selected chairCode → per-round history (summary) or machine filter (activity). */
  chair?: string;
  /** CEO 2026-07-01: super_admin → show ปิด/เปิดสาขา button in the sidebar. */
  canManage?: boolean;
  /** CEO 2026-07-01: checklist month "YYYY-MM" (default = current Bangkok month). */
  month?: string;
  /** CEO 2026-08-23: checklist sub-view — "dots" (default, unchanged) · "numbers"
   *  (ควรได้/เก็บได้/ฝาก per cell instead of a dot). */
  checklistView?: "dots" | "numbers";
  /** CEO 2026-08-23: which branch's day-detail is open in the numbers sub-view
   *  (the org-wide grid has no single branchId route param to fall back on). */
  numbersBranch?: string;
}) {
  const isOrg = branchId === null;
  const perChairDaily = perChairView === "daily";
  const perChairSummary = perChairView === "summary";
  const perChairActivity = perChairView === "activity";
  const baseHref = isOrg
    ? "/chairops/reconcile"
    : `/chairops/reconcile/${branchId}`;

  const safeFrom = normalizeDate(from);
  const safeTo = normalizeDate(to);
  const safeDay = normalizeDate(day);
  const pageNum = Math.max(0, Math.floor(page ?? 0));

  // Sidebar + overview always load. The active tab's dataset loads on demand.
  // cumShortage is the canonical "ค้างฝากรวม" aggregate shared with the exec
  // home tile (CEO ruling 2026-06-02 — positive-only sum across active
  // branches · see lib/chairops/queries/_cumulative-shortage.ts).
  const [sidebar, overview, cumShortage, ledger, timeline, periods, dayDetail] =
    await Promise.all([
      getReconcileSidebar({ orgId }),
      getReconcileOverview({ orgId, branchId: branchId ?? undefined }),
      getCumulativeShortage(orgId),
      view === "ledger"
        ? getReconcileLedger({
            orgId,
            branchId: branchId ?? undefined,
            take: 365,
            from: safeFrom,
            to: safeTo,
            allTime,
          })
        : Promise.resolve([]),
      view === "timeline"
        ? getReconcileTimeline({ orgId, branchId: branchId ?? undefined, days: 60 })
        : Promise.resolve([]),
      view === "periods"
        ? getReconcilePeriods({ orgId, branchId: branchId ?? undefined })
        : Promise.resolve([]),
      view === "ledger" && safeDay
        ? getReconcileDayDetail({ orgId, branchId: branchId ?? undefined, day: safeDay })
        : Promise.resolve(null as ReconcileDayDetail | null),
    ]);

  // CEO 2026-06-02: default the Ledger view to "last 30 complete POS days
  // ending at posCoverThrough" — same as how a bank statement opens on the
  // most-recent month, not a random year-old slice. Only applies when the
  // user hasn't supplied an explicit ?from/?to.
  //
  // FIX 2026-06-05: upper bound is today (not posThrough). When a deposit is
  // made AFTER the last POS upload (depositedAt > posThrough), capping at
  // posThrough silently hides the deposit row. The lower bound still anchors
  // to posThrough-29 so the ledger opens on the latest POS data window.
  const posThrough = overview.freshness.posCoverThrough;

  // CEO 2026-06-29: per-chair deep-dive — only meaningful per branch (chairCode
  // is unique within a branch). Loads after posThrough so the default window
  // matches the ledger's. Org view shows a "pick a branch" prompt instead.
  // CEO 2026-06-29: รายตู้ tab has two sub-views — "รายวัน" (per-day × per-chair
  // matrix · the new default) and "สรุปรวม" (window aggregate · the original).
  // Only the active one is fetched. Both share the same date-filter window.
  const perChair =
    view === "perchair" && branchId && perChairSummary
      ? await getReconcilePerChairTW({
          orgId,
          branchId,
          from: safeFrom,
          to: safeTo,
          allTime,
          posCoverThrough: posThrough,
        })
      : null;
  const perChairDetail =
    view === "perchair" && branchId && perChairDaily
      ? await getReconcilePerChairDetail({
          orgId,
          branchId,
          from: safeFrom,
          to: safeTo,
          allTime,
          posCoverThrough: posThrough,
        })
      : null;
  // CEO 2026-07-01: "ใครทำอะไร" activity log — who collected/deposited, day by
  // day. ?chair= narrows the log to one machine. Loaded only for this sub-view.
  const perChairActivityData =
    view === "perchair" && branchId && perChairActivity
      ? await getReconcileActivity({
          orgId,
          branchId,
          from: safeFrom,
          to: safeTo,
          allTime,
          posCoverThrough: posThrough,
          chair: chair ?? null,
        })
      : null;
  // CEO 2026-06-29: drill — one chair's per-round history (newest first) for the
  // summary sub-view. Loaded only when a chair is selected via ?chair=.
  const perChairRounds =
    view === "perchair" && branchId && perChairSummary && chair
      ? await getReconcilePerChairRoundsTW({ orgId, branchId, chairCode: chair })
      : null;

  // CEO 2026-07-01: monthly collection checklist (branch × day grid). Org-wide
  // regardless of the selected branch. Month via ?month=YYYY-MM (default now).
  const todayYm = new Date(Date.now() + 7 * 3_600_000)
    .toISOString()
    .slice(0, 7);
  // Validate BOTH shape and range — a hand-typed ?month=2026-13 / 2026-00 must
  // not reach `new Date(...)` (→ Invalid Date → Prisma throw → 500). Fall back
  // to the current month for anything out of 1..12 / a sane year.
  const YM_RE = /^\d{4}-\d{2}$/;
  let safeMonth = todayYm;
  if (month && YM_RE.test(month)) {
    const [y, m] = month.split("-").map(Number);
    if (m >= 1 && m <= 12 && y >= 2000 && y <= 2100) safeMonth = month;
  }
  const [ckYear, ckMonth] = safeMonth.split("-").map(Number);
  const showNumbers = view === "checklist" && checklistView === "numbers";
  const checklist =
    view === "checklist" && !showNumbers
      ? await getReconcileChecklist({ orgId, year: ckYear, month: ckMonth })
      : null;
  // CEO 2026-08-23: "numbers" sub-view — org-wide ควรได้/เก็บได้/ฝาก grid. Only
  // fetched when that sub-view is actually active (it's N=~48 branches' worth
  // of getReconcilePeriods() in parallel — heavier than the dot checklist, so
  // it must stay opt-in per the "only fetch what the active tab needs" rule
  // this file already follows for every other tab).
  const checklistNumbers = showNumbers
    ? await getReconcileChecklistNumbers({ orgId, year: ckYear, month: ckMonth })
    : null;
  // Drill-down for the numbers grid — extends the Ledger tab's `?day=` pattern
  // with `numbersBranch` since this grid spans every branch, not one page's
  // worth. Reuses getReconcileDayDetail() as-is (already branchId?-generic).
  const numbersDayDetail =
    showNumbers && safeDay && numbersBranch
      ? await getReconcileDayDetail({ orgId, branchId: numbersBranch, day: safeDay })
      : null;
  // The ควรได้ (meter) figure for that exact branch+day comes from the SAME
  // checklistNumbers payload already fetched above (no extra query) — find the
  // branch row + day cell the drill-down is open on.
  const numbersDayCell = (() => {
    if (!numbersDayDetail || !checklistNumbers || !safeDay) return null;
    const b = checklistNumbers.branches.find((x) => x.branchId === numbersBranch);
    if (!b) return null;
    const dayNum = Number(safeDay.slice(8, 10));
    return b.cells.find((c) => c.day === dayNum) ?? null;
  })();
  const numbersDayBranchName =
    checklistNumbers?.branches.find((x) => x.branchId === numbersBranch)?.name ?? null;

  const defaultedLedger = (() => {
    // Explicit selection (custom range OR "ทั้งหมด") shows as-is. Only the
    // untouched default opens on the latest 30-day window (bank-statement style).
    // CEO 2026-06-25 BUGFIX: "ทั้งหมด" (allTime) previously fell into this 30-day
    // default because it carries no ?from/?to — so it silently showed 30 days.
    if (view !== "ledger" || safeFrom || safeTo || allTime) return ledger;
    if (!posThrough) return ledger;
    const cutoff = isoMinusDays(posThrough, 29); // 30-day inclusive window
    const today = new Date().toISOString().slice(0, 10);
    return ledger.filter((d) => d.date >= cutoff && d.date <= today);
  })();
  // Totals reflect the WHOLE selected range (all pages), not just the visible
  // page, so the "ยอดรวม" footer is the range summary. Pagination only slices
  // which rows render.
  const totals = view === "ledger" ? ledgerTotals(defaultedLedger) : null;
  const totalRows = defaultedLedger.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / LEDGER_PAGE_SIZE));
  const safePage = Math.min(pageNum, pageCount - 1);
  const pagedLedger =
    pageCount > 1
      ? defaultedLedger.slice(
          safePage * LEDGER_PAGE_SIZE,
          safePage * LEDGER_PAGE_SIZE + LEDGER_PAGE_SIZE,
        )
      : defaultedLedger;

  // CEO 2026-06-02 (orchestra-audit CONF-05): the org-level aggregate uses
  // the canonical "positive-only" formula (= "ค้างฝากรวม") so it matches the
  // exec home tile exactly. Previously this used `sidebar.reduce((s,r) =>
  // s + r.cumDrift, 0)` which is signed net — surplus branches cancelled
  // shortage branches and the number contradicted the exec home tile.
  // Per-row sidebar chips stay signed (a branch can still be in surplus).
  const orgCumShortage = cumShortage.total;
  const heroLabel = isOrg
    ? "ค้างฝากรวมทุกสาขา"
    : `ค้างฝาก · ${branchName ?? ""}`;
  const recomputeHref = isOrg
    ? "/chairops/reconcile?recompute=1"
    : `${baseHref}?recompute=1`;
  // CEO 2026-06-02: forward the active date range so the CSV matches the
  // visible ledger slice. Falls back to the default 30-day window if no
  // explicit ?from/?to were set.
  const exportQs = new URLSearchParams();
  if (!isOrg) exportQs.set("branchId", branchId);
  // CEO 2026-06-25: when the screen is in "ทั้งหมด" mode, the export must also
  // be all-history — else the file silently caps at the 30-day default while
  // the screen shows everything (file ≠ screen). Forward ?all=1 instead of a
  // from/to window.
  if (allTime) {
    exportQs.set("all", "1");
  } else {
    if (safeFrom) exportQs.set("from", safeFrom);
    else if (posThrough && view === "ledger") {
      exportQs.set("from", isoMinusDays(posThrough, 29));
    }
    if (safeTo) exportQs.set("to", safeTo);
    else if (posThrough && view === "ledger") {
      // Match the visible window ceiling (today, not posThrough) so deposits
      // after the last POS upload appear in the downloaded file too.
      exportQs.set("to", new Date().toISOString().slice(0, 10));
    }
  }
  const exportHref = `/chairops/reconcile/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`;

  // CEO 2026-06-25 · build a ledger URL preserving the active filters while
  // overriding the drill-down day and/or pagination page. `day: null` clears
  // the drill-down; omitting `day` keeps the current one.
  const buildLedgerHref = (opts: { day?: string | null; page?: number }): string => {
    const usp = new URLSearchParams();
    if (safeFrom) usp.set("from", safeFrom);
    if (safeTo) usp.set("to", safeTo);
    if (allTime) usp.set("all", "1");
    if (missingSlip) usp.set("missingSlip", "1");
    const pageVal = opts.page ?? safePage;
    if (pageVal > 0) usp.set("page", String(pageVal));
    const dayVal = opts.day === undefined ? safeDay : opts.day;
    if (dayVal) usp.set("day", dayVal);
    const qs = usp.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  // CEO 2026-08-23 · build a checklist URL preserving month + sub-view (dots vs
  // numbers) while overriding the numbers drill-down (day+branch). Mirrors
  // buildLedgerHref's "omit = keep current, null = clear" convention.
  const buildChecklistHref = (opts: {
    ckView?: "dots" | "numbers";
    month?: string;
    day?: string | null;
    numbersBranch?: string | null;
  }): string => {
    const usp = new URLSearchParams();
    usp.set("view", "checklist");
    const ckv = opts.ckView ?? checklistView;
    if (ckv === "numbers") usp.set("ckv", "numbers");
    usp.set("month", opts.month ?? safeMonth);
    if (ckv === "numbers") {
      const dayVal = opts.day === undefined ? safeDay : opts.day;
      const branchVal = opts.numbersBranch === undefined ? numbersBranch : opts.numbersBranch;
      if (dayVal) usp.set("day", dayVal);
      if (branchVal) usp.set("branch", branchVal);
    }
    return `${baseHref}?${usp.toString()}`;
  };

  return (
    <div className="rc-app">
      <ReconcileSidebar
        rows={sidebar}
        activeBranchId={branchId}
        orgCumShortage={orgCumShortage}
        view={view}
        canManage={canManage}
      />

      <main className="rc-main">
        <header className="rc-header">
          <div>
            <div className="co-breadcrumb">
              <Link href="/chairops/dashboard">ChairOps</Link>
              <span>›</span>
              <span className="current">
                {isOrg ? "Reconcile รวม" : `Reconcile · ${branchName ?? ""}`}
              </span>
            </div>
            <h1 className="rc-title">
              {isOrg ? "ตรวจยอด · ทุกสาขารวม" : `ตรวจยอด · ${branchName ?? ""}`}
            </h1>
            <div
              className="text-3"
              style={{ fontSize: 12.5, marginTop: 4 }}
            >
              POS รายงาน 00:01–23:59 · แม่บ้านเก็บไม่ตรงเวลา · ระบบเทียบสะสมให้
            </div>
          </div>
          <div className="row gap-2">
            <a href={exportHref} className="btn btn-sm" download>
              <Download size={12} aria-hidden="true" /> Export CSV
            </a>
            <Link href={recomputeHref} className="btn btn-sm">
              <RefreshCcw size={12} aria-hidden="true" /> Recompute
            </Link>
          </div>
        </header>

        <FreshnessBar
          freshness={overview.freshness}
          context={isOrg ? "org" : "branch"}
        />

        {/* Sprint-1: POS staleness alert banner — amber ≥3 days, red ≥7 days.
            FreshnessBar shows the date inline but office staff miss it when
            busy; this banner blocks the data with an explicit warning. */}
        {overview.freshness.posCoverDaysAgo != null &&
          overview.freshness.posCoverDaysAgo >= 3 && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 4,
                background:
                  overview.freshness.posCoverDaysAgo >= 7
                    ? "var(--co-error-bg, #fef2f2)"
                    : "#fffbeb",
                border: `1px solid ${overview.freshness.posCoverDaysAgo >= 7 ? "var(--co-error-border, #fca5a5)" : "#fcd34d"}`,
                color:
                  overview.freshness.posCoverDaysAgo >= 7
                    ? "var(--co-error-text, #991b1b)"
                    : "#92400e",
              }}
            >
              <span aria-hidden="true">{overview.freshness.posCoverDaysAgo >= 7 ? "🔴" : "🟡"}</span>
              <span>
                POS ยังไม่ได้อัพโหลด{" "}
                <strong>{overview.freshness.posCoverDaysAgo} วัน</strong>
                {" "}— ตัวเลข Reconcile อาจไม่สะท้อนยอดล่าสุด · กรุณาอัพ XLSX แล้ว Recompute
              </span>
            </div>
          )}

        <DriftHero overview={overview} label={heroLabel} />

        <ReconcileTabs baseHref={baseHref} active={view} />

        {(view === "ledger" || view === "perchair") && (
          <LedgerDateFilter
            baseHref={baseHref}
            view={view}
            from={safeFrom ?? null}
            to={safeTo ?? null}
            allTime={!!allTime}
            posCoverThrough={posThrough}
          />
        )}

        {/* F1 (audit MISS-04 · 2026-06-02) — "ยังไม่มีสลิป" toggle. Chip is a
            simple URL-driven anchor so the page stays server-rendered. Only
            applies to the Ledger view. */}
        {view === "ledger" && (
          <div
            className="row gap-2"
            style={{ alignItems: "center", marginTop: 4 }}
          >
            <Link
              href={(() => {
                const usp = new URLSearchParams();
                if (safeFrom) usp.set("from", safeFrom);
                if (safeTo) usp.set("to", safeTo);
                if (allTime) usp.set("all", "1");
                const qs = usp.toString();
                return qs ? `${baseHref}?${qs}` : baseHref;
              })()}
              className="btn btn-sm"
              aria-pressed={!missingSlip}
              style={
                missingSlip
                  ? undefined
                  : {
                      background: "var(--surface-soft)",
                      borderColor: "var(--border-strong)",
                      fontWeight: 600,
                    }
              }
            >
              ทั้งหมด
            </Link>
            <Link
              href={(() => {
                const usp = new URLSearchParams();
                if (safeFrom) usp.set("from", safeFrom);
                if (safeTo) usp.set("to", safeTo);
                if (allTime) usp.set("all", "1");
                usp.set("missingSlip", "1");
                return `${baseHref}?${usp.toString()}`;
              })()}
              className="btn btn-sm"
              aria-pressed={!!missingSlip}
              title="แสดงเฉพาะวันที่มี CSV import และยังไม่มีสลิปฝาก"
              style={
                missingSlip
                  ? {
                      background: "#fef3c7",
                      borderColor: "#fcd34d",
                      color: "#92400e",
                      fontWeight: 600,
                    }
                  : undefined
              }
            >
              ยังไม่มีสลิป (CSV)
            </Link>
          </div>
        )}

        <div className="rc-body">
          {view === "ledger" && (
            <>
              {dayDetail && (
                <DayDetailPanel
                  detail={dayDetail}
                  closeHref={buildLedgerHref({ day: null })}
                />
              )}
              <LedgerTab
                ledger={pagedLedger}
                totals={totals}
                isOrg={isOrg}
                csvOnlyMissingSlip={missingSlip}
                makeDayHref={(d) => buildLedgerHref({ day: d })}
                activeDay={safeDay ?? null}
              />
              {pageCount > 1 && (
                <LedgerPager
                  page={safePage}
                  pageCount={pageCount}
                  total={totalRows}
                  pageSize={LEDGER_PAGE_SIZE}
                  prevHref={
                    safePage > 0
                      ? buildLedgerHref({ page: safePage - 1, day: null })
                      : null
                  }
                  nextHref={
                    safePage < pageCount - 1
                      ? buildLedgerHref({ page: safePage + 1, day: null })
                      : null
                  }
                />
              )}
            </>
          )}
          {view === "timeline" && <TimelineTab series={timeline} />}
          {view === "periods" && (
            <PeriodsTab periods={periods} branchId={branchId} />
          )}
          {view === "perchair" && (
            <>
              {!isOrg && (
                <PerChairViewToggle
                  summaryHref={(() => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    usp.set("pcv", "summary");
                    return `${baseHref}?${usp.toString()}`;
                  })()}
                  dailyHref={(() => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    return `${baseHref}?${usp.toString()}`;
                  })()}
                  activityHref={(() => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    usp.set("pcv", "activity");
                    return `${baseHref}?${usp.toString()}`;
                  })()}
                  active={perChairView}
                />
              )}
              {perChairActivity ? (
                <ActivityTab
                  data={perChairActivityData}
                  isOrg={isOrg}
                  makeChairHref={(c) => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    usp.set("pcv", "activity");
                    if (c) usp.set("chair", c);
                    return `${baseHref}?${usp.toString()}`;
                  }}
                />
              ) : perChairDaily ? (
                <PerChairDetailTab
                  data={perChairDetail}
                  isOrg={isOrg}
                  selectedChair={chair ?? null}
                  chairHref={(c) => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    usp.set("chair", c);
                    return `${baseHref}?${usp.toString()}`;
                  }}
                  backHref={(() => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    return `${baseHref}?${usp.toString()}`;
                  })()}
                />
              ) : (
                <PerChairTab
                  data={perChair}
                  isOrg={isOrg}
                  hrefBase={(() => {
                    const usp = new URLSearchParams();
                    usp.set("view", "perchair");
                    if (safeFrom) usp.set("from", safeFrom);
                    if (safeTo) usp.set("to", safeTo);
                    if (allTime) usp.set("all", "1");
                    usp.set("pcv", "summary");
                    return `${baseHref}?${usp.toString()}`;
                  })()}
                  selectedChair={chair ?? null}
                  rounds={perChairRounds}
                />
              )}
            </>
          )}
          {view === "checklist" && (
            <>
              {/* CEO 2026-08-23: จุด ⇄ ตัวเลข — a separate sub-view, NOT a
                  modification of ChecklistTab/checklistDot (those stay exactly
                  as before). Query-param switch (not CSS-only) because only the
                  active sub-view's data is fetched — see `showNumbers` above. */}
              <div className="row" style={{ gap: 6, padding: "0 2px 6px" }}>
                <Link
                  href={buildChecklistHref({ ckView: "dots", day: null, numbersBranch: null })}
                  className="rc-tab"
                  data-active={!showNumbers ? "" : undefined}
                  scroll={false}
                >
                  ● จุด
                </Link>
                <Link
                  href={buildChecklistHref({ ckView: "numbers" })}
                  className="rc-tab"
                  data-active={showNumbers ? "" : undefined}
                  scroll={false}
                >
                  🔢 ตัวเลข
                </Link>
              </div>
              {showNumbers ? (
                <>
                  {numbersDayDetail && (
                    <DayDetailPanel
                      detail={numbersDayDetail}
                      branchName={numbersDayBranchName ?? undefined}
                      expectedAmount={numbersDayCell?.expectedAmount}
                      expectedRoundCount={numbersDayCell?.roundCount}
                      closeHref={buildChecklistHref({ day: null, numbersBranch: null })}
                    />
                  )}
                  <NumbersTab
                    data={checklistNumbers}
                    todayYm={todayYm}
                    makeMonthHref={(ym) =>
                      buildChecklistHref({ ckView: "numbers", month: ym, day: null, numbersBranch: null })
                    }
                    makeBranchHref={(bid) => `/chairops/reconcile/${bid}`}
                    dayHref={(bid, d) => buildChecklistHref({ ckView: "numbers", day: d, numbersBranch: bid })}
                  />
                </>
              ) : (
                <ChecklistTab
                  data={checklist}
                  todayYm={todayYm}
                  makeMonthHref={(ym) => buildChecklistHref({ ckView: "dots", month: ym })}
                  makeBranchHref={(bid) => `/chairops/reconcile/${bid}`}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
