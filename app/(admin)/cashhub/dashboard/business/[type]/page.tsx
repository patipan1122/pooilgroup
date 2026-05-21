// Drill-down: list of branches in a business type (CASHHUB §10.2)

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Building2 } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { requireSession } from "@/lib/auth/session";
import { loadBusinessTypeDrill } from "@/lib/cashhub/aggregator";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sparkline,
  ProgressBar,
  HealthBadge,
} from "@/components/cashhub/charts";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatBaht, formatBahtCompact } from "@/lib/utils/format";
import { streakBadge } from "@/lib/cashhub/streak";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> =
  {
    approved: { label: "✅ วันนี้", tone: "success" },
    submitted: { label: "⏳ รออนุมัติ", tone: "warning" },
    missing: { label: "❌ ยังไม่กรอก", tone: "danger" },
    rejected: { label: "🔴 ปฏิเสธ", tone: "danger" },
    partial: { label: "🌗 บางกะ", tone: "warning" },
  };

export default async function BusinessDrillPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const cfg = BUSINESS_TYPES[type];
  if (!cfg) notFound();

  const session = await requireSession();
  // Targeted drill loader — scoped to branches of this business type, not the
  // full dashboard payload. Saves ~400-800ms per drill click vs loadDashboard.
  const data = await loadBusinessTypeDrill(session.user.org_id, type);
  const branchesInType = data.branchSummaries;

  if (branchesInType.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto">
        <BackLink />
        <EmptyState
          icon={<Building2 className="size-6" />}
          title={`ยังไม่มีสาขา ${cfg.label}`}
          description="เพิ่มสาขาในกลุ่มนี้เพื่อเริ่มเก็บยอด"
        />
      </div>
    );
  }

  const totalMonth = branchesInType.reduce((s, b) => s + b.monthTotal, 0);
  const totalTarget = branchesInType.reduce((s, b) => s + b.target, 0);
  const submitted = branchesInType.filter(
    (b) => b.todayStatus === "approved" || b.todayStatus === "submitted",
  ).length;
  const missing = branchesInType.filter((b) => b.todayStatus === "missing").length;

  // Sort: filled-today on top, then highest sales
  const sorted = [...branchesInType].sort((a, b) => {
    const aw = a.todayStatus === "missing" ? 1 : 0;
    const bw = b.todayStatus === "missing" ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return b.monthTotal - a.monthTotal;
  });

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackLink />
      <header className="mb-6 mt-3">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold flex items-center gap-2">
          <span className="text-2xl">{cfg.emoji}</span>
          BUSINESS DRILL-DOWN
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1.5">
          {cfg.label} <span className="accent">{branchesInType.length} สาขา</span>
        </h1>
      </header>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
        <StatBox label="ยอดรวมเดือนนี้" value={formatBahtCompact(totalMonth)} />
        <StatBox
          label="เป้าเดือนนี้"
          value={totalTarget > 0 ? formatBahtCompact(totalTarget) : "—"}
        />
        <StatBox label="ส่ง/รออนุมัติวันนี้" value={`${submitted}/${branchesInType.length}`} />
        <StatBox label="ขาดวันนี้" value={missing.toString()} tone={missing > 0 ? "danger" : "neutral"} />
      </div>

      <Section number="01" label="สาขา" title="รายชื่อสาขา" className="animate-fade-up">
        <Card>
          <CardHeader>
            <CardTitle>{cfg.label} · เดือนนี้</CardTitle>
            <Badge tone="brand">{branchesInType.length} สาขา</Badge>
          </CardHeader>
          <CardBody className="!p-0">
            <ul className="divide-y divide-zinc-100">
              {sorted.map((s, i) => {
                const sb = s.streak
                  ? streakBadge(s.streak.lastDate, data.today, s.streak.current)
                  : null;
                const targetPct =
                  s.target > 0 ? (s.monthTotal / s.target) * 100 : 0;
                const chip = STATUS_CHIP[s.todayStatus];
                return (
                  <li key={s.branch.id}>
                    <Link
                      href={`/cashhub/branches/${s.branch.id}`}
                      className="flex items-start sm:items-center gap-3 px-4 sm:px-5 py-3 hover:bg-zinc-50/60 transition-colors"
                    >
                      <div className="text-xs font-extrabold tabular-num font-display text-zinc-400 shrink-0 w-7 text-right">
                        #{i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                          <span className="tabular-num">{s.branch.code}</span>
                          {sb && (
                            <Badge tone={sb.tone} className="text-[10px]">
                              {sb.emoji} {sb.label}
                            </Badge>
                          )}
                          {chip && (
                            <Badge tone={chip.tone} className="text-[10px]">
                              {chip.label}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                          {s.branch.name}
                          {s.branch.province ? ` · ${s.branch.province}` : ""}
                        </div>
                        {s.target > 0 && (
                          <div className="mt-1.5">
                            <ProgressBar value={targetPct} className="h-1.5" />
                            <div className="text-[10px] text-zinc-500 mt-0.5">
                              {targetPct.toFixed(0)}% ของ{" "}
                              {formatBahtCompact(s.target)}
                            </div>
                          </div>
                        )}
                      </div>
                      <Sparkline
                        data={s.spark}
                        width={64}
                        height={24}
                        className="shrink-0 hidden sm:block"
                      />
                      <div className="text-right shrink-0 min-w-[80px]">
                        <div className="font-extrabold tabular-num text-sm sm:text-base">
                          {formatBahtCompact(s.monthTotal)}
                        </div>
                        {s.health && (
                          <HealthBadge
                            grade={s.health.grade}
                            size="sm"
                            className="mt-0.5 -mr-0.5 justify-end"
                          />
                        )}
                      </div>
                      <ChevronRight className="size-4 text-zinc-300 shrink-0 hidden sm:block" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function BackLink() {
  return <BackButton label="กลับ" fallbackHref="/cashhub/dashboard" />;
}

function StatBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <Card>
      <CardBody className="!p-3 sm:!p-4">
        <p className="text-xs font-bold text-zinc-500">
          {label}
        </p>
        <div
          className={`text-lg sm:text-xl font-extrabold tabular-num font-display mt-0.5 ${tone === "danger" ? "text-red-700" : "text-zinc-900"}`}
        >
          {value}
        </div>
      </CardBody>
    </Card>
  );
}

void formatBaht;
