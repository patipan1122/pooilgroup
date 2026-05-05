// /home — Core entry point for Pooilgroup
// Pure Core: greeting · module launcher · admin actions · system health
// NO module-specific data here (CashHub stuff lives at /cashhub/dashboard)
//
// Design language: auditmekub.com (heavy Thai display, deep royal blue,
// marker-underline keywords, floating cards on dot-grid)

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Users as UsersIcon,
  Building2,
  Inbox,
  ShieldAlert,
  ShieldCheck,
  Settings,
  ScrollText,
  Lock,
  ChevronRight,
  HardDrive,
  Activity,
  KeyRound,
  Phone,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong, bkkToday } from "@/lib/utils/format";
import { MODULES } from "@/lib/modules";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { ExecutiveTable } from "@/components/cashhub/executive-table";
import { loadExecutiveMatrix } from "@/lib/cashhub/executive-matrix";
import { startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function HomePage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const admin = adminClient();

  // ============================================================
  // ROLE-BASED ROUTING — driver redirected to /driver
  // (other roles see /home but with role-tailored content below)
  // ============================================================
  if (session.user.role === "driver") {
    redirect("/driver");
  }

  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";
  const isManager =
    session.user.role === "branch_manager" ||
    session.user.role === "area_manager" ||
    isAdmin;

  const todayStart = formatInTimeZone(startOfDay(new Date()), TZ, "yyyy-MM-dd'T'HH:mm:ss'+07:00'");
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Evening check window: 18:00-22:00 Bangkok time
  const bkkHour = parseInt(formatInTimeZone(new Date(), TZ, "H"), 10);
  const isEveningCheckTime = bkkHour >= 17 && bkkHour <= 22;
  const today = bkkToday();

  // Core data only — no CashHub, no FuelOS, no DocuFlow
  const [
    userCountQ,
    branchCountQ,
    pendingRequestsQ,
    pendingRequestsListQ,
    todayLoginsQ,
    failedLoginsQ,
    pendingInvitesQ,
    moduleStatusQ,
  ] = await Promise.all([
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_active", true),
    admin
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_active", true),
    admin
      .from("register_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
    admin
      .from("register_requests")
      .select("id, name, phone, requested_role, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("action", "LOGIN")
      .gte("created_at", todayStart),
    admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("action", "FAILED_LOGIN")
      .gte("created_at", since24h),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_active", false)
      .not("invite_token", "is", null)
      .is("invite_used_at", null),
    admin
      .from("org_modules")
      .select("module_name, is_active")
      .eq("org_id", orgId),
  ]);

  // Executive matrix — only for managers/admins (not staff/viewer)
  const executiveMatrix = isManager
    ? await loadExecutiveMatrix(orgId, { period: "monthly", count: 12 })
    : null;

  const userCount = userCountQ.count ?? 0;
  const branchCount = branchCountQ.count ?? 0;
  const pendingRequests = pendingRequestsQ.count ?? 0;
  const pendingRequestsList = pendingRequestsListQ.data ?? [];
  const todayLogins = todayLoginsQ.count ?? 0;
  const failedLogins = failedLoginsQ.count ?? 0;
  const pendingInvites = pendingInvitesQ.count ?? 0;

  const moduleEnabled: Record<string, boolean> = {
    cashhub: true,
    fuelos: true,
    docuflow: true,
    ...Object.fromEntries(
      (moduleStatusQ.data ?? []).map((m) => [m.module_name, m.is_active]),
    ),
  };

  const firstName = session.user.name.split(" ")[0];

  const adminActionTotal = pendingRequests + failedLogins + pendingInvites;

  // ============================================================
  // Evening Check — find branches that haven't filled today's daily report
  // Only run when it's the evening window (saves DB calls during morning)
  // ============================================================
  let eveningCheck: {
    totalActive: number;
    filledCount: number;
    missingBranches: Array<{
      id: string;
      code: string;
      name: string;
      business_type: string;
      phone: string | null;
      manager_name: string | null;
      manager_phone: string | null;
    }>;
  } | null = null;

  if (isAdmin && isEveningCheckTime) {
    // Only consider business types with daily cadence + cash report enabled
    const dailyTypes = Object.values(BUSINESS_TYPES)
      .filter((b) => b.reportingCadence === "daily" && b.hasCashReport)
      .map((b) => b.type);

    const [activeBranchesQ, todayReportsQ] = await Promise.all([
      admin
        .from("branches")
        .select("id, code, name, business_type, phone, manager:manager_id(name, phone)")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .in("business_type", dailyTypes),
      admin
        .from("daily_reports")
        .select("branch_id")
        .eq("org_id", orgId)
        .eq("report_date", today),
    ]);

    const activeList = (activeBranchesQ.data ?? []) as Array<{
      id: string;
      code: string;
      name: string;
      business_type: string;
      phone: string | null;
      manager: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null;
    }>;
    const filledIds = new Set(
      (todayReportsQ.data ?? []).map((r) => r.branch_id),
    );
    const missing = activeList
      .filter((b) => !filledIds.has(b.id))
      .map((b) => {
        const m = Array.isArray(b.manager) ? b.manager[0] : b.manager;
        return {
          id: b.id,
          code: b.code,
          name: b.name,
          business_type: b.business_type,
          phone: b.phone,
          manager_name: m?.name ?? null,
          manager_phone: m?.phone ?? null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    eveningCheck = {
      totalActive: activeList.length,
      filledCount: activeList.length - missing.length,
      missingBranches: missing,
    };
  }

  return (
    <div className="relative">
      {/* Soft dot-grid wash on the entire page */}
      <div
        aria-hidden
        className="absolute inset-0 bg-grid-dots opacity-[0.35] pointer-events-none"
      />

      {/* Drifting blue blobs ใน hero — premium auditme vibe */}
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-40 -right-20 size-80 rounded-full blur-3xl opacity-10 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.55 0.20 148) 0%, transparent 70%)",
          animationDelay: "4s",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto pb-24">
        {/* ============================================================
            HERO — heavy Thai display + blue gradient + slide-up reveal
            ============================================================ */}
        <header className="mb-14 sm:mb-20 animate-slide-up-soft">
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] font-bold text-[--color-brand-700]">
            <span className="brand-gradient-text">Pooilgroup</span>
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>

          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-[-0.04em] font-display mt-6 text-zinc-900 max-w-5xl leading-[0.95]">
            สวัสดี{" "}
            <span className="text-gradient-blue-vivid">{firstName}</span>
            <br />
            วันนี้จะเริ่มที่
            <span className="text-gradient-blue whitespace-nowrap">
              โปรแกรมไหน
            </span>
            ?
          </h1>

          <p className="text-base sm:text-lg lg:text-xl text-zinc-600 mt-7 max-w-2xl leading-relaxed">
            ศูนย์รวมทุกระบบของ Pooilgroup —{" "}
            <strong className="font-bold text-zinc-900">2 บริษัท</strong>
            <span className="text-zinc-400 mx-1.5">·</span>
            <strong className="font-bold text-zinc-900 tabular-num">
              {branchCount}
            </strong>{" "}
            สาขา
            <span className="text-zinc-400 mx-1.5">·</span>
            <strong className="font-bold text-zinc-900 tabular-num">
              {userCount}
            </strong>{" "}
            ผู้ใช้งาน
          </p>
        </header>

        {/* ============================================================
            00 EXECUTIVE OVERVIEW — สรุปยอดทั้งหมด · เห็นทันทีที่เข้า
            (เฉพาะ Manager ขึ้นไป — Staff/Viewer ไม่เห็นตารางใหญ่)
            ============================================================ */}
        {executiveMatrix && (
          <Section
            number="00"
            label="EXECUTIVE OVERVIEW"
            title="ยอดขาย ทุกประเภทธุรกิจ"
            description="เห็นภาพรวม Pooilgroup ที่นี่ทันที · กดแถวขยายดูสาขา · กดที่ตารางใหญ่ใน CashHub สำหรับฟีเจอร์เต็ม"
            className="mb-14 animate-fade-up"
            action={
              <a
                href="/cashhub/dashboard"
                className="text-sm font-bold text-[--color-brand-700] hover:text-[--color-brand-800] inline-flex items-center gap-1"
              >
                เปิด CashHub →
              </a>
            }
          >
            <ExecutiveTable data={executiveMatrix} />
          </Section>
        )}

        {/* ============================================================
            EVENING CHECK — only shown 17:00-22:00 BKK for admins
            ============================================================ */}
        {eveningCheck && (
          <Section
            label="EVENING CHECK · เช็คตอนเย็น"
            title={
              eveningCheck.missingBranches.length === 0
                ? "วันนี้ทุกสาขากรอกครบแล้ว 🎉"
                : `เหลือ ${eveningCheck.missingBranches.length} สาขายังไม่กรอก`
            }
            description={`ขณะนี้ ${formatInTimeZone(new Date(), TZ, "HH:mm")} น. — เช็คก่อน deadline 21:00 น.`}
            className="mb-14 animate-fade-up delay-50"
          >
            <EveningCheckCard
              totalActive={eveningCheck.totalActive}
              filledCount={eveningCheck.filledCount}
              missingBranches={eveningCheck.missingBranches}
            />
          </Section>
        )}

        {/* ============================================================
            01 PROGRAMS — module launcher (the centerpiece)
            ============================================================ */}
        <Section
          number="01"
          label="PROGRAMS"
          title="โปรแกรมที่ใช้งาน"
          description="คลิกการ์ดเพื่อเข้าโปรแกรม — ทุกโปรแกรมใช้บัญชีเดียวกัน"
          className="mb-14 animate-fade-up delay-100"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <ModuleCard
              slug="cashhub"
              enabled={moduleEnabled.cashhub}
              landingPath="/cashhub/dashboard"
            />
            <ModuleCard
              slug="fuelos"
              enabled={moduleEnabled.fuelos}
              landingPath="/fuelos"
            />
            <ModuleCard
              slug="docuflow"
              enabled={moduleEnabled.docuflow}
              landingPath="/docuflow"
            />
          </div>
        </Section>

        {/* ============================================================
            02 ADMIN — pure Core actions only (no CashHub)
            Only show if user is admin
            ============================================================ */}
        {isAdmin && (
          <Section
            number="02"
            label="ADMIN"
            title={
              adminActionTotal > 0
                ? `มี ${adminActionTotal} เรื่อง รอคุณดูแล`
                : "ระบบเรียบร้อย ไม่มีอะไรค้าง"
            }
            description="งานของผู้ดูแลระบบ — รับคนใหม่ · จัดการสิทธิ์ · ดูแลความปลอดภัย"
            className="mb-14 animate-fade-up delay-150"
          >
            {adminActionTotal === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-10 text-center">
                <div className="size-14 mx-auto mb-3 rounded-2xl bg-[--color-leaf-50] border-2 border-[--color-leaf-200] flex items-center justify-center text-[--color-leaf-700]">
                  <ShieldCheck className="size-6" />
                </div>
                <p className="font-bold text-zinc-900">ไม่มีอะไรค้างที่ Core</p>
                <p className="text-sm text-zinc-500 mt-1.5">
                  ผู้ใช้และความปลอดภัยอยู่ในสถานะปกติ
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingRequests > 0 && (
                  <ActionCard
                    href="/users/requests"
                    icon={<Inbox className="size-5" />}
                    accent="brand"
                    label="คำขอเข้าใช้งาน"
                    bigNumber={pendingRequests}
                    unit="คน"
                    bullets={pendingRequestsList.map(
                      (r) =>
                        `${r.name} · ${r.phone} (${r.requested_role})`,
                    )}
                  />
                )}
                {pendingInvites > 0 && (
                  <ActionCard
                    href="/users"
                    icon={<KeyRound className="size-5" />}
                    accent="brand"
                    label="ผู้ใช้ที่ยังไม่ activate"
                    bigNumber={pendingInvites}
                    unit="คน"
                    helper="ส่ง invite link ไปแล้วแต่ยังไม่กดยืนยัน · ส่งลิงก์ใหม่ได้ที่หน้า user"
                  />
                )}
                {failedLogins > 0 && (
                  <ActionCard
                    href="/audit?action=FAILED_LOGIN&range=today"
                    icon={<ShieldAlert className="size-5" />}
                    accent="danger"
                    label="Login น่าสงสัย"
                    bigNumber={failedLogins}
                    unit="ครั้ง / 24 ชม."
                    helper="ใส่รหัสผิดเกิน — ตรวจดูว่าใช่ใครจริง ๆ หรือเปล่า"
                  />
                )}
              </div>
            )}
          </Section>
        )}

        {/* ============================================================
            03 SYSTEM — health snapshot (no module data)
            ============================================================ */}
        <Section
          number="03"
          label="SYSTEM"
          title="ภาพรวมระบบ"
          description="ตัวเลขจริงของ Pooilgroup ณ ตอนนี้"
          className="mb-14 animate-fade-up delay-200"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <SystemStat
              icon={<UsersIcon className="size-5" />}
              label="ผู้ใช้งาน"
              value={userCount}
              unit="คน"
            />
            <SystemStat
              icon={<Building2 className="size-5" />}
              label="สาขา"
              value={branchCount}
              unit="สาขา"
            />
            <SystemStat
              icon={<Activity className="size-5" />}
              label="Login วันนี้"
              value={todayLogins}
              unit="ครั้ง"
            />
            <SystemStat
              icon={<HardDrive className="size-5" />}
              label="โปรแกรมเปิดอยู่"
              value={
                Object.values(moduleEnabled).filter(Boolean).length
              }
              unit={`/ ${Object.keys(moduleEnabled).length}`}
            />
          </div>
        </Section>

        {/* ============================================================
            04 QUICK ACCESS — admin shortcuts
            ============================================================ */}
        {isAdmin && (
          <Section
            number="04"
            label="QUICK ACCESS"
            title="ทางลัด"
            description="เครื่องมือที่ใช้บ่อย"
            className="animate-fade-up delay-250"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <QuickLink
                href="/users"
                icon={<UsersIcon className="size-4" />}
                label="ผู้ใช้งาน"
              />
              <QuickLink
                href="/branches"
                icon={<Building2 className="size-4" />}
                label="สาขา"
              />
              <QuickLink
                href="/audit"
                icon={<ScrollText className="size-4" />}
                label="Audit Log"
              />
              <QuickLink
                href="/settings"
                icon={<Settings className="size-4" />}
                label="ตั้งค่า"
              />
            </div>
          </Section>
        )}

        {/* Footer credit — subtle */}
        <p className="mt-16 text-center text-[11px] text-zinc-400">
          Pooilgroup ERP · ระบบรวมศูนย์ทุกโปรแกรมในที่เดียว
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   ModuleCard — premium floating card per program
   ทุก module ใช้สีฟ้าเหมือนกัน (DESIGN_SYSTEM §2)
   แยกความต่างด้วย emoji/icon ไม่ใช่สี
   ============================================================ */
function ModuleCard({
  slug,
  enabled,
  landingPath,
}: {
  slug: keyof typeof MODULES;
  enabled: boolean;
  landingPath: string;
}) {
  const m = MODULES[slug];
  const isActive = enabled && m.status === "active";
  const isComingSoon = m.status === "coming_soon" || !enabled;

  const cardBase =
    "relative group rounded-3xl border-2 bg-white p-6 sm:p-7 transition-all overflow-hidden";

  const cardActive =
    "border-zinc-200 hover:border-[--color-brand-400] hover-lift-premium cursor-pointer shadow-soft";

  const cardDisabled = "border-zinc-200 opacity-60";

  const inner = (
    <>
      {/* Decorative blue blur in corner — auditmekub vibe */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-44 rounded-full blur-3xl opacity-25 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative">
        {/* Top row: icon badge + status — ใช้ฟ้าเหมือนกันทุก module */}
        <div className="flex items-start justify-between mb-5">
          <div className="size-14 rounded-2xl border-2 bg-[--color-brand-50] border-[--color-brand-200] text-[--color-brand-700] flex items-center justify-center text-2xl">
            {m.emoji}
          </div>
          {isActive ? (
            <Badge tone="success">
              <span className="size-1.5 rounded-full bg-[--color-leaf-600] animate-pulse-soft inline-block" />
              ใช้งานอยู่
            </Badge>
          ) : (
            <Badge tone="neutral">
              <Lock className="size-3" />
              เร็ว ๆ นี้
            </Badge>
          )}
        </div>

        {/* Module name + tagline */}
        <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-zinc-900">
          {m.name}
        </h3>
        <p className="text-sm font-semibold text-[--color-brand-700] mt-1">
          {m.tagline}
        </p>

        {/* Description */}
        <p className="text-sm text-zinc-600 mt-4 leading-relaxed min-h-[60px]">
          {m.description}
        </p>

        {/* CTA */}
        <div className="mt-6 pt-5 border-t border-zinc-100 flex items-center justify-between">
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 font-bold text-[--color-brand-700] group-hover:text-[--color-brand-800]">
              เข้าโปรแกรม
              <ArrowUpRight className="size-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </span>
          ) : (
            <span className="text-sm text-zinc-400 font-medium">
              {isComingSoon ? "ยังไม่เปิดใช้งาน" : "ปิดใช้งานชั่วคราว"}
            </span>
          )}
        </div>
      </div>
    </>
  );

  if (isActive) {
    return (
      <Link href={landingPath} className={`${cardBase} ${cardActive}`}>
        {inner}
      </Link>
    );
  }
  return <div className={`${cardBase} ${cardDisabled}`}>{inner}</div>;
}

/* ============================================================
   ActionCard — Core admin todo card
   ============================================================ */
function ActionCard({
  href,
  icon,
  accent,
  label,
  bigNumber,
  unit,
  bullets,
  helper,
}: {
  href: string;
  icon: React.ReactNode;
  accent: "brand" | "warning" | "danger";
  label: string;
  bigNumber: number;
  unit?: string;
  bullets?: string[];
  helper?: string;
}) {
  const palette = {
    brand: {
      bg: "bg-[--color-brand-50]/60 hover:bg-[--color-brand-50]",
      border: "border-[--color-brand-200]",
      iconBg: "bg-[--color-brand-100] text-[--color-brand-700]",
      text: "text-[--color-brand-900]",
      arrow: "text-[--color-brand-600]",
    },
    warning: {
      bg: "bg-amber-50/60 hover:bg-amber-50",
      border: "border-amber-200",
      iconBg: "bg-amber-100 text-amber-700",
      text: "text-amber-900",
      arrow: "text-amber-600",
    },
    danger: {
      bg: "bg-red-50/60 hover:bg-red-50",
      border: "border-red-200",
      iconBg: "bg-red-100 text-red-700",
      text: "text-red-900",
      arrow: "text-red-600",
    },
  }[accent];

  return (
    <Link
      href={href}
      className={`group rounded-2xl border-2 p-5 transition-colors ${palette.bg} ${palette.border}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${palette.iconBg}`}
        >
          {icon}
        </div>
        <ChevronRight
          className={`size-5 ${palette.arrow} mt-1 group-hover:translate-x-0.5 transition-transform`}
        />
      </div>
      <p className={`font-bold ${palette.text}`}>{label}</p>
      <p className={`font-num-mega ${palette.text} text-3xl mt-1`}>
        {bigNumber}
        {unit && (
          <span className="text-sm font-medium opacity-70 ml-1.5">{unit}</span>
        )}
      </p>
      {helper && (
        <p className={`text-xs mt-2 opacity-80 ${palette.text}`}>{helper}</p>
      )}
      {bullets && bullets.length > 0 && (
        <ul className={`text-xs mt-2 space-y-0.5 opacity-80 ${palette.text}`}>
          {bullets.slice(0, 3).map((b, i) => (
            <li key={i} className="truncate">
              · {b}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

/* ============================================================
   SystemStat — clean numeric tile
   ============================================================ */
function SystemStat({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5 hover:border-[--color-brand-400] hover-lift-premium">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
          {label}
        </p>
        <span className="text-[--color-brand-600]">{icon}</span>
      </div>
      <p className="font-num-mega text-4xl sm:text-5xl">
        <span className="text-gradient-blue-vivid">
          {value.toLocaleString("th-TH")}
        </span>
        {unit && (
          <span className="text-sm text-zinc-400 font-medium ml-1.5">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

/* ============================================================
   EveningCheckCard — Owner's evening checkpoint
   Shows fill rate + branches that haven't filled with one-tap call
   ============================================================ */
function EveningCheckCard({
  totalActive,
  filledCount,
  missingBranches,
}: {
  totalActive: number;
  filledCount: number;
  missingBranches: Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
    phone: string | null;
    manager_name: string | null;
    manager_phone: string | null;
  }>;
}) {
  const allFilled = missingBranches.length === 0;
  const fillPct = totalActive > 0 ? Math.round((filledCount / totalActive) * 100) : 100;

  if (allFilled) {
    return (
      <div className="rounded-3xl border-2 border-[--color-leaf-300] bg-gradient-to-br from-[--color-leaf-50] to-white p-6 sm:p-8 shadow-leaf overflow-hidden relative">
        <div
          aria-hidden
          className="absolute -top-12 -right-12 size-44 rounded-full blur-3xl opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, oklch(0.55 0.20 148) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex items-center gap-5">
          <div className="size-16 rounded-2xl bg-[--color-leaf-100] border-2 border-[--color-leaf-200] flex items-center justify-center text-[--color-leaf-700] shrink-0">
            <CheckCircle2 className="size-8" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-[--color-leaf-700]">
              งานวันนี้
            </p>
            <p className="font-num-mega text-4xl sm:text-5xl text-[--color-leaf-700] leading-none mt-1">
              {filledCount}/{totalActive}
            </p>
            <p className="text-sm text-zinc-700 mt-2">
              ทุกสาขาส่งรายงานแล้ว · พักได้ 🌙
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hero status */}
      <div className="rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-6 sm:p-8 overflow-hidden relative">
        <div
          aria-hidden
          className="absolute -top-12 -right-12 size-44 rounded-full blur-3xl opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, oklch(0.78 0.16 75) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex items-start gap-5 flex-wrap">
          <div className="size-16 rounded-2xl bg-amber-100 border-2 border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <AlertTriangle className="size-8" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-amber-700">
              วันนี้ยังกรอกไม่ครบ
            </p>
            <p className="font-num-mega text-5xl sm:text-6xl text-zinc-900 leading-none mt-1">
              {filledCount}
              <span className="text-3xl text-zinc-400">/{totalActive}</span>
            </p>
            <p className="text-sm text-zinc-700 mt-2">
              ครบ <strong className="tabular-num text-[--color-leaf-700]">{fillPct}%</strong>
              <span className="text-zinc-400 mx-1.5">·</span>
              เหลือ <strong className="tabular-num text-amber-700">{missingBranches.length}</strong> สาขาต้องตามอีก
            </p>
          </div>
          {/* Progress ring */}
          <div className="relative size-20 shrink-0">
            <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15.915"
                fill="none"
                stroke="oklch(0.92 0.04 75)"
                strokeWidth="3.5"
              />
              <circle
                cx="18"
                cy="18"
                r="15.915"
                fill="none"
                stroke="oklch(0.60 0.18 148)"
                strokeWidth="3.5"
                strokeDasharray={`${fillPct}, 100`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-num-mega text-lg text-zinc-900 tabular-num">
                {fillPct}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Missing branches list */}
      <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b-2 border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-zinc-700">
            สาขาที่ยังไม่กรอก
          </p>
          <span className="text-xs text-zinc-500 inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            deadline 21:00 น.
          </span>
        </div>
        <div className="divide-y divide-zinc-100">
          {missingBranches.slice(0, 8).map((b) => {
            const cfg = BUSINESS_TYPES[b.business_type];
            return (
              <div
                key={b.id}
                className="px-5 py-3 flex items-center gap-3 flex-wrap hover:bg-zinc-50/50"
              >
                <span className="text-2xl shrink-0">{cfg?.emoji ?? "📋"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold tabular-num font-display text-sm">
                      {b.code}
                    </span>
                    <span className="text-sm text-zinc-700 truncate">
                      {b.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {b.manager_name ? (
                      <>
                        ผจก. {b.manager_name}
                        {b.manager_phone && (
                          <span className="text-zinc-400 ml-1.5">
                            · {b.manager_phone}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-700">ยังไม่มีผู้จัดการ</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {b.manager_phone && (
                    <a
                      href={`tel:${b.manager_phone}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[--color-leaf-50] border border-[--color-leaf-200] text-[--color-leaf-700] text-xs font-bold hover:bg-[--color-leaf-100]"
                    >
                      <Phone className="size-3.5" />
                      โทร
                    </a>
                  )}
                  <Link
                    href={`/branches/${b.id}`}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg border-2 border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                  >
                    ดู
                  </Link>
                </div>
              </div>
            );
          })}
          {missingBranches.length > 8 && (
            <Link
              href="/cashhub/dashboard"
              className="block px-5 py-3 text-center text-sm font-bold text-[--color-brand-700] hover:bg-[--color-brand-50]"
            >
              ดูทั้งหมด {missingBranches.length} สาขา →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   QuickLink — tool shortcut button
   ============================================================ */
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
      className="group flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border-2 border-zinc-200 bg-white hover:border-[--color-brand-400] hover:bg-[--color-brand-50]/30 transition-all hover-lift"
    >
      <span className="flex items-center gap-2.5">
        <span className="text-[--color-brand-600]">{icon}</span>
        <span className="text-sm font-bold text-zinc-800">{label}</span>
      </span>
      <ArrowRight className="size-4 text-zinc-400 group-hover:text-[--color-brand-600] group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}
