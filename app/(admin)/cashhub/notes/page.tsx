// Quick Note inbox — โน้ตจาก Staff ถึงเจ้าของ (CASHHUB §11.6)

import Link from "next/link";
import { ArrowLeft, MessageSquare, ExternalLink } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBahtCompact, bkkDate } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface NoteRow {
  id: string;
  branch_id: string;
  report_date: string;
  shift: string;
  notes: string;
  status: string;
  total_sales: number | string;
  branches: { code?: string; name?: string; business_type?: string } | null;
}

export default async function NotesInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const days = parseInt(sp.days || "30", 10);
  const since = formatInTimeZone(
    subDays(new Date(), days),
    TZ,
    "yyyy-MM-dd",
  );

  const admin = adminClient();
  const { data } = await admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, notes, status, total_sales, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .not("notes", "is", null)
    .gte("report_date", since)
    .order("report_date", { ascending: false })
    .limit(80);

  const rows = ((data ?? []) as Array<{
    id: string;
    branch_id: string;
    report_date: string;
    shift: string;
    notes: string | null;
    status: string;
    total_sales: number | string;
    branches: unknown;
  }>)
    .map((r) => ({
      ...r,
      notes: r.notes ?? "",
      branches: Array.isArray(r.branches) ? r.branches[0] : r.branches,
    }))
    .filter((r) => r.notes.trim().length > 0) as NoteRow[];

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-4xl mx-auto pb-24">
      <Link
        href="/cashhub/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700]"
      >
        <ArrowLeft className="size-4" />
        ภาพรวม
      </Link>
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[--color-brand-600] font-bold flex items-center gap-2">
          <MessageSquare className="size-4" /> NOTES INBOX
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1">
          โน้ตจาก <span className="accent">Staff</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          {rows.length} ข้อความใน {days} วัน · ใช้ดูปัญหา/ความเห็นจากหน้างาน
        </p>
      </header>

      <div className="flex gap-2 mb-4 text-sm">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            href={`?days=${d}`}
            className={`px-3 py-1.5 rounded-xl font-semibold ${
              days === d
                ? "bg-[--color-brand-600] text-white"
                : "bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {d} วัน
          </Link>
        ))}
      </div>

      <Section number="01" label="MESSAGES" title={`โน้ตล่าสุด`}>
        {rows.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<MessageSquare className="size-6" />}
                title="ยังไม่มีโน้ต"
                description="Staff ยังไม่ได้เขียนหมายเหตุในรายงาน"
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{rows.length} ข้อความ</CardTitle>
              <Badge tone="brand">{days} วันล่าสุด</Badge>
            </CardHeader>
            <CardBody className="!p-0">
              <ul className="divide-y divide-zinc-100">
                {rows.map((r) => {
                  const cfg = r.branches?.business_type
                    ? BUSINESS_TYPES[r.branches.business_type]
                    : undefined;
                  return (
                    <li key={r.id} className="px-4 sm:px-5 py-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl shrink-0">
                          {cfg?.emoji || "📋"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold tabular-num text-sm">
                              {r.branches?.code}
                            </span>
                            <Badge tone="neutral">
                              {bkkDate(r.report_date)}
                            </Badge>
                            <Badge tone="brand">
                              {formatBahtCompact(Number(r.total_sales || 0))}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-zinc-800">
                            {r.notes}
                          </p>
                          <Link
                            href={`/cashhub/reports/${r.id}`}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[--color-brand-700] hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            ดูรายงานเต็ม
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        )}
      </Section>
    </div>
  );
}
