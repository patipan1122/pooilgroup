// Staff /home — focus on "วันนี้กรอกหรือยัง?" + เข้ากรอกได้ทันที
// ผู้ใช้ role = staff เห็นเฉพาะสาขาที่ถูก assign

import Link from "next/link";
import {
  ClipboardCheck,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ScrollText,
  UserCircle,
  History,
  AlertCircle,
} from "lucide-react";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { thaiDateLong, bkkToday, bkkRelative, formatBaht } from "@/lib/utils/format";
import { loadReports } from "@/lib/cashhub/data";

interface BranchAssignment {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

interface RecentReport {
  id: string;
  report_date: string;
  total_sales: number | string;
  status: string;
  branch_id: string;
  submitted_at: string | null;
}

export async function StaffHome({
  userId,
  orgId,
  firstName,
}: {
  userId: string;
  orgId: string;
  firstName: string;
}) {
  const admin = adminClient();
  const today = bkkToday();

  // 1. Branches assigned to this staff
  const { data: ubData } = await admin
    .from("user_branches")
    .select("branch_id, branches(id, code, name, business_type, is_active)")
    .eq("user_id", userId)
    .eq("is_active", true);

  const branches: BranchAssignment[] = [];
  for (const ub of ubData ?? []) {
    const b = Array.isArray(ub.branches) ? ub.branches[0] : ub.branches;
    if (b && (b as { is_active: boolean }).is_active) {
      branches.push(b as BranchAssignment);
    }
  }

  // 2. Today's reports for these branches — go through canonical loader
  let todayByBranch: Record<string, "submitted" | "approved" | "rejected" | "draft" | "missing"> = {};
  if (branches.length > 0) {
    const todayReports = await loadReports(orgId, {
      dateFrom: today,
      dateTo: today,
      statuses: ["draft", "submitted", "approved", "rejected"],
      branchIds: branches.map((b) => b.id),
    });
    todayByBranch = Object.fromEntries(
      todayReports.map((r) => [
        r.branch_id,
        r.status as "submitted" | "approved" | "rejected" | "draft",
      ]),
    );
  }

  // 3. Recent submissions (last 7 days, my own submissions)
  // Server Component — Date.now() OK (single execution per request)
  // eslint-disable-next-line react-hooks/purity
  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const recents = (await loadReports(orgId, {
    dateFrom: sinceDate,
    statuses: ["draft", "submitted", "approved", "rejected"],
    submittedByIds: [userId],
    newestFirst: true,
    limit: 7,
  })) as unknown as RecentReport[];
  const branchById = Object.fromEntries(branches.map((b) => [b.id, b]));

  const filledCount = branches.filter(
    (b) => todayByBranch[b.id] && todayByBranch[b.id] !== "missing",
  ).length;
  const totalAssigned = branches.length;
  const allDone = totalAssigned > 0 && filledCount === totalAssigned;

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

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-3xl mx-auto pb-24">
        {/* Hero */}
        <header className="mb-12 sm:mb-14 animate-slide-up-soft">
          <p className="text-xs uppercase tracking-[0.18em] font-bold text-[var(--color-brand-700)]">
            <span className="brand-gradient-text">Pooilgroup</span>
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
            สวัสดี <span className="text-gradient-blue">{firstName}</span>
          </h1>
          <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-xl leading-relaxed">
            {totalAssigned === 0
              ? "ยังไม่ได้รับมอบหมายสาขา · กรุณาติดต่อ Admin"
              : allDone
                ? "🎉 วันนี้คุณกรอกครบทุกสาขาแล้ว ขอบคุณครับ"
                : `วันนี้คุณดูแล ${totalAssigned} สาขา · กรอกแล้ว ${filledCount} เหลือ ${totalAssigned - filledCount}`}
          </p>
        </header>

        {/* 01 รายงานวันนี้ */}
        {totalAssigned > 0 ? (
          <Section
            number="01"
            label="วันนี้"
            title={
              allDone
                ? "ครบแล้ว — เก่งมาก"
                : `กรอกรายงาน ${totalAssigned - filledCount} สาขา`
            }
            description="กดที่การ์ดเพื่อกรอกยอดขายของวันนี้"
            className="mb-12 animate-fade-up delay-100"
          >
            <div className="space-y-3">
              {branches.map((b) => {
                const status = todayByBranch[b.id];
                const cfg = BUSINESS_TYPES[b.business_type];
                const isDone = status && status !== "draft";
                return (
                  <Link
                    key={b.id}
                    href={`/liff/report/${b.id}`}
                    className={
                      isDone
                        ? "group flex items-center justify-between gap-4 rounded-2xl border-2 border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]/40 p-4 sm:p-5 hover:bg-[var(--color-leaf-50)] transition-all"
                        : "group flex items-center justify-between gap-4 rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5 hover:border-[var(--color-brand-400)] hover-lift-premium shadow-soft"
                    }
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div
                        className={
                          isDone
                            ? "size-12 rounded-2xl bg-[var(--color-leaf-100)] border-2 border-[var(--color-leaf-300)] text-[var(--color-leaf-700)] flex items-center justify-center text-2xl shrink-0"
                            : "size-12 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] text-[var(--color-brand-700)] flex items-center justify-center text-2xl shrink-0"
                        }
                      >
                        {cfg?.emoji ?? "📋"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg sm:text-xl font-extrabold font-display truncate">
                            {b.code}
                          </h3>
                          {isDone ? (
                            <Badge tone="success">
                              <CheckCircle2 className="size-3" />
                              {status === "approved"
                                ? "อนุมัติแล้ว"
                                : status === "rejected"
                                  ? "ถูกปฏิเสธ"
                                  : "ส่งแล้ว"}
                            </Badge>
                          ) : (
                            <Badge tone="warning">
                              <Clock className="size-3" />
                              ยังไม่กรอก
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-zinc-600 truncate mt-0.5">
                          {b.name}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {cfg?.label ?? b.business_type}
                        </p>
                      </div>
                    </div>
                    {isDone ? (
                      <span className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-leaf-700)] shrink-0">
                        ดู / แก้
                        <ArrowUpRight className="size-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-4 sm:px-5 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-bold text-sm shadow-blue group-hover:bg-[var(--color-brand-700)] transition-colors shrink-0">
                        <ClipboardCheck className="size-4" />
                        กรอกเลย
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </Section>
        ) : (
          <Section
            number="01"
            label="ยังไม่มีสาขา"
            title="รอ Admin มอบหมายสาขา"
            className="mb-12 animate-fade-up delay-100"
          >
            <EmptyState
              icon={<AlertCircle className="size-6" />}
              title="บัญชีนี้ยังไม่ได้ผูกสาขา"
              description="กรุณาติดต่อผู้ดูแลระบบให้กำหนดสาขาที่คุณดูแล"
            />
          </Section>
        )}

        {/* 02 ประวัติล่าสุด */}
        {recents.length > 0 && (
          <Section
            number="02"
            label="ประวัติ"
            title="ที่กรอกล่าสุด 7 วัน"
            description="ดูยอดที่ส่งไปแล้ว · กดเพื่อดูรายละเอียด"
            className="mb-12 animate-fade-up delay-150"
          >
            <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
              <ul className="divide-y divide-zinc-100">
                {recents.map((r) => {
                  const branch = branchById[r.branch_id];
                  const cfg = branch
                    ? BUSINESS_TYPES[branch.business_type]
                    : undefined;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/cashhub/reports/${r.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-brand-50)]/30 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-lg shrink-0">
                            {cfg?.emoji ?? "📋"}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">
                              {branch?.code ?? r.branch_id.slice(0, 6)}
                              <span className="text-zinc-400 mx-1.5">·</span>
                              {r.report_date}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {r.submitted_at
                                ? bkkRelative(r.submitted_at)
                                : "—"}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold tabular-num text-zinc-900">
                            {formatBaht(r.total_sales)}
                          </div>
                          <Badge
                            tone={
                              r.status === "approved"
                                ? "success"
                                : r.status === "rejected"
                                  ? "danger"
                                  : "warning"
                            }
                          >
                            {r.status === "approved"
                              ? "อนุมัติ"
                              : r.status === "rejected"
                                ? "ปฏิเสธ"
                                : "รอ"}
                          </Badge>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Section>
        )}

        {/* 03 ลิงก์ */}
        <Section
          number="03"
          label="ลิงก์"
          title="ทางลัด"
          className="animate-fade-up delay-200"
        >
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/liff/status"
              className="group flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border-2 border-zinc-200 bg-white hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
            >
              <span className="flex items-center gap-2.5">
                <ScrollText className="size-4 text-[var(--color-brand-600)]" />
                <span className="text-sm font-bold text-zinc-800">
                  สถานะรายงาน
                </span>
              </span>
              <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)]" />
            </Link>
            <Link
              href="/liff/history"
              className="group flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border-2 border-zinc-200 bg-white hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
            >
              <span className="flex items-center gap-2.5">
                <History className="size-4 text-[var(--color-brand-600)]" />
                <span className="text-sm font-bold text-zinc-800">
                  ประวัติย้อนหลัง
                </span>
              </span>
              <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)]" />
            </Link>
            <Link
              href="/profile"
              className="group flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border-2 border-zinc-200 bg-white hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
            >
              <span className="flex items-center gap-2.5">
                <UserCircle className="size-4 text-[var(--color-brand-600)]" />
                <span className="text-sm font-bold text-zinc-800">โปรไฟล์</span>
              </span>
              <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)]" />
            </Link>
          </div>
        </Section>
      </div>
    </div>
  );
}
