// CASHHUB §10.4 — Compare any two months side-by-side
// Mode 1: month vs month (org-wide)
// Mode 2: branch vs branch (current month)

import Link from "next/link";
import { AlertTriangle,TrendingDown, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import {
  startOfMonth,
  endOfMonth,
  parse,
  subMonths,
  format,
  addMonths,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { formatBaht, formatBahtCompact } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface ReportRow {
  branch_id: string;
  total_sales: number | string;
  status: string;
  cash: number | string;
  transfer: number | string;
  card: number | string;
  credit: number | string;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; type?: string }>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const sp = await searchParams;
  const admin = adminClient();

  const now = new Date();
  const defaultB = formatInTimeZone(subMonths(now, 1), TZ, "yyyy-MM");
  const defaultA = formatInTimeZone(now, TZ, "yyyy-MM");
  const aMonth = sp.a || defaultA;
  const bMonth = sp.b || defaultB;
  const filterType = sp.type || "";

  // Build month options (last 12 months)
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    months.push(formatInTimeZone(subMonths(now, i), TZ, "yyyy-MM"));
  }

  const [aDataQ, bDataQ, branchesQ] = await Promise.all([
    monthData(admin, session.user.org_id, aMonth, filterType),
    monthData(admin, session.user.org_id, bMonth, filterType),
    admin
      .from("branches")
      .select("id, code, name, business_type")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true),
  ]);

  const aData = aDataQ;
  const bData = bDataQ;
  const branches = branchesQ.data ?? [];

  // ---- BRANCH ANOMALY DETECTION ----
  // For each branch: compute totals for both months, compute mix
  // Flag branches that deviate from peer median in same business_type
  type BranchStat = {
    id: string;
    code: string;
    name: string;
    business_type: string;
    aTotal: number;
    bTotal: number;
    mom: number | null; // % change month-over-month
    mix: { cash: number; transfer: number; card: number; credit: number };
    cashPct: number; // current month cash percentage of received
    creditPct: number;
  };
  const branchStats: BranchStat[] = branches.map((b) => {
    const a = aData.reports.filter(
      (r) => r.branch_id === b.id && r.status === "approved",
    );
    const bb = bData.reports.filter(
      (r) => r.branch_id === b.id && r.status === "approved",
    );
    const aTotal = a.reduce((s, r) => s + Number(r.total_sales || 0), 0);
    const bTotal = bb.reduce((s, r) => s + Number(r.total_sales || 0), 0);
    const aMixB = {
      cash: a.reduce((s, r) => s + Number(r.cash || 0), 0),
      transfer: a.reduce((s, r) => s + Number(r.transfer || 0), 0),
      card: a.reduce((s, r) => s + Number(r.card || 0), 0),
      credit: a.reduce((s, r) => s + Number(r.credit || 0), 0),
    };
    const aReceived =
      aMixB.cash + aMixB.transfer + aMixB.card + aMixB.credit;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      business_type: b.business_type,
      aTotal,
      bTotal,
      mom: bTotal > 0 ? ((aTotal - bTotal) / bTotal) * 100 : null,
      mix: aMixB,
      cashPct: aReceived > 0 ? (aMixB.cash / aReceived) * 100 : 0,
      creditPct: aReceived > 0 ? (aMixB.credit / aReceived) * 100 : 0,
    };
  });

  // Compute peer medians per business_type
  function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((x, y) => x - y);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
  }
  const typeStats = new Map<
    string,
    { medianTotal: number; medianCashPct: number; medianCreditPct: number }
  >();
  const byType = new Map<string, BranchStat[]>();
  for (const s of branchStats) {
    if (!byType.has(s.business_type)) byType.set(s.business_type, []);
    byType.get(s.business_type)!.push(s);
  }
  for (const [t, arr] of byType.entries()) {
    typeStats.set(t, {
      medianTotal: median(arr.map((x) => x.aTotal).filter((v) => v > 0)),
      medianCashPct: median(arr.map((x) => x.cashPct).filter((v) => v > 0)),
      medianCreditPct: median(arr.map((x) => x.creditPct)),
    });
  }

  // Anomalies: 3 angles
  type Anomaly = {
    branch: BranchStat;
    angle: "self" | "peer" | "mix";
    severity: "warning" | "danger";
    message: string;
    delta: number;
  };
  const anomalies: Anomaly[] = [];
  for (const s of branchStats) {
    if (s.aTotal === 0 && s.bTotal === 0) continue;
    const peers = typeStats.get(s.business_type);

    // Angle 1 — self vs prev month
    if (s.mom !== null && Math.abs(s.mom) >= 20 && s.bTotal > 0) {
      anomalies.push({
        branch: s,
        angle: "self",
        severity: Math.abs(s.mom) >= 40 ? "danger" : "warning",
        message:
          s.mom < 0
            ? `ยอดลด ${s.mom.toFixed(0)}% เทียบ ${fmtMonth(bMonth)}`
            : `ยอดพุ่ง +${s.mom.toFixed(0)}% เทียบ ${fmtMonth(bMonth)}`,
        delta: s.mom,
      });
    }

    // Angle 2 — vs peers (same business type)
    if (peers && peers.medianTotal > 0 && s.aTotal > 0) {
      const peerDelta =
        ((s.aTotal - peers.medianTotal) / peers.medianTotal) * 100;
      if (peerDelta <= -30) {
        anomalies.push({
          branch: s,
          angle: "peer",
          severity: peerDelta <= -50 ? "danger" : "warning",
          message: `ต่ำกว่าเพื่อนในกลุ่ม ${Math.abs(peerDelta).toFixed(0)}%`,
          delta: peerDelta,
        });
      }
    }

    // Angle 3 — mix shift (cash drop / credit spike)
    if (peers && peers.medianCashPct > 0 && s.cashPct > 0) {
      const cashGap = s.cashPct - peers.medianCashPct;
      if (cashGap <= -15) {
        anomalies.push({
          branch: s,
          angle: "mix",
          severity: cashGap <= -25 ? "danger" : "warning",
          message: `เงินสด ${s.cashPct.toFixed(0)}% (ปกติ ~${peers.medianCashPct.toFixed(0)}%)`,
          delta: cashGap,
        });
      }
    }
    if (s.creditPct >= 15) {
      anomalies.push({
        branch: s,
        angle: "mix",
        severity: s.creditPct >= 25 ? "danger" : "warning",
        message: `เครดิต ${s.creditPct.toFixed(0)}% สูงผิดปกติ`,
        delta: s.creditPct,
      });
    }
  }
  anomalies.sort((x, y) => {
    if (x.severity !== y.severity) return x.severity === "danger" ? -1 : 1;
    return Math.abs(y.delta) - Math.abs(x.delta);
  });

  const total = (rs: ReportRow[]) =>
    rs
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const aTotal = total(aData.reports);
  const bTotal = total(bData.reports);
  const delta = bTotal > 0 ? ((aTotal - bTotal) / bTotal) * 100 : null;

  // Mix
  function mix(rs: ReportRow[]) {
    const m = { cash: 0, transfer: 0, card: 0, credit: 0 };
    for (const r of rs.filter((x) => x.status === "approved")) {
      m.cash += Number(r.cash || 0);
      m.transfer += Number(r.transfer || 0);
      m.card += Number(r.card || 0);
      m.credit += Number(r.credit || 0);
    }
    return m;
  }
  const aMix = mix(aData.reports);
  const bMix = mix(bData.reports);

  // By type
  function totalsByType(rs: ReportRow[], allBranches: typeof branches) {
    const map = new Map<string, number>();
    for (const r of rs.filter((x) => x.status === "approved")) {
      const b = allBranches.find((x) => x.id === r.branch_id);
      if (!b) continue;
      map.set(
        b.business_type,
        (map.get(b.business_type) ?? 0) + Number(r.total_sales || 0),
      );
    }
    return map;
  }
  const aByType = totalsByType(aData.reports, branches);
  const bByType = totalsByType(bData.reports, branches);
  const allTypes = new Set([...aByType.keys(), ...bByType.keys()]);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-6 flex flex-col gap-2">
        <SectionPill num="00" label="Compare · เปรียบเทียบ" />
        <TwoToneTitle first="เปรียบเทียบ" accent="เดือน vs เดือน" size={36} />
        <p className="text-[var(--ch-text-2)] mt-1 text-sm">
          ดูภาพรวม + จับสาขาที่ผิดปกติ — เทียบกับตัวเอง · เทียบกับเพื่อนกลุ่มเดียวกัน · เช็คสัดส่วนช่องทางรับเงิน
        </p>
      </header>

      {/* Anomaly section — most actionable, show first */}
      {anomalies.length > 0 && (
        <Section
          number="00"
          label="ผิดปกติ"
          title={`พบ ${anomalies.length} จุดผิดปกติ`}
          description="สาขาที่ต้องตรวจสอบ — เรียงตามความสำคัญ"
          className="mb-6"
        >
          <Card className="border-amber-200">
            <CardBody className="!p-0">
              <ul className="divide-y divide-amber-100">
                {anomalies.slice(0, 12).map((a, i) => {
                  const cfg = BUSINESS_TYPES[a.branch.business_type];
                  const angleLabel = {
                    self: "เทียบเดือนก่อน",
                    peer: "เทียบเพื่อน",
                    mix: "ช่องทางรับเงิน",
                  }[a.angle];
                  return (
                    <li
                      key={i}
                      className="flex items-center gap-3 px-4 sm:px-5 py-3"
                    >
                      <div
                        className={`size-9 rounded-xl flex items-center justify-center shrink-0 ${
                          a.severity === "danger"
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {a.angle === "self" ? (
                          a.delta < 0 ? (
                            <TrendingDown className="size-4" />
                          ) : (
                            <TrendingUp className="size-4" />
                          )
                        ) : (
                          <AlertTriangle className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg shrink-0">
                            {cfg?.emoji ?? "📋"}
                          </span>
                          <Link
                            href={`/cashhub/branches/${a.branch.id}`}
                            className="font-bold tabular-num text-sm hover:text-[var(--color-brand-700)]"
                          >
                            {a.branch.code}
                          </Link>
                          <span className="text-[11px] text-zinc-500 truncate">
                            {a.branch.name}
                          </span>
                          <Badge tone="neutral" className="text-[10px]">
                            {angleLabel}
                          </Badge>
                        </div>
                        <div
                          className={`text-sm mt-0.5 ${
                            a.severity === "danger"
                              ? "text-red-700"
                              : "text-amber-700"
                          }`}
                        >
                          {a.message}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold tabular-num">
                          {formatBahtCompact(a.branch.aTotal)}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          เดือนนี้
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {anomalies.length > 12 && (
                <div className="px-4 py-2 text-xs text-zinc-500 border-t border-amber-100 bg-amber-50/40">
                  + อีก {anomalies.length - 12} รายการ
                </div>
              )}
            </CardBody>
          </Card>
        </Section>
      )}

      {anomalies.length === 0 && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50/30">
          <CardBody className="text-center py-6">
            <div className="size-12 mx-auto rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 mb-2">
              ✓
            </div>
            <p className="font-bold text-zinc-900">ไม่พบสาขาผิดปกติ</p>
            <p className="text-xs text-zinc-500 mt-1">
              ทุกสาขายอดอยู่ในช่วงปกติเทียบกับ {fmtMonth(bMonth)} และเพื่อนในกลุ่ม
            </p>
          </CardBody>
        </Card>
      )}

      {/* Selectors (form-based GET) */}
      <Card className="mb-6">
        <CardBody>
          <form method="get" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Picker name="a" label="เดือน A" value={aMonth} options={months} />
            <Picker name="b" label="เดือน B" value={bMonth} options={months} />
            <TypePicker value={filterType} />
            <button
              type="submit"
              className="sm:col-span-3 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-semibold hover:bg-[var(--color-brand-700)] transition-colors"
            >
              เปรียบเทียบ
            </button>
          </form>
        </CardBody>
      </Card>

      {/* Total comparison */}
      <Section
        number="01"
        label="ยอดรวม"
        title="ยอดรวมอนุมัติ (Approved)"
        className="mb-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CompareCard label={fmtMonth(aMonth)} value={aTotal} highlight />
          <CompareCard label={fmtMonth(bMonth)} value={bTotal} />
        </div>
        {delta !== null && (
          <div className="mt-3 text-center">
            <Badge tone={delta >= 0 ? "success" : "danger"} className="text-sm">
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(1)}% เทียบ {fmtMonth(bMonth)}
            </Badge>
          </div>
        )}
      </Section>

      {/* Type breakdown */}
      <Section number="02" label="ตามประเภท" title="แยกตามประเภทธุรกิจ" className="mb-6">
        <Card>
          <CardBody className="!p-0">
            <table className="w-full text-sm">
              <thead className="sticky top-14 sm:top-16 z-20 bg-white text-xs font-bold text-zinc-500">
                <tr className="border-b border-zinc-100">
                  <th className="text-left p-3">ประเภท</th>
                  <th className="text-right p-3">{fmtMonth(aMonth)}</th>
                  <th className="text-right p-3">{fmtMonth(bMonth)}</th>
                  <th className="text-right p-3">ต่าง</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(allTypes).map((t) => {
                  const cfg = BUSINESS_TYPES[t];
                  const aV = aByType.get(t) ?? 0;
                  const bV = bByType.get(t) ?? 0;
                  const d = bV > 0 ? ((aV - bV) / bV) * 100 : aV > 0 ? 100 : 0;
                  return (
                    <tr key={t} className="border-b border-zinc-50">
                      <td className="p-3">
                        <span className="text-lg mr-2">{cfg?.emoji ?? "📋"}</span>
                        {cfg?.label ?? t}
                      </td>
                      <td className="p-3 text-right tabular-num font-semibold">
                        {formatBahtCompact(aV)}
                      </td>
                      <td className="p-3 text-right tabular-num text-zinc-500">
                        {formatBahtCompact(bV)}
                      </td>
                      <td
                        className={`p-3 text-right tabular-num font-bold ${d >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {d >= 0 ? "+" : ""}
                        {d.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </Section>

      {/* Payment mix */}
      <Section
        number="03"
        label="กระแสเงิน"
        title="ช่องทางรับเงิน"
        className="mb-6"
      >
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(["cash", "transfer", "card", "credit"] as const).map((k) => {
                const aV = aMix[k];
                const bV = bMix[k];
                const d = bV > 0 ? ((aV - bV) / bV) * 100 : 0;
                const label = {
                  cash: "💵 เงินสด",
                  transfer: "🏦 โอน/QR",
                  card: "💳 บัตร",
                  credit: "📝 เครดิต",
                }[k];
                return (
                  <div
                    key={k}
                    className="rounded-xl border border-zinc-100 p-3 bg-zinc-50/50"
                  >
                    <p className="text-xs font-semibold text-zinc-700">
                      {label}
                    </p>
                    <div className="flex items-baseline justify-between mt-1.5">
                      <span className="text-base font-extrabold tabular-num font-display">
                        {formatBahtCompact(aV)}
                      </span>
                      <span className="text-xs text-zinc-500 tabular-num">
                        {formatBahtCompact(bV)}
                      </span>
                    </div>
                    <div
                      className={`text-[11px] font-bold mt-1 ${d >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                    >
                      {d >= 0 ? "+" : ""}
                      {d.toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

async function monthData(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  monthStr: string,
  filterType: string,
): Promise<{ reports: ReportRow[] }> {
  const start = parse(monthStr, "yyyy-MM", new Date());
  const startStr = format(startOfMonth(start), "yyyy-MM-dd");
  const endStr = format(endOfMonth(start), "yyyy-MM-dd");

  let q = admin
    .from("daily_reports")
    .select(
      "branch_id, total_sales, status, cash, transfer, card, credit, branches!inner(business_type)",
    )
    .eq("org_id", orgId)
    .gte("report_date", startStr)
    .lte("report_date", endStr);
  if (filterType) {
    q = q.eq("branches.business_type", filterType);
  }
  const { data } = await q;
  return { reports: (data ?? []) as ReportRow[] };
}

function fmtMonth(s: string): string {
  const [y, m] = s.split("-");
  const months = [
    "ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
    "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค.",
  ];
  const yearBE = String((parseInt(y!, 10) + 543) % 100).padStart(2, "0");
  return `${months[parseInt(m!, 10) - 1]} ${yearBE}`;
}

function Picker({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-zinc-500">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="h-11 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {fmtMonth(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TypePicker({ value }: { value: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-zinc-500">
        Filter ประเภท (optional)
      </span>
      <select
        name="type"
        defaultValue={value}
        className="h-11 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
      >
        <option value="">ทั้งหมด</option>
        {Object.entries(BUSINESS_TYPES).map(([k, v]) => (
          <option key={k} value={k}>
            {v.emoji} {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-[var(--color-brand-300)]" : ""}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="text-3xl sm:text-4xl font-extrabold tabular-num font-display">
          {formatBaht(value)}
        </div>
      </CardBody>
    </Card>
  );
}

void addMonths;
