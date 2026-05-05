// Manager /home — สำหรับ branch_manager / area_manager
// โฟกัส: ดูภาพรวมสาขาที่ดูแล + รายงานรออนุมัติ + กรอกแทนได้
//
// area_manager เพิ่มสิทธิ์ "กรอกได้ทุกสาขา" ผ่านปุ่ม Quick Fill

import Link from "next/link";
import {
  ClipboardCheck,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ScrollText,
  UserCircle,
  Inbox,
  ChevronRight,
  Building2,
  TrendingUp,
} from "lucide-react";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExecutiveTable } from "@/components/cashhub/executive-table";
import { loadExecutiveMatrix } from "@/lib/cashhub/executive-matrix";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { thaiDateLong, bkkToday, formatBaht } from "@/lib/utils/format";
import { hasCrossBranchAccess } from "@/lib/auth/branch-access";
import type { DbUser } from "@/lib/auth/session";

interface BranchInfo {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

interface PendingReport {
  id: string;
  branch_id: string;
  report_date: string;
  total_sales: number | string;
  submitted_at: string | null;
}

export async function ManagerHome({
  user,
  firstName,
}: {
  user: DbUser;
  firstName: string;
}) {
  const admin = adminClient();
  const today = bkkToday();
  const isCrossBranch = hasCrossBranchAccess(user.role);
  const isAreaManager = user.role === "area_manager";

  // 1. Branches ที่ user คน นี้ดูแล (จาก user_branches)
  const { data: ubData } = await admin
    .from("user_branches")
    .select("branch_id, branches(id, code, name, business_type, is_active)")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const myBranches: BranchInfo[] = [];
  for (const ub of ubData ?? []) {
    const b = Array.isArray(ub.branches) ? ub.branches[0] : ub.branches;
    if (b && (b as { is_active: boolean }).is_active) {
      myBranches.push(b as BranchInfo);
    }
  }
  const myBranchIds = myBranches.map((b) => b.id);

  // 2. Today's status สำหรับสาขาที่ดูแล
  let todayByBranch: Record<string, string> = {};
  if (myBranchIds.length > 0) {
    const { data: rs } = await admin
      .from("daily_reports")
      .select("branch_id, status")
      .eq("org_id", user.org_id)
      .eq("report_date", today)
      .in("branch_id", myBranchIds);
    todayByBranch = Object.fromEntries(
      (rs ?? []).map((r) => [
        (r as { branch_id: string }).branch_id,
        (r as { status: string }).status,
      ]),
    );
  }

  // 3. Pending approvals ของสาขาที่ดูแล (status = submitted)
  let pendingReports: PendingReport[] = [];
  if (myBranchIds.length > 0) {
    const { data: pr } = await admin
      .from("daily_reports")
      .select("id, branch_id, report_date, total_sales, submitted_at")
      .eq("org_id", user.org_id)
      .eq("status", "submitted")
      .in("branch_id", myBranchIds)
      .order("submitted_at", { ascending: false })
      .limit(10);
    pendingReports = (pr ?? []) as PendingReport[];
  }
  const branchById = Object.fromEntries(myBranches.map((b) => [b.id, b]));

  // 4. Executive matrix — area_manager+ เห็นทั้งหมด, branch_manager เห็นเฉพาะที่ดูแล
  const executiveMatrix = isCrossBranch
    ? await loadExecutiveMatrix(user.org_id, { period: "monthly", count: 12 })
    : null; // branch_manager ไม่เห็น executive table (focus หน้าตัวเอง)

  const filledCount = myBranches.filter(
    (b) => todayByBranch[b.id] && todayByBranch[b.id] !== "draft",
  ).length;
  const missingCount = myBranches.length - filledCount;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-5xl mx-auto pb-24">
        {/* Hero */}
        <header className="mb-12 sm:mb-14 animate-slide-up-soft flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] font-bold text-[var(--color-brand-700)]">
              <span className="brand-gradient-text">Pooilgroup</span>
              <span className="text-zinc-400 mx-2">·</span>
              <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
              {isAreaManager && (
                <>
                  <span className="text-zinc-400 mx-2">·</span>
                  <Badge tone="brand">ผู้จัดการเขต</Badge>
                </>
              )}
            </p>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
              สวัสดี <span className="text-gradient-blue">{firstName}</span>
            </h1>
            <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-2xl leading-relaxed">
              {myBranches.length === 0
                ? "ยังไม่ได้ผูกสาขาให้ดูแล · ติดต่อ Admin"
                : `ดูแล ${myBranches.length} สาขา · กรอกวันนี้ ${filledCount} เหลือ ${missingCount}`}
              {pendingReports.length > 0 && (
                <>
                  <br />
                  <strong className="text-amber-700">
                    มี {pendingReports.length} รายงานรออนุมัติ
                  </strong>
                </>
              )}
            </p>
          </div>

          {/* Quick Fill button — area_manager ใหญ่ + เด่น */}
          {isCrossBranch && (
            <Link
              href="/cashhub/quick-fill"
              className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] hover-lift-premium shadow-blue transition-colors"
            >
              <ClipboardCheck className="size-4" />
              กรอกแทน (ทุกสาขา)
              <ArrowUpRight className="size-4" />
            </Link>
          )}
        </header>

