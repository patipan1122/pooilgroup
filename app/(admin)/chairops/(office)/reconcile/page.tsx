// Reconcile (W2 · claude-design Phase 2) · drift dashboard · 3-pane MasterDetailShell
//
// BR1 (window-based 12:00→12:00 reconciliation) + BR2 (zero-tolerance cumulative)
// per [[chairops-no-cumulative-shortage]] and [[chairops-maid-schedule-irregular]].
//
// Layout:
//   - SIDEBAR (260px) · branch list · top of list = OVERVIEW link · each row shows
//       branch name + ShortageDriftCell compact mode + status dot
//   - MAIN · period KPI tiles (4) + drift table sorted by shortage size
//   - NO meta pane on the list view (right rail only on detail page)
//
// Server Component default · only `?recompute=1` is a side-effect (kept for back-
// compat with the link in old UI). The detail page owns the explicit
// "Recompute this branch" client button.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import {
  MasterDetailShell,
  stickyTheadClass,
  ChairopsKpiTile,
  ShortageDriftCell,
} from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { baht, thaiDate, thaiRelative } from "@/lib/chairops/utils/format";
import {
  getDashboardRows,
  recomputeAllDrifts,
} from "@/lib/chairops/reconcile/drift-engine";
import {
  AlertTriangle,
  RefreshCcw,
  TimerReset,
  Wallet,
} from "lucide-react";

type SortKey = "drift" | "age" | "lastCollection" | "branch" | "deposit" | "pos";

const SORT_HEADERS: ReadonlyArray<{
  key: SortKey;
  label: string;
  align: "left" | "right";
}> = [
  { key: "branch", label: "สาขา", align: "left" },
  { key: "pos", label: "POS รวม", align: "right" },
  { key: "deposit", label: "ฝากรวม", align: "right" },
  { key: "drift", label: "DRIFT", align: "right" },
  { key: "age", label: "อายุ DRIFT", align: "right" },
  { key: "lastCollection", label: "เก็บล่าสุด", align: "left" },
];

