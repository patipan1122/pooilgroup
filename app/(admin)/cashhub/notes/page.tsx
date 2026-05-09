// Quick Note inbox — โน้ตจาก Staff ถึงเจ้าของ (CASHHUB §11.6)
// feedback_role_scoped_views.md · feedback_filter_pattern_biztype_first.md
// feedback_popup_first_drilldown.md

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { BackButton } from "@/components/ui/back-button";
import { loadManageableBranches } from "@/lib/auth/branch-access";
import { can } from "@/lib/auth/permissions";
import { NotesGrouped, type NoteListRow } from "./notes-grouped";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

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

  // Scope by role — branch_manager/staff see only own branches
  const isBranchScoped =
    session.user.role === "branch_manager" || session.user.role === "staff";
  const scopedBranchIds = isBranchScoped
    ? (await loadManageableBranches(session.user)).map((b) => b.id)
    : null;

  const admin = adminClient();
  let q = admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, notes, status, total_sales, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .not("notes", "is", null)
    .gte("report_date", since)
    .order("report_date", { ascending: false })
    .limit(80);
  if (scopedBranchIds) {
    if (scopedBranchIds.length === 0) {
      q = q.eq("branch_id", "00000000-0000-0000-0000-000000000000");
    } else {
      q = q.in("branch_id", scopedBranchIds);
    }
  }
  const { data } = await q;

  const rawRows = ((data ?? []) as Array<{
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
      branches: (Array.isArray(r.branches) ? r.branches[0] : r.branches) as
        | { code?: string; name?: string; business_type?: string }
        | null,
    }))
    .filter((r) => r.notes.trim().length > 0);

  const rows: NoteListRow[] = rawRows.map((r) => ({
    id: r.id,
    branch_id: r.branch_id,
    branch_code: r.branches?.code ?? "—",
    business_type: r.branches?.business_type ?? "_unknown",
    report_date: r.report_date,
    notes: r.notes,
    total_sales: Number(r.total_sales || 0),
  }));

  const canApprove = can(session.user, "cashhub.approve");

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-4xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold flex items-center gap-2">
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
                ? "bg-[var(--color-brand-600)] text-white"
                : "bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {d} วัน
          </Link>
        ))}
      </div>

      <Section number="01" label="MESSAGES" title="โน้ตล่าสุด">
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
          <NotesGrouped rows={rows} days={days} canApprove={canApprove} />
        )}
      </Section>
    </div>
  );
}
