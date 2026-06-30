// Maid home · LINE Mini App "Home" (mockup Phone 2).
// Layout per _design-reference/.../screens/lineapp.jsx <LineRichMenu>:
//   greeting card → 2-KPI block (gap + monthly) → 4 task cards → cut-off banner.
// Bottom nav lives in MaidShell. Server Component; cut-off countdown is
// server-rendered (page is force-dynamic so the countdown + per-maid data are
// always fresh). Drift is READ from the cache (readDriftSnapshot) — it is kept
// up to date by every economic event, so we don't recompute/write on render.

import Link from "next/link";
import Image from "next/image";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { readDriftSnapshot } from "@/lib/chairops/reconcile/drift-engine";
import { ChairopsKpiTile } from "@/components/chairops/_kit";
import { Card, CardBody } from "@/components/ui/card";
import { MaidLogoutButton } from "./profile/logout-button";
import { Badge } from "@/components/ui/badge";
import { baht, thaiDate, thaiRelative, ageDays, TZ } from "@/lib/chairops/utils/format";
import { toZonedTime } from "date-fns-tz";
import { SelfDayOffCard } from "./_components/self-dayoff-card";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock,
  Landmark,
  Package,
  Sparkles,
  Wallet,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// Cut-off ส่งยอด — 17:00 น. local time. Returns remaining h/m to that boundary
