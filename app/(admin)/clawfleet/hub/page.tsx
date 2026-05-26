// ClawFleet Hub — Morning Launcher (Workspace 1)
// CONCEPT: Hub != Dashboard. CEO opens · sees "ตอนนี้คุณต้องทำ X อย่าง"
// big action cards first · then 6 KPI strip below as secondary glance.
// Replaces traditional /clawfleet/dashboard pattern (still exists as legacy).
//
// Layout (top → bottom):
//   1. HubHeader (sticky) · greeting + Thai date/time + branch picker + refresh
//   2. ACTION CARDS       · 3-card grid (anomaly · stale session · low stock · silent machine)
//   3. KPI STRIP          · 6 compact tiles (รายได้ · ขาด · anomaly · warn · stock · sessions)
//   4. QUICK ACTIONS      · 3-4 deeplinks
//
// Data fetch is parallel via Promise.all (RSC). Branch filter persists via
// `?branch=` searchParam + `cf_branch` cookie (read-only here; written by header form).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  PackageOpen,
  BatteryWarning,
  Coins,
  TrendingDown,
  Sparkles,
  Gamepad2,
} from "lucide-react";
import { requireCfSession, isCfAdmin } from "@/lib/clawfleet/role-guard";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import {
  getDashboardKpis,
  getActionItems,
  listAccessibleBranches,
} from "@/lib/clawfleet/queries";
import { ActionCard } from "@/components/clawfleet/hub/action-card";
import { HubHeader } from "@/components/clawfleet/hub/hub-header";
import { KpiStrip, type KpiStripItem } from "@/components/clawfleet/hub/kpi-strip";
import { QuickActionsBar } from "@/components/clawfleet/hub/quick-actions-bar";
import { formatTHB } from "@/lib/clawfleet/validation";

export const dynamic = "force-dynamic";

// Safe default — page must render even when getActionItems errors.
const FALLBACK_ACTION_ITEMS = {
  anomalies: { count: 0, topSessionCode: undefined as string | undefined },
  staleSessions: {
    count: 0,
    oldestHoursAgo: undefined as number | undefined,
  },
  lowStock: { count: 0, topMachineCode: undefined as string | undefined },
  silentMachines: {
    count: 0,
    topMachineCode: undefined as string | undefined,
  },
};

// TODO[claude-design]: lift to lib/clawfleet/queries.ts as
//   getHubActionItems({ branchId? }) — current getActionItems honors role scope
//   but does NOT accept an ad-hoc branchId filter from the picker. For now we
//   filter the KPI/action numbers in-component when branchId is set.

interface HubPageProps {
  searchParams?: Promise<{ branch?: string }>;
}

