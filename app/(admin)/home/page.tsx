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
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";
import { MODULES } from "@/lib/modules";
import { startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function HomePage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const admin = adminClient();

  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";

  const todayStart = formatInTimeZone(startOfDay(new Date()), TZ, "yyyy-MM-dd'T'HH:mm:ss'+07:00'");
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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

  return (
    <div className="relative">
      {/* Soft dot-grid wash on the entire page */}
      <div
        aria-hidden
        className="absolute inset-0 bg-grid-dots opacity-[0.35] pointer-events-none"
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto pb-24">
        {/* ============================================================
            HERO — heavy Thai display + selective accents
            ============================================================ */}
        <header className="mb-12 sm:mb-16 animate-fade-up">
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] font-bold text-[--color-brand-700]">
            <span className="brand-gradient-text">Pooilgroup</span>
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.035em] font-display mt-5 text-zinc-900 max-w-4xl leading-[1.05]">
            สวัสดี <span className="accent">{firstName}</span>
            <br />
            วันนี้จะเริ่มที่<span className="marker-underline whitespace-nowrap">โปรแกรมไหน</span>?
          </h1>

          <p className="text-base sm:text-lg text-zinc-600 mt-6 max-w-2xl leading-relaxed">
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
              accentColor="blue"
            />
            <ModuleCard
              slug="fuelos"
              enabled={moduleEnabled.fuelos}
              landingPath="/fuelos"
              accentColor="leaf"
            />
            <ModuleCard
              slug="docuflow"
              enabled={moduleEnabled.docuflow}
              landingPath="/docuflow"
              accentColor="amber"
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
                    accent="warning"
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
   ============================================================ */
function ModuleCard({
  slug,
  enabled,
  landingPath,
  accentColor,
}: {
  slug: keyof typeof MODULES;
  enabled: boolean;
  landingPath: string;
  accentColor: "blue" | "leaf" | "amber";
}) {
  const m = MODULES[slug];
  const isActive = enabled && m.status === "active";
  const isComingSoon = m.status === "coming_soon" || !enabled;

  const accentBg = {
    blue: "bg-[--color-brand-50] border-[--color-brand-200] text-[--color-brand-700]",
    leaf: "bg-[--color-leaf-50] border-[--color-leaf-200] text-[--color-leaf-700]",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
  }[accentColor];

  const cardBase =
    "relative group rounded-3xl border-2 bg-white p-6 sm:p-7 transition-all overflow-hidden";

  const cardActive =
    "border-zinc-200 hover:border-[--color-brand-400] hover-lift cursor-pointer shadow-soft";

  const cardDisabled = "border-zinc-200 opacity-75";

  const inner = (
    <>
      {/* Decorative blur in corner — auditmekub vibe */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-44 rounded-full blur-3xl opacity-25 pointer-events-none"
        style={{
          background:
            accentColor === "blue"
              ? "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)"
              : accentColor === "leaf"
                ? "radial-gradient(circle, oklch(0.55 0.20 148) 0%, transparent 70%)"
                : "radial-gradient(circle, oklch(0.78 0.16 75) 0%, transparent 70%)",
        }}
      />

      <div className="relative">
        {/* Top row: icon badge + status */}
        <div className="flex items-start justify-between mb-5">
          <div
            className={`size-14 rounded-2xl border-2 flex items-center justify-center text-2xl ${accentBg}`}
          >
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
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5 hover:border-[--color-brand-300] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">
          {label}
        </p>
        <span className="text-[--color-brand-600]">{icon}</span>
      </div>
      <p className="font-num-mega text-3xl sm:text-4xl text-zinc-900">
        {value.toLocaleString("th-TH")}
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
