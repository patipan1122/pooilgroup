// ClawFleet · Operations Workspace 2
// 3-pane: FilterRail (280px) · SessionGrid (flex) · OpsDrawer (400px)
// MGR daily-driver page · merges sessions + anomalies into one workspace.

import { cookies } from "next/headers";
import {
  listSessions,
  listAnomalies,
  listAccessibleBranches,
  listGroups,
  getSessionDetail,
} from "@/lib/clawfleet/queries";
import { requireCfSession } from "@/lib/clawfleet/role-guard";
import { isModuleDisabled } from "@/lib/modules";
import { redirect } from "next/navigation";
import { OpsFilterRail } from "@/components/clawfleet/operations/ops-filter-rail";
import { SessionGrid } from "@/components/clawfleet/operations/session-grid";
import { AnomalyMiniRow } from "@/components/clawfleet/operations/anomaly-mini-row";
import { OpsDrawer } from "@/components/clawfleet/operations/ops-drawer";
import { StartSessionCta } from "@/components/clawfleet/operations/start-session-cta";
import { Activity, Filter } from "lucide-react";
import type { SessionStatus } from "@/lib/clawfleet/types";

export const dynamic = "force-dynamic";

type StatusFilter = "active" | "done" | "anomaly" | "all";
type SeverityFilter = "P0" | "P1" | "P2" | "all";

interface PageProps {
  searchParams: Promise<{
    branch?: string;
    status?: StatusFilter;
    severity?: SeverityFilter;
    focus?: string;
    anomaly?: string;
  }>;
}

function statusToDb(s: StatusFilter | undefined): SessionStatus | undefined {
  if (s === "active") return "OPEN";
  if (s === "done") return "CLOSED";
  if (s === "anomaly") return "ANOMALY_REVIEW";
  return undefined;
}

