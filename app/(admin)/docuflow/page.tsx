// DocuFlow — overview / landing
// ────────────────────────────────────────────────────────────────────
// Server component. Executive role guard. Reads canonical loaders
// (lib/docuflow/data.ts — Agent A) for stats + recent uploads.
// Spec: ดีเทลv1/DOCUFLOW.md §6 (Expiry Dashboard summary)
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  FileText,
  Clock,
  Truck,
  Users as UsersIcon,
  Upload,
  ArrowUpRight,
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

  // Stats — count via Prisma (lightweight aggregates).
  const [
    totalActive,
    renewals,
    vehicleCount,
    personDocCount,
    recent,
  ] = await Promise.all([
    prisma.document.count({ where: { orgId, isActive: true } }),
    loadRenewals(orgId, { withinDays: 90 }),
    prisma.vehicle.count({ where: { orgId, isActive: true } }),
    prisma.personDocument
      .findMany({
        where: { orgId, document: { isActive: true } },
        select: { userId: true },
        distinct: ["userId"],
      })
      .then((r) => r.length),
    loadDocuments(orgId, { limit: 10 }),
  ]);

  const expired = renewals.filter((r) => r.expiryStatus === "expired").length;
  const critical = renewals.filter((r) => r.expiryStatus === "critical").length;
  const urgent = renewals.filter((r) => r.expiryStatus === "urgent").length;
  const watch = renewals.filter((r) => r.expiryStatus === "watch").length;

  const stats = [
    {
      label: "เอกสารทั้งหมด",
      value: totalActive,
      Icon: FileText,
      hint: "ที่ใช้งาน",
    },
    {
      label: "หมดอายุแล้ว",
      value: expired,
      Icon: Clock,
      hint: "ต้องต่อด่วน",
      tone: expired > 0 ? "danger" : "neutral",
    },
    {
      label: "ใกล้หมด ≤30 วัน",
      value: critical + urgent,
      Icon: Clock,
      hint: `วิกฤต ${critical} · เร่งด่วน ${urgent}`,
      tone: critical + urgent > 0 ? "warning" : "neutral",
    },
    {
      label: "เฝ้าระวัง 31-90 วัน",
      value: watch,
      Icon: Clock,
      hint: "เริ่มเตรียมต่อ",
    },
    {
      label: "รถในระบบ",
      value: vehicleCount,
      Icon: Truck,
      hint: "พร้อมเอกสาร",
    },
    {
      label: "พนักงานมีเอกสาร",
      value: personDocCount,
      Icon: UsersIcon,
      hint: "ใบขับขี่/ฝึกอบรม",
    },
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          จัดการ <span className="text-gradient-blue">เอกสารทั้งหมด</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          {totalActive} เอกสารใช้งาน
          {expired + critical > 0 && (
            <>
              {" · "}
              <span className="font-bold text-rose-700">
                ต้องต่ออายุด่วน {expired + critical}
              </span>
            </>
          )}
        </p>
      </header>

      <Section
        number="01"
        label="OVERVIEW"
        title="สถานะเอกสาร"
        className="mb-10 animate-fade-up delay-100"
        action={
          adminTier ? (
            <Link
              href="/docuflow/documents/upload"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl"
            >
              <Upload className="size-4" />
              อัปโหลดเอกสาร
            </Link>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="hover-lift">
              <CardBody className="p-4">
                <div className="flex items-center gap-2 text-zinc-500">
                  <s.Icon className="size-3.5" />
                  <p className="text-[11px] uppercase tracking-[0.16em] font-bold">
                    {s.label}
                  </p>
                </div>
                <p
                  className={`mt-2 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight ${
                    s.tone === "danger"
                      ? "text-rose-700"
                      : s.tone === "warning"
                        ? "text-amber-700"
                        : "text-zinc-900"
                  }`}
                >
                  {s.value.toLocaleString("th-TH")}
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">{s.hint}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        number="02"
        label="EXPIRING"
        title="ใกล้หมดอายุที่สุด"
        description="10 รายการแรกที่ต้องต่ออายุก่อน — กดเข้าไปดูรายละเอียดเอกสาร"
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
                  <ExpiryBadge status={r.expiryStatus} days={r.daysUntilExpiry} />
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

      <Section
        number="03"
        label="RECENT"
        title="อัปโหลดล่าสุด"
        description="10 ไฟล์ที่ถูกเพิ่มล่าสุดเข้าระบบ"
        className="mb-10 animate-fade-up delay-300"
      >
        {recent.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ยังไม่มีเอกสารในระบบ"
                description={
                  adminTier
                    ? "เริ่มจากอัปโหลดเอกสารแรก"
                    : "รอ Admin อัปโหลดเอกสารเข้าระบบ"
                }
                action={
                  adminTier ? (
                    <Link
                      href="/docuflow/documents/upload"
                      className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] h-10 px-4 text-sm rounded-xl"
                    >
                      <Upload className="size-4" />
                      อัปโหลดเอกสาร
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
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
                      <span>{bkkRelative(d.uploadedAt)}</span>
                      {d.tags.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="truncate">
                            {d.tags.slice(0, 3).join(" · ")}
                          </span>
                        </>
                      )}
                    </div>
                  </Link>
                  {d.renewal && (
                    <ExpiryBadge
                      status={d.renewal.expiryStatus}
                      days={d.renewal.daysUntilExpiry}
                    />
                  )}
                  {!d.renewal && (
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
