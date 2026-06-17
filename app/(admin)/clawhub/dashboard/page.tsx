// ClawHub (JOLLY PLAY) — admin dashboard (KPI overview).
// All counts scoped to the single ClawHub org. force-dynamic so numbers are live.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { PageHeader, StatCard } from "../_components/ui";
import { fmtNum } from "../_lib";

export const dynamic = "force-dynamic";

export default async function ClawhubDashboardPage() {
  const orgId = await clawhubOrgId();

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    memberCount,
    pointsAgg,
    pendingReview,
    refundsToday,
    pendingRedemptions,
    expiringAgg,
  ] = await Promise.all([
    prisma.clawhubMember.count({ where: { orgId } }),
    prisma.clawhubMember.aggregate({ where: { orgId }, _sum: { pointsBalance: true } }),
    prisma.clawhubRefundRequest.count({ where: { orgId, status: "PENDING_REVIEW" } }),
    prisma.clawhubRefundRequest.count({ where: { orgId, createdAt: { gte: startOfDay } } }),
    prisma.clawhubRedemption.count({ where: { orgId, status: "PENDING" } }),
    // Points sitting in lots that expire within the next 7 days (live, unspent).
    prisma.clawhubPointEntry.aggregate({
      where: {
        orgId,
        kind: { in: ["EARN_REFUND", "ADJUST"] },
        remainingPoints: { gt: 0 },
        expiresAt: { gt: now, lte: in7days },
      },
      _sum: { remainingPoints: true },
    }),
  ]);

  const totalPoints = pointsAgg._sum.pointsBalance ?? 0;
  const expiringSoon = expiringAgg._sum.remainingPoints ?? 0;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="JOLLY PLAY"
        accent="ภาพรวม"
        subtitle="สมาชิก · แต้ม · คำขอคืนแต้มตู้คีบ"
        right={
          <Link href="/clawhub/settings" className="cw-btn cw-btn-ghost">
            ตั้งค่า Rich Menu
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="สมาชิกทั้งหมด" value={fmtNum(memberCount)} tone="brand" href="/clawhub/members" />
        <StatCard
          label="แต้มคงค้าง (ทั้งระบบ)"
          value={fmtNum(totalPoints)}
          hint="1 แต้ม = 10 บาท"
          tone="ink"
        />
        <StatCard
          label="คำขอคืนรอตรวจ"
          value={fmtNum(pendingReview)}
          tone={pendingReview > 0 ? "pending" : "ink"}
          href="/clawhub/refunds?status=PENDING_REVIEW"
        />
        <StatCard
          label="คืนแต้มวันนี้"
          value={fmtNum(refundsToday)}
          tone="ink"
          href="/clawhub/refunds"
        />
        <StatCard
          label="แลกของรอจ่าย"
          value={fmtNum(pendingRedemptions)}
          tone={pendingRedemptions > 0 ? "pending" : "ink"}
          href="/clawhub/redemptions?status=PENDING"
        />
        <StatCard
          label="แต้มใกล้หมดอายุ (7 วัน)"
          value={fmtNum(expiringSoon)}
          hint="แต้มที่จะหมดอายุภายในสัปดาห์นี้"
          tone={expiringSoon > 0 ? "danger" : "ink"}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[
          { href: "/clawhub/refunds?status=PENDING_REVIEW", label: "ตรวจคำขอคืนแต้ม" },
          { href: "/clawhub/redemptions?status=PENDING", label: "จ่ายของที่แลก" },
          { href: "/clawhub/dolls", label: "จัดการตุ๊กตา (รางวัล)" },
          { href: "/clawhub/inbox", label: "กล่องแชทลูกค้า" },
          { href: "/clawhub/members", label: "สมาชิก" },
          { href: "/clawhub/reports", label: "รายงาน" },
          { href: "/clawhub/settings", label: "ตั้งค่า + Rich Menu" },
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="cw-card flex min-h-[64px] items-center justify-center p-4 text-center text-sm font-semibold transition-transform hover:-translate-y-0.5"
            style={{ color: "var(--cw-charcoal)" }}
          >
            {q.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
