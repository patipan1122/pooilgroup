// ClawFleet · Insights workspace (Workspace 3)
// Merges /reports + /machines + /stock + audit-log into 1 explorer with view toggle.
// URL state: ?view=<events|sessions|machines|branches|staff|stock|audit>
//           &from=YYYY-MM-DD&to=YYYY-MM-DD&branch=&group=&machine=&staff=&severity=&drill=
//
// 2-pane layout: filter sidebar (280px) + main (flex)
// Drawer slides in from right when ?drill= is set.
//
// Guards: module entitlement + requireCfSession (per layout.tsx — re-asserted here defensively)

import { redirect } from "next/navigation";
import {
  listAccessibleBranches,
  listMachines,
  listGroups,
} from "@/lib/clawfleet/queries";
import { requireCfSession } from "@/lib/clawfleet/role-guard";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { prisma } from "@/lib/prisma";

import { FilterRail } from "@/components/clawfleet/insights/filter-rail";
import {
  InsightsViewToggle,
  type InsightsView,
} from "@/components/clawfleet/insights/view-toggle";
import { EventsTable } from "@/components/clawfleet/insights/events-table";
import { MachinesGrid } from "@/components/clawfleet/insights/machines-grid";
import { AuditLogTable } from "@/components/clawfleet/insights/audit-log-table";
import {
  SessionsTable,
  BranchesTable,
  StaffTable,
  StockTable,
} from "@/components/clawfleet/insights/aux-tables";
import { DrillDrawer } from "@/components/clawfleet/insights/drill-drawer";
import {
  EventDrillBody,
  MachineDrillBody,
  GenericDrillBody,
} from "@/components/clawfleet/insights/drill-bodies";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const VALID_VIEWS: InsightsView[] = [
  "events",
  "sessions",
  "machines",
  "branches",
  "staff",
  "stock",
  "audit",
];

