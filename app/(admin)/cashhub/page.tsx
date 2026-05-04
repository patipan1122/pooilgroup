import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBaht, bkkDate, bkkTime } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS = {
  submitted: { tone: "warning" as const, label: "รออนุมัติ", Icon: Clock },
  approved: { tone: "success" as const, label: "อนุมัติแล้ว", Icon: CheckCircle2 },
  rejected: { tone: "danger" as const, label: "ไม่อนุมัติ", Icon: XCircle },
  draft: { tone: "neutral" as const, label: "ร่าง", Icon: Clock },
};

export default async function CashHubPage() {
  const session = await requireSession();
  const admin = adminClient();

  const { data: reports } = await admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, total_sales, status, submitted_at, approved_at, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .order("submitted_at", { ascending: false })
    .limit(50);

  const list = reports ?? [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-display">
          ยอดสาขา (CashHub)
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          รายงานล่าสุด 50 รายการจากทุกสาขา
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายงานล่าสุด</CardTitle>
          <Badge tone="brand">{list.length}</Badge>
        </CardHeader>
        <CardBody className="!pt-0">
          {list.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-zinc-500">
                ยังไม่มีรายงานในระบบ
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {list.map((r) => {
                const branch = r.branches as { code?: string; name?: string; business_type?: string } | null;
                const cfg = branch ? BUSINESS_TYPES[branch.business_type ?? ""] : undefined;
                const status = STATUS[r.status as keyof typeof STATUS] || STATUS.submitted;

                return (
                  <Link
                    key={r.id}
                    href={`/reports/${r.id}`}
                    className="flex items-center gap-3 py-3 hover:bg-zinc-50 -mx-2 px-2 rounded-xl transition-colors"
                  >
                    <div className="text-2xl shrink-0">{cfg?.emoji || "📋"}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{branch?.code}</span>
                        <span className="text-zinc-500">·</span>
                        <span className="truncate">{branch?.name}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {bkkDate(r.report_date as string)} · {SHIFT_LABEL[r.shift as string]} ·{" "}
                        {r.submitted_at && bkkTime(r.submitted_at as string)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-num text-sm">
                        {formatBaht(Number(r.total_sales || 0))}
                      </div>
                      <Badge tone={status.tone} className="mt-1">
                        <status.Icon className="size-3" />
                        {status.label}
                      </Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 เช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 เย็น",
  all: "ทั้งวัน",
};
