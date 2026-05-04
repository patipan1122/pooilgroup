import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBaht, bkkDateTime, bkkDate } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { ArrowLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import { ApproveActions } from "./approve-actions";
import { canApproveBranch } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

const STATUS = {
  submitted: { tone: "warning" as const, label: "รออนุมัติ", Icon: Clock },
  approved: { tone: "success" as const, label: "อนุมัติแล้ว", Icon: CheckCircle2 },
  rejected: { tone: "danger" as const, label: "ไม่อนุมัติ", Icon: XCircle },
  draft: { tone: "neutral" as const, label: "ฉบับร่าง", Icon: Clock },
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
      "*, branches(code, name, business_type), submitted_by:users!daily_reports_submitted_by_id_fkey(name, phone), approved_by:users!daily_reports_approved_by_id_fkey(name)",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!report) notFound();

  const branch = report.branches as {
    code?: string;
    name?: string;
    business_type?: string;
  } | null;
  const cfg = branch ? BUSINESS_TYPES[branch.business_type ?? ""] : undefined;
  const status = STATUS[report.status as keyof typeof STATUS] || STATUS.submitted;
  const submittedBy = report.submitted_by as { name?: string; phone?: string } | null;
  const approvedBy = report.approved_by as { name?: string } | null;

  // Permission check for approve buttons
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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <Link
        href="/cashhub"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 mb-4"
      >
        <ArrowLeft className="size-4" />
        กลับไปยังรายการ
      </Link>

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{cfg?.emoji || "📋"}</span>
            <div>
              <CardTitle>
                {branch?.code} · {branch?.name}
              </CardTitle>
              <p className="text-xs text-zinc-500 mt-0.5">
                {bkkDate(report.report_date as string)} ·{" "}
                {SHIFT_LABEL[report.shift as string] || ""}
              </p>
            </div>
          </div>
          <Badge tone={status.tone}>
            <status.Icon className="size-3.5" />
            {status.label}
          </Badge>
        </CardHeader>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>ตัวเลข</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2.5">
          <Row label="ยอดขายรวม" value={formatBaht(Number(report.total_sales))} highlight />
          {report.qty1 !== null && report.qty1 !== undefined && (
            <Row
              label={`จำนวน (${report.qty1_unit ?? "—"})`}
              value={Number(report.qty1).toLocaleString("th-TH")}
            />
          )}
          {report.qty2 !== null && report.qty2 !== undefined && Number(report.qty2) > 0 && (
            <Row
              label={`เพิ่มเติม (${report.qty2_unit ?? "—"})`}
              value={Number(report.qty2).toLocaleString("th-TH")}
            />
          )}
          <div className="pt-2 border-t border-zinc-100" />
          <Row label="💵 เงินสด" value={formatBaht(Number(report.cash))} muted={Number(report.cash) === 0} />
          <Row label="🏦 โอน" value={formatBaht(Number(report.transfer))} muted={Number(report.transfer) === 0} />
          <Row label="💳 บัตร" value={formatBaht(Number(report.card))} muted={Number(report.card) === 0} />
          <Row label="📝 เครดิต" value={formatBaht(Number(report.credit))} muted={Number(report.credit) === 0} />
          {Number(report.shortage) > 0 && (
            <Row
              label="🔴 เงินขาด"
              value={formatBaht(Number(report.shortage))}
              danger
            />
          )}
          <div className="pt-2 border-t border-zinc-100" />
          <Row
            label="รวมรับ"
            value={formatBaht(recv)}
            highlight
          />
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

      {report.notes && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>หมายเหตุ</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm whitespace-pre-wrap">{report.notes as string}</p>
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>ข้อมูล Workflow</CardTitle>
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
            <Row label="เหตุผลที่ไม่อนุมัติ" value={report.rejected_reason as string} />
          )}
        </CardBody>
      </Card>

      {canApprove && report.status === "submitted" && (
        <ApproveActions reportId={report.id as string} />
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
        className={`tabular-num font-medium ${
          highlight ? "text-base font-semibold" : "text-sm"
        } ${muted ? "text-zinc-400" : ""} ${danger ? "text-red-600" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};
