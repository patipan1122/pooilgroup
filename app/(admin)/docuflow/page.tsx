// DocuFlow — overview / landing
// ────────────────────────────────────────────────────────────────────
// Phase 4 strip 2026-05-12 — user feedback "ใช้โคตรยาก เยอะเกิน"
// เหลือ 3 อย่าง: นับเอกสาร · ใกล้หมดอายุ · ล่าสุด + 2 ปุ่มหลัก
// ลบ pyramid drill-down (Phase 1) — ใช้ /docuflow/browse แทนถ้าจะดูตามโครงสร้าง
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  FileText,
  Clock,
  Upload,
  ArrowUpRight,
  AlertTriangle,
  FolderTree,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadDocuments, loadRenewals } from "@/lib/docuflow/data";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong, bkkRelative } from "@/lib/utils/format";
import { ExpiryBadge } from "@/components/docuflow/expiry-badge";

export const dynamic = "force-dynamic";

export default async function DocuFlowOverviewPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const [totalActive, renewals, recent] = await Promise.all([
    prisma.document.count({ where: { orgId, isActive: true } }),
    loadRenewals(orgId, { withinDays: 90 }),
    loadDocuments(orgId, { limit: 10 }),
  ]);

  const expired = renewals.filter((r) => r.expiryStatus === "expired").length;
  const critical = renewals.filter((r) => r.expiryStatus === "critical").length;
  const urgent = renewals.filter((r) => r.expiryStatus === "urgent").length;
  const urgentTotal = expired + critical + urgent;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
            📄 DocuFlow · {thaiDateLong(new Date())}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[1.05]">
            จัดการ <span className="text-gradient-blue">เอกสาร</span>
          </h1>
          <p className="text-zinc-600 mt-1.5 text-sm">
            {totalActive.toLocaleString("th-TH")} เอกสารใช้งาน
            {urgentTotal > 0 && (
              <>
                {" · "}
                <span className="font-bold text-rose-700">
                  ต่ออายุด่วน {urgentTotal}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/docuflow/browse"
            className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border-2 border-zinc-200 hover:border-zinc-300 active:bg-zinc-50 h-10 px-4 text-sm rounded-xl shrink-0"
          >
            <FolderTree className="size-4" />
            ดูตามโครงสร้าง
          </Link>
          {adminTier && (
            <Link
              href="/docuflow/documents/upload"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl shrink-0"
            >
              <Upload className="size-4" />
              อัปโหลดเอกสาร
            </Link>
          )}
        </div>
      </header>

      {/* ============================================================
          STATS — 3 ตัวเลขใหญ่
          ============================================================ */}
      <Section
        number="01"
        label="OVERVIEW"
        title="สถานะเอกสาร"
        className="mb-10 animate-fade-up delay-100"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="เอกสารทั้งหมด"
            value={totalActive}
            tone="brand"
            icon={<FileText className="size-5" />}
          />
          <StatCard
            label="หมดอายุแล้ว"
            value={expired}
            tone={expired > 0 ? "danger" : "muted"}
            icon={<AlertTriangle className="size-5" />}
            href={expired > 0 ? "/docuflow/expiry" : undefined}
          />
          <StatCard
            label="ใกล้หมด ≤30 วัน"
            value={critical + urgent}
            tone={critical + urgent > 0 ? "warning" : "muted"}
            icon={<Clock className="size-5" />}
            href={critical + urgent > 0 ? "/docuflow/expiry" : undefined}
          />
        </div>
      </Section>

      {/* ============================================================
          ใกล้หมดอายุที่สุด
          ============================================================ */}
      <Section
        number="02"
        label="EXPIRING"
        title="ใกล้หมดอายุที่สุด"
        description="10 รายการแรก — กดเข้าไปต่ออายุ/ดูรายละเอียด"
        className="mb-10 animate-fade-up delay-200"
        action={
          <Link
            href="/docuflow/expiry"
            className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-10 px-4 text-sm rounded-xl"
          >
            ดูทั้งหมด
            <ArrowUpRight className="size-4" />
          </Link>
        }
      >
        {renewals.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Clock className="size-6" />}
                title="ยังไม่มีเอกสารที่ใกล้หมดอายุ"
                description="ทุกเอกสารยังมีอายุเหลือเกิน 90 วัน"
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-zinc-100">
              {renewals.slice(0, 10).map((r) => (
                <li
                  key={r.id}
                  className="px-4 py-3 sm:px-5 sm:py-4 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
                >
                  <ExpiryBadge
                    status={r.expiryStatus}
                    days={r.daysUntilExpiry}
                  />
                  <Link
                    href={`/docuflow/documents/${r.document.id}`}
                    className="flex-1 min-w-0 group"
                  >
                    <p className="font-medium text-zinc-900 truncate group-hover:text-[var(--color-brand-700)] transition-colors">
                      {r.document.name}
                    </p>
                    {r.notes && (
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {r.notes}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {/* ============================================================
          อัปโหลดล่าสุด
          ============================================================ */}
      <Section
        number="03"
        label="RECENT"
        title="อัปโหลดล่าสุด"
        description="ไฟล์ที่เพิ่มเข้าระบบล่าสุด"
        className="animate-fade-up delay-300"
      >
        {recent.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ยังไม่มีเอกสาร"
                description={
                  adminTier ? "เริ่มอัปโหลดเอกสารแรก" : "รอ Admin อัปโหลด"
                }
                action={
                  adminTier ? (
                    <Link
                      href="/docuflow/documents/upload"
                      className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] h-10 px-4 text-sm rounded-xl"
                    >
                      <Upload className="size-4" />
                      อัปโหลด
                    </Link>
                  ) : undefined
                }
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-zinc-100">
              {recent.map((d) => (
                <li
                  key={d.id}
                  className="px-4 py-3 sm:px-5 sm:py-4 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
                >
                  <div className="size-9 shrink-0 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)]">
                    <FileText className="size-4" />
                  </div>
                  <Link
                    href={`/docuflow/documents/${d.id}`}
                    className="flex-1 min-w-0 group"
                  >
                    <p className="font-medium text-zinc-900 truncate group-hover:text-[var(--color-brand-700)] transition-colors">
                      {d.name}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {bkkRelative(d.uploadedAt)}
                    </p>
                  </Link>
                  {d.renewal ? (
                    <ExpiryBadge
                      status={d.renewal.expiryStatus}
                      days={d.renewal.daysUntilExpiry}
                    />
                  ) : (
                    <Badge tone="neutral">ไม่มีวันหมดอายุ</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </div>
  );
}

/* ============================================================
   StatCard — 3 ตัวเลขใหญ่
   ============================================================ */

function StatCard({
  label,
  value,
  tone,
  icon,
  href,
}: {
  label: string;
  value: number;
  tone: "brand" | "danger" | "warning" | "muted";
  icon: React.ReactNode;
  href?: string;
}) {
  const palette = {
    brand:
      "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 text-[var(--color-brand-900)]",
    danger: "border-rose-200 bg-rose-50 text-rose-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    muted: "border-zinc-200 bg-white text-zinc-900",
  }[tone];

  const inner = (
    <>
      <div className="flex items-center gap-2 text-zinc-500">
        <span className="text-current opacity-70">{icon}</span>
        <p className="text-xs font-bold">
          {label}
        </p>
      </div>
      <p className="mt-2 text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight">
        {value.toLocaleString("th-TH")}
      </p>
    </>
  );

  if (href && value > 0) {
    return (
      <Link
        href={href}
        className={`rounded-2xl border-2 p-5 hover-lift transition-all ${palette}`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={`rounded-2xl border-2 p-5 ${palette}`}>{inner}</div>;
}
