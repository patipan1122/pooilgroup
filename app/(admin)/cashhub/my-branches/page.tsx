// /cashhub/my-branches — Branch-manager landing page
// feedback_role_scoped_views.md — ผู้จัดการสาขาเห็นแค่สาขาในความดูแล
// แสดง: heatmap mini 30 วันล่าสุด · who-filled-today · ปุ่มกรอกด่วน
// ห้าม: ยอดรวม org · leaderboard · executive matrix

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardCheck,
  Building2,
  AlertCircle,
  ScrollText,
  CheckCircle2,
  CircleDashed,
  XCircle,
  Clock,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { loadManageableBranches } from "@/lib/auth/branch-access";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { thaiDateLong, bkkToday } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

const DAYS_BACK = 30;

export default async function MyBranchesPage() {
  const session = await requireSession();

  // Cross-branch roles ไม่จำเป็นต้องใช้หน้านี้ → ส่งไป exec dashboard
  if (
    session.user.role === "super_admin" ||
    session.user.role === "org_admin" ||
    session.user.role === "admin" ||
    session.user.role === "area_manager"
  ) {
    redirect("/cashhub/dashboard");
  }

  const admin = adminClient();
  const today = bkkToday();
  const dateFrom = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAYS_BACK - 1));
    return d.toISOString().slice(0, 10);
  })();

  const branches = await loadManageableBranches(session.user);
  const branchIds = branches.map((b) => b.id);

  // Reports for these branches in the last 30 days
  let reports: Array<{ branch_id: string; report_date: string; status: string }> = [];
  if (branchIds.length > 0) {
    const { data } = await admin
      .from("daily_reports")
      .select("branch_id, report_date, status")
      .eq("org_id", session.user.org_id)
      .in("branch_id", branchIds)
      .gte("report_date", dateFrom)
      .lte("report_date", today)
      .order("report_date", { ascending: false });
    reports = (data ?? []) as typeof reports;
  }

  // Build matrix branch → date → status
  const matrix = new Map<string, Map<string, string>>();
  for (const r of reports) {
    const m = matrix.get(r.branch_id) ?? new Map<string, string>();
    const cur = m.get(r.report_date);
    if (
      !cur ||
      (cur !== "approved" && r.status === "approved") ||
      (cur === "rejected" && r.status === "submitted")
    ) {
      m.set(r.report_date, r.status);
    }
    matrix.set(r.branch_id, m);
  }

  // Build day list (newest → oldest)
  const days: string[] = Array.from({ length: DAYS_BACK }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  // Today summary
  const todayDone = branches.filter((b) => {
    const s = matrix.get(b.id)?.get(today);
    return s === "approved" || s === "submitted";
  }).length;
  const todayMissing = branches.length - todayDone;

  return (
    <div className="p-4 sm:p-8 lg:p-10 max-w-6xl mx-auto pb-24">
      <header className="mb-10 animate-slide-up-soft">
        <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
          CASHHUB · MY BRANCHES
          <span className="text-zinc-400 mx-2">·</span>
          <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
        </p>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          สาขา <span className="text-gradient-blue">ของฉัน</span>
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 mt-3 max-w-2xl">
          {session.user.name} · ผู้จัดการสาขา ·{" "}
          <strong className="text-zinc-900 tabular-num">
            {branches.length}
          </strong>{" "}
          สาขาในความดูแล
        </p>
      </header>

      {branches.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="ยังไม่มีสาขาที่ดูแล"
          description="กรุณาติดต่อ Admin ให้กำหนดสาขาให้คุณ"
        />
      ) : (
        <>
          {/* Today summary */}
          <Section
            number="01"
            label="TODAY"
            title={`วันนี้ ${todayDone}/${branches.length} สาขา กรอกแล้ว`}
            description="กดสาขาที่ยังไม่กรอกเพื่อกรอกได้เลย"
            className="mb-10 animate-fade-up"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {branches.map((b) => {
                const status = matrix.get(b.id)?.get(today);
                const isDone = status === "approved" || status === "submitted";
                const cfg = BUSINESS_TYPES[b.business_type];
                return (
                  <Link
                    key={b.id}
                    href={`/liff/report/${b.id}`}
                    className={cn(
                      "group flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 transition-all",
                      isDone
                        ? "border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]/40 hover:bg-[var(--color-leaf-50)]"
                        : "border-zinc-200 bg-white hover:border-[var(--color-brand-400)] hover-lift",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{cfg?.emoji}</span>
                        <span className="font-bold tabular-num text-sm">
                          {b.code}
                        </span>
                        {isDone && (
                          <Badge tone="success">
                            {status === "approved" ? "✓ อนุมัติ" : "✓ ส่งแล้ว"}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-zinc-600 truncate mt-0.5">
                        {b.name}
                      </div>
                    </div>
                    {!isDone && (
                      <span className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold shadow-blue group-hover:bg-[var(--color-brand-700)] shrink-0">
                        <ClipboardCheck className="size-3.5" />
                        กรอก
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            {todayMissing > 0 && (
              <p className="text-xs text-zinc-500 mt-3">
                เหลือ <strong className="text-amber-700">{todayMissing}</strong>{" "}
                สาขาที่ยังไม่กรอกวันนี้
              </p>
            )}
          </Section>

          {/* History (30 days) — mini heatmap */}
          <Section
            number="02"
            label="HISTORY"
            title={`${DAYS_BACK} วันย้อนหลัง`}
            description="ดูว่าสาขาไหนกรอกครบ/ขาดวันไหน · กดเซลล์เพื่อดูรายงานของวันนั้น"
            className="mb-10 animate-fade-up delay-100"
          >
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-3">
              <Badge tone="success">
                <CheckCircle2 className="size-3" /> อนุมัติ
              </Badge>
              <Badge tone="warning">
                <Clock className="size-3" /> รออนุมัติ
              </Badge>
              <Badge tone="danger">
                <XCircle className="size-3" /> ปฏิเสธ
              </Badge>
              <span className="inline-flex items-center gap-1">
                <CircleDashed className="size-3 text-zinc-400" /> ไม่กรอก
              </span>
            </div>
            <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-x-auto">
              <table className="text-xs min-w-full">
                <thead className="bg-zinc-50">
                  <tr className="border-b border-zinc-100">
                    <th className="text-left p-2 sticky left-0 bg-zinc-50 z-10 whitespace-nowrap">
                      สาขา
                    </th>
                    {days.map((d) => {
                      const day = parseInt(d.slice(8, 10), 10);
                      return (
                        <th
                          key={d}
                          className={cn(
                            "p-1 text-center font-semibold tabular-num text-[10px] w-7",
                            d === today &&
                              "text-[var(--color-brand-700)] font-extrabold",
                          )}
                        >
                          {day}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => {
                    const cfg = BUSINESS_TYPES[b.business_type];
                    return (
                      <tr key={b.id} className="border-b border-zinc-50">
                        <td className="p-2 sticky left-0 bg-white whitespace-nowrap font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <span>{cfg?.emoji}</span>
                            <span className="tabular-num">{b.code}</span>
                          </span>
                        </td>
                        {days.map((d) => {
                          const status = matrix.get(b.id)?.get(d);
                          return (
                            <td key={d} className="p-0.5 text-center">
                              <Link
                                href={`/cashhub/branches/${b.id}?date=${d}`}
                                className={cn(
                                  "size-5 mx-auto rounded-md text-[9px] flex items-center justify-center font-bold transition-transform hover:scale-110 cursor-pointer",
                                  cellColor(status),
                                )}
                                title={`${b.code} · ${d} · ${statusLabel(status)}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Quick links */}
          <Section
            number="03"
            label="QUICK ACCESS"
            title="ทางลัด"
            description="ดูเงินขาดของสาขาฉัน · โน้ตจาก Staff"
            className="animate-fade-up delay-200"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/cashhub/shortages"
                className="group rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover-lift transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="size-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                    <AlertCircle className="size-5" />
                  </div>
                  <h3 className="font-bold font-display text-zinc-900">
                    เงินขาด
                  </h3>
                </div>
                <p className="text-sm text-zinc-600">
                  ดูประวัติเงินขาดของสาขาฉัน · ระบุตัวคน · หมายเหตุ
                </p>
              </Link>
              <Link
                href="/cashhub/notes"
                className="group rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover-lift transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="size-10 rounded-xl bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center">
                    <ScrollText className="size-5" />
                  </div>
                  <h3 className="font-bold font-display text-zinc-900">
                    โน้ตจาก Staff
                  </h3>
                </div>
                <p className="text-sm text-zinc-600">
                  ข้อความที่พนักงานหน้าร้านแนบมาในใบรายงาน
                </p>
              </Link>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function cellColor(status: string | undefined): string {
  if (status === "approved") return "bg-emerald-300 hover:bg-emerald-400";
  if (status === "submitted") return "bg-amber-200 hover:bg-amber-300";
  if (status === "rejected") return "bg-red-200 hover:bg-red-300";
  return "bg-zinc-100 hover:bg-zinc-200";
}

function statusLabel(status: string | undefined): string {
  if (status === "approved") return "อนุมัติ";
  if (status === "submitted") return "รออนุมัติ";
  if (status === "rejected") return "ปฏิเสธ";
  return "ไม่กรอก";
}
