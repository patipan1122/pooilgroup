// Reports list — grouped by business type with drill-down
// Shows: รออนุมัติ + อนุมัติแล้ว + ⚠️ ยังไม่ส่ง (missing branches today)
// Filter chips for business type + status; Quick Approve bulk action

import { CheckCircle2, Clock, XCircle, ScrollText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadBranches, loadReports, indexBranches } from "@/lib/cashhub/data";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatInTimeZone } from "date-fns-tz";
import { ReportsBoard } from "./reports-table";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const STATUS = {
  submitted: { tone: "warning" as const, label: "รออนุมัติ", Icon: Clock },
  approved: { tone: "success" as const, label: "อนุมัติแล้ว", Icon: CheckCircle2 },
  rejected: { tone: "danger" as const, label: "ไม่อนุมัติ", Icon: XCircle },
  draft: { tone: "neutral" as const, label: "ร่าง", Icon: Clock },
};

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 เช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 เย็น",
  all: "ทั้งวัน",
};

export interface ReportRowVm {
  id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  business_type: string;
  business_emoji: string;
  business_label: string;
  report_date: string;
  shift: string;
  shift_label: string;
  total_sales: number;
  status: keyof typeof STATUS;
  status_tone: "warning" | "success" | "danger" | "neutral";
  status_label: string;
  submitted_at: string | null;
  reconcile_diff: number;
}

export interface MissingBranchVm {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  business_type: string;
  business_emoji: string;
  business_label: string;
  days_missing: number;
}

export interface BusinessGroupVm {
  type: string;
  label: string;
  emoji: string;
  branchCount: number;
  reports: ReportRowVm[];
  missing: MissingBranchVm[];
  pendingCount: number;
  approvedCount: number;
  missingCount: number;
  totalSales: number;
}

