// /recruit/blacklist — Blacklist management
// Per Recruit Redesign canvas Section 07 (BlacklistDesktop)
//
// Layout: 4 stat cards + filter tabs + table with severity badges + side info card.

import { requireSession } from "@/lib/auth/session";
import {
  requireRecruitAccess,
  canRecruitAdmin,
  canRecruitWrite,
} from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { BlacklistManagerV2 } from "@/components/recruit/blacklist-manager-v2";
import { Shield, AlertTriangle, Calendar, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BlacklistPage() {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const now = new Date();
  const [entries, autoCheckedApps] = await Promise.all([
    prisma.recruitBlacklist.findMany({
      where: { orgId: session.user.org_id },
      orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { addedAt: "desc" }],
      include: { addedBy: { select: { name: true } } },
    }),
    prisma.recruitApplication.count({
      where: { orgId: session.user.org_id, flaggedBlacklist: true },
    }),
  ]);

  const active = entries.filter((e) => !e.removedAt && e.expiresAt > now);
  const expired = entries.filter((e) => !e.removedAt && e.expiresAt <= now);
  const removed = entries.filter((e) => e.removedAt);

  // Derive severity from expiry duration
  function severity(addedAt: Date, expiresAt: Date): "critical" | "medium" | "low" {
    const days = Math.floor(
      (expiresAt.getTime() - addedAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days > 3 * 365) return "critical"; // > 3 years
    if (days > 180) return "medium"; // 6mo - 3yr
    return "low";
  }
  const criticalCount = active.filter(
    (e) => severity(e.addedAt, e.expiresAt) === "critical",
  ).length;

  function mapEntry(e: (typeof entries)[number]) {
    return {
      id: e.id,
      fullName: e.fullName,
      phone: e.phone,
      reason: e.reason,
      scope: e.companyScope,
      addedAt: e.addedAt.toISOString(),
      addedBy: e.addedBy.name,
      expiresAt: e.expiresAt.toISOString(),
      severity: severity(e.addedAt, e.expiresAt),
    };
  }

  return (
    <div className="p-5 sm:p-8 max-w-7xl mx-auto">
      <Section
        number="07"
        label="BLACKLIST"
        title="Blacklist ผู้สมัคร"
        description="คนเก่าที่มีปัญหา · ระบบจะใช้ตรวจสอบใบสมัครใหม่ทันที"
      >
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="ใช้งานอยู่"
            value={active.length}
            Icon={Shield}
            tone="danger"
          />
          <StatCard
            label="เกรด Critical"
            value={criticalCount}
            Icon={AlertTriangle}
            tone="warning"
            hint="ไม่มีหมดอายุ"
          />
          <StatCard
            label="หมดอายุแล้ว"
            value={expired.length}
            Icon={Calendar}
            tone="neutral"
          />
          <StatCard
            label="ใบสมัครที่ flag"
            value={autoCheckedApps}
            Icon={CheckCircle2}
            tone="success"
            hint="ระบบจับได้แล้ว"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <BlacklistManagerV2
            active={active.map(mapEntry)}
            expired={expired.map(mapEntry)}
            removed={removed.map(mapEntry)}
            canWrite={canRecruitWrite(session.user.role)}
            canRemove={canRecruitAdmin(session.user.role)}
          />

          {/* Auto-check info card */}
          <aside className="space-y-4 h-fit">
            <div className="rounded-2xl bg-gradient-to-br from-[var(--color-brand-50)] to-white border border-[var(--color-brand-200)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="size-8 rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center">
                  <Shield className="size-4" />
                </span>
                <p className="text-sm font-bold text-[var(--color-brand-900)]">
                  ระบบตรวจอัตโนมัติ
                </p>
              </div>
              <p className="text-xs text-zinc-700 leading-relaxed">
                ทุกใบสมัครใหม่จะถูกเช็คกับ Blacklist อัตโนมัติ (เบอร์ + ชื่อ) ·
                ถ้าตรง · ใบสมัครจะถูก flag เพื่อให้ HR ดูก่อนตัดสิน · ไม่ auto-reject
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-zinc-200 p-4">
              <p className="text-sm font-bold text-zinc-900 mb-3">ระดับ Severity</p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-red-500" />
                  <span className="font-bold text-red-700">Critical</span>
                  <span className="text-zinc-500">— ไม่หมดอายุ (&gt; 3 ปี)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-amber-500" />
                  <span className="font-bold text-amber-700">Medium</span>
                  <span className="text-zinc-500">— 6 เดือน-3 ปี</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-yellow-400" />
                  <span className="font-bold text-yellow-700">Low</span>
                  <span className="text-zinc-500">— ต่ำกว่า 6 เดือน</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
              <p className="text-xs text-amber-900 leading-relaxed">
                <b>⚖️ PDPA:</b> Blacklist ต้องมีเหตุผลชัดเจน + ผู้บันทึกรับผิดชอบ ·
                ถูกบันทึกใน audit log ทุกครั้ง · ผู้ที่ถูก flag มีสิทธิ์ขอลบใน /my/[refId]
              </p>
            </div>
          </aside>
        </div>
      </Section>
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  tone,
  hint,
}: {
  label: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  tone: "danger" | "warning" | "neutral" | "success";
  hint?: string;
}) {
  const toneCls = {
    danger: "text-red-700 bg-red-50",
    warning: "text-amber-700 bg-amber-50",
    neutral: "text-zinc-700 bg-zinc-50",
    success: "text-green-700 bg-green-50",
  }[tone];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`size-8 rounded-lg flex items-center justify-center ${toneCls}`}>
          <Icon className="size-4" />
        </span>
        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
          {label}
        </p>
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold font-display text-zinc-900 tabular-num mt-2">
        {value}
      </p>
      {hint && <p className="text-[10px] text-zinc-400 mt-1">{hint}</p>}
    </div>
  );
}
