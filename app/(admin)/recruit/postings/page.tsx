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
import { requireRecruitAccess, canRecruitWrite } from "@/lib/recruit/role-guard";
import { Section } from "@/components/ui/section";
import {
  POSTING_STATUS_LABELS,
  type PostingStatus,
} from "@/lib/recruit/types";
import { Plus, FileQuestion, Tag } from "lucide-react";
import { PostingsGrid } from "@/components/recruit/postings-grid";
import { resolveCompanyFilter } from "@/lib/auth/company-context";
import { postingCompanyScope } from "@/lib/recruit/company-scope";

export const dynamic = "force-dynamic";

async function loadPostings(
  orgId: string,
  filter?: PostingStatus,
  companyId?: string,
  tag?: string,
) {
  const postings = await prisma.recruitJobPosting.findMany({
    where: {
      orgId,
      ...(filter ? { status: filter } : {}),
      // กรองตามบริษัทที่เลือกบน "ตัวสลับด้านบน" — CEO 2026-10-10: ไม่มี "ทุกบริษัท"
      // อีกแล้ว, resolveCompanyFilter คืนบริษัทจริงเสมอ. แก้ 2026-10-11: ประกาศงาน
      // ที่ไม่ได้ผูกบริษัทไว้ (companyId เป็น NULL โดยตั้งใจตั้งแต่ออกแบบ — มีจริง
      // 32/52 รายการ) ต้องโชว์เสมอไม่ว่าจะเลือกบริษัทไหน ไม่ใช่กรองแบบตรงเป๊ะอย่างเดียว
      // (ของเดิมกรองแบบตรงเป๊ะทำให้ 62% ของประกาศงานหายไปจากทุกมุมมอง).
      ...postingCompanyScope(companyId ?? ""),
      ...(tag ? { tags: { has: tag } } : {}),
    },
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
    let lastAppliedAt: Date | null = null;
    const day = 24 * 60 * 60 * 1000;

    for (const a of apps) {
      counts[a.status as keyof typeof counts]++;
      const src = (a.source ?? "direct").toLowerCase();
      sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
      if (a.submittedAt) {
        const submitted = new Date(a.submittedAt);
        if (now - submitted.getTime() < day) recentCount++;
        if (!lastAppliedAt || submitted > lastAppliedAt) lastAppliedAt = submitted;
      }
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
      lastAppliedAt,
      daysOpen,
      urgent,
    };
  });
}

export default async function PostingsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; company?: string; tag?: string }>;
}) {
  const session = await requireSession();
  await requireRecruitAccess(session.user);
  const params = await searchParams;
  const filter = params.status as PostingStatus | undefined;
  const companyFilter = await resolveCompanyFilter(session.user.org_id, params.company);
  const tagFilter = params.tag || undefined;

  const postings = await loadPostings(
    session.user.org_id,
    filter,
    companyFilter,
    tagFilter,
  );

  // แท็กทั้งหมดที่เคยมีในองค์กร (ไม่กรองตามสถานะ) — โชว์เป็นปุ่มกรองคงที่ ไม่หายไปมาตามฟิลเตอร์อื่น
  const tagRows = await prisma.recruitJobPosting.findMany({
    where: { orgId: session.user.org_id },
    select: { tags: true },
  });
  const allTags = [...new Set(tagRows.flatMap((r) => r.tags))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );

  const canWrite = await canRecruitWrite(session.user);

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
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
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <FilterChip
            href={buildPostingsHref(undefined, tagFilter)}
            label="ทั้งหมด"
            active={!filter}
          />
          {(["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as PostingStatus[]).map((s) => (
            <FilterChip
              key={s}
              href={buildPostingsHref(s, tagFilter)}
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

        {/* Group filter chips (field เดิมคือ tags — ใช้เป็น "กลุ่ม" ของ CEO) */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 mb-5 flex-wrap">
            <Tag className="size-3.5 text-zinc-400" />
            <span className="text-xs font-semibold text-zinc-500">กลุ่ม:</span>
            {allTags.map((t) => (
              <FilterChip
                key={t}
                href={buildPostingsHref(filter, tagFilter === t ? undefined : t)}
                label={t}
                active={tagFilter === t}
              />
            ))}
          </div>
        )}

        {postings.length === 0 ? (
          <EmptyState filter={filter} canWrite={canWrite} />
        ) : (
          <PostingsGrid postings={postings} canWrite={canWrite} orgTags={allTags} />
        )}
      </Section>
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

// รักษาทั้ง status + tag ไว้ด้วยกันตอนสลับตัวกรองใดตัวหนึ่ง (กรองซ้อนกันได้)
function buildPostingsHref(status?: PostingStatus, tag?: string): string {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (tag) qs.set("tag", tag);
  const s = qs.toString();
  return s ? `/recruit/postings?${s}` : "/recruit/postings";
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