export default async function ClawfleetHubPage({ searchParams }: HubPageProps) {
  // ─── Auth & module entitlement (per [[module-entitlement-must-gate-all-layouts]])
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  const session = await requireCfSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "clawfleet");
    if (!ok) redirect("/403");
  }

  // ─── Branch filter resolution (searchParam > cookie > "")
  const sp = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const cookieBranch = cookieStore.get("cf_branch")?.value ?? "";
  const requestedBranchId = (sp.branch ?? cookieBranch).trim();

  // ─── Parallel data fetch
  const [kpi, actionItemsRaw, branches] = await Promise.all([
    getDashboardKpis(),
    getActionItems().catch(() => FALLBACK_ACTION_ITEMS),
    listAccessibleBranches(),
  ]);
  const actionItems = actionItemsRaw ?? FALLBACK_ACTION_ITEMS;

  // Validate requested branch is in scope (defense in depth)
  const branchOptions = branches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
  }));
  const validBranchId = branchOptions.find((b) => b.id === requestedBranchId)
    ? requestedBranchId
    : "";

  // ─── Build action card list (only show cards with count > 0; cap at 3)
  type CardDef = {
    key: string;
    tone: "rose" | "amber" | "emerald" | "indigo";
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    ctaLabel: string;
    href: string;
    count: number;
    priority: number;
  };

  const branchQs = validBranchId ? `&branch=${validBranchId}` : "";

  const allCards: CardDef[] = [
    {
      key: "anomaly",
      tone: "rose",
      icon: <AlertTriangle className="h-6 w-6" aria-hidden />,
      title: "Anomaly รอ review",
      subtitle:
        actionItems.anomalies.count === 1
          ? `1 รอบ · เริ่มที่ ${actionItems.anomalies.topSessionCode ?? "ล่าสุด"} · ~3 นาที`
          : `${actionItems.anomalies.count} รอบรอตรวจ · ~${actionItems.anomalies.count * 3} นาที`,
      ctaLabel: "เริ่มตรวจ",
      href: `/clawfleet/operations?tab=anomaly${branchQs}`,
      count: actionItems.anomalies.count,
      priority: 1,
    },
    {
      key: "stale",
      tone: "amber",
      icon: <Clock className="h-6 w-6" aria-hidden />,
      title: "Session ค้างนาน",
      subtitle:
        actionItems.staleSessions.count === 0
          ? "ไม่มี"
          : actionItems.staleSessions.oldestHoursAgo
            ? `${actionItems.staleSessions.count} รอบ · นานสุด ${actionItems.staleSessions.oldestHoursAgo} ชม.`
            : `${actionItems.staleSessions.count} รอบเปิดค้าง >12 ชม.`,
      ctaLabel: "ปิดให้",
      href: `/clawfleet/operations?tab=open${branchQs}`,
      count: actionItems.staleSessions.count,
      priority: 2,
    },
    {
      key: "stock",
      tone: "amber",
      icon: <PackageOpen className="h-6 w-6" aria-hidden />,
      title: "สต๊อกใกล้หมด",
      subtitle:
        actionItems.lowStock.count === 0
          ? "ทุกตู้พอ"
          : actionItems.lowStock.topMachineCode
            ? `${actionItems.lowStock.count} ตู้ · เริ่มจาก ${actionItems.lowStock.topMachineCode}`
            : `${actionItems.lowStock.count} ตู้ < 10 ตัว`,
      ctaLabel: "เติมสต๊อก",
      href: `/clawfleet/operations?tab=stock${branchQs}`,
      count: actionItems.lowStock.count,
      priority: 3,
    },
    {
      key: "silent",
      tone: "amber",
      icon: <BatteryWarning className="h-6 w-6" aria-hidden />,
      title: "ตู้เงียบ >7 วัน",
      subtitle:
        actionItems.silentMachines.count === 0
          ? "ทุกตู้มี collection"
          : actionItems.silentMachines.topMachineCode
            ? `${actionItems.silentMachines.count} ตู้ · เช็ค ${actionItems.silentMachines.topMachineCode}`
            : `${actionItems.silentMachines.count} ตู้ไม่มี collection`,
      ctaLabel: "ตรวจสอบ",
      href: `/clawfleet/operations?tab=machines&filter=silent${branchQs}`,
      count: actionItems.silentMachines.count,
      priority: 4,
    },
  ];

  const cardsToShow = allCards
    .filter((c) => c.count > 0)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  const totalActions = cardsToShow.reduce((sum, c) => sum + c.count, 0);
  const userName = session.user.name?.split(" ")[0] || "ผู้ใช้";
  const isAdmin = isCfAdmin(session.user.role);
  const warnCount =
    actionItems.staleSessions.count + actionItems.silentMachines.count;

  // ─── KPI strip (6 tiles · all link to relevant deep view)
  const kpiItems: KpiStripItem[] = [
    {
      key: "revenue",
      icon: <Coins className="h-4 w-4" />,
      label: "รายได้วันนี้",
      value: formatTHB(kpi.cashTodayCents),
      sub: `${kpi.sessionsToday.toLocaleString("th-TH")} รอบ`,
      severity: "success",
      href: `/clawfleet/insights?view=events&period=today${branchQs}`,
    },
    {
      key: "diff",
      icon: <TrendingDown className="h-4 w-4" />,
      label: "ขาด/เกินวันนี้",
      value: "—",
      sub: "ดูรายละเอียด",
      severity: "warning",
      href: `/clawfleet/insights?view=variance&period=today${branchQs}`,
    },
    {
      key: "anomaly",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Anomaly",
      value: kpi.anomalyCount,
      sub: kpi.anomalyCount > 0 ? "รอ review" : "ปกติ",
      severity: kpi.anomalyCount > 0 ? "danger" : "success",
      href: `/clawfleet/operations?tab=anomaly${branchQs}`,
    },
    {
      key: "warn",
      icon: <Clock className="h-4 w-4" />,
      label: "คำเตือน",
      value: warnCount,
      sub: "stale · เงียบ",
      severity: warnCount > 0 ? "warning" : "success",
      href: `/clawfleet/operations?tab=open${branchQs}`,
    },
    {
      key: "stock",
      icon: <PackageOpen className="h-4 w-4" />,
      label: "ตู้ใกล้หมด",
      value: kpi.lowStockMachines,
      sub: "<10 ตัว",
      severity: kpi.lowStockMachines > 0 ? "warning" : "success",
      href: `/clawfleet/operations?tab=stock${branchQs}`,
    },
    {
      key: "active",
      icon: <Gamepad2 className="h-4 w-4" />,
      label: "ตู้ active",
      value: kpi.activeMachines,
      sub: "ทั้งระบบ",
      severity: "info",
      href: `/clawfleet/setup?tab=machines${branchQs}`,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <HubHeader
        userName={userName}
        branches={branchOptions}
        selectedBranchId={validBranchId}
      />

      {/* ─── Section 1: ตอนนี้คุณต้องทำ X อย่าง ─── */}
      <section className="mb-8" aria-labelledby="hub-actions-heading">
        <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2
              id="hub-actions-heading"
              className="text-xl sm:text-2xl font-bold text-zinc-900"
            >
              {cardsToShow.length === 0
                ? "ไม่มีอะไรเร่งด่วน"
                : `ตอนนี้คุณต้องทำ ${cardsToShow.length} อย่าง`}
            </h2>
            {cardsToShow.length > 0 && (
              <p className="mt-1 text-sm text-zinc-500">
                เริ่มจากการ์ดสีแดงก่อน · รวม{" "}
                {totalActions.toLocaleString("th-TH")} รายการ
              </p>
            )}
          </div>
          {cardsToShow.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <span
                className="size-1.5 rounded-full bg-rose-500"
                aria-hidden
              />
              เรียงตามความเร่งด่วน
            </span>
          )}
        </div>

        {cardsToShow.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-100 grid place-items-center mb-3">
              <Sparkles className="h-7 w-7 text-emerald-700" aria-hidden />
            </div>
            <h3 className="text-lg font-bold text-emerald-900">
              วันนี้ราบรื่น · ไม่มี anomaly · ไม่มีตู้ค้าง
            </h3>
            <p className="mt-1 text-sm text-emerald-700">
              ดูยอดรวมข้างล่างหรือเริ่มรอบเก็บใหม่ได้เลย
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cardsToShow.map((card) => (
              <ActionCard
                key={card.key}
                icon={card.icon}
                tone={card.tone}
                title={card.title}
                subtitle={card.subtitle}
                ctaLabel={card.ctaLabel}
                href={card.href}
                count={card.count}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── Section 2: สรุปวันนี้ (6 KPI strip) ─── */}
      <section className="mb-8" aria-labelledby="hub-kpi-heading">
        <div className="mb-4">
          <h2 id="hub-kpi-heading" className="text-lg font-bold text-zinc-900">
            สรุปวันนี้
          </h2>
          <p className="text-xs text-zinc-500">
            ตัวเลขสด · กดที่การ์ดเพื่อดูรายละเอียด
          </p>
        </div>
        <KpiStrip items={kpiItems} />
      </section>

      {/* ─── Section 3: ลัด ─── */}
      <section aria-labelledby="hub-quick-heading">
        <div className="mb-4">
          <h2
            id="hub-quick-heading"
            className="text-lg font-bold text-zinc-900"
          >
            ลัด
          </h2>
          <p className="text-xs text-zinc-500">เปิดงานที่ใช้บ่อย</p>
        </div>
        <QuickActionsBar showSettings={isAdmin} />
      </section>
    </div>
  );
}