export default async function ReconcileListPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    recompute?: string;
    q?: string;
  }>;
}) {
  await requireRole("OFFICE");
  const sp = await searchParams;
  const sort = (sp.sort ?? "drift") as SortKey;
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const q = (sp.q ?? "").trim().toLowerCase();

  if (sp.recompute === "1") {
    await recomputeAllDrifts();
  }

  // Fetch ONCE — sidebar uses the full set, main table derives a filtered
  // + sorted view in memory (B8: avoid double getDashboardRows DB hit).
  const allBranches = await getDashboardRows();

  let rows = allBranches;
  if (q) {
    rows = rows.filter(
      (r) =>
        r.branchName.toLowerCase().includes(q) ||
        r.branchSlug.toLowerCase().includes(q) ||
        (r.mallGroup ?? "").toLowerCase().includes(q),
    );
  }

  rows = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "drift":
        cmp = a.driftAmount - b.driftAmount;
        break;
      case "age":
        cmp = a.driftHours - b.driftHours;
        break;
      case "lastCollection": {
        const at = a.lastCollectionAt ? a.lastCollectionAt.getTime() : 0;
        const bt = b.lastCollectionAt ? b.lastCollectionAt.getTime() : 0;
        cmp = at - bt;
        break;
      }
      case "pos":
        cmp = a.posTotal - b.posTotal;
        break;
      case "deposit":
        cmp = a.depositTotal - b.depositTotal;
        break;
      case "branch":
        cmp = a.branchName.localeCompare(b.branchName, "th");
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });

  // Sidebar list always shows ALL branches (not filtered by search) so the
  // operator can re-navigate even when narrowing the table.
  const sidebarBranches = [...allBranches].sort(
    (a, b) => b.driftAmount - a.driftAmount,
  );

  // BR2 zero-tolerance: any branch with driftAmount > 0 and >= 24h aging
  // counts as "shortage". Period summary mirrors prior implementation tile set.
  const summary = {
    branches: rows.length,
    totalShortage: rows.reduce(
      (s, r) => s + (r.driftAmount > 0 ? r.driftAmount : 0),
      0,
    ),
    shortageBranches: rows.filter(
      (r) => r.driftAmount > 0 && r.driftHours >= 24,
    ).length,
    missedBranches: rows.filter((r) => r.daysSinceLastCollection > 1).length,
  };

  return (
    <div className="chairops-scope">
      <MasterDetailShell
        sidebar={
          <BranchSidebar
            branches={sidebarBranches}
            activeBranchId={null}
            currentSort={sort}
            currentDir={dir}
            currentQuery={q}
          />
        }
        noMeta
      >
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500">รอบการเงิน</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">
              ตรวจยอด · Reconcile
            </h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-600">
              drift = ΣPOS − Σแม่บ้านฝาก · เรียงค้างมากสุด · BR2 ห้ามขาดสะสม ·
              คลิกหัวคอลัมน์เพื่อเปลี่ยนการเรียง
            </p>
          </div>
          <Link
            href="/chairops/reconcile?recompute=1"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCcw className="size-3.5" aria-hidden="true" />
            Recompute ทุกสาขา
          </Link>
        </header>

        {/* search */}
        <form className="mb-4" action="/chairops/reconcile" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="ค้นหาชื่อสาขา · slug · mall"
            className="h-9 w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 text-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
            aria-label="ค้นหาสาขา"
          />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
        </form>

        {/* KPI tiles */}
        <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <ChairopsKpiTile
            label="สาขาทั้งหมด"
            value={summary.branches}
            unit="สาขา"
            tone="neutral"
          />
          <ChairopsKpiTile
            label="ยอดขาดรวม"
            value={baht(summary.totalShortage)}
            tone={summary.totalShortage > 0 ? "danger" : "success"}
            icon={<Wallet className="size-4" aria-hidden="true" />}
          />
          <ChairopsKpiTile
            label="สาขามี shortage ≥24 ชม."
            value={summary.shortageBranches}
            unit="สาขา"
            tone={summary.shortageBranches > 0 ? "danger" : "success"}
            icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          />
          <ChairopsKpiTile
            label="แม่บ้านไม่ส่งเกิน 1 วัน"
            value={summary.missedBranches}
            unit="สาขา"
            tone={summary.missedBranches > 0 ? "warning" : "success"}
            icon={<TimerReset className="size-4" aria-hidden="true" />}
          />
        </section>

        <div className="overflow-x-auto rounded-2xl border-2 border-zinc-200 bg-white shadow-soft">
          <table className="min-w-[1000px] w-full text-sm">
            <thead
              className={stickyTheadClass(
                "bg-zinc-50 text-xs font-semibold text-zinc-600",
              )}
            >
              <tr className="text-left">
                {SORT_HEADERS.map((h) => (
                  <SortHeaderCell
                    key={h.key}
                    sortKey={h.key}
                    align={h.align}
                    current={sort}
                    dir={dir}
                    q={q}
                  >
                    {h.label}
                  </SortHeaderCell>
                ))}
                <th className="px-3 py-3 font-semibold">สถานะ</th>
                <th className="px-3 py-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={SORT_HEADERS.length + 2}
                    className="px-3 py-16 text-center text-sm text-zinc-500"
                  >
                    ยังไม่มีข้อมูล drift · ลอง{" "}
                    <Link
                      href="/chairops/reconcile?recompute=1"
                      className="font-medium text-zinc-900 underline"
                    >
                      recompute
                    </Link>{" "}
                    ก่อน
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const status = classifyDrift(r);
                return (
                  <tr
                    key={r.branchId}
                    className="hover:bg-zinc-50/70"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/chairops/reconcile/${r.branchId}`}
                        className="block"
                      >
                        <div className="font-semibold text-zinc-900">
                          {r.branchName}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {r.mallGroup ?? "—"}
                          {r.floor ? ` · ${r.floor}` : ""}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                      {baht(r.posTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                      {baht(r.depositTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <ShortageDriftCell
                        // ShortageDriftCell uses negative=shortage convention;
                        // drift-engine uses positive=shortage. Invert sign here.
                        amount={-r.driftAmount}
                        ageHours={r.driftHours}
                        cumulativeDays={Math.floor(r.driftHours / 24)}
                        compact
                        className="justify-end"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs text-zinc-500">
                      {r.driftAmount > 0 ? `${r.driftHours} ชม.` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-600">
                      {r.lastCollectionAt ? (
                        <>
                          <div className="text-xs">
                            {thaiDate(r.lastCollectionAt)}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {thaiRelative(r.lastCollectionAt)}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs font-semibold text-rose-600">
                          ไม่เคยเก็บ
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={status.tone} dot>
                        {status.label}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/chairops/reconcile/${r.branchId}`}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        เปิด timeline →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </MasterDetailShell>
    </div>
  );
}

