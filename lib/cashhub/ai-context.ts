// Build a compact business-context summary for the AI to ground answers in.
// Pure server-side. Token budget: keep under ~2K tokens of context.

import { adminClient } from "@/lib/db/server";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
  getDate,
  getDaysInMonth,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { BUSINESS_TYPES } from "@/constants/business-types";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export interface AiContext {
  todayBkk: string;
  monthLabel: string;
  daysElapsed: number;
  daysInMonth: number;
  branchCount: number;
  monthApproved: number;
  monthPending: number;
  prevMonthTotal: number;
  topBranches: Array<{ code: string; name: string; total: number }>;
  worstBranches: Array<{ code: string; name: string; total: number; missingDays: number }>;
  byType: Array<{ type: string; label: string; total: number; branchCount: number }>;
  paymentMix: { cash: number; transfer: number; card: number; credit: number };
  pendingCount: number;
  shortageCount: number;
  shortageTotal: number;
}

export async function buildAiContext(orgId: string): Promise<AiContext> {
  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const monthEnd = formatInTimeZone(endOfMonth(now), TZ, "yyyy-MM-dd");
  const prevStart = formatInTimeZone(
    startOfMonth(subMonths(now, 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const prevEnd = formatInTimeZone(
    endOfMonth(subMonths(now, 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const last7 = formatInTimeZone(subDays(now, 6), TZ, "yyyy-MM-dd");

  const [branchesQ, monthQ, prevMonthQ, last7Q, pendingQ, shortagesQ] =
    await Promise.all([
      admin
        .from("branches")
        .select("id, code, name, business_type")
        .eq("org_id", orgId)
        .eq("is_active", true),
      admin
        .from("daily_reports")
        .select(
          "branch_id, total_sales, status, cash, transfer, card, credit",
        )
        .eq("org_id", orgId)
        .gte("report_date", monthStart)
        .lte("report_date", monthEnd),
      admin
        .from("daily_reports")
        .select("total_sales, status")
        .eq("org_id", orgId)
        .gte("report_date", prevStart)
        .lte("report_date", prevEnd),
      admin
        .from("daily_reports")
        .select("branch_id, report_date, status")
        .eq("org_id", orgId)
        .gte("report_date", last7)
        .lte("report_date", today),
      admin
        .from("daily_reports")
        .select("id")
        .eq("org_id", orgId)
        .eq("status", "submitted"),
      admin
        .from("cash_shortages")
        .select("id, amount")
        .eq("org_id", orgId)
        .gte("report_date", monthStart)
        .lte("report_date", today),
    ]);

  const branches = (branchesQ.data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
  }>;
  const monthRows = (monthQ.data ?? []) as Array<{
    branch_id: string;
    total_sales: number | string;
    status: string;
    cash: number | string;
    transfer: number | string;
    card: number | string;
    credit: number | string;
  }>;
  const prevRows = (prevMonthQ.data ?? []) as Array<{
    total_sales: number | string;
    status: string;
  }>;
  const last7Rows = (last7Q.data ?? []) as Array<{
    branch_id: string;
    report_date: string;
    status: string;
  }>;
  const pendingRows = (pendingQ.data ?? []) as Array<{ id: string }>;
  const shortageRows = (shortagesQ.data ?? []) as Array<{
    id: string;
    amount: number | string;
  }>;

  const monthApproved = monthRows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const monthPending = monthRows
    .filter((r) => r.status === "submitted")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const prevMonthTotal = prevRows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);

  // Per-branch + per-type
  const byBranch = new Map<
    string,
    { code: string; name: string; total: number }
  >();
  for (const b of branches) {
    byBranch.set(b.id, { code: b.code, name: b.name, total: 0 });
  }
  for (const r of monthRows) {
    if (r.status === "approved" && byBranch.has(r.branch_id)) {
      byBranch.get(r.branch_id)!.total += Number(r.total_sales || 0);
    }
  }
  const sortedBranches = Array.from(byBranch.values()).sort(
    (a, b) => b.total - a.total,
  );
  const topBranches = sortedBranches.slice(0, 5);

  // Missing days per branch (last 7 days)
  const filledByBranch = new Map<string, Set<string>>();
  for (const r of last7Rows) {
    if (r.status !== "rejected") {
      const set = filledByBranch.get(r.branch_id) ?? new Set<string>();
      set.add(r.report_date);
      filledByBranch.set(r.branch_id, set);
    }
  }
  const worstBranches = branches
    .map((b) => {
      const filled = filledByBranch.get(b.id)?.size ?? 0;
      const missingDays = Math.max(0, 7 - filled);
      const total = byBranch.get(b.id)?.total ?? 0;
      return { code: b.code, name: b.name, total, missingDays };
    })
    .filter((b) => b.missingDays >= 2)
    .sort((a, b) => b.missingDays - a.missingDays)
    .slice(0, 5);

  // By type
  const typeMap = new Map<
    string,
    { type: string; label: string; total: number; branchCount: number }
  >();
  for (const b of branches) {
    const cfg = BUSINESS_TYPES[b.business_type];
    if (!cfg) continue;
    const cur = typeMap.get(b.business_type) ?? {
      type: b.business_type,
      label: cfg.label,
      total: 0,
      branchCount: 0,
    };
    cur.branchCount += 1;
    typeMap.set(b.business_type, cur);
  }
  for (const r of monthRows) {
    if (r.status !== "approved") continue;
    const branch = branches.find((b) => b.id === r.branch_id);
    if (!branch) continue;
    const t = typeMap.get(branch.business_type);
    if (t) t.total += Number(r.total_sales || 0);
  }

  // Mix
  const mix = monthRows
    .filter((r) => r.status === "approved")
    .reduce(
      (acc, r) => ({
        cash: acc.cash + Number(r.cash || 0),
        transfer: acc.transfer + Number(r.transfer || 0),
        card: acc.card + Number(r.card || 0),
        credit: acc.credit + Number(r.credit || 0),
      }),
      { cash: 0, transfer: 0, card: 0, credit: 0 },
    );

  return {
    todayBkk: today,
    monthLabel: formatInTimeZone(now, TZ, "yyyy-MM"),
    daysElapsed: getDate(now),
    daysInMonth: getDaysInMonth(now),
    branchCount: branches.length,
    monthApproved,
    monthPending,
    prevMonthTotal,
    topBranches,
    worstBranches,
    byType: Array.from(typeMap.values()).sort((a, b) => b.total - a.total),
    paymentMix: mix,
    pendingCount: pendingRows.length,
    shortageCount: shortageRows.length,
    shortageTotal: shortageRows.reduce(
      (s, r) => s + Number(r.amount || 0),
      0,
    ),
  };
}

const baht = (n: number) =>
  `฿${Math.round(n).toLocaleString("th-TH")}`;

export function contextToText(ctx: AiContext): string {
  const lines: string[] = [];
  lines.push(`วันที่อ้างอิง: ${ctx.todayBkk} (วันที่ ${ctx.daysElapsed}/${ctx.daysInMonth} ของเดือน)`);
  lines.push(`สาขาที่ใช้งาน: ${ctx.branchCount} สาขา`);
  lines.push("");
  lines.push("== ยอดเดือนนี้ ==");
  lines.push(`อนุมัติแล้ว: ${baht(ctx.monthApproved)}`);
  lines.push(`รออนุมัติ: ${baht(ctx.monthPending)}`);
  lines.push(`เดือนก่อนรวม: ${baht(ctx.prevMonthTotal)}`);
  if (ctx.prevMonthTotal > 0) {
    const delta = ((ctx.monthApproved - ctx.prevMonthTotal) / ctx.prevMonthTotal) * 100;
    lines.push(`เทียบเดือนก่อน: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`);
  }
  lines.push("");
  lines.push("== แยกตามประเภทธุรกิจ ==");
  for (const t of ctx.byType) {
    lines.push(`${t.label}: ${baht(t.total)} (${t.branchCount} สาขา)`);
  }
  lines.push("");
  lines.push("== ช่องทางรับเงิน ==");
  const total =
    ctx.paymentMix.cash +
    ctx.paymentMix.transfer +
    ctx.paymentMix.card +
    ctx.paymentMix.credit;
  if (total > 0) {
    lines.push(`เงินสด: ${baht(ctx.paymentMix.cash)} (${((ctx.paymentMix.cash / total) * 100).toFixed(0)}%)`);
    lines.push(`โอน: ${baht(ctx.paymentMix.transfer)} (${((ctx.paymentMix.transfer / total) * 100).toFixed(0)}%)`);
    lines.push(`บัตร: ${baht(ctx.paymentMix.card)} (${((ctx.paymentMix.card / total) * 100).toFixed(0)}%)`);
    lines.push(`เครดิต: ${baht(ctx.paymentMix.credit)} (${((ctx.paymentMix.credit / total) * 100).toFixed(0)}%)`);
  }
  lines.push("");
  lines.push("== Top สาขาเดือนนี้ ==");
  for (const b of ctx.topBranches) {
    lines.push(`${b.code} (${b.name}): ${baht(b.total)}`);
  }
  if (ctx.worstBranches.length > 0) {
    lines.push("");
    lines.push("== สาขาขาดส่ง 7 วัน ==");
    for (const b of ctx.worstBranches) {
      lines.push(`${b.code}: ขาด ${b.missingDays} วัน, ยอดเดือนนี้ ${baht(b.total)}`);
    }
  }
  if (ctx.shortageTotal > 0) {
    lines.push("");
    lines.push(`เงินขาดเดือนนี้: ${ctx.shortageCount} ครั้ง รวม ${baht(ctx.shortageTotal)}`);
  }
  if (ctx.pendingCount > 0) {
    lines.push(`รออนุมัติ: ${ctx.pendingCount} รายงาน`);
  }
  return lines.join("\n");
}
