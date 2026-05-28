// /recruit/talent-pool — past applicants that HR can re-engage
// Reads from existing recruit_applicants + recruit_applications (no new schema)
// Per Recruit Redesign canvas screen 11A (TalentPoolDesktop)
//
// Definition of "talent pool":
// - REJECTED + > 60 days ago → talent pool (retention)
// - HIRED applicants who left (cannot detect · skip for now)
// - Applicants with multiple submissions
// - High AI score applicants who were NOT hired

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Users, Sparkles, MessageCircle, Phone, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  filter?: "all" | "rejected" | "high-score" | "repeat" | "withdrawn";
  q?: string;
}

export default async function TalentPoolPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;
  const filter = params.filter ?? "all";
  const q = params.q ?? "";

  // Pull applicants with their applications · last 90 days window
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const applicants = await prisma.recruitApplicant.findMany({
    where: {
      orgId: session.user.org_id,
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      applications: {
        where: { draft: false },
        select: {
          id: true,
          status: true,
          aiScore: true,
          createdAt: true,
          submittedAt: true,
          posting: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Compute pool segmentation
  const pool = applicants
    .map((a) => {
      const apps = a.applications;
      if (apps.length === 0) return null;
      const latest = apps[0];
      const maxScore = apps.reduce(
        (m, x) => (x.aiScore != null && x.aiScore > m ? x.aiScore : m),
        0,
      );
      const allStatuses = apps.map((x) => x.status);
      const hasRejected = allStatuses.includes("REJECTED");
      const hasHired = allStatuses.includes("HIRED");
      const isWithdrawn = allStatuses.every((s) => s === "WITHDRAWN");
      const submissionCount = apps.length;
      const latestSubmittedAt = latest.submittedAt ?? latest.createdAt;
      const daysSince = Math.floor(
        (Date.now() - new Date(latestSubmittedAt).getTime()) / (24 * 60 * 60 * 1000),
      );

      // Skip currently active applicants (active = NEW/SCREENING/INTERVIEW/OFFERED on most recent)
      const activeStatuses = ["NEW", "SCREENING", "INTERVIEW", "OFFERED"];
      if (activeStatuses.includes(latest.status)) return null;
      if (hasHired) return null; // Don't re-engage currently hired

      // Tag the kind of pool entry
      const tags: string[] = [];
      if (hasRejected && daysSince > 60) tags.push("rejected");
      if (maxScore >= 75) tags.push("high-score");
      if (submissionCount >= 2) tags.push("repeat");
      if (isWithdrawn) tags.push("withdrawn");

      if (tags.length === 0) return null;

      return {
        id: a.id,
        fullName: a.fullName,
        phone: a.phone,
        email: a.email,
        createdAt: a.createdAt,
        maxScore,
        submissionCount,
        daysSince,
        tags,
        latestStatus: latest.status,
        latestPosting: latest.posting.title,
        latestSubmittedAt,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Filter by tab
  const filtered =
    filter === "all"
      ? pool
      : pool.filter((p) => p.tags.includes(filter));

  // Stats per filter
  const stats = {
    all: pool.length,
    rejected: pool.filter((p) => p.tags.includes("rejected")).length,
    "high-score": pool.filter((p) => p.tags.includes("high-score")).length,
    repeat: pool.filter((p) => p.tags.includes("repeat")).length,
    withdrawn: pool.filter((p) => p.tags.includes("withdrawn")).length,
  };

  // Open postings count (for "smart suggestion" banner)
  const openPostings = await prisma.recruitJobPosting.count({
    where: { orgId: session.user.org_id, status: "OPEN" },
  });

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="11"
        label="Talent Pool"
        title="คนเก่าที่น่าเรียกกลับ"
        description="คนที่เคยสมัครงานกับเรา · ที่ AI ประเมินสูง · ที่สมัครหลายครั้ง — กลับมาเชิญสมัครรอบใหม่ได้"
      >
        {/* Smart suggestion banner */}
        {stats["high-score"] > 0 && openPostings > 0 && (
          <div className="rounded-2xl bg-gradient-to-br from-[var(--color-brand-50)] to-white border border-[var(--color-brand-200)] p-4 mb-5 flex items-center gap-3">
            <Sparkles className="size-5 text-[var(--color-brand-600)] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-[var(--color-brand-800)]">
                AI แนะนำ
              </p>
              <p className="text-xs text-zinc-700 mt-1 leading-relaxed">
                มี <b>{stats["high-score"]} คน</b> ใน Pool ที่ได้คะแนน AI ≥ 75 ·
                {openPostings} ตำแหน่งกำลังเปิดอยู่ — ลองเชิญกลับมาสมัครได้
              </p>
            </div>
            <Link
              href="/recruit/talent-pool?filter=high-score"
              className="h-10 px-4 bg-[var(--color-brand-600)] text-white rounded-lg font-bold text-xs hover:bg-[var(--color-brand-700)] flex items-center gap-1"
            >
              ดูทั้งหมด
              <ChevronRight className="size-3" />
            </Link>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          <FilterTab href="/recruit/talent-pool" label="ทั้งหมด" count={stats.all} active={filter === "all"} />
          <FilterTab
            href="/recruit/talent-pool?filter=high-score"
            label="AI score สูง"
            count={stats["high-score"]}
            active={filter === "high-score"}
            tone="success"
          />
          <FilterTab
            href="/recruit/talent-pool?filter=repeat"
            label="สมัครหลายครั้ง"
            count={stats.repeat}
            active={filter === "repeat"}
            tone="brand"
          />
          <FilterTab
            href="/recruit/talent-pool?filter=rejected"
            label="เคยไม่ผ่าน"
            count={stats.rejected}
            active={filter === "rejected"}
            tone="neutral"
          />
          <FilterTab
            href="/recruit/talent-pool?filter=withdrawn"
            label="ถอนไป"
            count={stats.withdrawn}
            active={filter === "withdrawn"}
            tone="neutral"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-zinc-50/60 border-b border-zinc-200 text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
              <div className="col-span-4">คน + เบอร์</div>
              <div className="col-span-3">เคยสมัคร</div>
              <div className="col-span-2 text-center">AI สูงสุด</div>
              <div className="col-span-2">ประเภท</div>
              <div className="col-span-1" />
            </div>
            {/* Rows */}
            <div className="divide-y divide-zinc-100">
              {filtered.slice(0, 50).map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-zinc-50/40 transition-colors"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <div className="size-9 rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {p.fullName.trim().charAt(0).toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-900 truncate">{p.fullName}</p>
                      <p className="text-xs text-zinc-500 font-mono truncate">{p.phone}</p>
                    </div>
                  </div>
                  <div className="col-span-3">
                    <p className="text-sm text-zinc-900 truncate">{p.latestPosting}</p>
                    <p className="text-xs text-zinc-500">
                      {p.submissionCount > 1 ? `${p.submissionCount} ครั้ง · ` : ""}
                      {p.daysSince}d ที่แล้ว
                    </p>
                  </div>
                  <div className="col-span-2 text-center">
                    {p.maxScore > 0 ? (
                      <p
                        className={`text-lg font-extrabold font-display ${
                          p.maxScore >= 75
                            ? "text-green-700"
                            : p.maxScore >= 50
                              ? "text-amber-700"
                              : "text-zinc-400"
                        }`}
                      >
                        {p.maxScore}
                      </p>
                    ) : (
                      <span className="text-zinc-300 text-xs">—</span>
                    )}
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <PoolTag key={t} kind={t} />
                    ))}
                  </div>
                  <div className="col-span-1 flex justify-end gap-1">
                    <a
                      href={`tel:${p.phone.replace(/[^0-9+]/g, "")}`}
                      title="โทรหา"
                      className="size-8 rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-green-50 hover:text-green-700 flex items-center justify-center"
                    >
                      <Phone className="size-3.5" />
                    </a>
                    <a
                      href={`sms:${p.phone.replace(/[^0-9+]/g, "")}`}
                      title="ส่ง SMS"
                      className="size-8 rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-blue-50 hover:text-blue-700 flex items-center justify-center"
                    >
                      <MessageCircle className="size-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
            {filtered.length > 50 && (
              <div className="p-3 bg-zinc-50/40 border-t border-zinc-200 text-center">
                <p className="text-xs text-zinc-500">
                  แสดง 50 จาก {filtered.length} · ใช้ค้นหาด้านบนเพื่อหาคนเฉพาะ
                </p>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function FilterTab({
  href,
  label,
  count,
  active,
  tone = "neutral",
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  tone?: "brand" | "success" | "neutral";
}) {
  const activeClass = {
    brand: "bg-[var(--color-brand-50)] border-[var(--color-brand-500)] text-[var(--color-brand-800)]",
    success: "bg-green-50 border-green-500 text-green-800",
    neutral: "bg-zinc-100 border-zinc-400 text-zinc-900",
  }[tone];
  return (
    <Link
      href={href}
      className={`text-xs h-10 px-4 inline-flex items-center gap-1.5 rounded-full font-medium border transition-colors ${
        active ? activeClass : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {label}
      <span
        className={`text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-full ${
          active ? "bg-white/60" : "bg-zinc-100"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

function PoolTag({ kind }: { kind: string }) {
  const meta = {
    "high-score": { label: "AI สูง", className: "bg-green-100 text-green-800" },
    repeat: { label: "หลายครั้ง", className: "bg-[var(--color-brand-100)] text-[var(--color-brand-800)]" },
    rejected: { label: "ไม่ผ่าน", className: "bg-red-100 text-red-800" },
    withdrawn: { label: "ถอน", className: "bg-zinc-200 text-zinc-700" },
  }[kind] ?? { label: kind, className: "bg-zinc-100 text-zinc-600" };
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
      <Users className="size-12 mx-auto text-zinc-300" />
      <p className="mt-4 font-bold text-zinc-900">
        {filter === "all"
          ? "ยังไม่มีคนใน Pool"
          : "ไม่มีคนในตัวกรองนี้"}
      </p>
      <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto leading-relaxed">
        Pool คือคนที่เคยสมัครงานกับเรา (ไม่ผ่าน · ถอน · หรือสมัครหลายครั้ง) ·
        จะแสดงเองหลังมีการคัดออก/ปฏิเสธใบสมัคร
      </p>
    </div>
  );
}
