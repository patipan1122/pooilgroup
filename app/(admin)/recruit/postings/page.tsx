// /recruit/postings — list of all job postings
// Redesigned per Recruit Redesign canvas (2026-05-21):
// - Funnel mini bar showing pipeline per posting
// - Source breakdown chips (FB / LINE / TikTok / QR)
// - Share link pill + copy button
// - Urgent badge if days open > 7 and < 5 hires
// - "+ N ใหม่" badge for applications in last 24h

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import {
  POSTING_STATUS_LABELS,
  type PostingStatus,
} from "@/lib/recruit/types";
import { Plus, FileQuestion, Link as LinkIcon, Copy, Flame } from "lucide-react";
import { CopyLinkButton } from "@/components/recruit/copy-link-button";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<PostingStatus, "neutral" | "brand" | "success" | "warning"> = {
  DRAFT: "neutral",
  OPEN: "success",
  CLOSED: "warning",
  ARCHIVED: "neutral",
};

const SOURCE_LABELS: Record<string, { label: string; color: string; bgClass: string; textClass: string }> = {
  facebook: { label: "Facebook", color: "#1877f2", bgClass: "bg-blue-50", textClass: "text-blue-700" },
  line: { label: "LINE", color: "#06c755", bgClass: "bg-green-50", textClass: "text-green-700" },
  tiktok: { label: "TikTok", color: "#000000", bgClass: "bg-zinc-100", textClass: "text-zinc-900" },
  qr: { label: "QR หน้าร้าน", color: "#f59e0b", bgClass: "bg-amber-50", textClass: "text-amber-700" },
  instagram: { label: "Instagram", color: "#e4405f", bgClass: "bg-pink-50", textClass: "text-pink-700" },
  jobsdb: { label: "JobsDB", color: "#dc2626", bgClass: "bg-red-50", textClass: "text-red-700" },
  direct: { label: "เปิดตรง", color: "#71717a", bgClass: "bg-zinc-100", textClass: "text-zinc-700" },
};

type PostingWithStats = Awaited<ReturnType<typeof loadPostings>>[number];

async function loadPostings(orgId: string, filter?: PostingStatus) {
  const postings = await prisma.recruitJobPosting.findMany({
    where: { orgId, ...(filter ? { status: filter } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { applications: { where: { draft: false } } } },
      company: { select: { name: true, code: true } },
      applications: {
        where: { draft: false },
        select: { status: true, source: true, submittedAt: true },
      },
    },
  });

  const now = Date.now();
  return postings.map((p) => {
    const apps = p.applications;
    const counts = {
      NEW: 0,
      SCREENING: 0,
      INTERVIEW: 0,
      OFFERED: 0,
      HIRED: 0,
      REJECTED: 0,
      WITHDRAWN: 0,
    };
    const sourceCounts = new Map<string, number>();
    let recentCount = 0;
    const day = 24 * 60 * 60 * 1000;

    for (const a of apps) {
      counts[a.status as keyof typeof counts]++;
      const src = (a.source ?? "direct").toLowerCase();
      sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
      if (a.submittedAt && now - new Date(a.submittedAt).getTime() < day) recentCount++;
    }

    const opensAt = p.opensAt ?? p.createdAt;
    const daysOpen = Math.floor((now - new Date(opensAt).getTime()) / day);
    const urgent = p.status === "OPEN" && daysOpen > 7 && counts.HIRED < 1;

    const sources = [...sourceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, count]) => ({ key: k, count }));

    return {
      ...p,
      counts,
      sources,
      recentCount,
      daysOpen,
      urgent,
    };
  });
}