        {/* 01 รายงานรออนุมัติ */}
        {pendingReports.length > 0 && (
          <Section
            number="01"
            label="รออนุมัติ"
            title={`มี ${pendingReports.length} รายงานต้องดู`}
            description="กดเพื่อดูรายละเอียด · อนุมัติ / ปฏิเสธ"
            className="mb-12 animate-fade-up delay-100"
          >
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/40 overflow-hidden">
              <ul className="divide-y divide-amber-200">
                {pendingReports.map((r) => {
                  const branch = branchById[r.branch_id];
                  const cfg = branch ? BUSINESS_TYPES[branch.business_type] : undefined;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/cashhub/reports/${r.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-amber-100/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xl shrink-0">{cfg?.emoji ?? "📋"}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-bold tabular-num">
                              {branch?.code ?? r.branch_id.slice(0, 6)}
                              <span className="text-zinc-400 mx-1.5">·</span>
                              {r.report_date}
                            </div>
                            <div className="text-xs text-zinc-600 truncate">
                              {branch?.name}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold tabular-num text-zinc-900">
                            {formatBaht(r.total_sales)}
                          </span>
                          <ChevronRight className="size-4 text-amber-700" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Section>
        )}

        {/* 02 สาขาที่ดูแล */}
        {myBranches.length > 0 && (
          <Section
            number={pendingReports.length > 0 ? "02" : "01"}
            label="สาขาที่ดูแล"
            title={
              filledCount === myBranches.length
                ? "ทุกสาขากรอกครบแล้ว 🎉"
                : `กรอกวันนี้ ${filledCount}/${myBranches.length}`
            }
            description="กดสาขาเพื่อกรอกรายงาน หรือดูยอดวันนี้"
            className="mb-12 animate-fade-up delay-150"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {myBranches.map((b) => {
                const status = todayByBranch[b.id];
                const isDone = status && status !== "draft";
                const cfg = BUSINESS_TYPES[b.business_type];
                return (
                  <Link
                    key={b.id}
                    href={`/liff/report/${b.id}`}
                    className={
                      isDone
                        ? "group flex items-center justify-between gap-3 rounded-2xl border-2 border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]/40 px-4 py-3 hover:bg-[var(--color-leaf-50)] transition-all"
                        : "group flex items-center justify-between gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3 hover:border-[var(--color-brand-400)] hover-lift transition-all shadow-soft"
                    }
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={
                          isDone
                            ? "size-10 rounded-xl bg-[var(--color-leaf-100)] border border-[var(--color-leaf-300)] text-[var(--color-leaf-700)] flex items-center justify-center text-lg shrink-0"
                            : "size-10 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] flex items-center justify-center text-lg shrink-0"
                        }
                      >
                        {cfg?.emoji ?? "📋"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold tabular-num text-sm">
                            {b.code}
                          </span>
                          {isDone ? (
                            <Badge tone="success">
                              {status === "approved" ? "✓ อนุมัติ" : "✓ ส่งแล้ว"}
                            </Badge>
                          ) : (
                            <Badge tone="warning">⏰ ยังไม่กรอก</Badge>
                          )}
                        </div>
                        <div className="text-xs text-zinc-600 truncate mt-0.5">
                          {b.name}
                        </div>
                      </div>
                    </div>
                    <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)] shrink-0" />
                  </Link>
                );
              })}
            </div>
          </Section>
        )}

        {/* 03 Executive table — only for area_manager (cross-branch) */}
        {executiveMatrix && (
          <Section
            number={pendingReports.length > 0 ? "03" : "02"}
            label="EXECUTIVE OVERVIEW"
            title="ยอดขาย ทุกประเภทธุรกิจ"
            description="ภาพรวม Pooilgroup · กดแถวขยายดูสาขา"
            className="mb-12 animate-fade-up delay-200"
            action={
              <Link
                href="/cashhub/dashboard"
                className="text-sm font-bold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] inline-flex items-center gap-1"
              >
                เปิด CashHub →
              </Link>
            }
          >
            <ExecutiveTable data={executiveMatrix} />
          </Section>
        )}

        {/* Empty state when nothing assigned */}
        {myBranches.length === 0 && !isCrossBranch && (
          <Section
            label="ยังไม่มีสาขา"
            title="รอ Admin มอบหมายสาขา"
            className="mb-12 animate-fade-up delay-100"
          >
            <EmptyState
              icon={<Building2 className="size-6" />}
              title="ยังไม่ได้รับมอบหมาย"
              description="กรุณาติดต่อผู้ดูแลระบบให้กำหนดสาขาที่คุณดูแล"
            />
          </Section>
        )}

        {/* Quick Links — number = next available */}
        <Section
          number={String(
            1 +
              (pendingReports.length > 0 ? 1 : 0) +
              (myBranches.length > 0 ? 1 : 0) +
              (executiveMatrix ? 1 : 0),
          ).padStart(2, "0")}
          label="ทางลัด"
          title="เครื่องมือที่ใช้บ่อย"
          className="animate-fade-up delay-250"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <QuickLink
              href="/cashhub/quick-fill"
              icon={<ClipboardCheck className="size-4" />}
              label={isCrossBranch ? "กรอกทุกสาขา" : "กรอกรายงาน"}
            />
            <QuickLink
              href="/cashhub/reports?status=submitted"
              icon={<Inbox className="size-4" />}
              label="รออนุมัติ"
            />
            <QuickLink
              href="/cashhub/dashboard"
              icon={<TrendingUp className="size-4" />}
              label="ภาพรวม CashHub"
            />
            <QuickLink
              href="/profile"
              icon={<UserCircle className="size-4" />}
              label="โปรไฟล์"
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border-2 border-zinc-200 bg-white hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
    >
      <span className="flex items-center gap-2.5">
        <span className="text-[var(--color-brand-600)]">{icon}</span>
        <span className="text-sm font-bold text-zinc-800">{label}</span>
      </span>
      <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)]" />
    </Link>
  );
}
