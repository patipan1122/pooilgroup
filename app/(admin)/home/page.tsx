// /home — Core entry point for Pooilgroup
// PURE CORE ONLY: greeting · module launcher · admin actions · system health
// HARD RULE: ห้ามมี module-specific data/UI ในหน้านี้เด็ดขาด
//   - ยอด/รายงาน/ตาราง CashHub → /cashhub/dashboard
//   - Price/order/CRM ของ FuelOS → /fuelos
//   - เอกสาร DocuFlow → /docuflow
// อ่าน feedback_module_isolation.md ก่อนแก้ไฟล์นี้

import Link from "next/link";
import {
  ArrowUpRight,
  Users as UsersIcon,
  Building2,
  Inbox,
  ShieldAlert,
  ShieldCheck,
  Lock,
  ChevronRight,
  HardDrive,
  Activity,
  KeyRound,
} from "lucide-react";
import { redirect } from "next/navigation";
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

  // ============================================================
  // ROLE-BASED ROUTING — non-admin roles ไป workspace ของโมดูลโดยตรง
  // /home = Core ล้วน (org-level) เท่านั้น · ห้ามมี module data
  // ============================================================
  if (session.user.role === "driver") {
    redirect("/driver");
  }

  if (session.user.role === "staff") {
    // Persona-aware default: if this staff is registered as a repair technician,
    // send them straight to their job list. Otherwise (cashhub front-desk staff)
    // route to the quick-fill page as before.
    // Artifact #1 principle: "where does the eye go first?" — answer per persona.
    const { prisma } = await import("@/lib/prisma");
    const techProfile = await prisma.repairTechnician.findFirst({
      where: { userId: session.user.id, orgId: session.user.org_id, isActive: true },
      select: { id: true },
    });
    if (techProfile) {
      redirect("/repairs/my-jobs");
    }
    redirect("/cashhub/quick-fill");
  }

  // ผู้จัดการสาขาเข้าหน้าของตัวเอง (ไม่เห็น executive overview)
  // feedback_role_scoped_views.md
  if (session.user.role === "branch_manager") {
    redirect("/cashhub/my-branches");
  }
  if (session.user.role === "area_manager") {
    redirect("/cashhub/dashboard");
  }

  // remaining roles = super_admin | org_admin | admin | viewer
  const isAdmin =
    session.user.role === "super_admin" ||
    session.user.role === "org_admin" ||
    session.user.role === "admin";

  // Server Component — runs once per request; Date.now() / new Date() เป็น OK
  const todayStart = formatInTimeZone(
    startOfDay(new Date()),
    TZ,
    "yyyy-MM-dd'T'HH:mm:ss'+07:00'",
  );
  // eslint-disable-next-line react-hooks/purity
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ============================================================
  // CORE-ONLY queries · ห้ามดึง daily_reports / cashhub_* / fuelos_* / docuflow_*
  // ============================================================
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
            HERO
            ============================================================ */}
        <header className="mb-14 sm:mb-20 animate-slide-up-soft">
          <p className="text-xs uppercase tracking-[0.18em] font-bold text-[var(--color-brand-700)]">
            <span className="brand-gradient-text">Pooilgroup</span>
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.03em] font-display mt-6 text-zinc-900 max-w-5xl leading-[1.05]">
            สวัสดี{" "}
            <span className="text-gradient-blue-vivid">{firstName}</span>
            <br />
            วันนี้จะเริ่มที่
            <span className="text-gradient-blue whitespace-nowrap">
              โปรแกรมไหน
            </span>
            ?
          </h1>

          <p className="text-base sm:text-lg text-zinc-600 mt-7 max-w-2xl leading-relaxed">
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
          label="โปรแกรม"
          title="โปรแกรมที่ใช้งาน"
          description="คลิกการ์ดเพื่อเข้าโปรแกรม — ทุกโปรแกรมใช้บัญชีเดียวกัน"
          className="mb-14 animate-fade-up"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <ModuleCard
              slug="cashhub"
              enabled={moduleEnabled.cashhub}
              landingPath="/cashhub/dashboard"
            />
            <ModuleCard
              slug="docuflow"
              enabled={moduleEnabled.docuflow ?? true}
              landingPath="/docuflow"
            />
            <ModuleCard
              slug="recruit"
              enabled={moduleEnabled.recruit ?? true}
              landingPath="/recruit"
            />
            <ModuleCard
              slug="repairs"
              enabled={moduleEnabled.repairs ?? true}
              landingPath="/repairs"
            />
            <ModuleCard
              slug="clawfleet"
              enabled={moduleEnabled.clawfleet ?? true}
              landingPath="/clawfleet/dashboard"
            />
            <ModuleCard
              slug="fuelos"
              enabled={moduleEnabled.fuelos ?? true}
              landingPath="/fuelos"
            />
          </div>
        </Section>

        {/* ============================================================
            01.b OPERATIONS SUMMARY — cross-module exec tile (admin tier only)
            Aggregates Repair + Recruit live counts so CEO sees 1 health line.
            BA insight: saves ~15K฿/mo of CEO time vs. opening 2 modules.
            ============================================================ */}
        {isAdmin && <OperationsSummary orgId={orgId} />}

        {/* ============================================================
            02 ADMIN — pure Core actions only
            ============================================================ */}
        {isAdmin && (
          <Section
            number="02"
            label="ผู้ดูแลระบบ"
            title={
              adminActionTotal > 0
                ? `มี ${adminActionTotal} เรื่อง รอคุณดูแล`
                : "ระบบเรียบร้อย ไม่มีอะไรค้าง"
            }
            description="งานของผู้ดูแลระบบ — รับคนใหม่ · จัดการสิทธิ์ · ดูแลความปลอดภัย"
            className="mb-14 animate-fade-up delay-100"
          >
            {adminActionTotal === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-10 text-center">
                <div className="size-14 mx-auto mb-3 rounded-2xl bg-[var(--color-leaf-50)] border-2 border-[var(--color-leaf-200)] flex items-center justify-center text-[var(--color-leaf-700)]">
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
            03 SYSTEM — health snapshot (org-level only, no module data)
            ============================================================ */}
        <Section
          number="03"
          label="ระบบ"
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

        {/* Quick Access removed — Sidebar (Zone "จัดการ" + "ระบบ") covers
            ผู้ใช้งาน · สาขา · Audit Log · ตั้งค่า. Removing the duplicate
            avoids two-paths-to-the-same-page on /home. */}

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
   ทุก module ใช้สีฟ้าเหมือนกัน · แยกความต่างด้วย emoji
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
    "border-zinc-200 hover:border-[var(--color-brand-400)] hover-lift-premium cursor-pointer shadow-soft";

  const cardDisabled = "border-zinc-200 opacity-60";

  const inner = (
    <>
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-44 rounded-full blur-3xl opacity-25 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="flex items-start justify-between mb-5">
          <div className="size-14 rounded-2xl border-2 bg-[var(--color-brand-50)] border-[var(--color-brand-200)] text-[var(--color-brand-700)] flex items-center justify-center text-2xl">
            {m.emoji}
          </div>
          {isActive ? (
            <Badge tone="success">
              <span className="size-1.5 rounded-full bg-[var(--color-leaf-600)] animate-pulse-soft inline-block" />
              ใช้งานอยู่
            </Badge>
          ) : (
            <Badge tone="neutral">
              <Lock className="size-3" />
              เร็ว ๆ นี้
            </Badge>
          )}
        </div>

        <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-zinc-900">
          {m.name}
        </h3>
        <p className="text-sm font-semibold text-[var(--color-brand-700)] mt-1">
          {m.tagline}
        </p>

        <p className="text-sm text-zinc-600 mt-4 leading-relaxed min-h-[60px]">
          {m.description}
        </p>

        <div className="mt-6 pt-5 border-t border-zinc-100 flex items-center justify-between">
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 font-bold text-[var(--color-brand-700)] group-hover:text-[var(--color-brand-800)]">
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
      bg: "bg-[var(--color-brand-50)]/60 hover:bg-[var(--color-brand-50)]",
      border: "border-[var(--color-brand-200)]",
      iconBg: "bg-[var(--color-brand-100)] text-[var(--color-brand-700)]",
      text: "text-[var(--color-brand-900)]",
      arrow: "text-[var(--color-brand-600)]",
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
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5 hover:border-[var(--color-brand-400)] hover-lift-premium">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-zinc-500">
          {label}
        </p>
        <span className="text-[var(--color-brand-600)]">{icon}</span>
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

// ============================================================
// OperationsSummary — cross-module exec tile (Repair + Recruit live counts)
// Server component · queries Prisma directly · admin-tier only.
// ============================================================
async function OperationsSummary({ orgId }: { orgId: string }) {
  const { prisma } = await import("@/lib/prisma");

  // Use Promise.all so the 5 queries run in parallel
  const startOfToday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const [
    openTicketsCount,
    urgentOpenCount,
    overdueCount,
    openPostingsCount,
    todayApplicationsCount,
  ] = await Promise.all([
    prisma.repairTicket.count({
      where: {
        orgId,
        status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
      },
    }),
    prisma.repairTicket.count({
      where: {
        orgId,
        status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
        urgency: "URGENT",
      },
    }),
    prisma.repairTicket.count({
      where: {
        orgId,
        status: { in: ["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS"] },
        resolveDueAt: { lt: new Date() },
      },
    }),
    prisma.recruitJobPosting.count({
      where: { orgId, status: "OPEN" },
    }),
    prisma.recruitApplication.count({
      where: { orgId, draft: false, submittedAt: { gte: startOfToday } },
    }),
  ]);

  // Nothing to show → hide entirely
  if (
    openTicketsCount === 0 &&
    openPostingsCount === 0 &&
    todayApplicationsCount === 0
  ) {
    return null;
  }

  return (
    <Section
      number="01.b"
      label="OPERATIONS · วันนี้"
      title="ภาพรวม operations · เห็นทุกโมดูลใน 5 วินาที"
      description="ใบแจ้งซ่อมเปิดอยู่ · งานด่วน · ประกาศรับสมัครเปิดอยู่ · ใบสมัครใหม่วันนี้"
      className="mb-14 animate-fade-up"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <OpsTile
          href="/repairs?status=NEW"
          label="ใบซ่อมเปิดอยู่"
          value={openTicketsCount}
          unit="ใบ"
          accent={openTicketsCount > 0 ? "brand" : "zinc"}
          sub={overdueCount > 0 ? `เกิน SLA ${overdueCount} ใบ` : "ตามเวลาทั้งหมด"}
          subDanger={overdueCount > 0}
        />
        <OpsTile
          href="/repairs?urgency=URGENT"
          label="ด่วนมาก"
          value={urgentOpenCount}
          unit="ใบ"
          accent={urgentOpenCount > 0 ? "danger" : "zinc"}
        />
        <OpsTile
          href="/recruit/postings?status=OPEN"
          label="ประกาศเปิดรับ"
          value={openPostingsCount}
          unit="ตำแหน่ง"
          accent={openPostingsCount > 0 ? "brand" : "zinc"}
        />
        <OpsTile
          href="/recruit?status=NEW"
          label="ใบสมัครใหม่วันนี้"
          value={todayApplicationsCount}
          unit="ใบ"
          accent={todayApplicationsCount > 0 ? "leaf" : "zinc"}
        />
      </div>
    </Section>
  );
}

function OpsTile({
  href,
  label,
  value,
  unit,
  accent,
  sub,
  subDanger,
}: {
  href: string;
  label: string;
  value: number;
  unit?: string;
  accent: "brand" | "danger" | "leaf" | "zinc";
  sub?: string;
  subDanger?: boolean;
}) {
  const accentMap: Record<string, string> = {
    brand: "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/60",
    danger: "border-red-200 bg-red-50/70",
    leaf: "border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]/60",
    zinc: "border-zinc-200 bg-white",
  };
  const numberClass: Record<string, string> = {
    brand: "text-[var(--color-brand-700)]",
    danger: "text-red-700",
    leaf: "text-[var(--color-leaf-700)]",
    zinc: "text-zinc-700",
  };
  return (
    <Link
      href={href}
      className={`block rounded-2xl border-2 p-4 hover:shadow-md transition-shadow ${accentMap[accent]}`}
    >
      <p className="text-xs font-bold text-zinc-600">
        {label}
      </p>
      <p className={`mt-2 font-extrabold tabular-num text-3xl sm:text-4xl ${numberClass[accent]}`}>
        {value.toLocaleString("th-TH")}
        {unit && (
          <span className="text-xs text-zinc-500 font-medium ml-1.5">{unit}</span>
        )}
      </p>
      {sub && (
        <p
          className={`mt-1 text-xs font-bold ${
            subDanger ? "text-red-700" : "text-zinc-500"
          }`}
        >
          {sub}
        </p>
      )}
    </Link>
  );
}

