// DocuFlow — Expiry Dashboard
// ────────────────────────────────────────────────────────────────────
// 4 buckets visually distinct: expired / critical / urgent / watch.
// Filter by company / branch / business type.
// Spec: ดีเทลv1/DOCUFLOW.md §6
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Clock, AlertCircle, AlertTriangle, Calendar } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadRenewals } from "@/lib/docuflow/data";
import type { ExpiryStatus } from "@/lib/docuflow/expiry";
import { prisma } from "@/lib/prisma";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpiryBadge } from "@/components/docuflow/expiry-badge";
import { DocumentFilters } from "@/components/docuflow/document-filters";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface SP {
  company?: string;
  branch?: string;
  type?: string;
}

interface BucketDef {
  status: ExpiryStatus;
  label: string;
  description: string;
  Icon: typeof Clock;
  cardClass: string;
  countClass: string;
}

const BUCKETS: BucketDef[] = [
  {
    status: "expired",
    label: "หมดแล้ว",
    description: "เอกสารหมดอายุแล้ว — ต้องต่อด่วน",
    Icon: AlertCircle,
    cardClass: "border-rose-200 bg-rose-50/40",
    countClass: "text-rose-700",
  },
  {
    status: "critical",
    label: "วิกฤต ≤ 7 วัน",
    description: "หมดในสัปดาห์หน้า",
    Icon: AlertTriangle,
    cardClass: "border-rose-200 bg-rose-50/30",
    countClass: "text-rose-700",
  },
  {
    status: "urgent",
    label: "เร่งด่วน ≤ 30 วัน",
    description: "หมดภายในเดือน — เริ่มดำเนินการ",
    Icon: Clock,
    cardClass: "border-amber-200 bg-amber-50/40",
    countClass: "text-amber-700",
  },
  {
    status: "watch",
    label: "เฝ้าระวัง ≤ 90 วัน",
    description: "เริ่มเตรียมต่ออายุ",
    Icon: Calendar,
    cardClass: "border-zinc-200 bg-zinc-50/60",
    countClass: "text-zinc-700",
  },
];

