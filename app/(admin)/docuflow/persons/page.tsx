// DocuFlow · Person docs dashboard — drivers + staff personal docs
// Sensitive (license, health, training, ID) — admin tier only
// Server component · sort by expiring desc

import Link from "next/link";
import { UserCircle2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { thaiDateLong } from "@/lib/utils/format";
import { prisma } from "@/lib/prisma";
import { classifyExpiry, type ExpiryStatus } from "@/lib/vehicles/data";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  admin: "Admin",
  area_manager: "Area Manager",
  branch_manager: "Branch Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

import { PERSON_DOC_TYPES } from "./types";

interface PersonRowVm {
  userId: string;
  name: string;
  role: string;
  roleLabel: string;
  docCount: number;
  /** Required types present (denominator = PERSON_DOC_TYPES.length) */
  completionPct: number;
  expiringCount: number;
  worstStatus: ExpiryStatus | "missing";
}

const STATUS_RANK: Record<ExpiryStatus | "missing", number> = {
  expired: 0,
  critical: 1,
  urgent: 2,
  watch: 3,
  no_expiry: 4,
  ok: 5,
  missing: 6,
};

const WORST_BADGE: Record<
  ExpiryStatus | "missing",
  { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  expired: { tone: "danger", label: "หมดอายุ" },
  critical: { tone: "danger", label: "≤7 วัน" },
  urgent: { tone: "warning", label: "≤30 วัน" },
  watch: { tone: "info", label: "≤90 วัน" },
  ok: { tone: "success", label: "ปลอดภัย" },
  no_expiry: { tone: "neutral", label: "ไม่ระบุ" },
  missing: { tone: "neutral", label: "ไม่มีเอกสาร" },
};

export default async function DocuFlowPersonsPage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  // Pull all active users + their person docs
  const [users, personDocs] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: "asc" }],
    }),
    prisma.personDocument.findMany({
      where: { orgId },
      select: {
        userId: true,
        docType: true,
        expiryDate: true,
      },
    }),
  ]);

  // Group docs by user
  const docsByUser = new Map<
    string,
    Array<{ docType: string; expiryDate: Date | null }>
  >();
  for (const d of personDocs) {
    if (!docsByUser.has(d.userId)) docsByUser.set(d.userId, []);
    docsByUser.get(d.userId)!.push({
      docType: d.docType,
      expiryDate: d.expiryDate,
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: PersonRowVm[] = users.map((u) => {
    const docs = docsByUser.get(u.id) ?? [];
    const typesPresent = new Set(docs.map((d) => d.docType));
    const requiredPresent = PERSON_DOC_TYPES.filter((t) =>
      typesPresent.has(t),
    ).length;
    const completionPct = Math.round(
      (requiredPresent / PERSON_DOC_TYPES.length) * 100,
    );

    // Compute worst status across all docs
    let worst: ExpiryStatus | "missing" =
      docs.length === 0 ? "missing" : "ok";
    let expiringCount = 0;
    for (const d of docs) {
      if (!d.expiryDate) continue;
      const exp = new Date(d.expiryDate);
      exp.setHours(0, 0, 0, 0);
      const days = Math.floor(
        (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      const status = classifyExpiry(days);
      if (status === "expired" || status === "critical" || status === "urgent") {
        expiringCount += 1;
      }
      if (STATUS_RANK[status] < STATUS_RANK[worst]) worst = status;
    }

    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role] ?? u.role,
      docCount: docs.length,
      completionPct,
      expiringCount,
      worstStatus: worst,
    };
  });

  // Sort by expiringCount desc, then worst status, then name
  rows.sort((a, b) => {
    if (b.expiringCount !== a.expiringCount) {
      return b.expiringCount - a.expiringCount;
    }
    if (STATUS_RANK[a.worstStatus] !== STATUS_RANK[b.worstStatus]) {
      return STATUS_RANK[a.worstStatus] - STATUS_RANK[b.worstStatus];
    }
    return a.name.localeCompare(b.name, "th");
  });

  const totalExpiring = rows.reduce((s, r) => s + r.expiringCount, 0);
  const totalWithDocs = rows.filter((r) => r.docCount > 0).length;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · เอกสารบุคคล · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          เอกสาร <span className="text-gradient-blue">บุคคล</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          {rows.length} คน · มีเอกสาร {totalWithDocs} คน
          {totalExpiring > 0 && (
            <>
              {" · "}
              <span className="font-bold text-rose-700">
                เอกสารใกล้หมดอายุ {totalExpiring} ฉบับ
              </span>
            </>
          )}
        </p>
      </header>

      <Section
        number="01"
        label="STAFF + DRIVERS"
        title="พนักงาน + คนขับ"
        description="เรียงตามจำนวนเอกสารใกล้หมดอายุ — ผู้ที่ต้องดูแลก่อนอยู่บนสุด"
      >
        {rows.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<UserCircle2 className="size-6" />}
                title="ยังไม่มีพนักงาน"
                description="เพิ่มพนักงานในเมนู ‘ผู้ใช้งาน’ ก่อน แล้วกลับมาที่นี่"
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((r) => (
              <PersonRow key={r.userId} row={r} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function PersonRow({ row }: { row: PersonRowVm }) {
  const badge = WORST_BADGE[row.worstStatus];
  return (
    <Link
      href={`/docuflow/persons/${row.userId}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] rounded-2xl"
    >
      <Card className="hover-lift transition-all">
        <CardBody className="space-y-2.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-11 shrink-0 rounded-full bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)]">
                <UserCircle2 className="size-6" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-zinc-900 tracking-tight truncate">
                  {row.name}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{row.roleLabel}</p>
              </div>
            </div>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>

          {/* Completion bar */}
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 mb-1">
              <span>ความครบของเอกสาร</span>
              <span className="font-semibold text-zinc-700 tabular-nums">
                {row.completionPct}% · {row.docCount} ฉบับ
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className={
                  row.completionPct >= 75
                    ? "h-full bg-green-500 transition-all"
                    : row.completionPct >= 50
                      ? "h-full bg-amber-500 transition-all"
                      : "h-full bg-rose-500 transition-all"
                }
                style={{ width: `${row.completionPct}%` }}
              />
            </div>
          </div>

          {row.expiringCount > 0 && (
            <p className="text-xs font-semibold text-rose-700">
              ⚠️ ใกล้หมดอายุ {row.expiringCount} ฉบับ
            </p>
          )}
        </CardBody>
      </Card>
    </Link>
  );
}
