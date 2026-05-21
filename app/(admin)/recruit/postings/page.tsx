// /recruit/postings — list of all job postings

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
import { thaiDateLong } from "@/lib/utils/format";
import { Plus, FileQuestion } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<PostingStatus, "neutral" | "brand" | "success" | "warning"> = {
  DRAFT: "neutral",
  OPEN: "success",
  CLOSED: "warning",
  ARCHIVED: "neutral",
};

export default async function PostingsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;
  const filter = params.status as PostingStatus | undefined;

  const postings = await prisma.recruitJobPosting.findMany({
    where: {
      orgId: session.user.org_id,
      ...(filter ? { status: filter } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { applications: { where: { draft: false } } } },
      company: { select: { name: true, code: true } },
    },
  });

  const canWrite = ["super_admin","org_admin","admin","area_manager","branch_manager"]
    .includes(session.user.role);

  return (
    <div className="p-5 sm:p-8 max-w-6xl mx-auto">
      <Section
        number="01"
        label="ประกาศ"
        title="ประกาศรับสมัครงานทั้งหมด"
        description="สร้างประกาศ → ได้ลิ้งค์ + QR ทันที"
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
        <div className="flex gap-1.5 mb-4 flex-wrap">
          <FilterChip href="/recruit/postings" label="ทั้งหมด" active={!filter} />
          {(["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as PostingStatus[]).map((s) => (
            <FilterChip
              key={s}
              href={`/recruit/postings?status=${s}`}
              label={POSTING_STATUS_LABELS[s]}
              active={filter === s}
            />
          ))}
        </div>

        {postings.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
            <FileQuestion className="size-12 mx-auto text-zinc-300" />
            <p className="mt-4 font-bold text-zinc-900">ยังไม่มีประกาศ</p>
            <p className="text-sm text-zinc-500 mt-1">
              สร้างประกาศแรกได้ที่ปุ่มมุมขวาบน
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {postings.map((p) => (
              <Link
                key={p.id}
                href={`/recruit/postings/${p.id}`}
                className="rounded-3xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Badge tone={STATUS_TONE[p.status as PostingStatus]}>
                    {POSTING_STATUS_LABELS[p.status as PostingStatus]}
                  </Badge>
                  {p.company && (
                    <span className="text-xs text-zinc-500">{p.company.name}</span>
                  )}
                </div>
                <h3 className="text-lg font-extrabold text-zinc-900 tracking-tight font-display">
                  {p.title}
                </h3>
                {p.description && (
                  <p className="text-xs text-zinc-500 mt-1.5 line-clamp-2">
                    {p.description}
                  </p>
                )}
                <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">
                    <span className="font-bold tabular-num text-zinc-900">
                      {p._count.applications}
                    </span>{" "}
                    ใบสมัคร
                  </span>
                  <span className="text-zinc-400">
                    {thaiDateLong(p.createdAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
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
      className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
        active
          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {label}
    </Link>
  );
}
