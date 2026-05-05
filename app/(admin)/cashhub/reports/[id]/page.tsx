// Report detail with Smart Approval Panel (CASHHUB §5 — context for owner)
// Shows: numbers + auto-check + 30d avg + 7-day spark + target progress + Approve/Reject

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import {
  formatBaht,
  formatBahtCompact,
  bkkDateTime,
  bkkDate,
} from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { ApproveActions } from "./approve-actions";
import { canApproveBranch } from "@/lib/auth/permissions";
import { autoCheck } from "@/lib/cashhub/auto-check";
import {
  startOfMonth,
  endOfMonth,
  subDays,
  getDaysInMonth,
  getDate,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Sparkline, ProgressBar } from "@/components/cashhub/charts";
import { targetProgress } from "@/lib/cashhub/forecast";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const STATUS = {
  submitted: { tone: "warning" as const, label: "รออนุมัติ", Icon: Clock },
  approved: { tone: "success" as const, label: "อนุมัติแล้ว", Icon: CheckCircle2 },
  rejected: { tone: "danger" as const, label: "ไม่อนุมัติ", Icon: XCircle },
  draft: { tone: "neutral" as const, label: "ฉบับร่าง", Icon: Clock },
};

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const admin = adminClient();

  const { data: report } = await admin
    .from("daily_reports")
    .select(
      "*, branches(id, code, name, business_type), submitted_by:users!daily_reports_submitted_by_id_fkey(name, phone), approved_by:users!daily_reports_approved_by_id_fkey(name)",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!report) notFound();

  const branchRel = (report.branches ?? null) as
    | { id?: string; code?: string; name?: string; business_type?: string }
    | null;
  const branchId = branchRel?.id;
  const cfg = branchRel?.business_type
    ? BUSINESS_TYPES[branchRel.business_type]
    : undefined;
  const status = STATUS[report.status as keyof typeof STATUS] || STATUS.submitted;
  const submittedBy = report.submitted_by as
    | { name?: string; phone?: string }
    | null;
  const approvedBy = report.approved_by as { name?: string } | null;

  // Permission
  const { data: ub } = await admin
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", session.user.id)
    .eq("is_active", true);
  const userBranchIds = ub?.map((u) => u.branch_id as string) ?? [];
  const canApprove = canApproveBranch(
    session.user,
    report.branch_id as string,
    userBranchIds,
  );

  const recv =
    Number(report.cash || 0) +
    Number(report.transfer || 0) +
    Number(report.card || 0) +
    Number(report.credit || 0) +
    Number(report.shortage || 0);

  // ---- Smart Approval Panel context: 30-day history, target, today's other shifts ----
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const last30Start = formatInTimeZone(subDays(now, 29), TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const monthEnd = formatInTimeZone(endOfMonth(now), TZ, "yyyy-MM-dd");
  const monthYear = parseInt(formatInTimeZone(now, TZ, "yyyy"), 10);
  const monthNum = parseInt(formatInTimeZone(now, TZ, "M"), 10);
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = getDate(now);

  const [hist30Q, monthQ, targetQ, otherShiftsQ] = await Promise.all([
    branchId
      ? admin
          .from("daily_reports")
          .select("report_date, total_sales, status")
          .eq("branch_id", branchId)
          .gte("report_date", last30Start)
          .lte("report_date", today)
          .order("report_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    branchId
      ? admin
          .from("daily_reports")
          .select("total_sales, status")
          .eq("branch_id", branchId)
          .gte("report_date", monthStart)
          .lte("report_date", monthEnd)
      : Promise.resolve({ data: [] }),
    branchId
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin.from as any)("branch_targets")
          .select("amount")
          .eq("branch_id", branchId)
          .eq("year", monthYear)
          .eq("month", monthNum)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    branchId
      ? admin
          .from("daily_reports")
          .select("shift, status, total_sales")
          .eq("branch_id", branchId)
          .eq("report_date", report.report_date as string)
          .neq("id", report.id as string)
      : Promise.resolve({ data: [] }),
  ]);

  const hist30 = (hist30Q.data ?? []) as Array<{
    report_date: string;
    total_sales: number | string;
    status: string;
  }>;
  const monthData = (monthQ.data ?? []) as Array<{
    total_sales: number | string;
    status: string;
  }>;
  const target = (targetQ.data as { amount: number | string } | null)?.amount
    ? Number((targetQ.data as { amount: number | string }).amount)
    : 0;
  const otherShifts = ((otherShiftsQ.data ?? []) as Array<{
    shift: string;
    status: string;
    total_sales: number | string;
  }>).map((s) => ({
    shift: s.shift,
    status: s.status,
    total: Number(s.total_sales || 0),
  }));

  // Auto-check
  const history30dTotals = hist30
    .filter(
      (h) =>
        h.report_date !== (report.report_date as string) &&
        h.status === "approved",
    )
    .map((h) => Number(h.total_sales || 0));
  const ac = autoCheck({
    totalSales: Number(report.total_sales || 0),
    cash: Number(report.cash || 0),
    transfer: Number(report.transfer || 0),
    card: Number(report.card || 0),
    credit: Number(report.credit || 0),
    shortage: Number(report.shortage || 0),
    submittedAt: report.submitted_at as string,
    reportDate: report.report_date as string,
    hasReconcile: cfg?.hasReconcile ?? true,
    history30dTotals,
  });

  // 7-day sparkline
  const days7: Array<{ date: string; value: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = formatInTimeZone(subDays(now, i), TZ, "yyyy-MM-dd");
    const v = hist30
      .filter((h) => h.report_date === d && h.status !== "rejected")
      .reduce((s, h) => s + Number(h.total_sales || 0), 0);
    days7.push({ date: d, value: v });
  }

  // Target progress
  const monthApproved = monthData
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const tp = targetProgress({
    target,
    actual: monthApproved,
    daysElapsed,
    daysInMonth,
  });
  const validTotals = history30dTotals.filter((n) => n > 0);
  const avg30 =
    validTotals.length > 0
      ? validTotals.reduce((s, n) => s + n, 0) / validTotals.length
      : 0;
  const ratio = avg30 > 0 ? Number(report.total_sales || 0) / avg30 : 0;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackButton label="กลับ" fallbackHref="/cashhub/reports" />

      {/* Header */}
      <header className="mt-3 mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📋 REPORT DETAIL
        </p>
        <div className="flex items-start gap-3 mt-1">
          <div className="text-2xl sm:text-3xl shrink-0">{cfg?.emoji ?? "📋"}</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display">
              <span className="tabular-num">{branchRel?.code}</span>
            </h1>
            <p className="text-zinc-600 text-sm mt-0.5">
              {branchRel?.name} · {bkkDate(report.report_date as string)} ·{" "}
              {SHIFT_LABEL[report.shift as string]}
            </p>
          </div>
          <Badge tone={status.tone} className="shrink-0">
            <status.Icon className="size-3.5" />
            {status.label}
          </Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* LEFT — Numbers */}
        <div className="lg:col-span-3 space-y-4">
          <Section number="01" label="NUMBERS" title="ตัวเลข">
            <Card>
              <CardBody className="space-y-2.5">
                <Row
                  label="ยอดขายรวม"
                  value={formatBaht(Number(report.total_sales))}
                  highlight
                />
                {report.qty1 !== null && report.qty1 !== undefined && (
                  <Row
                    label={`จำนวน (${report.qty1_unit ?? "—"})`}
                    value={Number(report.qty1).toLocaleString("th-TH")}
                  />
                )}
                {report.qty2 !== null &&
                  report.qty2 !== undefined &&
                  Number(report.qty2) > 0 && (
                    <Row
                      label={`เพิ่มเติม (${report.qty2_unit ?? "—"})`}
                      value={Number(report.qty2).toLocaleString("th-TH")}
                    />
                  )}
                <div className="pt-2 border-t border-zinc-100" />
                <Row
                  label="💵 เงินสด"
                  value={formatBaht(Number(report.cash))}
                  muted={Number(report.cash) === 0}
                />
                <Row
                  label="🏦 โอน"
                  value={formatBaht(Number(report.transfer))}
                  muted={Number(report.transfer) === 0}
                />
                <Row
                  label="💳 บัตร"
                  value={formatBaht(Number(report.card))}
                  muted={Number(report.card) === 0}
                />
                <Row
                  label="📝 เครดิต"
                  value={formatBaht(Number(report.credit))}
                  muted={Number(report.credit) === 0}
                />
                {Number(report.shortage) > 0 && (
                  <Row
                    label="🔴 เงินขาด"
                    value={formatBaht(Number(report.shortage))}
                    danger
                  />
                )}
                <div className="pt-2 border-t border-zinc-100" />
                <Row label="รวมรับ" value={formatBaht(recv)} highlight />
                {Math.abs(recv - Number(report.total_sales)) < 0.01 ? (
                  <p className="text-sm text-green-700 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> ยอดตรงพอดี
                  </p>
                ) : (
                  <p className="text-sm text-red-700 inline-flex items-center gap-1.5">
                    <XCircle className="size-4" /> ยอดไม่ตรง
                  </p>
                )}
              </CardBody>
            </Card>
          </Section>

          {report.notes && (
            <Card className="bg-amber-50/40 border-amber-200">
              <CardHeader className="!border-amber-100">
                <CardTitle>📝 หมายเหตุจาก Staff</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-sm whitespace-pre-wrap">
                  {report.notes as string}
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <Row
                label="ส่งโดย"
                value={`${submittedBy?.name ?? "—"}${submittedBy?.phone ? ` (${submittedBy.phone})` : ""}`}
              />
              <Row
                label="เวลาส่ง"
                value={bkkDateTime(report.submitted_at as string)}
              />
              {report.status === "approved" && report.approved_at && (
                <>
                  <Row label="อนุมัติโดย" value={approvedBy?.name ?? "—"} />
                  <Row
                    label="เวลาอนุมัติ"
                    value={bkkDateTime(report.approved_at as string)}
                  />
                </>
              )}
              {report.status === "rejected" && report.rejected_reason && (
                <Row
                  label="เหตุผลที่ไม่อนุมัติ"
                  value={report.rejected_reason as string}
                />
              )}
            </CardBody>
          </Card>
        </div>

        {/* RIGHT — Smart Context Panel */}
        <div className="lg:col-span-2 space-y-4">
          <Section number="02" label="AUTO CHECK" title="ตรวจอัตโนมัติ">
            <Card>
              <CardHeader>
                <CardTitle>{ac.summary}</CardTitle>
                <Badge tone={ac.passed ? "success" : "warning"}>
                  {ac.checks.filter((c) => c.status === "pass").length}/
                  {ac.checks.length}
                </Badge>
              </CardHeader>
              <CardBody className="!p-0">
                <ul className="divide-y divide-zinc-100">
                  {ac.checks.map((c, i) => {
                    const Icon =
                      c.status === "pass"
                        ? CheckCircle2
                        : c.status === "warn"
                          ? AlertTriangle
                          : XCircle;
                    const tone =
                      c.status === "pass"
                        ? "text-emerald-700"
                        : c.status === "warn"
                          ? "text-amber-700"
                          : "text-red-700";
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 px-4 py-2.5 text-sm"
                      >
                        <Icon className={cn("size-4 mt-0.5 shrink-0", tone)} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{c.label}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">
                            {c.detail}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          </Section>

          <Section number="03" label="CONTEXT" title="ภาพรอบ ๆ">
            <Card>
              <CardBody className="space-y-3.5">
                {avg30 > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                      เฉลี่ย 30 วัน
                    </p>
                    <div className="flex items-baseline justify-between">
                      <span className="text-base font-extrabold tabular-num font-display">
                        {formatBaht(avg30)}
                      </span>
                      <Badge
                        tone={
                          ratio >= 0.5 && ratio <= 1.5
                            ? "success"
                            : ratio >= 0.4 && ratio <= 1.6
                              ? "warning"
                              : "danger"
                        }
                      >
                        วันนี้ {(ratio * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                    7 วันล่าสุด
                  </p>
                  <Sparkline data={days7} width={300} height={36} className="w-full" />
                </div>

                {target > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                      เป้าเดือนนี้
                    </p>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm tabular-num font-bold">
                        {formatBahtCompact(monthApproved)}
                      </span>
                      <span className="text-xs text-zinc-500 tabular-num">
                        / {formatBahtCompact(target)}
                      </span>
                    </div>
                    <ProgressBar
                      value={tp.pctOfTotal}
                      marker={(daysElapsed / daysInMonth) * 100}
                    />
                    <p className="text-[10px] text-zinc-500 mt-0.5 tabular-num">
                      {tp.pctOfTotal.toFixed(0)}% ของเป้า · pace{" "}
                      {tp.pctOfPace.toFixed(0)}%
                    </p>
                  </div>
                )}

                {otherShifts.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                      กะอื่นวันเดียวกัน
                    </p>
                    <ul className="space-y-1 text-xs">
                      {otherShifts.map((s) => (
                        <li
                          key={s.shift}
                          className="flex items-center justify-between"
                        >
                          <span>{SHIFT_LABEL[s.shift]}</span>
                          <span className="tabular-num font-semibold">
                            {formatBahtCompact(s.total)} ·{" "}
                            <span
                              className={cn(
                                "text-[10px]",
                                s.status === "approved"
                                  ? "text-emerald-700"
                                  : s.status === "submitted"
                                    ? "text-amber-700"
                                    : "text-red-700",
                              )}
                            >
                              {s.status}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-2 border-t border-zinc-100">
                  <Link
                    href={`/cashhub/branches/${branchId}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[var(--color-brand-700)] hover:underline"
                  >
                    <TrendingUp className="size-3.5" />
                    ดูประวัติสาขานี้แบบเต็ม →
                  </Link>
                </div>
              </CardBody>
            </Card>
          </Section>
        </div>
      </div>

      {/* Sticky approve actions */}
      {canApprove && report.status === "submitted" && (
        <div className="fixed sm:static sm:mt-6 bottom-0 left-0 right-0 sm:max-w-5xl sm:mx-auto z-30 bg-white sm:bg-transparent border-t-2 sm:border-0 border-zinc-200 px-4 py-3 sm:p-0 safe-bottom">
          <ApproveActions
            reportId={report.id as string}
            preset={
              ac.passed
                ? undefined
                : `Auto-check ติด ${ac.checks.filter((c) => c.status !== "pass").length} จุด — ${ac.checks
                    .filter((c) => c.status !== "pass")
                    .map((c) => c.label)
                    .join(", ")}`
            }
          />
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  muted,
  danger,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-zinc-600">{label}</span>
      <span
        className={cn(
          "tabular-num font-medium",
          highlight && "text-base font-bold font-display",
          muted && "text-zinc-400",
          danger && "text-red-600",
        )}
      >
        {value}
      </span>
    </div>
  );
}
