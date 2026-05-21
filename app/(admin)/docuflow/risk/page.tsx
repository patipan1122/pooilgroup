// /docuflow/risk — Org-wide AI Risk Aggregate Dashboard (Item 2)
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §7 part 2 (lines 402-418)
//
// Server-rendered. Reads canonical loaders → Claude narrative → renders
// 3 sections: Top risks ranked + per-bucket category list with item links.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Clock,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole, isAdminTier } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { computeOrgRiskSummary, type RiskGroup } from "@/lib/docuflow/risk-aggregate";
import { narrateOrgRisk } from "@/lib/docuflow/risk-narrate";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpiryBadge } from "@/components/docuflow/expiry-badge";
import { RefreshOrgRiskButton } from "@/components/docuflow/refresh-org-risk-button";
import { thaiDateLong } from "@/lib/utils/format";
import {
  daysUntilExpiry as daysFn,
  getExpiryStatus,
  type ExpiryStatus,
} from "@/lib/docuflow/expiry";

export const dynamic = "force-dynamic";

async function loadOrgName(orgId: string): Promise<string> {
  try {
    const admin = adminClient();
    const { data } = await admin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    return (data?.name as string | undefined) ?? "Pooilgroup";
  } catch {
    return "Pooilgroup";
  }
}

export default async function OrgRiskPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const [summary, orgName] = await Promise.all([
    computeOrgRiskSummary(orgId),
    loadOrgName(orgId),
  ]);
  const narrative = await narrateOrgRisk(summary, orgName);

  const isEmpty = summary.totals.grandTotal === 0;
  const dangerCount =
    summary.totals.expired + summary.totals.critical + summary.totals.urgent;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <div className="mt-4 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display leading-[0.95]">
              ความ <span className="text-gradient-blue">เสี่ยงรวม</span>
            </h1>
            <p className="text-zinc-600 mt-1.5 text-sm">
              ภาพรวม AI วิเคราะห์เอกสารทั้งกลุ่ม — ใบอนุญาต · รถ · พนักงาน
            </p>
          </div>
          {adminTier && <RefreshOrgRiskButton />}
        </div>
      </header>

      {/* Top stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 animate-fade-up delay-100">
        <StatCell
          label="หมดแล้ว"
          value={summary.totals.expired}
          tone={summary.totals.expired > 0 ? "danger" : "neutral"}
        />
        <StatCell
          label="≤ 7 วัน"
          value={summary.totals.critical}
          tone={summary.totals.critical > 0 ? "danger" : "neutral"}
        />
        <StatCell
          label="≤ 30 วัน"
          value={summary.totals.urgent}
          tone={summary.totals.urgent > 0 ? "warning" : "neutral"}
        />
        <StatCell
          label="≤ 90 วัน"
          value={summary.totals.watch}
          tone="neutral"
        />
      </div>

      {/* AI narrative — top 3 risks */}
      <Section
        number="01"
        label="วิเคราะห์ AI"
        title="🔍 AI วิเคราะห์ Pool Group"
        description="ความเสี่ยงสูงสุด 3 อันดับแรก + คำแนะนำ"
        className="mb-6 animate-fade-up delay-150"
      >
        {/* Overall tone callout */}
        <Card
          className={
            isEmpty
              ? "border-green-200 bg-green-50/40"
              : dangerCount > 0
                ? "border-rose-200 bg-rose-50/40"
                : "border-amber-200 bg-amber-50/40"
          }
        >
          <CardBody>
            <div className="flex items-start gap-3">
              {isEmpty ? (
                <ShieldCheck className="size-5 mt-0.5 text-green-700 shrink-0" />
              ) : dangerCount > 0 ? (
                <AlertCircle className="size-5 mt-0.5 text-rose-700 shrink-0" />
              ) : (
                <Clock className="size-5 mt-0.5 text-amber-700 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-zinc-500">
                  สรุปภาพรวม
                </p>
                <p className="text-sm sm:text-base font-medium text-zinc-900 mt-1 leading-relaxed">
                  {narrative.overallTone}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Top 3 ranked risks */}
        {narrative.topRisks.length > 0 && (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            {narrative.topRisks.map((r) => (
              <Card key={r.rank}>
                <CardBody className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="size-7 rounded-full bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] text-[var(--color-brand-700)] text-sm font-extrabold flex items-center justify-center tabular-num">
                      {r.rank}
                    </span>
                    <Badge tone="brand">{r.daysWindow}</Badge>
                    <Badge tone="neutral">{r.count} รายการ</Badge>
                  </div>
                  <h3 className="text-base font-bold tracking-tight font-display text-zinc-900 leading-snug">
                    {r.title}
                  </h3>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
                    <p className="text-xs font-bold text-zinc-500 mb-1">
                      ผลกระทบธุรกิจ
                    </p>
                    <p className="text-sm text-zinc-800 leading-relaxed">
                      {r.businessImpact}
                    </p>
                  </div>
                  <div className="rounded-xl border-2 border-[var(--color-brand-100)] bg-[var(--color-brand-50)] px-3 py-2.5">
                    <p className="text-xs font-bold text-[var(--color-brand-700)] mb-1">
                      แนะนำ
                    </p>
                    <p className="text-sm font-medium text-zinc-900 leading-relaxed">
                      {r.recommendation}
                    </p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {/* Footer — model info */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
          <span>
            วิเคราะห์เมื่อ {thaiDateLong(narrative.computedAt)}
            {narrative.fromCache && " · จาก cache"}
          </span>
          {narrative.modelUsed && <span>{narrative.modelUsed}</span>}
        </div>
      </Section>

      {/* Empty-state shortcut */}
      {isEmpty ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Sparkles className="size-6" />}
              title="ปลอดภัย — ไม่มีเอกสารใกล้หมดอายุ"
              description="เอกสารทุกฉบับยังเหลืออายุเกิน 90 วัน · กลับมาเช็คอีกครั้งสัปดาห์หน้า"
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <BucketSection
            number="02"
            label="วิกฤต"
            title="วิกฤต ≤ 30 วัน (รวมหมดแล้ว)"
            description="ต้องดำเนินการก่อน — ไม่ทำคือผิดกฎหมาย / หยุดดำเนินการ"
            emptyText="ไม่มีเอกสารวิกฤต — ดี"
            groups={summary.critical}
            severity="critical"
          />
          <BucketSection
            number="03"
            label="เร่งด่วน"
            title="เร่งด่วน 31-60 วัน"
            description="ควรเริ่มดำเนินการในเดือนนี้"
            emptyText="ไม่มีเอกสารในช่วง 31-60 วัน"
            groups={summary.urgent}
            severity="urgent"
          />
          <BucketSection
            number="04"
            label="เฝ้าระวัง"
            title="เฝ้าระวัง 61-90 วัน"
            description="วางแผนล่วงหน้า — ยังไม่ต้องรีบ"
            emptyText="ไม่มีเอกสารในช่วง 61-90 วัน"
            groups={summary.watch}
            severity="watch"
          />
        </>
      )}
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "neutral";
}) {
  const valueColor =
    tone === "danger"
      ? "text-rose-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-zinc-900";
  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4">
      <p className="text-xs font-bold text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl sm:text-3xl font-extrabold tabular-num font-display tracking-tight ${valueColor}`}
      >
        {value}
      </p>
    </div>
  );
}

function BucketSection({
  number,
  label,
  title,
  description,
  emptyText,
  groups,
  severity,
}: {
  number: string;
  label: string;
  title: string;
  description: string;
  emptyText: string;
  groups: RiskGroup[];
  severity: "critical" | "urgent" | "watch";
}) {
  const cardClass =
    severity === "critical"
      ? "border-rose-200 bg-rose-50/30"
      : severity === "urgent"
        ? "border-amber-200 bg-amber-50/30"
        : "border-zinc-200 bg-zinc-50/40";
  const iconClass =
    severity === "critical"
      ? "text-rose-700"
      : severity === "urgent"
        ? "text-amber-700"
        : "text-zinc-700";
  const Icon =
    severity === "critical"
      ? AlertTriangle
      : severity === "urgent"
        ? Clock
        : ShieldCheck;

  return (
    <Section
      number={number}
      label={label}
      title={title}
      description={description}
      className="mt-6 animate-fade-up"
    >
      {groups.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<ShieldCheck className="size-6" />}
              title={emptyText}
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.category} className={cardClass}>
              <CardBody>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Icon className={`size-5 mt-0.5 shrink-0 ${iconClass}`} />
                    <div className="min-w-0">
                      <h3 className="font-bold tracking-tight font-display text-zinc-900">
                        {g.categoryLabel}
                      </h3>
                      <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                        {g.businessImpact}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-2xl font-extrabold tabular-num shrink-0 ${iconClass}`}
                  >
                    {g.count}
                  </span>
                </div>
                <ul className="divide-y divide-zinc-100 bg-white rounded-xl border border-zinc-100">
                  {g.items.map((it) => {
                    const days = it.daysUntilExpiry;
                    // Re-derive bucket for the badge — gives consistent tone
                    // even when our aggregate severity differs from the
                    // canonical 5-bucket ExpiryStatus.
                    const status: ExpiryStatus =
                      it.expiryDate
                        ? getExpiryStatus(it.expiryDate)
                        : days !== null && days < 0
                          ? "expired"
                          : "watch";
                    const href = buildHref(it.refKind, it.refId);
                    return (
                      <li
                        key={`${it.refKind}-${it.refId}-${it.expiryDate ?? ""}`}
                        className="px-4 py-3 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
                      >
                        <ExpiryBadge
                          status={status}
                          days={days ?? daysFn(it.expiryDate ?? new Date())}
                        />
                        <Link
                          href={href}
                          className="flex-1 min-w-0 group"
                        >
                          <p className="font-medium text-zinc-900 truncate group-hover:text-[var(--color-brand-700)] transition-colors">
                            {it.label}
                          </p>
                          {it.subLabel && (
                            <p className="text-xs text-zinc-500 mt-0.5 truncate">
                              {it.subLabel}
                            </p>
                          )}
                        </Link>
                        <Link
                          href={href}
                          className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] shrink-0"
                        >
                          ดู
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </li>
                    );
                  })}
                  {g.count > g.items.length && (
                    <li className="px-4 py-2.5 text-xs text-zinc-500 text-center bg-zinc-50/60">
                      ... และอีก {g.count - g.items.length} รายการในหมวดนี้
                    </li>
                  )}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

function buildHref(
  kind: "document" | "vehicle" | "person",
  id: string,
): string {
  switch (kind) {
    case "document":
      return `/docuflow/documents/${id}`;
    case "vehicle":
      return `/docuflow/vehicles/${id}`;
    case "person":
      return `/docuflow/persons/${id}`;
  }
}
