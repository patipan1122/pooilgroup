// Maid home · LINE Mini App "Home" (mockup Phone 2).
// Layout per _design-reference/.../screens/lineapp.jsx <LineRichMenu>:
//   greeting card → 2-KPI block (gap + monthly) → 4 task cards → cut-off banner.
// Bottom nav lives in MaidShell. Server Component; cut-off countdown is
// server-rendered (page is force-dynamic so it recomputes each request).

import Link from "next/link";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { ChairopsKpiTile } from "@/components/chairops/_kit";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { baht, thaiDate, thaiRelative, ageDays, TZ } from "@/lib/chairops/utils/format";
import { toZonedTime } from "date-fns-tz";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock,
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
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardBody className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <CircleAlert className="h-5 w-5" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-amber-700">
            บัญชีของคุณยังไม่ได้กำหนดสาขา · กรุณาติดต่อออฟฟิศก่อนเริ่มใช้งาน
          </p>
        </CardBody>
      </Card>
    );
  }

  const branchId = session.user.primaryBranchId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [branch, drift, chairCount, monthAgg, todayCleanliness, openDamage] =
    await Promise.all([
      prisma.chairopsBranch.findUniqueOrThrow({
        where: { id: branchId },
        select: { name: true },
      }),
      recomputeDriftForBranch(branchId),
      prisma.chairopsChair.count({
        where: { branchId, orgId: session.user.orgId, isActive: true },
      }),
      prisma.chairopsCashCollection.aggregate({
        where: {
          branchId,
          maidId: session.user.id,
          collectedAt: { gte: monthStart },
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
    ]);

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
      sub: "ตามต้องการ",
      href: "/chairops/m/parts/new",
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
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight text-zinc-900">
                {greeting} {session.user.displayName}
              </h1>
              <p className="text-xs text-zinc-500">
                {thaiDate(now, "d MMM yyyy")} · สาขา {branch.name}
              </p>
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

      {/* 2-KPI block (already-shipped tiles): gap + monthly running */}
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
      </div>

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