export default async function OperationsPage({ searchParams }: PageProps) {
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  await requireCfSession();

  const sp = await searchParams;
  const cookieStore = await cookies();
  // cf_branch cookie · persists last branch picked across sessions (1 year set client-side via rail)
  const cookieBranch = cookieStore.get("cf_branch")?.value;
  const branchFilter = sp.branch ?? cookieBranch ?? undefined;
  const statusFilter = sp.status ?? "all";
  const severityFilter = sp.severity ?? "all";
  const focusCode = sp.focus;
  const anomalyCode = sp.anomaly;

  // Parallel fetch (RSC pattern · single round-trip)
  const [allSessions, allAnomalies, branches, groups] = await Promise.all([
    listSessions({ status: statusToDb(statusFilter), take: 200 }),
    listAnomalies(),
    listAccessibleBranches(),
    listGroups(),
  ]);

  // Branch filter (client-side · simpler than re-running query)
  const sessions = branchFilter
    ? allSessions.filter((s) => s.group.branch.id === branchFilter)
    : allSessions;

  const anomalies = branchFilter
    ? allAnomalies.filter((s) => s.group?.branch ? true : false)
    : allAnomalies;

  // Severity filter for anomaly strip
  const filteredAnomalies = severityFilter === "all"
    ? anomalies
    : anomalies.filter((s) => {
        const flags = (s.anomalyFlags ?? []) as string[];
        // Match severity heuristically — any flag matching severity prefix wins
        return flags.some((f) => {
          if (severityFilter === "P0") return ["C1", "C2", "M5", "P4", "F1"].some((p) => f.startsWith(p));
          if (severityFilter === "P1") return ["M3", "P3", "A1", "COIN_GROUP", "G6", "G9", "S1"].some((p) => f.startsWith(p));
          if (severityFilter === "P2") return ["M2", "M4", "P2_", "P5", "A3", "EXCHANGER_NO", "G8"].some((p) => f.startsWith(p));
          return true;
        });
      });

  // Per-branch session counts (for filter rail badges)
  const sessionsByBranch = new Map<string, number>();
  for (const s of allSessions) {
    sessionsByBranch.set(s.group.branch.id, (sessionsByBranch.get(s.group.branch.id) ?? 0) + 1);
  }

  // Drawer payload — fetch session detail if focus/anomaly param present
  let drawerSession = null;
  let drawerMode: "session" | "anomaly" | null = null;
  let prevAnomalyCode: string | undefined;
  let nextAnomalyCode: string | undefined;
  if (focusCode) {
    const matched = allSessions.find((s) => s.sessionCode === focusCode);
    if (matched) {
      drawerSession = await getSessionDetail(matched.id);
      drawerMode = "session";
    }
  } else if (anomalyCode) {
    const matched = allAnomalies.find((s) => s.sessionCode === anomalyCode);
    if (matched) {
      drawerSession = await getSessionDetail(matched.id);
      drawerMode = "anomaly";
      // Compute prev/next within filtered anomaly list for keyboard nav (n/p)
      const codes = filteredAnomalies.map((a) => a.sessionCode);
      const idx = codes.indexOf(anomalyCode);
      if (idx > 0) prevAnomalyCode = codes[idx - 1];
      if (idx >= 0 && idx < codes.length - 1) nextAnomalyCode = codes[idx + 1];
    }
  }

  const openSessionsByGroup: Record<string, string> = {};
  for (const s of allSessions) {
    if (s.status === "OPEN") {
      openSessionsByGroup[s.group.id] = s.id;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      {/* Sticky page header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid size-10 place-items-center rounded-xl bg-blue-100 text-blue-700">
            <Activity className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-900">ปฏิบัติการ</h1>
            <p className="hidden truncate text-xs text-zinc-500 sm:block">
              งานที่กำลังเกิดตอนนี้ · {sessions.length} รอบ · {filteredAnomalies.length} anomaly
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mobile filter toggle (uses native details) */}
          <details className="lg:hidden">
            <summary className="grid size-9 cursor-pointer place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50">
              <Filter className="h-4 w-4" />
            </summary>
            <div className="fixed inset-0 z-40 bg-zinc-950/40" />
            <div className="fixed left-0 top-0 z-50 h-full w-[280px] overflow-y-auto bg-white p-4 shadow-lg">
              <OpsFilterRail
                branches={branches.map((b) => ({
                  id: b.id,
                  name: b.name,
                  code: b.code,
                  sessionCount: sessionsByBranch.get(b.id) ?? 0,
                }))}
                activeBranch={branchFilter}
                activeStatus={statusFilter}
                activeSeverity={severityFilter}
              />
            </div>
          </details>
          <StartSessionCta
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              branch: { name: g.branch.name, code: g.branch.code },
              exchanger: g.exchanger ? { code: g.exchanger.code } : null,
              _count: { machines: g._count.machines },
            }))}
            existingOpen={openSessionsByGroup}
          />
        </div>
      </header>

      {/* 3-pane work area */}
      <div className="flex flex-1">
        {/* LEFT · FilterRail · 280px · desktop only */}
        <aside className="hidden w-[280px] shrink-0 border-r border-zinc-200 bg-white lg:block">
          <OpsFilterRail
            branches={branches.map((b) => ({
              id: b.id,
              name: b.name,
              code: b.code,
              sessionCount: sessionsByBranch.get(b.id) ?? 0,
            }))}
            activeBranch={branchFilter}
            activeStatus={statusFilter}
            activeSeverity={severityFilter}
          />
        </aside>

        {/* CENTER · Anomaly strip + Session grid */}
        <main className="flex-1 min-w-0 space-y-4 p-4 sm:p-6">
          <AnomalyMiniRow anomalies={filteredAnomalies} activeAnomaly={anomalyCode} />
          <SessionGrid sessions={sessions} activeFocus={focusCode} />
        </main>
      </div>

      {/* RIGHT · Drawer (overlay · slides in when ?focus or ?anomaly) */}
      <OpsDrawer
        open={drawerMode !== null}
        mode={drawerMode}
        session={drawerSession}
        prevAnomalyCode={prevAnomalyCode}
        nextAnomalyCode={nextAnomalyCode}
      />
    </div>
  );
}
