// CASHHUB §4.x §10.2 — Full branch leaderboard with health, streak, target progress

import Link from "next/link";
import { ArrowLeft, Trophy, Building2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/cashhub/aggregator";
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

const SORTS = {
  total: "ยอดเดือนนี้",
  growth: "% เทียบเดือนก่อน",
  health: "Health Score",
  streak: "Streak",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: keyof typeof SORTS; type?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : "total";
  const type = sp.type || "";

  const data = await loadDashboard(session.user.org_id);

  let rows = data.branchSummaries;
  if (type) rows = rows.filter((r) => r.branch.business_type === type);

  const sorted = [...rows];
  if (sort === "total") sorted.sort((a, b) => b.monthTotal - a.monthTotal);
  else if (sort === "health")
    sorted.sort((a, b) => (b.health?.score ?? 0) - (a.health?.score ?? 0));
  else if (sort === "streak")
    sorted.sort(
      (a, b) => (b.streak?.current ?? 0) - (a.streak?.current ?? 0),
    );

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <Link
        href="/cashhub/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700]"
      >
        <ArrowLeft className="size-4" />
        ภาพรวม
      </Link>
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[--color-brand-600] font-bold flex items-center gap-2">
          <Trophy className="size-4" /> LEADERBOARD
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1">
          อันดับ <span className="accent">สาขา</span>
        </h1>
      </header>

      {/* Filters */}
      <Card className="mb-5">
        <CardBody>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 text-sm"
          >
            <label className="flex flex-col gap-1.5 min-w-[160px]">
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                เรียงตาม
              </span>
              <select
                name="sort"
                defaultValue={sort}
                className="h-10 rounded-xl border border-zinc-200 px-3 font-medium bg-white"
              >
                {Object.entries(SORTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 min-w-[160px]">
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                ประเภทธุรกิจ
              </span>
              <select
                name="type"
                defaultValue={type}
                className="h-10 rounded-xl border border-zinc-200 px-3 font-medium bg-white"
              >
                <option value="">ทั้งหมด</option>
                {Object.entries(BUSINESS_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.emoji} {v.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-10 rounded-xl bg-[--color-brand-600] text-white font-semibold px-5"
            >
              ใช้ตัวกรอง
            </button>
          </form>
        </CardBody>
      </Card>

      <Section number="01" label="RANKINGS" title={`${sorted.length} สาขา`}>
        <Card>
          <CardHeader>
            <CardTitle>เรียงตาม {SORTS[sort]}</CardTitle>
          </CardHeader>
          <CardBody className="!p-0">
            {sorted.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<Building2 className="size-6" />}
                  title="ยังไม่มีสาขา"
                  description="เพิ่มสาขาเพื่อดู Leaderboard"
                />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {sorted.map((s, i) => {
                  const cfg = BUSINESS_TYPES[s.branch.business_type];
                  const sb = s.streak
                    ? streakBadge(s.streak.lastDate, data.today, s.streak.current)
                    : null;
                  const targetPct =
                    s.target > 0 ? (s.monthTotal / s.target) * 100 : 0;
                  return (
                    <li key={s.branch.id}>
                      <Link
                        href={`/cashhub/branches/${s.branch.id}`}
                        className="flex items-start sm:items-center gap-3 px-4 py-3 hover:bg-zinc-50/60 transition-colors"
                      >
                        <div className="text-sm font-extrabold tabular-num font-display text-zinc-400 shrink-0 w-7 text-right">
                          #{i + 1}
                        </div>
                        <span className="text-lg shrink-0">{cfg?.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm tabular-num">
                            {s.branch.code}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate">
                            {s.branch.name}
                            {s.branch.province ? ` · ${s.branch.province}` : ""}
                          </div>
                          {s.target > 0 && (
                            <div className="mt-1 max-w-[200px]">
                              <ProgressBar
                                value={targetPct}
                                className="h-1.5"
                              />
                            </div>
                          )}
                        </div>
                        {sb && (
                          <Badge tone={sb.tone} className="hidden sm:inline-flex shrink-0">
                            {sb.emoji} {sb.label}
                          </Badge>
                        )}
                        <Sparkline
                          data={s.spark}
                          width={60}
                          height={20}
                          className="shrink-0 hidden sm:block"
                        />
                        <div className="text-right shrink-0 min-w-[80px]">
                          <div className="font-bold tabular-num text-sm">
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
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

void formatBaht;
