import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { CheckCircle2, Clock, XCircle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBaht, bkkTime, thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  submitted: "warning" as const,
  approved: "success" as const,
  rejected: "danger" as const,
  draft: "neutral" as const,
};
const STATUS_LABEL = {
  submitted: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  draft: "ฉบับร่าง",
};

export default async function LiffStatusPage() {
  const session = await requireSession();
  const admin = adminClient();

  // Today's reports submitted by this user
  const { data: reports } = await admin
    .from("daily_reports")
    .select(
      "id, branch_id, total_sales, status, submitted_at, approved_at, shift, report_date, branches(code, name, business_type)",
    )
    .eq("submitted_by_id", session.user.id)
    .order("submitted_at", { ascending: false })
    .limit(20);

  return (
    <div className="p-4 max-w-md mx-auto safe-top safe-bottom space-y-4">
      <div>
        <h1 className="text-xl font-semibold font-display">รายงานของฉัน</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {thaiDateLong(new Date())}
        </p>
      </div>

      <Link
        href="/liff/report"
        className="block bg-[--color-brand-600] text-white rounded-2xl px-5 py-4 shadow-soft hover:bg-[--color-brand-700] transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">📝 กรอกรายงานใหม่</div>
            <div className="text-sm opacity-80 mt-0.5">เลือกสาขา + ส่งให้ Manager</div>
          </div>
          <ArrowRight className="size-5" />
        </div>
      </Link>

      <div className="space-y-2">
        {(!reports || reports.length === 0) && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-zinc-200">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm text-zinc-500">
              ยังไม่มีรายงานที่ส่ง
            </p>
          </div>
        )}
        {(reports ?? []).map((r) => {
          const branch = r.branches as { code?: string; name?: string; business_type?: string } | null;
          const cfg = branch ? BUSINESS_TYPES[branch.business_type ?? ""] : undefined;
          const status = r.status as keyof typeof STATUS_TONE;
          const Icon = status === "approved" ? CheckCircle2 : status === "rejected" ? XCircle : Clock;
          const iconColor = status === "approved" ? "text-green-600" : status === "rejected" ? "text-red-600" : "text-amber-600";

          return (
            <div
              key={r.id}
              className="bg-white rounded-2xl border border-zinc-200 px-4 py-3 shadow-soft"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xl shrink-0">{cfg?.emoji || "📋"}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {branch?.code} · {branch?.name}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {bkkTime(r.submitted_at as string)} · {SHIFT_LABEL[r.shift as string] || ""}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold tabular-num text-sm">
                    {formatBaht(Number(r.total_sales || 0))}
                  </div>
                  <Badge tone={STATUS_TONE[status]} className="mt-1">
                    <Icon className={`size-3 ${iconColor}`} />
                    {STATUS_LABEL[status]}
                  </Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};
