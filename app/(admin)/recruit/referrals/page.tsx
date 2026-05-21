// /recruit/referrals — Referral program admin view
// Per Recruit Redesign canvas section 12 (ReferralAdmin)

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { MyReferralCard } from "@/components/recruit/my-referral-card";
import { ReferralPaidButton } from "@/components/recruit/referral-paid-button";
import { Trophy, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<
  string,
  { label: string; className: string }
> = {
  PENDING: { label: "ยังไม่ใช้", className: "bg-zinc-100 text-zinc-700" },
  CLICKED: { label: "เปิดลิ้งค์", className: "bg-blue-100 text-blue-700" },
  APPLIED: { label: "สมัครแล้ว", className: "bg-amber-100 text-amber-800" },
  SCREENED: { label: "ผ่านคัด", className: "bg-purple-100 text-purple-800" },
  HIRED: { label: "รับเข้า", className: "bg-green-100 text-green-800" },
  PAID: { label: "จ่ายแล้ว", className: "bg-emerald-200 text-emerald-900" },
  EXPIRED: { label: "หมดอายุ", className: "bg-zinc-200 text-zinc-500" },
};

export default async function ReferralsAdminPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);
  const orgId = session.user.org_id;

  // Stats
  const [allReferrals, hiredReferrals] = await Promise.all([
    prisma.recruitReferral.findMany({
      where: { orgId, applicantId: { not: null } }, // exclude master codes
      include: {
        referrer: { select: { name: true } },
        applicant: { select: { fullName: true, phone: true } },
        posting: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.recruitReferral.findMany({
      where: { orgId, status: "HIRED" },
    }),
  ]);

  const stats = {
    total: allReferrals.length,
    clicked: allReferrals.filter((r) => r.clickedAt).length,
    applied: allReferrals.filter((r) => r.appliedAt).length,
    hired: hiredReferrals.length,
    pendingPayout: hiredReferrals.filter((r) => !r.paidAt).length,
  };

  // Top referrers
  const referrerMap = new Map<string, { name: string; applied: number; hired: number }>();
  for (const r of allReferrals) {
    const key = r.referrerId;
    const entry = referrerMap.get(key) ?? { name: r.referrer.name, applied: 0, hired: 0 };
    if (r.appliedAt) entry.applied++;
    if (r.status === "HIRED" || r.status === "PAID") entry.hired++;
    referrerMap.set(key, entry);
  }
  const topReferrers = [...referrerMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.hired - a.hired || b.applied - a.applied)
    .slice(0, 5);

  return (
    <div className="p-5 sm:p-8 max-w-7xl mx-auto">
      <Section
        number="12"
        label="Referral"
        title="โปรแกรมแนะนำเพื่อน"
        description="พนักงานชวนเพื่อนสมัคร · ติด tag UTM อัตโนมัติ · จ่ายโบนัสเมื่อรับเข้า"
      >
        {/* My code card */}
        <MyReferralCard />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 my-6">
          <StatCard label="ทั้งหมด" value={stats.total} accent="brand" />
          <StatCard label="เปิดลิ้งค์" value={stats.clicked} accent="blue" />
          <StatCard label="สมัครแล้ว" value={stats.applied} accent="warning" />
          <StatCard label="รับเข้า" value={stats.hired} accent="success" />
          <StatCard
            label="รอจ่ายโบนัส"
            value={stats.pendingPayout}
            accent={stats.pendingPayout > 0 ? "danger" : "neutral"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Referrals table */}
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <div className="p-4 border-b border-zinc-200 bg-zinc-50/60">
              <h2 className="text-sm font-bold text-zinc-900">รายการแนะนำ</h2>
            </div>
            {allReferrals.length === 0 ? (
              <p className="p-8 text-center text-sm text-zinc-400">
                ยังไม่มีแนะนำ · ใช้ลิ้งค์ของตัวเองส่งให้เพื่อน
              </p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {allReferrals.map((r) => {
                  const meta = STATUS_PILL[r.status];
                  return (
                    <div key={r.id} className="p-4 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.className}`}
                          >
                            {meta.label}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            {r.code}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-zinc-900 mt-1">
                          {r.applicant?.fullName ?? "—"}
                        </p>
                        <p className="text-xs text-zinc-500">
                          ตำแหน่ง: {r.posting?.title ?? "ทั่วไป"} · แนะนำโดย{" "}
                          <b>{r.referrer.name}</b>
                        </p>
                        {r.bountyBaht && (
                          <p className="text-xs text-green-700 mt-1 font-bold">
                            โบนัส ฿{r.bountyBaht.toString()}
                          </p>
                        )}
                      </div>
                      {r.status === "HIRED" && !r.paidAt && (
                        <ReferralPaidButton referralId={r.id} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top referrers */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 h-fit">
            <h2 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2">
              <Trophy className="size-4 text-amber-500" />
              Top Referrers
            </h2>
            {topReferrers.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">ยังไม่มีข้อมูล</p>
            ) : (
              <div className="space-y-3">
                {topReferrers.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <span
                      className={`size-7 rounded-full grid place-items-center font-bold text-xs shrink-0 ${
                        i === 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-900 truncate">{r.name}</p>
                      <p className="text-xs text-zinc-500">
                        {r.applied} สมัคร · <b className="text-green-700">{r.hired} รับ</b>
                      </p>
                    </div>
                    <TrendingUp className="size-4 text-zinc-300" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "brand" | "blue" | "warning" | "success" | "danger" | "neutral";
}) {
  const cls = {
    brand: "text-[var(--color-brand-700)]",
    blue: "text-blue-700",
    warning: "text-amber-700",
    success: "text-green-700",
    danger: "text-red-700",
    neutral: "text-zinc-700",
  }[accent];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-2xl font-extrabold font-display tabular-num mt-2 ${cls}`}>
        {value}
      </p>
    </div>
  );
}