function isView(v: string | undefined): v is InsightsView {
  return !!v && (VALID_VIEWS as string[]).includes(v);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SP {
  view?: string;
  from?: string;
  to?: string;
  branch?: string;
  group?: string;
  machine?: string;
  staff?: string;
  severity?: string;
  drill?: string;
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  // Defensive guard — layout already runs these, but Insights is a privileged surface
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  const session = await requireCfSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "clawfleet");
    if (!ok) redirect("/403");
  }

  const params = await searchParams;
  const view: InsightsView = isView(params.view) ? params.view : "events";
  const fromISO = params.from ?? daysAgoISO(7);
  const toISO = params.to ?? todayISO();
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T23:59:59`);
  const drill = params.drill;

  // Parallel: filter options + view counts
  const [branches, machinesAll, groups, staff] = await Promise.all([
    listAccessibleBranches(),
    listMachines({ branchId: params.branch }),
    listGroups(),
    listStaffOptions(session.user.org_id),
  ]);

  // baseParams used by child components to build drill links that preserve filters
  const baseParams = new URLSearchParams();
  baseParams.set("view", view);
  baseParams.set("from", fromISO);
  baseParams.set("to", toISO);
  if (params.branch) baseParams.set("branch", params.branch);
  if (params.group) baseParams.set("group", params.group);
  if (params.machine) baseParams.set("machine", params.machine);
  if (params.staff) baseParams.set("staff", params.staff);
  if (params.severity) baseParams.set("severity", params.severity);

  const exportHref = `/api/clawfleet/reports/export?from=${from.toISOString()}&to=${to.toISOString()}${params.branch ? `&branch=${params.branch}` : ""}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      <header className="mb-4">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
          <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
          ClawFleet · Workspace
        </p>
        <h1 className="text-2xl font-bold text-zinc-900 sm:text-3xl">
          Insights
        </h1>
        <p className="text-sm text-zinc-500">
          ขุดข้อมูลทุกมุม · filter → ตาราง → drawer · พร้อม CSV export
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <FilterRail
          view={view}
          from={fromISO}
          to={toISO}
          branchId={params.branch}
          groupId={params.group}
          machineId={params.machine}
          staffId={params.staff}
          severity={
            params.severity === "P0" ||
            params.severity === "P1" ||
            params.severity === "P2"
              ? params.severity
              : undefined
          }
          branches={branches.map((b) => ({ id: b.id, label: b.name }))}
          groups={groups.map((g) => ({
            id: g.id,
            label: `${g.name} · ${g.branch.name}`,
          }))}
          machines={machinesAll.map((m) => ({
            id: m.id,
            label: `${m.code}${m.nickname ? ` · ${m.nickname}` : ""}`,
          }))}
          staff={staff}
        />

        <main className="flex-1 min-w-0 space-y-4">
          <InsightsViewToggle active={view} />

          {/* Body — one of seven views */}
          {view === "events" && (
            <EventsTable
              from={from}
              to={to}
              branchId={params.branch}
              machineId={params.machine}
              baseParams={baseParams}
              exportHref={exportHref}
            />
          )}

          {view === "machines" && (
            <MachinesGrid branchId={params.branch} baseParams={baseParams} />
          )}

          {view === "audit" && (
            <AuditLogTable
              actorId={params.staff}
              from={from}
              to={to}
              baseParams={baseParams}
            />
          )}
          {view === "sessions" && (
            <SessionsTable
              from={from}
              to={to}
              groupId={params.group}
              baseParams={baseParams}
            />
          )}
          {view === "branches" && (
            <BranchesTable
              from={from}
              to={to}
              branchId={params.branch}
              baseParams={baseParams}
            />
          )}
          {view === "staff" && (
            <StaffTable
              from={from}
              to={to}
              branchId={params.branch}
              staffId={params.staff}
              baseParams={baseParams}
            />
          )}
          {view === "stock" && (
            <StockTable branchId={params.branch} baseParams={baseParams} />
          )}
        </main>
      </div>

      {/* Universal drawer — content varies by view */}
      {drill && (
        <DrillDrawer
          title={drillTitle(view, drill)}
          subtitle={drillSubtitle(view)}
        >
          {view === "events" && <EventDrillBody eventId={drill} />}
          {view === "machines" && <MachineDrillBody code={drill} />}
          {view === "audit" && <GenericDrillBody id={drill} view="audit" />}
          {(view === "sessions" ||
            view === "branches" ||
            view === "staff" ||
            view === "stock") && (
            <GenericDrillBody id={drill} view={view} />
          )}
        </DrillDrawer>
      )}
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================

function drillTitle(view: InsightsView, drill: string): string {
  switch (view) {
    case "events":
      return "รายละเอียดเหตุการณ์";
    case "machines":
      return `ตู้ ${drill}`;
    case "audit":
      return "Audit entry";
    case "sessions":
      return "รอบเก็บ";
    case "branches":
      return "สาขา";
    case "staff":
      return "พนักงาน";
    case "stock":
      return "สต๊อก";
    default:
      return "รายละเอียด";
  }
}

function drillSubtitle(view: InsightsView): string | undefined {
  switch (view) {
    case "events":
      return "เงินสด · มิเตอร์ · พนักงาน · anomaly flags";
    case "machines":
      return "30 วันล่าสุด · loadout · เหตุการณ์";
    case "audit":
      return "ใคร · ทำอะไร · เมื่อไหร่";
    case "sessions":
      return "พนักงาน · กลุ่ม · เหตุการณ์";
    default:
      return undefined;
  }
}

async function listStaffOptions(
  orgId: string,
): Promise<{ id: string; label: string }[]> {
  // TODO[claude-design]: replace with getActiveStaffForOrg() once available — for now
  // pull from cf_collection_events.collectedBy to limit to actual users
  const rows = await prisma.cfCollectionEvent.findMany({
    where: { orgId },
    distinct: ["collectedById"],
    select: {
      collectedBy: { select: { id: true, name: true } },
    },
    take: 200,
  });
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const r of rows) {
    if (!seen.has(r.collectedBy.id)) {
      seen.add(r.collectedBy.id);
      out.push({ id: r.collectedBy.id, label: r.collectedBy.name });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "th"));
}

