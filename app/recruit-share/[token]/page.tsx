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
//
// Table layout (2026-10-14, CEO-approved): shows เพศ/อายุ/ประสบการณ์ทำงาน in
// addition to the original safe fields — these are applicant-submitted form
// answers (same trust level as phone number, already public here), NOT
// internal assessment data. อายุ/ประสบการณ์ทำงาน aren't fixed DB columns —
// each posting's form is custom-built, so they're located by fuzzy label
// match (findFieldByLabelKeyword) and may be blank ("—") for postings whose
// form never asked that question.

import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  STATUS_LABELS,
  STATUS_TONE,
  POSTING_STATUS_LABELS,
  GENDER_LABELS,
  FormSchemaSchema,
  type ApplicationStatus,
  type PostingStatus,
  type Gender,
} from "@/lib/recruit/types";
import {
  findFieldByLabelKeyword,
  formatAnswerValue,
  type AppFileMeta,
} from "@/lib/recruit/answers";
import { FileQuickOpen } from "@/components/recruit/file-quick-open";
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
      fieldSchema: true,
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
          answers: true,
          applicant: { select: { fullName: true, phone: true, gender: true } },
        },
      },
    },
  });
  // NULL/revoked token, or no match at all → same 404 either way (don't leak
  // which case it was).
  if (!posting) notFound();

  // อายุ/ประสบการณ์ทำงาน ไม่ใช่ column ตายตัว — หาจาก label ของฟอร์มตำแหน่งนี้
  // เท่านั้น (ไม่ดึง answers ทั้งก้อนออกไปโชว์ — เลือกแค่ 2 คำถามนี้).
  const schemaResult = FormSchemaSchema.safeParse(posting.fieldSchema);
  const schema = schemaResult.success ? schemaResult.data : null;
  const ageField = schema ? findFieldByLabelKeyword(schema, ["อายุ"]) : null;
  const experienceField = schema
    ? findFieldByLabelKeyword(schema, ["ประสบการณ์"])
    : null;

  const applicants = posting.applications.map((a) => {
    const rawAnswers = (a.answers ?? {}) as unknown as Record<string, unknown>;
    return {
      id: a.id,
      refId: a.refId,
      status: a.status,
      submittedAt: a.submittedAt,
      fullName: a.applicant.fullName,
      phone: a.applicant.phone,
      gender: a.applicant.gender as Gender | null,
      age: ageField
        ? formatAnswerValue(ageField, rawAnswers[ageField.id])
        : "",
      experience: experienceField
        ? formatAnswerValue(experienceField, rawAnswers[experienceField.id])
        : "",
      files: Array.isArray(a.files) ? (a.files as unknown as AppFileMeta[]) : [],
    };
  });

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
        <div className="max-w-6xl mx-auto">
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

      {/* Applicant table */}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 mt-4">
        <DataTable
          stickyHeader={false}
          columns={[
            { key: "name", header: "ชื่อ / เบอร์โทร" },
            { key: "gender", header: "เพศ" },
            { key: "age", header: "อายุ" },
            { key: "status", header: "สถานะ" },
            { key: "date", header: "วันที่สมัคร" },
            { key: "experience", header: "ประสบการณ์ทำงาน", className: "max-w-[260px]" },
            { key: "files", header: "ไฟล์แนบ" },
          ]}
          rows={applicants.map((a) => ({
            key: a.id,
            cells: {
              name: (
                <div className="min-w-[140px]">
                  <p className="font-bold text-zinc-900">{a.fullName}</p>
                  <a
                    href={`tel:${a.phone}`}
                    className="text-xs text-zinc-500 hover:text-[var(--color-brand-700)]"
                  >
                    {a.phone}
                  </a>
                </div>
              ),
              gender: a.gender ? (
                GENDER_LABELS[a.gender]
              ) : (
                <span className="text-zinc-300">—</span>
              ),
              age: a.age || <span className="text-zinc-300">—</span>,
              status: (
                <Badge tone={STATUS_TONE[a.status as ApplicationStatus]}>
                  {STATUS_LABELS[a.status as ApplicationStatus]}
                </Badge>
              ),
              date: (
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  {a.submittedAt ? thaiDateLong(a.submittedAt) : "—"}
                </span>
              ),
              experience: a.experience ? (
                <p className="text-[13px] text-zinc-700 whitespace-pre-wrap">
                  {a.experience}
                </p>
              ) : (
                <span className="text-zinc-300">—</span>
              ),
              files: <FileQuickOpen files={a.files} variant="cell" />,
            },
          }))}
          emptyState={
            <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500">
              ยังไม่มีผู้สมัครสำหรับตำแหน่งนี้
            </div>
          }
        />
      </div>
    </div>
  );
}
