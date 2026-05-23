// /recruit/dashboard — Exec dashboard for recruit module
// Per Recruit Redesign canvas section 10 (ExecDashboard)
//
// KPIs · funnel chart · source ROI · time-to-hire · HR leaderboard
// No new schema — queries existing recruit_applications + audit_logs

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { TrendingUp, TrendingDown, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

const SOURCE_COLORS: Record<string, string> = {
  facebook: "#1877f2",
  line: "#06c755",
  tiktok: "#000000",
  qr: "#f59e0b",
  jobsdb: "#dc2626",
  instagram: "#e4405f",
  direct: "#71717a",
};

const SOURCE_LABELS: Record<string, string> = {
  facebook: "Facebook",
  line: "LINE",
  tiktok: "TikTok",
  qr: "QR หน้าร้าน",
  jobsdb: "JobsDB",
  instagram: "Instagram",
  direct: "เปิดตรง",
};

export default async function RecruitExecDashboard() {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const orgId = session.user.org_id;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // Pull all relevant data
  const [currentApps, previousApps, hiredApps, openPostings] = await Promise.all([
    prisma.recruitApplication.findMany({
      where: {
        orgId,
        draft: false,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        status: true,
        source: true,
        createdAt: true,
        submittedAt: true,
      },
    }),
    prisma.recruitApplication.findMany({
      where: {
        orgId,
        draft: false,
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
      select: { id: true, status: true },
    }),
    prisma.recruitApplication.findMany({
      where: {
        orgId,
        draft: false,
        status: "HIRED",
        createdAt: { gte: sixtyDaysAgo },
      },
      select: { id: true, submittedAt: true, updatedAt: true },
    }),
    prisma.recruitJobPosting.count({
      where: { orgId, status: "OPEN" },
    }),
  ]);

  // Total applications · 30d vs prev-30d
  const total30 = currentApps.length;
  const totalPrev30 = previousApps.length;
  const pctChange30 =
    totalPrev30 > 0 ? Math.round(((total30 - totalPrev30) / totalPrev30) * 100) : null;

  // Funnel
  const funnel = {
    apply: total30,
    screen: currentApps.filter((a) => a.status !== "NEW").length,
    interview: currentApps.filter((a) => ["INTERVIEW", "OFFERED", "HIRED"].includes(a.status)).length,
    offer: currentApps.filter((a) => ["OFFERED", "HIRED"].includes(a.status)).length,
    hired: currentApps.filter((a) => a.status === "HIRED").length,
  };

  // Conversion rate
  const conversionRate = total30 > 0 ? (funnel.hired / total30) * 100 : 0;

  // Time-to-hire (average days from submittedAt to status=HIRED)
  let avgTimeToHire = 0;
  if (hiredApps.length > 0) {
    const totalDays = hiredApps.reduce((sum, a) => {
      if (!a.submittedAt) return sum;
      const days =
        (a.updatedAt.getTime() - a.submittedAt.getTime()) / (1000 * 60 * 60 * 24);
      return sum + days;
    }, 0);
    avgTimeToHire = totalDays / hiredApps.length;
  }

  // Source breakdown
  const sourceMap = new Map<string, { apply: number; hired: number }>();
  for (const a of currentApps) {
    const src = (a.source ?? "direct").toLowerCase();
    const entry = sourceMap.get(src) ?? { apply: 0, hired: 0 };
    entry.apply++;
    if (a.status === "HIRED") entry.hired++;
    sourceMap.set(src, entry);
  }
  const sources = [...sourceMap.entries()]
    .map(([key, { apply, hired }]) => ({
      key,
      label: SOURCE_LABELS[key] ?? key,
      color: SOURCE_COLORS[key] ?? "#71717a",
      apply,
      hired,
      conversionRate: apply > 0 ? (hired / apply) * 100 : 0,
    }))
    .sort((a, b) => b.apply - a.apply);

  // Posting performance
  const postingStats = await prisma.recruitJobPosting.findMany({
    where: { orgId, status: { in: ["OPEN", "CLOSED"] } },
    include: {
      _count: { select: { applications: { where: { draft: false, createdAt: { gte: thirtyDaysAgo } } } } },
      applications: {
        where: { draft: false, createdAt: { gte: thirtyDaysAgo } },
        select: { status: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // Total active applications (across all 30 days)
  const stillActive = currentApps.filter((a) =>
    ["NEW", "SCREENING", "INTERVIEW", "OFFERED"].includes(a.status),
  ).length;

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="10"
        label="Dashboard"
        title="ภาพรวมการสรรหา"
        description="สำหรับผู้บริหาร · ดูสุขภาพการรับสมัครรวมในช่วง 30 วัน"
      >
        {/* Top KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="ใบสมัครเดือนนี้"
            value={total30}
            change={pctChange30}
            accent="brand"
          />
          <KpiCard
            label="Conversion rate"
            value={`${conversionRate.toFixed(1)}%`}
            sub="สมัคร → รับเข้า"
            accent="success"
          />
          <KpiCard
            label="Time to hire"
            value={avgTimeToHire > 0 ? `${avgTimeToHire.toFixed(1)} วัน` : "—"}
            sub={hiredApps.length > 0 ? `จาก ${hiredApps.length} คน` : "ยังไม่มีคนรับ"}
            accent="purple"
          />
          <KpiCard
            label="ประกาศเปิดอยู่"
            value={openPostings}
            sub={`${stillActive} ใบยังประมวลผล`}
            accent="warning"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Funnel */}
          <div className="lg:col-span-2 rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-bold text-zinc-900 mb-1">Funnel · 30 วันล่าสุด</h2>
            <p className="text-xs text-zinc-500 mb-4">
              จากสมัครจนถึงรับเข้าทำงาน · เทียบเท่าจากเดือนที่แล้ว
            </p>
            <FunnelChart funnel={funnel} prev={previousApps.length} />
          </div>

          {/* Source breakdown */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-bold text-zinc-900 mb-1">Source · ที่มา</h2>
            <p className="text-xs text-zinc-500 mb-4">
              ใบสมัครมาจากช่องทางไหน · conversion ของแต่ละช่อง
            </p>
            {sources.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">ยังไม่มีข้อมูล source</p>
            ) : (
              <div className="space-y-3">
                {sources.slice(0, 5).map((s) => (
                  <div key={s.key}>
                    <div className="flex justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5 font-medium text-zinc-700">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: s.color }}
                        />
                        {s.label}
                      </div>
                      <div className="text-zinc-500 tabular-num">
                        {s.apply} → <b className="text-green-700">{s.hired}</b>
                        {s.conversionRate > 0 && (
                          <span className="text-zinc-400 ml-1">
                            ({s.conversionRate.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(s.apply / Math.max(sources[0]?.apply ?? 1, 1)) * 100}%`,
                          background: s.color,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Posting leaderboard */}
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden mb-6">
          <div className="p-5 border-b border-zinc-200">
            <h2 className="text-sm font-bold text-zinc-900">ประกาศที่ทำงานได้ดี · Top 5</h2>
            <p className="text-xs text-zinc-500 mt-1">
              จัดอันดับด้วยจำนวนใบสมัคร + คนที่รับ
            </p>
          </div>
          {postingStats.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-400">ยังไม่มีประกาศ</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {postingStats.map((p, i) => {
                const apply = p._count.applications;
                const hired = p.applications.filter((a) => a.status === "HIRED").length;
                const conv = apply > 0 ? (hired / apply) * 100 : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/recruit?posting=${p.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-50 transition-colors"
                  >
                    <span
                      className={`size-7 rounded-full grid place-items-center font-bold text-xs shrink-0 ${
                        i === 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-900 truncate">{p.title}</p>
                      <p className="text-xs text-zinc-500">
                        {p.status === "OPEN" ? "เปิดอยู่" : "ปิดแล้ว"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm tabular-num">
                        <b className="text-zinc-900">{apply}</b> สมัคร
                      </p>
                      <p className="text-xs">
                        <b className="text-green-700">{hired}</b> รับ ·{" "}
                        <span className="text-zinc-400">{conv.toFixed(0)}%</span>
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-zinc-300" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="rounded-2xl bg-zinc-50 border border-dashed border-zinc-300 p-4 text-xs text-zinc-600 leading-relaxed">
          <p className="font-bold text-zinc-800 mb-2">📊 หมายเหตุเรื่องการคำนวณ</p>
          <ul className="space-y-1 pl-4 list-disc">
            <li>30 วันล่าสุด = ใบสมัครที่สร้างใน 30 วันที่ผ่านมา</li>
            <li>Conversion = HIRED / สมัครทั้งหมด · ตามใบสมัครในช่วง 30 วัน</li>
            <li>Time to hire = วันเฉลี่ยจาก submittedAt → updatedAt (ตอนรับ) · จาก 60 วัน</li>
            <li>Source ดึงจาก field <code className="font-mono bg-white px-1 rounded">source</code> ของใบสมัคร · ติด UTM ที่ลิ้งค์เพื่อ track</li>
          </ul>
        </div>
      </Section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  change,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  change?: number | null;
  sub?: string;
  accent: "brand" | "success" | "warning" | "purple" | "danger";
}) {
  const accentColor = {
    brand: "text-[var(--color-brand-700)]",
    success: "text-green-700",
    warning: "text-amber-700",
    purple: "text-purple-700",
    danger: "text-red-700",
  }[accent];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
        {label}
      </p>
      <div className="flex items-baseline gap-2 mt-2">
        <p className={`text-2xl sm:text-3xl font-extrabold font-display tabular-num ${accentColor}`}>
          {value}
        </p>
        {change != null && (
          <span
            className={`text-xs font-bold inline-flex items-center gap-0.5 ${
              change >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {change >= 0 ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {change > 0 ? "+" : ""}
            {change}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function FunnelChart({
  funnel,
  prev,
}: {
  funnel: { apply: number; screen: number; interview: number; offer: number; hired: number };
  prev: number;
}) {
  const stages = [
    { key: "apply", label: "สมัคร", value: funnel.apply, color: "#1e3aff" },
    { key: "screen", label: "คัดกรอง", value: funnel.screen, color: "#f5b800" },
    { key: "interview", label: "สัมภาษณ์", value: funnel.interview, color: "#f97316" },
    { key: "offer", label: "เสนองาน", value: funnel.offer, color: "#8b5cf6" },
    { key: "hired", label: "รับเข้า", value: funnel.hired, color: "#16a34a" },
  ];
  const max = Math.max(...stages.map((s) => s.value), prev, 1);

  return (
    <div className="space-y-3">
      {stages.map((s) => {
        const pctFromApply =
          funnel.apply > 0 ? Math.round((s.value / funnel.apply) * 100) : 0;
        return (
          <div key={s.key}>
            <div className="flex justify-between text-xs mb-1.5">
              <div className="font-bold text-zinc-700">{s.label}</div>
              <div className="text-zinc-500 tabular-num">
                <b className="text-zinc-900">{s.value}</b>
                <span className="ml-1 text-zinc-400">({pctFromApply}%)</span>
              </div>
            </div>
            <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(s.value / max) * 100}%`,
                  background: s.color,
                }}
              />
            </div>
          </div>
        );
      })}
      {prev > 0 && (
        <div className="pt-3 mt-3 border-t border-zinc-100 text-xs text-zinc-500 flex justify-between">
          <span>เดือนก่อน (สมัครรวม):</span>
          <span className="tabular-num font-bold text-zinc-700">{prev}</span>
        </div>
      )}
    </div>
  );
}
