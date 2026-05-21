// /recruit/pipeline — Kanban view by status

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess, canRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { type ApplicationStatus } from "@/lib/recruit/types";
import { PipelineColumn } from "@/components/recruit/pipeline-column";
import { PipelineFilter } from "@/components/recruit/pipeline-filter";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ posting?: string }>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;
  const filter = params.posting;

  const [postings, apps] = await Promise.all([
    prisma.recruitJobPosting.findMany({
      where: {
        orgId: session.user.org_id,
        status: { in: ["OPEN", "CLOSED"] },
      },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.recruitApplication.findMany({
      where: {
        orgId: session.user.org_id,
        draft: false,
        ...(filter ? { postingId: filter } : {}),
        status: { notIn: ["WITHDRAWN"] },
      },
      include: {
        applicant: { select: { fullName: true, phone: true } },
        posting: { select: { title: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: 300,
    }),
  ]);

  const grouped: Record<ApplicationStatus, typeof apps> = {
    NEW: [],
    SCREENING: [],
    INTERVIEW: [],
    OFFERED: [],
    HIRED: [],
    REJECTED: [],
    WITHDRAWN: [],
  };
  for (const a of apps) grouped[a.status as ApplicationStatus].push(a);

  const canWrite = canRecruitWrite(session.user.role);
  const showStatuses: ApplicationStatus[] = [
    "NEW",
    "SCREENING",
    "INTERVIEW",
    "OFFERED",
    "HIRED",
    "REJECTED",
  ];

  return (
    <div className="p-5 sm:p-8">
      <Section
        number="📊"
        label="PIPELINE"
        title="Pipeline ใบสมัครงาน"
        description="ดูใบสมัครเรียงตาม status · กดเข้าใบเพื่อดู / เปลี่ยน status"
        action={<PipelineFilter postings={postings} currentValue={filter} />}
      >
        {/* Horizontal scroll on mobile · grid on desktop */}
        <div className="overflow-x-auto -mx-5 sm:mx-0 pb-4">
          <div className="flex gap-3 px-5 sm:px-0 min-w-max sm:min-w-0 sm:grid sm:grid-cols-3 lg:grid-cols-6">
            {showStatuses.map((s) => (
              <PipelineColumn
                key={s}
                status={s}
                applications={grouped[s].map((a) => ({
                  id: a.id,
                  applicantName: a.applicant.fullName,
                  phone: a.applicant.phone,
                  posting: a.posting.title,
                  aiScore: a.aiScore,
                  starRating: a.starRating,
                  flagged: a.flaggedBlacklist,
                  refId: a.refId,
                }))}
                canWrite={canWrite}
              />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
