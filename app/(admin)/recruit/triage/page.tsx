// /recruit/triage — HR Mobile Triage (swipe to accept/reject)
// Per Recruit Redesign canvas Section 04 (HR5Triage)
//
// Pull all NEW + ?posting= apps · render as swipe stack · HR keys/buttons
// "ผ่าน" → move to SCREENING · "ไม่ผ่าน" → REJECTED · "ข้าม" → next

import { requireSession } from "@/lib/auth/session";
import { requireRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { TriageStack } from "@/components/recruit/triage-stack";

export const dynamic = "force-dynamic";

interface SearchParams {
  posting?: string;
}

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireRecruitWrite(session.user.role);
  const params = await searchParams;

  const apps = await prisma.recruitApplication.findMany({
    where: {
      orgId: session.user.org_id,
      draft: false,
      status: "NEW",
      ...(params.posting ? { postingId: params.posting } : {}),
    },
    include: {
      applicant: { select: { fullName: true, phone: true, email: true } },
      posting: { select: { title: true } },
    },
    orderBy: { submittedAt: "desc" },
    take: 50,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--color-brand-900)] to-zinc-900 text-white">
      <TriageStack
        applications={apps.map((a) => ({
          id: a.id,
          refId: a.refId,
          applicantName: a.applicant.fullName,
          phone: a.applicant.phone,
          email: a.applicant.email,
          postingTitle: a.posting.title,
          aiScore: a.aiScore,
          aiSummary: a.aiSummary,
          tags: a.tags,
          flaggedBlacklist: a.flaggedBlacklist,
          submittedAt: a.submittedAt?.toISOString() ?? a.createdAt.toISOString(),
        }))}
        postingFilter={params.posting ?? null}
      />
    </div>
  );
}