// ---------- sub-components (server) ----------

function BranchSidebar({
  branches,
  activeBranchId,
  currentSort,
  currentDir,
  currentQuery,
}: {
  branches: Awaited<ReturnType<typeof getDashboardRows>>;
  activeBranchId: string | null;
  currentSort: SortKey;
  currentDir: "asc" | "desc";
  currentQuery: string;
}) {
  const overviewQs = new URLSearchParams();
  if (currentSort !== "drift") overviewQs.set("sort", currentSort);
  if (currentDir !== "desc") overviewQs.set("dir", currentDir);
  if (currentQuery) overviewQs.set("q", currentQuery);
  const overviewHref =
    "/chairops/reconcile" +
    (overviewQs.toString() ? `?${overviewQs.toString()}` : "");

  return (
    <nav className="flex h-full flex-col" aria-label="รายชื่อสาขา">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Reconcile
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          {branches.length.toLocaleString("th-TH")} สาขา
        </h2>
      </div>
      <ul className="flex-1 divide-y divide-zinc-200/60">
        <li>
          <Link
            href={overviewHref}
            className={
              "block px-3 py-2.5 text-sm hover:bg-white " +
              (activeBranchId === null
                ? "bg-white font-semibold text-zinc-900"
                : "text-zinc-700")
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span>ภาพรวมทุกสาขา</span>
              <span className="text-xs text-zinc-500">
                {branches.length}
              </span>
            </div>
          </Link>
        </li>
        {branches.map((b) => {
          const isActive = b.branchId === activeBranchId;
          const cls = classifyDrift(b);
          return (
            <li key={b.branchId}>
              <Link
                href={`/chairops/reconcile/${b.branchId}`}
                className={
                  "block px-3 py-2.5 text-sm hover:bg-white " +
                  (isActive
                    ? "bg-white font-semibold text-zinc-900"
                    : "text-zinc-700")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{b.branchName}</span>
                  <StatusPill tone={cls.tone} size="xs" dot>
                    {b.driftAmount > 0
                      ? baht(b.driftAmount)
                      : cls.label}
                  </StatusPill>
                </div>
                {b.mallGroup && (
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {b.mallGroup}
                    {b.floor ? ` · ${b.floor}` : ""}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SortHeaderCell({
  sortKey,
  align,
  current,
  dir,
  q,
  children,
}: {
  sortKey: SortKey;
  align: "left" | "right";
  current: SortKey;
  dir: "asc" | "desc";
  q: string;
  children: React.ReactNode;
}) {
  const isActive = current === sortKey;
  const nextDir = isActive
    ? dir === "asc"
      ? "desc"
      : "asc"
    : sortKey === "branch"
      ? "asc"
      : "desc";
  const params = new URLSearchParams();
  params.set("sort", sortKey);
  params.set("dir", nextDir);
  if (q) params.set("q", q);
  return (
    <th
      className={
        "px-3 py-3 font-semibold " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      <Link
        href={`/chairops/reconcile?${params.toString()}`}
        className={
          isActive ? "text-zinc-900" : "text-zinc-600 hover:text-zinc-900"
        }
      >
        {children} {isActive ? (dir === "asc" ? "↑" : "↓") : ""}
      </Link>
    </th>
  );
}

// ---------- helpers ----------

function classifyDrift(r: {
  driftAmount: number;
  driftHours: number;
  daysSinceLastCollection: number;
}): {
  label: string;
  // Pool StatusPill tones.
  tone: "success" | "warning" | "danger" | "info" | "neutral";
} {
  if (r.daysSinceLastCollection > 1) {
    return { label: "แม่บ้านไม่ส่ง", tone: "danger" };
  }
  if (r.driftAmount > 0 && r.driftHours >= 24) {
    return { label: "shortage", tone: "danger" };
  }
  if (r.driftAmount > 0) {
    return { label: "ค้าง <24 ชม.", tone: "warning" };
  }
  if (r.driftAmount < -100) {
    return { label: "ส่วนเกิน?", tone: "warning" };
  }
  return { label: "OK", tone: "success" };
}
