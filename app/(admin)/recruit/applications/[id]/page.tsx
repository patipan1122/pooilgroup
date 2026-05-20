// /recruit/applications/[id] — full-page application detail

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import {
  requireRecruitAccess,
  canRecruitWrite,
} from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { ApplicationDetail } from "@/components/recruit/application-detail";

export const dynamic = "force-dynamic";

export default async function ApplicationFullPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const exists = await prisma.recruitApplication.findFirst({
    where: { id, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!exists) return notFound();

  return (
    <div className="bg-white min-h-screen">
      <div className="border-b border-zinc-200 px-5 sm:px-8 py-4 sticky top-0 bg-white z-10">
        <Link
          href="/recruit"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← กลับ Inbox
        </Link>
      </div>
      <ApplicationDetail
        applicationId={id}
        canWrite={canRecruitWrite(session.user.role)}
      />
    </div>
  );
}