export default async function CashHubReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; date?: string }>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const sp = await searchParams;

  const filterStatus = sp.status || "";
  const filterType = sp.type || "";
  const filterDate = sp.date || "";
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

  // Single source of truth: read via canonical loaders (lib/cashhub/data.ts)
  // statuses: [] = ดึงทุก status (submitted/approved/rejected/draft) — filter ที่ ReportsBoard
  // โหลด 2 ชุด:
  //   activeBranches → ใช้ตรวจ "ขาดส่ง" + group totals (สาขาเปิดอยู่ตอนนี้)
  //   allBranches    → ใช้ index lookup (รายงานเก่าจากสาขาปิดยังต้องเห็นชื่อ)
  const [activeBranches, allBranches, allReports] = await Promise.all([
    loadBranches(session.user.org_id, { activeOnly: true }),
    loadBranches(session.user.org_id, { activeOnly: false }),
    loadReports(session.user.org_id, {
      statuses: [],
      newestFirst: true,
      limit: 200,
    }),
  ]);
  const branchIndex = indexBranches(allBranches);

  // Build the full row VMs first (no filters yet)
  const allRows: ReportRowVm[] = allReports.map((r) => {
    const branch = branchIndex.get(r.branch_id);
    const cfg = branch?.business_type
      ? BUSINESS_TYPES[branch.business_type]
      : undefined;
    const status = (r.status as keyof typeof STATUS) || "submitted";
    const totalReceived =
      Number(r.cash || 0) +
      Number(r.transfer || 0) +
      Number(r.card || 0) +
      Number(r.credit || 0) +
      Number(r.shortage || 0);
    const reconcileDiff = Number(r.total_sales || 0) - totalReceived;
    return {
      id: r.id,
      branch_id: r.branch_id,
      branch_code: branch?.code ?? "—",
      branch_name: branch?.name ?? "",
      business_type: branch?.business_type ?? "unknown",
      business_emoji: cfg?.emoji ?? "📋",
      business_label: cfg?.label ?? branch?.business_type ?? "ไม่ทราบ",
      report_date: r.report_date,
      shift: r.shift,
      shift_label: SHIFT_LABEL[r.shift] ?? r.shift,
      total_sales: Number(r.total_sales || 0),
      status,
      status_tone: STATUS[status].tone,
      status_label: STATUS[status].label,
      submitted_at: r.submitted_at,
      reconcile_diff: reconcileDiff,
    };
  });

  // Detect missing branches: branches with hasCashReport && reportingCadence==='daily'
  // that have no report for today (regardless of status)
  const branchesWithReportToday = new Set(
    allRows
      .filter((r) => r.report_date === today)
      .map((r) => r.branch_id),
  );

  const allMissing: MissingBranchVm[] = activeBranches
    .filter((b) => {
      const cfg = BUSINESS_TYPES[b.business_type];
      if (!cfg) return false;
      if (!cfg.hasCashReport) return false;
      if (cfg.reportingCadence !== "daily") return false;
      return !branchesWithReportToday.has(b.id);
    })
    .map((b) => {
      const cfg = BUSINESS_TYPES[b.business_type];
      // count consecutive days missing (look back up to 7 days)
      let daysMissing = 0;
      const branchReports = new Set(
        allRows
          .filter((r) => r.branch_id === b.id)
          .map((r) => r.report_date),
      );
      const checkDate = new Date(today + "T00:00:00+07:00");
      for (let i = 0; i < 7; i++) {
        const d = formatInTimeZone(checkDate, TZ, "yyyy-MM-dd");
        if (branchReports.has(d)) break;
        daysMissing++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
      return {
        branch_id: b.id,
        branch_code: b.code,
        branch_name: b.name,
        business_type: b.business_type,
        business_emoji: cfg?.emoji ?? "📋",
        business_label: cfg?.label ?? b.business_type,
        days_missing: daysMissing,
      };
    });

  // Apply filters
  const filteredRows = allRows.filter((r) => {
    if (filterStatus && filterStatus !== "missing" && r.status !== filterStatus) {
      return false;
    }
    if (filterType && r.business_type !== filterType) return false;
    if (filterDate && r.report_date !== filterDate) return false;
    return true;
  });
  const filteredMissing = allMissing.filter(
    (m) => !filterType || m.business_type === filterType,
  );

  // Group by business type
  const groupMap = new Map<string, BusinessGroupVm>();
  for (const b of activeBranches) {
    const cfg = BUSINESS_TYPES[b.business_type];
    if (!cfg) continue;
    if (filterType && b.business_type !== filterType) continue;
    if (!groupMap.has(b.business_type)) {
      groupMap.set(b.business_type, {
        type: b.business_type,
        label: cfg.label,
        emoji: cfg.emoji,
        branchCount: 0,
        reports: [],
        missing: [],
        pendingCount: 0,
        approvedCount: 0,
        missingCount: 0,
        totalSales: 0,
      });
    }
    const g = groupMap.get(b.business_type)!;
    g.branchCount++;
  }
  for (const r of filteredRows) {
    const g = groupMap.get(r.business_type);
    if (!g) continue;
    g.reports.push(r);
    if (r.status === "submitted") g.pendingCount++;
    if (r.status === "approved") {
      g.approvedCount++;
      g.totalSales += r.total_sales;
    }
  }
  for (const m of filteredMissing) {
    const g = groupMap.get(m.business_type);
    if (!g) continue;
    g.missing.push(m);
    g.missingCount++;
  }

  const groups = Array.from(groupMap.values()).sort(
    (a, b) => b.totalSales - a.totalSales,
  );

  const totalPending = filteredRows.filter(
    (r) => r.status === "submitted",
  ).length;
  const totalMissing = filteredMissing.length;
  const totalReports = filteredRows.length;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up flex flex-col gap-2">
        <SectionPill num="00" label={`CashHub · ${thaiDateLong(new Date())}`} />
        <TwoToneTitle first="รายงาน" accent="ทั้งหมด" size={32} />
        <p className="text-[var(--ch-text-2)] mt-1 text-sm">
          {totalReports} รายงาน · รออนุมัติ{" "}
          <span className="font-bold text-[#a16207]">{totalPending}</span>
          {totalMissing > 0 && (
            <>
              {" · "}
              <span className="font-bold text-[var(--ch-danger)]">
                ยังไม่ส่งวันนี้ {totalMissing}
              </span>
            </>
          )}
        </p>
      </header>

      <ReportsBoard
        groups={groups}
        filterStatus={filterStatus}
        filterType={filterType}
        filterDate={filterDate}
        totalPending={totalPending}
        totalMissing={totalMissing}
        showOnlyMissing={filterStatus === "missing"}
      />

      {groups.length === 0 && (
        <Section
          number="01"
          label="รายงาน"
          title="รายงานล่าสุด"
          action={
            <a
              href="/api/cashhub/export"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-10 px-4 text-sm rounded-xl"
            >
              Export CSV
            </a>
          }
        >
          <Card>
            <CardBody>
              <EmptyState
                icon={<ScrollText className="size-6" />}
                title="ยังไม่มีรายงาน"
                description="ลองเปลี่ยนตัวกรอง หรือให้ Staff เริ่มกรอกผ่าน LIFF"
              />
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}
