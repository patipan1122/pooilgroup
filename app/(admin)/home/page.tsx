// /home — Core entry point for Pooilgroup (DASHBOARD)
// PURE CORE ONLY: greeting · quick-launch favorites · admin actions · system health
// The full program directory now lives at /programs (bottom-nav "โปรแกรม" tab +
// desktop sidebar "โปรแกรมทั้งหมด"). /home stays a fast dashboard.
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
  ChevronRight,
  HardDrive,
  Activity,
  KeyRound,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import { MODULES } from "@/lib/modules";
import { loadUserModules } from "@/lib/auth/module-access";
import {
  buildFavorites,
  TileGrid,
} from "@/components/features/hub/programs";
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
  // CostCtrl = CEO-only cost dashboard → การ์ดโชว์เฉพาะ super_admin
  const isSuperAdmin = session.user.role === "super_admin";

  // Which programs the user can launch. Admin tier → all. Program-admins
  // (org-role viewer + user_modules grants) → only their granted programs.
  const access = await loadUserModules(session.user);
  const canSee = (slug: string) => access.has(slug as never);

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

  // Stat tile: open programs out of the TOTAL registry (not org_modules rows).
  const totalModules = Object.keys(MODULES).length;
  const openModules = Object.keys(MODULES).filter(
    (s) => moduleEnabled[s] ?? true,
  ).length;

  const firstName = session.user.name.split(" ")[0];
  const favorites = buildFavorites(canSee, moduleEnabled, isSuperAdmin, 6);
  const adminActionTotal = pendingRequests + failedLogins + pendingInvites;

  return (
    <div className="relative">
      {/* Soft dot-grid wash */}
      <div
        aria-hidden
        className="absolute inset-0 bg-grid-dots opacity-[0.25] pointer-events-none"
      />

      <div className="relative p-4 sm:p-8 lg:p-10 max-w-6xl mx-auto">
        {/* ============================================================
            HERO — compact (greeting + inline stat chips)
            ============================================================ */}
        <header className="mb-8 animate-slide-up-soft">
          <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-[var(--color-brand-700)]">
            <span className="brand-gradient-text">Pooilgroup</span>
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display mt-2 text-zinc-900">
            สวัสดี{" "}
            <span className="text-gradient-blue-vivid">{firstName}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <StatChip label="บริษัท" value="2" />
            <StatChip label="สาขา" value={branchCount.toLocaleString("th-TH")} />
            <StatChip
              label="ผู้ใช้งาน"
              value={userCount.toLocaleString("th-TH")}
            />
          </div>
        </header>

        {/* ============================================================
            QUICK LAUNCH — favorites (full directory at /programs)
            ============================================================ */}
        <section className="mb-10 animate-fade-up" aria-labelledby="quick-launch">
          <div className="flex items-center justify-between mb-2.5">
            <h2 id="quick-launch" className="text-sm font-semibold text-zinc-700">
              โปรแกรมที่ใช้บ่อย
            </h2>
            <Link
              href="/programs"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)]"
            >
              ดูทั้งหมด
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
          {favorites.length > 0 ? (
            <TileGrid items={favorites} />
          ) : (
            <Link
              href="/programs"
              className="block rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 p-8 text-center hover:border-[var(--color-brand-300)]"
            >
              <p className="font-bold text-zinc-900">ดูโปรแกรมทั้งหมด</p>
              <p className="text-sm text-zinc-500 mt-1">
                เปิดรายการโปรแกรมที่คุณเข้าใช้งานได้
              </p>
            </Link>
          )}
        </section>

        {/* Cross-module exec tile (admin tier only) */}
        {isAdmin && <OperationsSummary orgId={orgId} />}

        {/* ============================================================
            ADMIN — pure Core actions only
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
            className="mb-10 animate-fade-up delay-100"
          >
            {adminActionTotal === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 p-10 text-center">
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
                      (r) => `${r.name} · ${r.phone} (${r.requested_role})`,
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
            SYSTEM — health snapshot (org-level only, no module data)
            ============================================================ */}
        <Section
          number="03"
          label="ระบบ"
          title="ภาพรวมระบบ"
          description="ตัวเลขจริงของ Pooilgroup ณ ตอนนี้"
          className="mb-10 animate-fade-up delay-200"
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
              value={openModules}
              unit={`/ ${totalModules}`}
            />
          </div>
        </Section>

        {/* Footer credit — subtle */}
        <p className="mt-12 text-center text-[11px] text-zinc-500">
          Pooilgroup ERP · ระบบรวมศูนย์ทุกโปรแกรมในที่เดียว
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   StatChip — compact inline stat pill for the hero
   ============================================================ */
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1">
      <span className="text-sm font-bold tabular-nums text-zinc-900">
        {value}
      </span>
      <span className="text-xs text-zinc-500">{label}</span>
    </span>
  );
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
      bg: "bg-[var(--color-brand-50)] hover:bg-[var(--color-brand-100)]",
      border: "border-[var(--color-brand-200)]",
      iconBg: "bg-[var(--color-brand-100)] text-[var(--color-brand-700)]",
      text: "text-[var(--color-brand-900)]",
      arrow: "text-[var(--color-brand-600)]",
    },
    warning: {
      bg: "bg-amber-50 hover:bg-amber-100",
      border: "border-amber-200",
      iconBg: "bg-amber-100 text-amber-700",
      text: "text-amber-900",
      arrow: "text-amber-600",
    },
    danger: {
      bg: "bg-red-50 hover:bg-red-100",
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
      <p className={`font-num-mega ${palette.text} text-3xl mt-1 tabular-nums`}>
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
        <p className="text-xs font-bold text-zinc-500">{label}</p>
        <span className="text-[var(--color-brand-600)]">{icon}</span>
      </div>
      <p className="font-num-mega text-4xl sm:text-5xl tabular-nums">
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
      className="mb-10 animate-fade-up"
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
    brand: "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]",
    danger: "border-red-200 bg-red-50",
    leaf: "border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]",
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
      <p className="text-xs font-bold text-zinc-600">{label}</p>
      <p
        className={`mt-2 font-extrabold tabular-nums text-3xl sm:text-4xl ${numberClass[accent]}`}
      >
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
