// /recruit/postings/[id] — Posting detail + editor + applicant insights
// Redesigned per Recruit Redesign canvas (Section 02C):
// - Hero with stats strip (funnel mini bar + source chips + days open)
// - Share/QR card prominent if OPEN
// - Editor below

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess, canRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { PostingEditor } from "@/components/recruit/posting-editor";
import { PostingShareCard } from "@/components/recruit/posting-share-card";
import { CopyLinkButton } from "@/components/recruit/copy-link-button";
import {
  FormSchemaSchema,
  EMPTY_FORM_SCHEMA,
  POSTING_STATUS_LABELS,
  STATUS_LABELS,
  STATUS_TONE,
  type ApplicationStatus,
  type PostingStatus,
  type FormSchema,
} from "@/lib/recruit/types";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Calendar, Users, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

const SOURCE_META: Record<string, { label: string; color: string; bg: string; text: string }> = {
  facebook: { label: "Facebook", color: "#1877f2", bg: "bg-blue-50", text: "text-blue-700" },
  line: { label: "LINE", color: "#06c755", bg: "bg-green-50", text: "text-green-700" },
  tiktok: { label: "TikTok", color: "#000000", bg: "bg-zinc-100", text: "text-zinc-900" },
  qr: { label: "QR หน้าร้าน", color: "#f59e0b", bg: "bg-amber-50", text: "text-amber-700" },
  instagram: { label: "Instagram", color: "#e4405f", bg: "bg-pink-50", text: "text-pink-700" },
  jobsdb: { label: "JobsDB", color: "#dc2626", bg: "bg-red-50", text: "text-red-700" },
  direct: { label: "เปิดตรง", color: "#71717a", bg: "bg-zinc-100", text: "text-zinc-700" },
};