export default async function PostingsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;
  const filter = params.status as PostingStatus | undefined;

  const postings = await loadPostings(session.user.org_id, filter);

  const canWrite = ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"]
    .includes(session.user.role);

  return (
    <div className="p-5 sm:p-8 max-w-6xl mx-auto">
      <Section
        number="01"
        label="ประกาศ"
        title="ประกาศรับสมัครงานทั้งหมด"
        description="สร้างประกาศ → ได้ลิ้งค์ + QR ทันที → แชร์ Facebook / LINE / หน้าร้าน"
        action={
          canWrite && (
            <Link
              href="/recruit/postings/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand-600)] text-white px-4 h-11 font-bold hover:bg-[var(--color-brand-700)] transition-colors"
            >
              <Plus className="size-4" />
              ประกาศใหม่
            </Link>
          )
        }
      >
        {/* Filter chips */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          <FilterChip href="/recruit/postings" label="ทั้งหมด" active={!filter} />
          {(["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as PostingStatus[]).map((s) => (
            <FilterChip
              key={s}
              href={`/recruit/postings?status=${s}`}
              label={POSTING_STATUS_LABELS[s]}
              active={filter === s}
            />
          ))}
          <Link
            href="/recruit"
            className="text-xs h-10 px-3 inline-flex items-center rounded-full font-medium text-zinc-500 hover:text-[var(--color-brand-700)] hover:bg-zinc-50"
          >
            → ดูใบสมัคร
          </Link>
        </div>

        {postings.length === 0 ? (
          <EmptyState filter={filter} canWrite={canWrite} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {postings.map((p) => (
              <PostingCard key={p.id} posting={p} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function PostingCard({ posting }: { posting: PostingWithStats }) {
  const { counts, sources, recentCount, daysOpen, urgent } = posting;
  const apply = posting._count.applications;
  const hasApps = apply > 0;

  return (
    <div
      className={`relative rounded-3xl border-2 bg-white p-5 transition-colors group flex flex-col gap-3 ${
        urgent
          ? "border-amber-300 bg-gradient-to-b from-amber-50/40 to-white"
          : "border-zinc-200 hover:border-[var(--color-brand-300)]"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={STATUS_TONE[posting.status as PostingStatus]}>
            {POSTING_STATUS_LABELS[posting.status as PostingStatus]}
          </Badge>
          {urgent && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
              <Flame className="size-3" />
              เร่งด่วน
            </span>
          )}
        </div>
        {daysOpen > 0 && posting.status === "OPEN" && (
          <span className="text-[11px] text-zinc-500">
            เปิดมา <b className="text-zinc-700">{daysOpen}</b> วัน
          </span>
        )}
      </div>

      {/* Title + company */}
      <Link href={`/recruit/postings/${posting.id}`} className="block group/title">
        <h3 className="text-lg font-extrabold text-zinc-900 tracking-tight font-display group-hover/title:text-[var(--color-brand-700)]">
          {posting.title}
        </h3>
        {posting.company && (
          <p className="text-xs text-zinc-500 mt-1">
            {posting.company.name}
          </p>
        )}
      </Link>

      {/* Funnel mini bar */}
      {hasApps ? (
        <MiniFunnel
          apply={apply}
          screen={counts.SCREENING}
          interview={counts.INTERVIEW}
          offer={counts.OFFERED}
          hired={counts.HIRED}
        />
      ) : (
        <div className="py-3 text-center text-xs text-zinc-400 border-y border-dashed border-zinc-200">
          ยังไม่มีใบสมัคร — กด &ldquo;แชร์&rdquo; ด้านล่างเพื่อรับใบสมัคร
        </div>
      )}

      {/* Sources + new */}
      {(sources.length > 0 || recentCount > 0) && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {sources.map((s) => {
              const meta = SOURCE_LABELS[s.key] ?? SOURCE_LABELS.direct;
              return (
                <span
                  key={s.key}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${meta.bgClass} ${meta.textClass}`}
                  title={`${meta.label} · ${s.count} ใบ`}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: meta.color }}
                  />
                  {meta.label}
                  <b className="ml-0.5 tabular-num">{s.count}</b>
                </span>
              );
            })}
          </div>
          {recentCount > 0 && (
            <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
              ● {recentCount} ใหม่ 24h
            </span>
          )}
        </div>
      )}

      {/* Share link + actions */}
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 min-w-0 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-600">
          <LinkIcon className="size-3 text-zinc-400 shrink-0" />
          <span className="truncate">/apply/{posting.slug}</span>
        </div>
        <CopyLinkButton slug={posting.slug} />
        <Link
          href={`/recruit?posting=${posting.id}`}
          className="text-xs h-9 px-3 inline-flex items-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-bold hover:bg-[var(--color-brand-100)] whitespace-nowrap"
        >
          ดู {apply} ใบ →
        </Link>
      </div>
    </div>
  );
}

function MiniFunnel({
  apply,
  screen,
  interview,
  offer,
  hired,
}: {
  apply: number;
  screen: number;
  interview: number;
  offer: number;
  hired: number;
}) {
  const total = Math.max(apply, 1);
  // "new" bucket = apply minus those who moved on (rough viz)
  const newBucket = Math.max(apply - screen - interview - offer - hired, 0);
  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-100">
        <div className="bg-green-500" style={{ width: `${(hired / total) * 100}%` }} />
        <div className="bg-purple-500" style={{ width: `${(offer / total) * 100}%` }} />
        <div className="bg-orange-500" style={{ width: `${(interview / total) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(screen / total) * 100}%` }} />
        <div
          className="bg-[var(--color-brand-500)]"
          style={{ width: `${(newBucket / total) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-[11px] text-zinc-600">
        <span>
          <b className="text-zinc-900 tabular-num">{apply}</b> สมัคร
        </span>
        <span>
          คัด <b className="tabular-num">{screen}</b>
        </span>
        <span>
          สัมภาษณ์ <b className="tabular-num">{interview}</b>
        </span>
        <span>
          เสนอ <b className="tabular-num">{offer}</b>
        </span>
        <span>
          รับ <b className="tabular-num text-green-700">{hired}</b>
        </span>
      </div>
    </div>
  );
}

function EmptyState({
  filter,
  canWrite,
}: {
  filter?: PostingStatus;
  canWrite: boolean;
}) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
      <FileQuestion className="size-12 mx-auto text-zinc-300" />
      <p className="mt-4 font-bold text-zinc-900">
        {filter
          ? `ยังไม่มีประกาศใน "${POSTING_STATUS_LABELS[filter]}"`
          : "ยังไม่มีประกาศ"}
      </p>
      <p className="text-sm text-zinc-500 mt-1">
        สร้างประกาศ → ได้ลิ้งค์ + QR ทันที → แชร์ใน Facebook / LINE
      </p>
      {canWrite && (
        <Link
          href="/recruit/postings/new"
          className="inline-flex items-center gap-2 mt-5 rounded-xl bg-[var(--color-brand-600)] text-white px-5 h-11 font-bold hover:bg-[var(--color-brand-700)]"
        >
          <Plus className="size-4" />
          สร้างประกาศแรก
        </Link>
      )}
    </div>
  );
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`text-xs h-10 px-4 inline-flex items-center rounded-full font-medium border transition-colors ${
        active
          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {label}
    </Link>
  );
}