// (Asia/Bangkok). Past cut-off → over=true.
function cutoffRemaining(): { over: boolean; hours: number; minutes: number } {
  const nowZoned = toZonedTime(new Date(), TZ);
  const cutoff = new Date(nowZoned);
  cutoff.setHours(17, 0, 0, 0);
  const ms = cutoff.getTime() - nowZoned.getTime();
  if (ms <= 0) return { over: true, hours: 0, minutes: 0 };
  const totalMin = Math.floor(ms / 60_000);
  return { over: false, hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

export default async function MaidHomePage() {
  const session = await requireExactRole("MAID");

  if (!session.user.primaryBranchId) {
    // No branch yet → the maid can't do any task. Don't trap them on a bare
    // message (previously this page had NO name + NO logout → a maid bound to the
    // wrong/leftover account was stuck with no way out). Show who they're signed
    // in as + a logout button so they can switch accounts / let the office fix it.
    return (
      <div className="space-y-3">
        <Card className="border-amber-200 bg-amber-50">
          <CardBody className="space-y-2 p-5 text-sm">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <CircleAlert className="h-5 w-5" />
              ยังไม่ได้ผูกสาขา
            </div>
            <p className="text-amber-700">
              เข้าสู่ระบบเป็น{" "}
              <span className="font-semibold">{session.user.displayName}</span> ·
              บัญชีนี้ยังไม่ได้กำหนดสาขา · กรุณาติดต่อออฟฟิศให้ตั้งสาขาก่อนเริ่มใช้งาน
            </p>
            <p className="text-xs text-amber-600">
              ถ้านี่ไม่ใช่บัญชีของคุณ · กด “ออกจากระบบ” แล้วเปิดลิงก์เชิญของคุณใหม่อีกครั้ง
            </p>
          </CardBody>
        </Card>
        <MaidLogoutButton />
      </div>
    );
  }

  const branchId = session.user.primaryBranchId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // BF1 · today's day-off (if any) so the LIFF can show
  // "วันนี้คุณลา" card + cancel-before-18:00 path.
  const todayUtc = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return new Date(`${fmt.format(new Date())}T00:00:00Z`);
  })();

  const [
    branch,
    drift,
    chairCount,
    monthAgg,
    todayCleanliness,
    openDamage,
    pendingDeposits,
    todayDayOff,
    pendingAgg,
  ] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true },
    }),
    readDriftSnapshot(branchId, session.user.orgId),
    prisma.chairopsChair.count({
      where: { branchId, orgId: session.user.orgId, isActive: true },
    }),
    // Month KPI now reads the new cash_deposits table (one row per bank
    // trip). The legacy CashCollection.depositedAmount column is left at 0
    // for new rows; the office staff may have legacy rows with non-zero
    // values which we ignore here intentionally.
    prisma.chairopsCashDeposit.aggregate({
      where: {
        branchId,
        maidId: session.user.id,
        depositedAt: { gte: monthStart },
      },
      _sum: { depositedAmount: true },
      _count: true,
    }),
    prisma.chairopsCleanlinessReport.count({
      where: { branchId, byMaidId: session.user.id, reportedAt: { gte: dayStart } },
    }),
    prisma.chairopsDamageTicket.count({
      where: {
        branchId,
        orgId: session.user.orgId,
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] },
      },
    }),
    // Step-1-only rows: counted but no deposit yet (depositId null). Drives
    // both the "เงินค้าง รอฝาก" KPI and the pending-deposit section. Tapping
    // the section CTA opens /m/deposit where the maid can multi-select rounds
    // and submit ONE bank trip (CEO 2026-05-30 batch-deposit spec).
    prisma.chairopsCashCollection.findMany({
      where: {
        // soft-delete: hide rows deleted by super_admin (CEO 2026-06-30)
        deletedAt: null,
        branchId,
        maidId: session.user.id,
        depositId: null,
      },
      orderBy: { collectedAt: "asc" },
      take: 20,
      select: {
        id: true,
        countedAmount: true,
        collectedAt: true,
        notes: true,
      },
    }),
    prisma.chairopsMaidDayOff.findUnique({
      where: {
        orgId_maidId_date: {
          orgId: session.user.orgId,
          maidId: session.user.id,
          date: todayUtc,
        },
      },
      select: { reason: true },
    }),
    // ยอด/จำนวนรอบค้างฝาก "ทั้งหมด" — ไม่ผูกกับ take:20 ของ list ด้านบน
    // (เดิม KPI นับจาก 20 แถวแรก → ถ้าค้างเกิน 20 รอบ ยอดจะต่ำกว่าจริง)
    prisma.chairopsCashCollection.aggregate({
      where: {
        deletedAt: null, // soft-delete: exclude super_admin-deleted rows
        orgId: session.user.orgId, // defense-in-depth (no RLS) + matches badge query
        branchId,
        maidId: session.user.id,
        depositId: null,
      },
      _sum: { countedAmount: true },
      _count: true,
    }),
  ]);

  const pendingTotal = pendingAgg._sum.countedAmount ?? 0;
  const pendingCount = pendingAgg._count;

  const daysSinceLast =
    drift.lastCollectionAt != null ? ageDays(drift.lastCollectionAt) : null;
  const gapTone: "neutral" | "warning" | "danger" =
    daysSinceLast == null
      ? "neutral"
      : daysSinceLast >= 3
        ? "danger"
        : daysSinceLast >= 1
          ? "warning"
          : "neutral";

  const monthDeposit = Number(monthAgg._sum.depositedAmount ?? 0);
  const monthCount = monthAgg._count;

  const driftLabel: { tone: "danger" | "warning" | "success"; text: string } =
    drift.status === "shortage"
      ? { tone: "danger", text: "เงินขาด" }
      : drift.status === "missed"
        ? { tone: "warning", text: "เก็บล่าช้า" }
        : drift.status === "surplus"
          ? { tone: "warning", text: "เงินเกิน" }
          : drift.status === "watch"
            ? { tone: "warning", text: "เฝ้าดู" }
            : { tone: "success", text: "ปกติ" };

  // Task counts drive the "วันนี้มี X งาน" greeting line + per-card sub text.
  const collectPending = daysSinceLast == null || daysSinceLast >= 1;
  const taskCount =
    (collectPending ? 1 : 0) + (todayCleanliness === 0 ? 1 : 0);

  const cutoff = cutoffRemaining();
  const greeting = greetByHour(toZonedTime(now, TZ).getHours());

  const tasks: MaidTaskCard[] = [
    {
      emoji: "💰",
      title: "เก็บเงิน",
      sub: collectPending
        ? `${chairCount} เก้าอี้ · ยังไม่ได้ส่ง`
        : "ส่งยอดวันนี้แล้ว",
      href: "/chairops/m/collect/new",
      status: collectPending ? "open" : "ok",
      icon: <Wallet className="size-5" aria-hidden />,
    },
    {
      emoji: "🧹",
      title: "เช็คคลีน",
      sub: todayCleanliness === 0 ? "checklist 10 ข้อ" : "ส่ง checklist แล้ว",
      href: "/chairops/m/cleanliness/new",
      status: todayCleanliness === 0 ? "open" : "ok",
      icon: <Sparkles className="size-5" aria-hidden />,
    },
    {
      emoji: "🔧",
      title: "ตรวจของเสีย",
      sub: openDamage === 0 ? "ไม่มีรายการค้าง" : `${openDamage} รายการกำลังซ่อม`,
      href: "/chairops/m/damage",
      status: openDamage === 0 ? "ok" : "open",
      icon: <Wrench className="size-5" aria-hidden />,
    },
    {
      emoji: "📦",
      title: "เบิกของ",
      sub: "ดู/เบิกของ",
      href: "/chairops/m/parts",
      status: "idle",
      icon: <Package className="size-5" aria-hidden />,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Greeting card (mockup .co-mini-greeting) */}
      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardBody className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              {/* น้องแมวน้ำโบกมือทักทายแม่บ้าน · next/image ย่อ+แปลง WebP
                  อัตโนมัติ (ไฟล์ต้นทาง 366KB → ไม่กี่ KB ที่ขนาดแสดง 64px)
                  ลดเน็ตบนมือถือแม่บ้าน */}
              <Image
                src="/mascot/clean/seal-wave-clean.png"
                alt=""
                aria-hidden
                width={56}
                height={64}
                className="-my-1 h-16 w-auto shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight text-zinc-900">
                  {greeting} {session.user.displayName}
                </h1>
                <p className="text-xs text-zinc-500">
                  {thaiDate(now, "d MMM yyyy")} · สาขา {branch.name}
                </p>
              </div>
            </div>
            <Badge tone={driftLabel.tone}>{driftLabel.text}</Badge>
          </div>
          <p className="text-sm font-medium text-zinc-700">
            วันนี้ที่ {branch.name} มี{" "}
            <span className="font-bold text-emerald-700">{taskCount} งาน</span>{" "}
            ต้องทำ
          </p>
          <ul className="ml-4 list-disc space-y-0.5 text-xs text-zinc-600">
            {collectPending && <li>เก็บเงินจากเก้าอี้ {chairCount} ตัว</li>}
            {todayCleanliness === 0 && <li>เช็คคลีน checklist 10 ข้อ</li>}
            {taskCount === 0 && <li>งานหลักวันนี้เสร็จแล้ว · เยี่ยมมาก!</li>}
          </ul>
        </CardBody>
      </Card>

      {/* KPI row: gap + monthly running + pending-deposit */}
      <div className="grid grid-cols-2 gap-3">
        <ChairopsKpiTile
          label="ไม่ได้เก็บมา"
          value={
            daysSinceLast == null
              ? "—"
              : daysSinceLast === 0
                ? "วันนี้"
                : `${daysSinceLast} วัน`
          }
          tone={gapTone}
          delta={
            drift.lastCollectionAt
              ? `เก็บล่าสุด ${thaiRelative(drift.lastCollectionAt)}`
              : "ยังไม่เคยเก็บ"
          }
          icon={<CalendarClock className="size-4" aria-hidden />}
        />
        <ChairopsKpiTile
          label="เก็บเดือนนี้"
          value={baht(monthDeposit)}
          tone="neutral"
          delta={`${monthCount} ครั้ง`}
          icon={<CalendarDays className="size-4" aria-hidden />}
        />
        <div className="col-span-2">
          <ChairopsKpiTile
            label="เงินค้าง รอฝาก"
            value={baht(pendingTotal)}
            tone={pendingCount > 0 ? "warning" : "neutral"}
            delta={
              pendingCount > 0
                ? `${pendingCount} รายการรอฝาก`
                : "ฝากครบทุกรายการ"
            }
            icon={<Landmark className="size-4" aria-hidden />}
          />
        </div>
      </div>

      {/* Pending-deposit section — preview list + ONE batch CTA. The maid
          picks which rounds to bundle on /m/deposit (saves bank fees per CEO
          2026-05-30 spec). Each preview row is a Link to the collection
          detail so the maid can inspect chair breakdown before depositing. */}
      {pendingCount > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <Landmark className="size-4 text-amber-600" aria-hidden />
            เงินค้าง รอฝาก ({pendingCount})
          </h2>
          <ul className="space-y-2">
            {pendingDeposits.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link href={`/chairops/m/collect/${p.id}`} className="block">
                  <Card className="border-amber-200 bg-amber-50/40 transition-colors active:bg-amber-100">
                    <CardBody className="flex items-center gap-3 p-4">
                      <div className="min-w-0 grow">
                        <div className="text-base font-bold tabular-nums text-zinc-900">
                          {baht(p.countedAmount)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          นับเมื่อ {thaiRelative(p.collectedAt)}
                          {p.notes ? ` · ${p.notes.slice(0, 40)}` : ""}
                        </div>
                      </div>
                      <ChevronRight
                        className="size-5 shrink-0 text-zinc-400"
                        aria-hidden
                      />
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
            {pendingCount > 5 && (
              <li className="px-1 text-xs text-zinc-500">
                + อีก {pendingCount - 5} รอบ (ดูทั้งหมดในหน้าฝากเงิน)
              </li>
            )}
          </ul>
          <Link href="/chairops/m/deposit" className="block">
            <Card className="border-emerald-300 bg-emerald-50 transition-colors active:bg-emerald-100">
              <CardBody className="flex items-center gap-3 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-200 text-emerald-700">
                  <Landmark className="size-5" aria-hidden />
                </div>
                <div className="min-w-0 grow">
                  <div className="font-semibold text-emerald-900">
                    ฝากเงินก้อน · เลือกรอบ
                  </div>
                  <div className="text-xs text-emerald-700">
                    เลือก {pendingCount} รอบรวม {baht(pendingTotal)}{" "}
                    · ฝากครั้งเดียวประหยัดค่าธรรมเนียม
                  </div>
                </div>
                <ChevronRight
                  className="size-5 shrink-0 text-emerald-700"
                  aria-hidden
                />
              </CardBody>
            </Card>
          </Link>
        </section>
      )}

      {/* BF1 · self-flag day-off (top of tasks so it's never buried) */}
      <SelfDayOffCard
        onLeaveToday={!!todayDayOff}
        todayReason={todayDayOff?.reason ?? null}
      />

      {/* 4 task cards (mockup .co-mini-tasks) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-700">งานวันนี้</h2>
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.title}>
              <Link href={t.href} className="block">
                <Card className="transition-colors active:bg-zinc-100">
                  <CardBody className="flex min-h-[64px] items-center gap-3 p-4">
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700"
                      aria-hidden
                    >
                      {t.icon}
                    </span>
                    <div className="min-w-0 grow">
                      <div className="font-semibold text-zinc-900">
                        {t.emoji} {t.title}
                      </div>
                      <div className="text-xs text-zinc-500">{t.sub}</div>
                    </div>
                    {t.status === "ok" ? (
                      <Badge tone="success" className="shrink-0">
                        เสร็จ
                      </Badge>
                    ) : (
                      <ChevronRight
                        className="size-5 shrink-0 text-zinc-400"
                        aria-hidden
                      />
                    )}
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Cut-off banner (mockup .co-mini-foot-card · yellow) */}
      <div
        className="rounded-2xl border border-amber-300 bg-amber-50 p-4"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
          <Clock className="size-4 shrink-0" aria-hidden />
          cut-off ส่งยอด · 17:00 น.
        </div>
        <div className="mt-1 text-lg font-bold tabular-nums text-amber-900">
          {cutoff.over ? (
            <span className="flex items-center gap-1 text-base text-rose-700">
              <AlertTriangle className="size-4" aria-hidden /> เลยเวลา cut-off แล้ว
            </span>
          ) : (
            `เหลือ ${cutoff.hours} ชม. ${cutoff.minutes} นาที`
          )}
        </div>
      </div>
    </div>
  );
}

interface MaidTaskCard {
  emoji: string;
  title: string;
  sub: string;
  href: string;
  status: "open" | "ok" | "idle";
  icon: ReactNode;
}

function greetByHour(h: number): string {
  if (h < 12) return "อรุณสวัสดิ์!";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}
