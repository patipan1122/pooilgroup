// /recruit — Applications Inbox (default landing)
// Multi-pane workspace: filter bar | list | detail link
// CEO preference [[ceo-prefers-multi-pane-workspace]]
// Dashboard KPI strip at top (CEO needs 30-second overview · per UX audit)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { ApplicationsInbox } from "@/components/recruit/applications-inbox";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import {
  FileText,
  Inbox as InboxIcon,
  Sparkles,
  FileQuestion,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  status?: string;
  posting?: string;
  q?: string;
  selected?: string;
}

export default async function RecruitInboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;

  const statusFilter = (
    params.status && APPLICATION_STATUSES.includes(params.status as ApplicationStatus)
      ? params.status
      : null
  ) as ApplicationStatus | null;

  // Counts by status for filter sidebar
  const [counts, postings, postingsCount] = await Promise.all([
    prisma.recruitApplication.groupBy({
      by: ["status"],
      where: { orgId: session.user.org_id, draft: false },
      _count: { _all: true },
    }),
    prisma.recruitJobPosting.findMany({
      where: { orgId: session.user.org_id, status: { in: ["OPEN", "CLOSED"] } },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.recruitJobPosting.count({ where: { orgId: session.user.org_id } }),
  ]);

  const countMap: Record<ApplicationStatus, number> = {
    NEW: 0,
    SCREENING: 0,
    INTERVIEW: 0,
    OFFERED: 0,
    HIRED: 0,
    REJECTED: 0,
    WITHDRAWN: 0,
  };
  for (const c of counts) countMap[c.status as ApplicationStatus] = c._count._all;

  // Empty system → onboarding state
  if (postingsCount === 0) {
    return (
      <div className="p-6 sm:p-10 max-w-4xl mx-auto">
        <Section number="01" label="รับสมัครพนักงาน" title="ยินดีต้อนรับสู่โปรแกรมรับสมัครพนักงาน">
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-10 text-center">
            <div className="size-16 mx-auto rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] flex items-center justify-center text-[var(--color-brand-700)]">
              <FileQuestion className="size-7" />
            </div>
            <h3 className="mt-5 text-2xl font-extrabold tracking-tight text-zinc-900 font-display">
              เริ่มสร้างประกาศแรก
            </h3>
            <p className="mt-2 text-sm text-zinc-600 max-w-md mx-auto leading-relaxed">
              สร้างประกาศรับสมัครงาน → ได้ลิ้งค์ + QR ทันที →
              เอาไปแปะ Facebook / LINE / หน้าร้านได้เลย
            </p>
            <Link
              href="/recruit/postings/new"
              className="inline-flex items-center gap-2 mt-6 rounded-xl bg-[var(--color-brand-600)] text-white px-5 h-12 font-bold hover:bg-[var(--color-brand-700)] transition-colors"
            >
              สร้างประกาศแรก
            </Link>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <FeatureMini
                Icon={FileText}
                title="สร้างฟอร์ม"
                desc="เลือก field ตามต้องการ · 10 ชนิด · AI ช่วยแนะนำ"
              />
              <FeatureMini
                Icon={InboxIcon}
                title="รับใบสมัคร"
                desc="เก็บถาวร · ค้นได้ตลอด · pipeline ตาม status"
              />
              <FeatureMini
                Icon={Sparkles}
                title="AI ช่วยคัด"
                desc="กดประเมินรายคน · ไม่ auto · ประหยัด"
              />
            </div>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <ApplicationsInbox
      orgId={session.user.org_id}
      currentStatus={statusFilter}
      currentPosting={params.posting ?? null}
      currentQuery={params.q ?? ""}
      currentSelectedId={params.selected ?? null}
      countMap={countMap}
      postings={postings}
      postingsCount={postingsCount}
      canWrite={["super_admin","org_admin","admin","area_manager","branch_manager"].includes(session.user.role)}
    />
  );
}

function FeatureMini({
  Icon,
  title,
  desc,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border-2 border-zinc-200 p-5 bg-zinc-50/40">
      <div className="size-10 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] flex items-center justify-center">
        <Icon className="size-5" />
      </div>
      <p className="mt-3 font-bold text-zinc-900 text-sm">{title}</p>
      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{desc}</p>
    </div>
  );
}