export default async function PostingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const posting = await prisma.recruitJobPosting.findFirst({
    where: { id, orgId: session.user.org_id },
    include: {
      company: { select: { id: true, name: true, code: true } },
      _count: { select: { applications: { where: { draft: false } } } },
      createdBy: { select: { name: true } },
      applications: {
        where: { draft: false },
        select: {
          id: true,
          refId: true,
          status: true,
          source: true,
          createdAt: true,
          submittedAt: true,
          aiScore: true,
          applicant: { select: { fullName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!posting) return notFound();

  const companies = await prisma.company.findMany({
    where: { orgId: session.user.org_id, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });

  let schema: FormSchema = EMPTY_FORM_SCHEMA;
  try {
    schema = FormSchemaSchema.parse(posting.fieldSchema);
  } catch {
    // fallback
  }

  const canEdit = canRecruitWrite(session.user.role);

  // Compute stats
  const apps = posting.applications;
  const counts = {
    NEW: 0,
    SCREENING: 0,
    INTERVIEW: 0,
    OFFERED: 0,
    HIRED: 0,
    REJECTED: 0,
    WITHDRAWN: 0,
  } as Record<ApplicationStatus, number>;
  const sourceCounts = new Map<string, number>();
  for (const a of apps) {
    counts[a.status as ApplicationStatus]++;
    const src = (a.source ?? "direct").toLowerCase();
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .map(([key, count]) => ({ key, count, meta: SOURCE_META[key] ?? SOURCE_META.direct }))
    .sort((a, b) => b.count - a.count);

  const opensAt = posting.opensAt ?? posting.createdAt;
  const daysOpen = Math.floor(
    (Date.now() - new Date(opensAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const total = posting._count.applications;
  const conversionRate = total > 0 ? (counts.HIRED / total) * 100 : 0;

  const recentApps = apps.slice(0, 5);

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto space-y-6">
      {/* Breadcrumb + back */}
      <div>
        <Link
          href="/recruit/postings"
          className="inline-flex items-center gap-1 h-10 -ml-2 px-2 text-sm text-zinc-500 hover:text-zinc-900 rounded-lg hover:bg-zinc-100"
        >
          <ChevronLeft className="size-4" />
          ประกาศทั้งหมด
        </Link>
      </div>

      {/* Hero */}
      <div className="rounded-3xl border-2 border-zinc-200 bg-white p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge tone={posting.status === "OPEN" ? "success" : "neutral"}>
                {POSTING_STATUS_LABELS[posting.status as PostingStatus]}
              </Badge>
              {daysOpen > 0 && posting.status === "OPEN" && (
                <span className="text-xs text-zinc-500 inline-flex items-center gap-1">
                  <Calendar className="size-3" />
                  เปิดมา {daysOpen} วัน
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-zinc-900">
              {posting.title}
            </h1>
            <p className="text-xs text-zinc-500 mt-1">
              {posting.company?.name ?? "ทั่วทุกบริษัท"} · สร้างโดย {posting.createdBy.name}
            </p>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <StatBox
            label="ใบสมัครทั้งหมด"
            value={total}
            Icon={Users}
          />
          <StatBox label="คัด+สัมภาษณ์" value={counts.SCREENING + counts.INTERVIEW} accent="warning" />
          <StatBox label="รับเข้าแล้ว" value={counts.HIRED} accent="success" />
          <StatBox
            label="Conversion"
            value={`${conversionRate.toFixed(1)}%`}
            Icon={TrendingUp}
            accent="brand"
          />
        </div>

        {/* Funnel mini bar */}
        {total > 0 && (
          <div className="mt-5">
            <p className="text-xs font-bold text-zinc-700 mb-2">
              Pipeline ของประกาศนี้
            </p>
            <div className="flex h-2 rounded-full overflow-hidden bg-zinc-100">
              <div className="bg-green-500" style={{ width: `${(counts.HIRED / total) * 100}%` }} />
              <div className="bg-purple-500" style={{ width: `${(counts.OFFERED / total) * 100}%` }} />
              <div className="bg-orange-500" style={{ width: `${(counts.INTERVIEW / total) * 100}%` }} />
              <div className="bg-amber-400" style={{ width: `${(counts.SCREENING / total) * 100}%` }} />
              <div className="bg-[var(--color-brand-500)]" style={{ width: `${(counts.NEW / total) * 100}%` }} />
            </div>
            <div className="flex justify-between mt-2 text-[11px] text-zinc-600">
              <span>
                <b className="text-zinc-900 tabular-num">{counts.NEW}</b> ใหม่
              </span>
              <span>
                <b className="tabular-num">{counts.SCREENING}</b> คัด
              </span>
              <span>
                <b className="tabular-num">{counts.INTERVIEW}</b> สัมภาษณ์
              </span>
              <span>
                <b className="tabular-num">{counts.OFFERED}</b> เสนอ
              </span>
              <span>
                <b className="tabular-num text-green-700">{counts.HIRED}</b> รับ
              </span>
            </div>
          </div>
        )}

        {/* Source breakdown */}
        {sources.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold text-zinc-700 mb-2">ที่มา</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {sources.map((s) => (
                <span
                  key={s.key}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${s.meta.bg} ${s.meta.text}`}
                >
                  <span className="size-1.5 rounded-full" style={{ background: s.meta.color }} />
                  {s.meta.label}
                  <b className="ml-0.5 tabular-num">{s.count}</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Share card (if open) */}
      {posting.status === "OPEN" && (
        <div className="rounded-3xl border-2 border-[var(--color-brand-200)] bg-gradient-to-br from-[var(--color-brand-50)]/30 to-white p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="text-xs font-bold text-[var(--color-brand-900)] uppercase tracking-wide">
                แชร์ลิ้งค์
              </p>
              <p className="text-sm text-zinc-700 mt-0.5">
                ส่งลิ้งค์นี้ไป Facebook / LINE / QR หน้าร้าน
              </p>
            </div>
            <CopyLinkButton slug={posting.slug} size="md" />
          </div>
          <PostingShareCard slug={posting.slug} title={posting.title} />
        </div>
      )}

      {/* Recent applicants quick view */}
      {recentApps.length > 0 && (
        <div className="rounded-3xl border border-zinc-200 bg-white overflow-hidden">
          <div className="p-4 border-b border-zinc-200 bg-zinc-50/60 flex items-center justify-between">
            <p className="text-sm font-bold text-zinc-900">
              ใบสมัครล่าสุด · 5 อันดับแรก
            </p>
            <Link
              href={`/recruit?posting=${posting.id}`}
              className="text-xs font-bold text-[var(--color-brand-700)] hover:underline"
            >
              ดูทั้งหมด {total} ใบ →
            </Link>
          </div>
          <div className="divide-y divide-zinc-100">
            {recentApps.map((a) => (
              <Link
                key={a.id}
                href={`/recruit/applications/${a.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50/40 transition-colors group"
              >
                <div className="size-9 rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                  {a.applicant.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-900 group-hover:text-[var(--color-brand-700)]">
                    {a.applicant.fullName}
                  </p>
                  <p className="text-xs text-zinc-500 font-mono">
                    #{a.refId.slice(-6)} ·{" "}
                    {a.submittedAt
                      ? new Date(a.submittedAt).toLocaleDateString("th-TH")
                      : "ฉบับร่าง"}
                  </p>
                </div>
                {a.aiScore != null && (
                  <span
                    className={`text-sm font-bold tabular-num ${
                      a.aiScore >= 75
                        ? "text-green-700"
                        : a.aiScore >= 50
                          ? "text-amber-700"
                          : "text-red-700"
                    }`}
                  >
                    AI {a.aiScore}
                  </span>
                )}
                <Badge tone={STATUS_TONE[a.status as ApplicationStatus]}>
                  {STATUS_LABELS[a.status as ApplicationStatus]}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Editor */}
      <PostingEditor
        mode={canEdit ? "edit" : "view"}
        postingId={posting.id}
        companies={companies}
        initialData={{
          title: posting.title,
          description: posting.description ?? "",
          companyId: posting.companyId,
          opensAt: posting.opensAt?.toISOString().slice(0, 10) ?? null,
          closesAt: posting.closesAt?.toISOString().slice(0, 10) ?? null,
          fieldSchema: schema,
          status: posting.status as PostingStatus,
        }}
        canPublish={canEdit && posting.status === "DRAFT"}
        canClose={canEdit && posting.status === "OPEN"}
      />
    </div>
  );
}

function StatBox({
  label,
  value,
  Icon,
  accent,
}: {
  label: string;
  value: number | string;
  Icon?: React.ComponentType<{ className?: string }>;
  accent?: "warning" | "success" | "brand";
}) {
  const cls = accent
    ? { warning: "text-amber-700", success: "text-green-700", brand: "text-[var(--color-brand-700)]" }[accent]
    : "text-zinc-900";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/30 p-3">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-zinc-400" />}
        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
          {label}
        </p>
      </div>
      <p className={`text-xl sm:text-2xl font-extrabold font-display tabular-num mt-1.5 ${cls}`}>
        {value}
      </p>
    </div>
  );
}
