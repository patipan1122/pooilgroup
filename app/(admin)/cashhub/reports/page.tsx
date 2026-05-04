import { CheckCircle2, Clock, XCircle, ScrollText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatBaht,
  bkkDate,
  bkkTime,
  thaiDateLong,
} from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

export const dynamic = "force-dynamic";

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

interface ReportRow {
  id: string;
  branch_id: string;
  report_date: string;
  shift: string;
  total_sales: number | string;
  status: keyof typeof STATUS;
  submitted_at: string;
  approved_at: string | null;
  branches: { code?: string; name?: string; business_type?: string } | null;
}

export default async function CashHubReportsPage() {
  const session = await requireSession();
  const admin = adminClient();

  const { data } = await admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, total_sales, status, submitted_at, approved_at, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .order("submitted_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []).map((r) => {
    const b = Array.isArray(r.branches) ? r.branches[0] : r.branches;
    return { ...r, branches: b } as ReportRow;
  });

  const totalCount = rows.length;
  const pendingCount = rows.filter((r) => r.status === "submitted").length;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
          💰 CashHub · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
          รายงาน <span className="accent">ทั้งหมด</span>
        </h1>
        <p className="text-zinc-600 mt-2">
          50 รายงานล่าสุด · รออนุมัติ {pendingCount} จาก {totalCount}
        </p>
      </header>

      <Section
        number="01"
        label="REPORTS"
        title="รายงานล่าสุด"
        description="คลิกรายงานเพื่อดูรายละเอียด · อนุมัติ/ปฏิเสธในหน้ารายละเอียด"
        action={
          <a href="/api/cashhub/export">
            <Button variant="outline" size="md">
              Export CSV
            </Button>
          </a>
        }
        className="animate-fade-up delay-100"
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="size-6" />}
            title="ยังไม่มีรายงานในระบบ"
            description="Staff สามารถเริ่มกรอกรายงานผ่าน LINE LIFF ได้แล้ว"
          />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            rowHref={(r) => `/cashhub/reports/${r.id}`}
            columns={[
              {
                key: "type",
                header: "",
                cell: (r) => {
                  const cfg = r.branches?.business_type
                    ? BUSINESS_TYPES[r.branches.business_type]
                    : undefined;
                  return <span className="text-xl">{cfg?.emoji || "📋"}</span>;
                },
                className: "w-10",
              },
              {
                key: "branch",
                header: "สาขา",
                cell: (r) => (
                  <div>
                    <div className="font-bold tabular-num text-sm">
                      {r.branches?.code || "—"}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {r.branches?.name}
                    </div>
                  </div>
                ),
              },
              {
                key: "date",
                header: "วันที่",
                cell: (r) => (
                  <div>
                    <div className="text-sm font-medium">
                      {bkkDate(r.report_date)}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {SHIFT_LABEL[r.shift]}
                    </div>
                  </div>
                ),
              },
              {
                key: "sales",
                header: "ยอดขาย",
                align: "right",
                cell: (r) => (
                  <div className="font-bold tabular-num">
                    {formatBaht(Number(r.total_sales || 0))}
                  </div>
                ),
              },
              {
                key: "submitted",
                header: "ส่งเมื่อ",
                cell: (r) => (
                  <span className="text-xs text-zinc-500 tabular-num">
                    {r.submitted_at ? bkkTime(r.submitted_at) : "—"}
                  </span>
                ),
              },
              {
                key: "status",
                header: "สถานะ",
                align: "right",
                cell: (r) => {
                  const s = STATUS[r.status] || STATUS.submitted;
                  return (
                    <Badge tone={s.tone}>
                      <s.Icon className="size-3" />
                      {s.label}
                    </Badge>
                  );
                },
              },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
