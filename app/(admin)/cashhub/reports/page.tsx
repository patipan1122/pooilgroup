// Reports list with filters + Quick Approve bulk action

import { CheckCircle2, Clock, XCircle, ScrollText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatBaht,
  bkkDate,
  bkkTime,
  thaiDateLong,
} from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { ReportsTable } from "./reports-table";

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

export interface ReportRowVm {
  id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  business_emoji: string;
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

export default async function CashHubReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; date?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const admin = adminClient();

  const filterStatus = sp.status || "";
  const filterType = sp.type || "";
  const filterDate = sp.date || "";

  let q = admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, total_sales, cash, transfer, card, credit, shortage, status, submitted_at, approved_at, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .order("submitted_at", { ascending: false })
    .limit(100);
  if (filterStatus) q = q.eq("status", filterStatus);
  if (filterDate) q = q.eq("report_date", filterDate);
  if (filterType) {
    // need to join — supabase doesn't allow easy filter on relation, so prefilter branches
    const { data: bs } = await admin
      .from("branches")
      .select("id")
      .eq("org_id", session.user.org_id)
      .eq("business_type", filterType);
    const ids = (bs ?? []).map((b) => b.id);
    if (ids.length > 0) q = q.in("branch_id", ids);
    else q = q.eq("branch_id", "00000000-0000-0000-0000-000000000000");
  }

  const { data } = await q;

  const rows: ReportRowVm[] = (data ?? []).map((r) => {
    const b = Array.isArray(r.branches) ? r.branches[0] : r.branches;
    const branchRel = (b ?? {}) as {
      code?: string;
      name?: string;
      business_type?: string;
    };
    const cfg = branchRel.business_type
      ? BUSINESS_TYPES[branchRel.business_type]
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
      id: r.id as string,
      branch_id: r.branch_id as string,
      branch_code: branchRel.code ?? "—",
      branch_name: branchRel.name ?? "",
      business_emoji: cfg?.emoji ?? "📋",
      report_date: r.report_date as string,
      shift: r.shift as string,
      shift_label: SHIFT_LABEL[r.shift as string] ?? r.shift,
      total_sales: Number(r.total_sales || 0),
      status,
      status_tone: STATUS[status].tone,
      status_label: STATUS[status].label,
      submitted_at: r.submitted_at as string | null,
      reconcile_diff: reconcileDiff,
    };
  });

  const pendingCount = rows.filter((r) => r.status === "submitted").length;
  const totalCount = rows.length;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
          💰 CashHub · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1.5">
          รายงาน <span className="accent">ทั้งหมด</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          {totalCount} รายงาน · รออนุมัติ{" "}
          <span className="font-bold text-amber-700">{pendingCount}</span>
        </p>
      </header>

      {/* Filters */}
      <Card className="mb-4">
        <CardBody>
          <form
            method="get"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-end"
          >
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                สถานะ
              </span>
              <select
                name="status"
                defaultValue={filterStatus}
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
              >
                <option value="">ทั้งหมด</option>
                <option value="submitted">รออนุมัติ</option>
                <option value="approved">อนุมัติแล้ว</option>
                <option value="rejected">ปฏิเสธ</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                ประเภท
              </span>
              <select
                name="type"
                defaultValue={filterType}
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
              >
                <option value="">ทุกประเภท</option>
                {Object.entries(BUSINESS_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.emoji} {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                วันที่
              </span>
              <input
                type="date"
                name="date"
                defaultValue={filterDate}
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                className="h-10 rounded-xl bg-[--color-brand-600] text-white font-semibold flex-1 text-sm"
              >
                ใช้
              </button>
              <a
                href="/cashhub/reports"
                className="h-10 rounded-xl border border-zinc-200 text-zinc-700 font-semibold text-sm inline-flex items-center justify-center px-3 hover:bg-zinc-50"
              >
                Reset
              </a>
            </div>
          </form>
        </CardBody>
      </Card>

      <Section
        number="01"
        label="REPORTS"
        title="รายงานล่าสุด"
        description="ติ๊กรายการที่ผ่าน Auto-check แล้วกด Approve ทั้งหมด · กดแถวเพื่อดูรายละเอียด"
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
          <Card>
            <CardBody>
              <EmptyState
                icon={<ScrollText className="size-6" />}
                title="ยังไม่มีรายงาน"
                description="ลองเปลี่ยนตัวกรอง หรือให้ Staff เริ่มกรอกผ่าน LIFF"
              />
            </CardBody>
          </Card>
        ) : (
          <ReportsTable rows={rows} />
        )}
      </Section>
    </div>
  );
}

void formatBaht;
void bkkDate;
void bkkTime;
