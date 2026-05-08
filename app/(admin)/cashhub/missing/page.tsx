// /admin/cashhub/missing — branches that did NOT submit a report on a given day,
// with a "แจ้งเหตุผล" button so the manager records why (CASHHUB §11.5).
// Why this exists: เจ้าของไม่ต้องโทรถาม Manager — Manager บันทึกใน UI เลย
// then เจ้าของเห็น "พนักงานลาออก หาคนใหม่อยู่" ใน Dashboard.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { BackButton } from "@/components/ui/back-button";
import { resolveCompanyFilter } from "@/lib/auth/company-context";
import { bkkToday } from "@/lib/utils/format";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { MissingList, type MissingRow } from "./missing-list";

export const dynamic = "force-dynamic";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function MissingPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; company?: string }>;
}) {
  const session = await requireSession();
  // Role-scope: branch_manager เห็นเฉพาะสาขาตัวเอง · staff/driver/viewer ห้ามเข้า
  if (session.user.role === "driver") redirect("/driver");
  if (session.user.role === "staff") redirect("/cashhub/quick-fill");
  if (session.user.role === "viewer") redirect("/cashhub/heatmap");

  const sp = await searchParams;
  const days = Math.max(1, Math.min(30, parseInt(sp.days ?? "7", 10) || 7));
  const companyId = await resolveCompanyFilter(sp.company);

  const admin = adminClient();
  const today = bkkToday();
  const fromDate = formatInTimeZone(
    subDays(new Date(), days - 1),
    TZ,
    "yyyy-MM-dd",
  );

  // Pull branches in scope
  const branchQ = admin
    .from("branches")
    .select("id, code, name, business_type, company_id, manager_id")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);
  if (companyId) branchQ.eq("company_id", companyId);
  const { data: allBranches } = await branchQ;
  const branches = (allBranches ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
    company_id: string;
    manager_id: string | null;
  }>;

  // Branch_manager filter — only own branches via user_branches
  let scopedBranches = branches;
  if (session.user.role === "branch_manager") {
    const { data: ub } = await admin
      .from("user_branches")
      .select("branch_id")
      .eq("user_id", session.user.id)
      .eq("is_active", true);
    const ids = new Set(((ub ?? []) as Array<{ branch_id: string }>).map((r) => r.branch_id));
    scopedBranches = branches.filter((b) => ids.has(b.id));
  }

  if (scopedBranches.length === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <BackButton fallbackHref="/cashhub" label="กลับ" />
        <h1 className="text-2xl sm:text-3xl font-extrabold font-display mt-4 mb-3">
          ไม่มีสาขาที่ดูแล
        </h1>
        <p className="text-sm text-zinc-500">
          ติดต่อ admin ให้ผูกสาขากับบัญชีคุณ
        </p>
      </div>
    );
  }

  const branchIds = scopedBranches.map((b) => b.id);
  const [reportsQ, reasonsQ] = await Promise.all([
    admin
      .from("daily_reports")
      .select("branch_id, report_date, status, shift")
      .in("branch_id", branchIds)
      .gte("report_date", fromDate)
      .lte("report_date", today),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("missing_report_reasons")
      .select("branch_id, report_date, reason_type, reason_text")
      .in("branch_id", branchIds)
      .gte("report_date", fromDate)
      .lte("report_date", today),
  ]);

  // For each branch × day, decide if it was filled.
  const reportSet = new Set(
    ((reportsQ.data ?? []) as Array<{ branch_id: string; report_date: string }>).map(
      (r) => `${r.branch_id}|${r.report_date}`,
    ),
  );
  const reasonMap = new Map<string, { type: string; text: string | null }>();
  for (const r of (reasonsQ.data ?? []) as Array<{
    branch_id: string;
    report_date: string;
    reason_type: string;
    reason_text: string | null;
  }>) {
    reasonMap.set(`${r.branch_id}|${r.report_date}`, {
      type: r.reason_type,
      text: r.reason_text,
    });
  }

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(formatInTimeZone(subDays(new Date(), i), TZ, "yyyy-MM-dd"));
  }

  // Compose row list — only branches missing AT LEAST one day
  const rows: MissingRow[] = [];
  for (const b of scopedBranches) {
    const missingDays: Array<{
      date: string;
      reasonType: string | null;
      reasonText: string | null;
    }> = [];
    for (const d of dates) {
      if (!reportSet.has(`${b.id}|${d}`)) {
        const r = reasonMap.get(`${b.id}|${d}`);
        missingDays.push({
          date: d,
          reasonType: r?.type ?? null,
          reasonText: r?.text ?? null,
        });
      }
    }
    if (missingDays.length > 0) {
      rows.push({
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        businessType: b.business_type,
        missing: missingDays,
      });
    }
  }

  // Sort: most missing days first
  rows.sort((a, b) => b.missing.length - a.missing.length);

  return (
    <div className="relative p-4 sm:p-8 lg:p-12 max-w-5xl mx-auto pb-24">
      <BackButton fallbackHref="/cashhub" label="กลับ" />
      <header className="mt-4 mb-8 animate-slide-up-soft">
        <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
          CashHub · Missing Reports
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold font-display mt-3 leading-tight">
          สาขาที่ <span className="text-gradient-blue">ยังไม่กรอก</span> รายงาน
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 mt-3 leading-relaxed">
          {days} วันล่าสุด · กดปุ่ม "แจ้งเหตุผล" เพื่อบันทึกว่าทำไมไม่กรอก —
          เจ้าของจะเห็นใน Dashboard ไม่ต้องโทรถาม
        </p>
      </header>

      <Section
        number="01"
        label="MISSING"
        title={`${rows.length} สาขายังไม่กรอกบางวัน`}
        description={
          rows.length === 0
            ? "ดีเยี่ยม — ทุกสาขากรอกครบแล้ว"
            : "เรียงตามจำนวนวันที่ขาดมากสุดก่อน"
        }
      >
        {rows.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50 p-10 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-base text-emerald-900 font-bold">
              ทุกสาขากรอกครบทุกวันใน {days} วันที่ผ่านมา
            </p>
          </div>
        ) : (
          <MissingList rows={rows} />
        )}
      </Section>
    </div>
  );
}
