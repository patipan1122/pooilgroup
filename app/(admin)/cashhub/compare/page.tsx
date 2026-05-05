// CASHHUB §10.4 — Compare any two months side-by-side
// Mode 1: month vs month (org-wide)
// Mode 2: branch vs branch (current month)

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
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
  void branches;

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
      <Link
        href="/cashhub/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[var(--color-brand-700)]"
      >
        <ArrowLeft className="size-4" />
        ภาพรวม
      </Link>
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          🔁 COMPARE
        </p>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          เปรียบเทียบ <span className="text-gradient-blue">เดือน vs เดือน</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          เลือกเดือนสองเดือนเพื่อดูเทรนด์ยอดและช่องทางรับเงิน
        </p>
      </header>

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
        label="TOTALS"
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
      <Section number="02" label="BY TYPE" title="แยกตามประเภทธุรกิจ" className="mb-6">
        <Card>
          <CardBody className="!p-0">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
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
        label="MONEY FLOW"
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
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
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
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
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