export default async function ExpiryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const sp = await searchParams;

  const filterCompany = sp.company || "";
  const filterBranch = sp.branch || "";
  const filterType = sp.type || "";

  const [renewals, companies, branches] = await Promise.all([
    loadRenewals(orgId, { withinDays: 90 }),
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.branch.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        businessType: true,
        companyId: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Lookup ownership rows for each renewal to apply filters.
  // Fetch all ownership for the doc ids touched (one query, indexed).
  const docIds = renewals.map((r) => r.documentId);
  const ownerships = docIds.length
    ? await prisma.documentOwnership.findMany({
        where: { orgId, documentId: { in: docIds } },
        select: {
          documentId: true,
          level: true,
          companyId: true,
          branchId: true,
          businessType: true,
        },
      })
    : [];
  const ownershipByDoc = new Map<string, typeof ownerships>();
  for (const o of ownerships) {
    const list = ownershipByDoc.get(o.documentId) ?? [];
    list.push(o);
    ownershipByDoc.set(o.documentId, list);
  }

  const filtered = renewals.filter((r) => {
    const owners = ownershipByDoc.get(r.documentId) ?? [];
    if (filterCompany) {
      const ok = owners.some((o) => o.companyId === filterCompany);
      if (!ok) return false;
    }
    if (filterBranch) {
      const ok = owners.some((o) => o.branchId === filterBranch);
      if (!ok) return false;
    }
    if (filterType) {
      const ok = owners.some((o) => o.businessType === filterType);
      if (!ok) return false;
    }
    return true;
  });

  // Group by status
  const grouped: Record<ExpiryStatus, typeof filtered> = {
    expired: [],
    critical: [],
    urgent: [],
    watch: [],
    normal: [],
  };
  for (const r of filtered) grouped[r.expiryStatus].push(r);

  const totalUrgent =
    grouped.expired.length + grouped.critical.length + grouped.urgent.length;

  // Build company / business-type chips
  const companyChips = companies.map((c) => ({ value: c.id, label: c.name }));
  const branchChips = branches
    .filter((b) => !filterCompany || b.companyId === filterCompany)
    .slice(0, 30)
    .map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }));
  const typeChips = Array.from(
    new Set(branches.map((b) => b.businessType)),
  ).map((t) => {
    const cfg = BUSINESS_TYPES[t];
    return { value: t, label: cfg ? `${cfg.emoji} ${cfg.label}` : t };
  });

  const preserveFor = (key: string) => {
    const p: Record<string, string> = {};
    if (filterCompany && key !== "company") p.company = filterCompany;
    if (filterBranch && key !== "branch") p.branch = filterBranch;
    if (filterType && key !== "type") p.type = filterType;
    return p;
  };

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          ใกล้ <span className="text-gradient-blue">หมดอายุ</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          {filtered.length} เอกสารกำลังใกล้หมด
          {totalUrgent > 0 && (
            <>
              {" · "}
              <span className="font-bold text-rose-700">
                ต้องดำเนินการด่วน {totalUrgent}
              </span>
            </>
          )}
        </p>
      </header>

      <Section
        number="01"
        label="ตัวกรอง"
        title="กรอง"
        className="mb-6 animate-fade-up delay-100"
      >
        <Card>
          <CardBody className="space-y-4">
            <div>
              <p className="text-xs font-bold text-zinc-500 mb-2">
                บริษัท
              </p>
              <DocumentFilters
                paramKey="company"
                current={filterCompany}
                chips={companyChips}
                preserve={preserveFor("company")}
              />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-500 mb-2">
                ประเภทธุรกิจ
              </p>
              <DocumentFilters
                paramKey="type"
                current={filterType}
                chips={typeChips}
                preserve={preserveFor("type")}
              />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-500 mb-2">
                สาขา {filterCompany && "(ในบริษัทที่เลือก)"}
              </p>
              <DocumentFilters
                paramKey="branch"
                current={filterBranch}
                chips={branchChips}
                preserve={preserveFor("branch")}
              />
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section
        number="02"
        label="แบ่งกลุ่ม"
        title="แบ่งตามความเร่งด่วน"
        className="animate-fade-up delay-200"
      >
        {filtered.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Clock className="size-6" />}
                title="ไม่มีเอกสารใกล้หมดอายุ"
                description="ทุกเอกสารยังเหลืออายุเกิน 90 วัน — เยี่ยม!"
                action={
                  <Link
                    href="/docuflow/browse"
                    className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-9 px-4 text-sm rounded-xl"
                  >
                    ดูเอกสารทั้งหมด
                  </Link>
                }
              />
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-5">
            {BUCKETS.map((b) => {
              const list = grouped[b.status];
              if (list.length === 0) return null;
              return (
                <Card key={b.status} className={b.cardClass}>
                  <CardBody>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-2.5">
                        <b.Icon className={`size-5 mt-0.5 ${b.countClass}`} />
                        <div>
                          <h3 className="font-bold tracking-tight font-display text-zinc-900">
                            {b.label}
                          </h3>
                          <p className="text-xs text-zinc-600 mt-0.5">
                            {b.description}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-2xl font-extrabold tabular-nums ${b.countClass}`}
                      >
                        {list.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-zinc-100 bg-white rounded-xl border border-zinc-100">
                      {list.map((r) => (
                        <li
                          key={r.id}
                          className="px-4 py-3 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
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
                            <p className="text-xs text-zinc-500 mt-0.5">
                              หมด {thaiDateLong(r.expiryDate)}
                            </p>
                          </Link>
                          <Link
                            href={`/docuflow/documents/${r.document.id}`}
                            className="inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] h-9 px-3 text-sm rounded-lg shrink-0"
                          >
                            ต่ออายุ
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
