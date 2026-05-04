import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ClipboardCheck,
  Sparkles,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  Bell,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Section, SectionDivider } from "@/components/ui/section";
import { StatBlock } from "@/components/ui/stat-block";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBaht, thaiDateLong } from "@/lib/utils/format";
import { MODULE_LIST } from "@/lib/modules";
import { startOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function HomePage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const admin = adminClient();

  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(
    startOfMonth(new Date()),
    TZ,
    "yyyy-MM-dd",
  );

  const isAdmin =
    session.user.role === "super_admin" ||
    session.user.role === "org_admin";

  // Cross-module summary — for now only CashHub has data
  const [
    cashhubMonthQ,
    branchesQ,
    todayQ,
    pendingQ,
    pendingRequestsQ,
    recentReportsQ,
  ] = await Promise.all([
    admin
      .from("daily_reports")
      .select("total_sales, status")
      .eq("org_id", orgId)
      .gte("report_date", monthStart)
      .lte("report_date", today),
    admin
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_active", true),
    admin
      .from("daily_reports")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("report_date", today),
    admin
      .from("daily_reports")
      .select(
        "id, report_date, total_sales, branch:branch_id(code, name)",
      )
      .eq("org_id", orgId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(5),
    admin
      .from("register_requests")
      .select(
        "id, name, phone, requested_role, created_at",
        { count: "exact" },
      )
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("daily_reports")
      .select(
        "id, status, report_date, branch:branch_id(code, name)",
      )
      .eq("org_id", orgId)
      .order("submitted_at", { ascending: false })
      .limit(5),
  ]);

  const monthApproved = (cashhubMonthQ.data ?? [])
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);

  const branchCount = branchesQ.count ?? 0;
  const todaySubmitted = todayQ.count ?? 0;
  const pendingCount = pendingQ.data?.length ?? 0;
  const pendingReports = pendingQ.data ?? [];
  const pendingRequests = pendingRequestsQ.data ?? [];
  const pendingRequestCount = pendingRequestsQ.count ?? 0;
  const recentReports = recentReportsQ.data ?? [];

  // Total action items (for the action center heading)
  const actionCount = isAdmin
    ? pendingCount + pendingRequestCount
    : pendingCount;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto bg-grid-dots/30">
      {/* Hero greeting */}
      <header className="mb-10 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
          Pooilgroup · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-display mt-3 text-zinc-900 max-w-3xl">
          สวัสดี <span className="accent">{session.user.name.split(" ")[0]}</span>{" "}
          <span className="text-zinc-700">·</span> เลือกโปรแกรมที่ต้องการใช้
        </h1>
        <p className="text-base text-zinc-600 mt-3 max-w-2xl">
          ระบบ ERP สำหรับ Pooilgroup · {branchCount} สาขา · 5 บริษัท · รวมทุกโปรแกรมในที่เดียว
        </p>
      </header>

      {/* My Action Center — what you need to do RIGHT NOW */}
      <Section
        number="01"
        label="MY ACTIONS"
        title={
          actionCount > 0
            ? `มี ${actionCount} เรื่องรอคุณ`
            : "เคลียร์หมดแล้ว"
        }
        description="ทำของในนี้ก่อน · กดเพื่อข้ามไปจัดการทันที"
        className="animate-fade-up delay-50"
      >
        {actionCount === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="ไม่มีอะไรค้าง"
            description="ทุกอย่างเรียบร้อย — ไปดูภาพรวมข้างล่างหรือเข้าโปรแกรมได้เลย"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Pending CashHub reports */}
            {pendingCount > 0 && (
              <Link
                href="/cashhub/reports?status=submitted"
                className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4 hover:bg-amber-50 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <ClipboardCheck className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-amber-900">
                      รายงาน CashHub รออนุมัติ
                    </p>
                    <p className="text-2xl font-extrabold text-amber-900 tabular-num mt-0.5">
                      {pendingCount}{" "}
                      <span className="text-sm font-medium">รายการ</span>
                    </p>
                    {pendingReports.slice(0, 3).map((r) => {
                      const branch = Array.isArray(r.branch)
                        ? r.branch[0]
                        : r.branch;
                      return (
                        <div
                          key={r.id}
                          className="text-xs text-amber-800/80 mt-0.5 truncate"
                        >
                          • {branch?.code} {branch?.name} · {r.report_date}
                        </div>
                      );
                    })}
                    {pendingCount > 3 && (
                      <div className="text-xs text-amber-700/70 mt-0.5">
                        + อีก {pendingCount - 3} รายการ
                      </div>
                    )}
                  </div>
                  <ArrowRight className="size-4 text-amber-600 mt-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            )}

            {/* Pending register requests (admin only) */}
            {isAdmin && pendingRequestCount > 0 && (
              <Link
                href="/users/requests"
                className="rounded-2xl border-2 border-blue-200 bg-blue-50/60 p-4 hover:bg-blue-50 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Inbox className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-blue-900">
                      คำขอเข้าใช้งานใหม่
                    </p>
                    <p className="text-2xl font-extrabold text-blue-900 tabular-num mt-0.5">
                      {pendingRequestCount}{" "}
                      <span className="text-sm font-medium">คน</span>
                    </p>
                    {pendingRequests.slice(0, 3).map((r) => (
                      <div
                        key={r.id}
                        className="text-xs text-blue-800/80 mt-0.5 truncate"
                      >
                        • {r.name} · {r.phone} ({r.requested_role})
                      </div>
                    ))}
                  </div>
                  <ArrowRight className="size-4 text-blue-600 mt-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            )}
          </div>
        )}
      </Section>

      <SectionDivider />

      {/* Cross-module quick stats */}
      <Section
        number="02"
        label="OVERVIEW"
        title="ภาพรวมวันนี้"
        description="สรุปสถานะระบบในมุมเดียว"
        className="animate-fade-up delay-100"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatBlock
            size="lg"
            label="ยอดเดือนนี้"
            value={formatBaht(monthApproved)}
            helper="อนุมัติแล้ว"
            icon={<Sparkles className="size-5" />}
          />
          <StatBlock
            size="lg"
            label="สาขาทั้งหมด"
            value={branchCount.toLocaleString("th-TH")}
            unit="สาขา"
            icon={<Building2 className="size-5" />}
          />
          <StatBlock
            size="lg"
            label="ส่งวันนี้"
            value={todaySubmitted.toLocaleString("th-TH")}
            helper={`จาก ${branchCount} สาขา`}
            icon={<ClipboardCheck className="size-5" />}
          />
          <StatBlock
            size="lg"
            label="รออนุมัติ"
            value={pendingCount.toLocaleString("th-TH")}
            helper={pendingCount > 0 ? "ต้องดำเนินการ" : "เคลียร์หมดแล้ว"}
          />
        </div>
      </Section>

      <SectionDivider />

      {/* Module launcher */}
      <Section
        number="03"
        label="PROGRAMS"
        title="3 โปรแกรมหลัก"
        description="คลิกเพื่อเข้าสู่โปรแกรมที่ต้องการ — ระบบและบัญชีใช้ร่วมกัน"
        className="animate-fade-up delay-150"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {MODULE_LIST.map((m, idx) => {
            const isActive = m.status === "active";
            const isComingSoon = m.status === "coming_soon";
            return (
              <Card
                key={m.slug}
                className={`relative overflow-hidden ${
                  isActive
                    ? "hover:border-[--color-brand-500] hover-lift"
                    : "opacity-90"
                }`}
                style={{ animationDelay: `${(idx + 1) * 80}ms` }}
              >
                {/* Decorative corner accent */}
                <div
                  className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-15 blur-2xl"
                  style={{
                    background:
                      "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
                  }}
                />
                <CardBody className="relative">
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="size-12 rounded-2xl bg-[--color-brand-600] text-white flex items-center justify-center text-2xl shadow-blue">
                      {m.emoji}
                    </div>
                    {isActive ? (
                      <Badge tone="success">
                        <span className="size-1.5 rounded-full bg-green-600 animate-pulse-soft inline-block" />
                        ใช้งาน
                      </Badge>
                    ) : (
                      <Badge tone="neutral">เร็ว ๆ นี้</Badge>
                    )}
                  </div>

                  <h3 className="text-xl font-extrabold tracking-tight font-display text-zinc-900">
                    {m.name}
                  </h3>
                  <p className="text-sm font-medium text-[--color-brand-700] mt-0.5">
                    {m.tagline}
                  </p>
                  <p className="text-sm text-zinc-600 mt-3 leading-relaxed min-h-[60px]">
                    {m.description}
                  </p>

                  <div className="mt-5 pt-5 border-t border-zinc-100">
                    {isActive ? (
                      <Link
                        href={m.basePath + "/dashboard"}
                        className="inline-flex items-center gap-1.5 font-semibold text-[--color-brand-700] hover:text-[--color-brand-800] group"
                      >
                        เข้าโปรแกรม
                        <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-zinc-400 font-medium">
                        ยังไม่เปิดใช้งาน
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </Section>

      <SectionDivider />

      {/* Quick links */}
      <Section
        number="03"
        label="QUICK LINKS"
        title="ทางลัด"
        description="เข้าถึงเครื่องมือที่ใช้บ่อย"
        className="animate-fade-up delay-200"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickLink href="/users" label="ผู้ใช้งาน" />
          <QuickLink href="/audit" label="Audit Log" />
          <QuickLink href="/settings" label="ตั้งค่า" />
          <QuickLink href="/profile" label="โปรไฟล์" />
        </div>
      </Section>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl border-2 border-zinc-200 bg-white hover:border-[--color-brand-300] hover:bg-[--color-brand-50]/30 transition-all hover-lift"
    >
      <span className="text-sm font-semibold text-zinc-800">{label}</span>
      <ArrowRight className="size-4 text-zinc-400" />
    </Link>
  );
}
