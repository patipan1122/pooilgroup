// /recruit-share/[token] — read-only "applicant list for ONE posting" share view.
//
// CEO-approved scope (revised 2026-09-19): fully public, no login required —
// same trust model as getBillByPublicToken() in lib/rentspace/data.ts. The
// random UUID token IS the credential; anyone who has the link can view.
// CEO's original choice was login-required, then explicitly reversed it to
// match the RentSpace bill-link precedent for convenience. Read-only — no
// edit/status-change actions live here. Revocable via
// revokeApplicantShareLink() (sets the token back to null → this page 404s).
//
// Deliberately lives OUTSIDE app/(admin)/recruit/ (and outside any
// session-gated layout) so it is NOT gated by requireRecruitAccess or any
// requireSession() from a parent layout.
//
// The lookup is by token only (no orgId scope) on purpose — the token is the
// sole credential for which POSTING is visible.
//
// Field selection is a `select` (not `include: true`) on purpose, mirroring
// that same rentspace file's comment: this is a share view, so internal
// recruiter-only fields (aiScore, aiSummary, aiStrengths, aiRisks,
// screeningVerdict, tags, notes) must never ride along even if someone later
// adds more fields to RecruitApplication.

import { notFound } from "next/navigation";
import { Phone, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABELS,
  STATUS_TONE,
  POSTING_STATUS_LABELS,
  type ApplicationStatus,
  type PostingStatus,
} from "@/lib/recruit/types";
import { ApplicationFiles } from "@/components/recruit/application-files";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function ApplicantShareListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) notFound();

  const posting = await prisma.recruitJobPosting.findUnique({
    where: { applicantShareToken: token },
    select: {
      id: true,
      title: true,
      status: true,
      company: { select: { name: true } },
      applications: {
        where: { draft: false },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          refId: true,
          status: true,
          submittedAt: true,
          files: true,
          applicant: { select: { fullName: true, phone: true } },
        },
      },
    },
  });
  // NULL/revoked token, or no match at all → same 404 either way (don't leak
  // which case it was).
  if (!posting) notFound();

  const applicants = posting.applications.map((a) => ({
    ...a,
    files: Array.isArray(a.files)
      ? (a.files as unknown as Array<{
          key: string;
          name: string;
          size: number;
          mime: string;
        }>)
      : [],
  }));

  return (
    <div className="min-h-[calc(100vh-60px)] bg-zinc-50/40 pb-10">
      {/* Header */}
      <div
        className="px-4 sm:px-6 py-5 text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--color-brand-600), var(--color-brand-900))",
        }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide opacity-90">
            <Users className="size-3.5" />
            ลิงก์แชร์ · รายชื่อผู้สมัคร
          </div>
          <h1 className="text-lg sm:text-xl font-extrabold mt-1 leading-snug">
            {posting.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs opacity-90">
            {posting.company && <span>{posting.company.name}</span>}
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/15 text-[11px] font-bold">
              {POSTING_STATUS_LABELS[posting.status as PostingStatus]}
            </span>
            <span>· {applicants.length} ใบสมัคร</span>
          </div>
        </div>
      </div>

      {/* Applicant list */}
      <div className="max-w-2xl mx-auto px-3 sm:px-6 mt-4">
        {applicants.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500">
            ยังไม่มีผู้สมัครสำหรับตำแหน่งนี้
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            {applicants.map((a) => (
              <div key={a.id} className="p-3.5 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 truncate">
                      {a.applicant.fullName}
                    </p>
                    <a
                      href={`tel:${a.applicant.phone}`}
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-[var(--color-brand-700)]"
                    >
                      <Phone className="size-3" />
                      {a.applicant.phone}
                    </a>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge tone={STATUS_TONE[a.status as ApplicationStatus]}>
                      {STATUS_LABELS[a.status as ApplicationStatus]}
                    </Badge>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {a.submittedAt ? thaiDateLong(a.submittedAt) : "—"}
                    </p>
                  </div>
                </div>
                {a.files.length > 0 && <ApplicationFiles files={a.files} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
