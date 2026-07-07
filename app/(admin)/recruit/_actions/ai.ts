"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canRecruitWrite } from "@/lib/recruit/role-guard";
import { audit } from "@/lib/audit/log";
import {
  scoreCandidate,
  scoreResumeFile,
  isResumeReadableMime,
  draftMessage,
  suggestFields,
  type DraftKind,
  type FieldSuggestion,
} from "@/lib/recruit/ai";
import { getObject } from "@/lib/r2/upload";
import { checkAiBudget } from "@/lib/ai/cost-cap";
import { FormSchemaSchema } from "@/lib/recruit/types";

export async function scoreApplicationAction(applicationId: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  // Cost circuit-breaker — enforce the same AI caps the rest of the app does
  // (batch-score fires this per item, so the hourly cap actually bites).
  const budget = await checkAiBudget({
    userId: session.user.id,
    orgId: session.user.org_id,
    endpoint: "recruit.score-candidate",
  });
  if (!budget.allowed) throw new Error(budget.reason ?? "เกิน budget AI ชั่วคราว");

  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    include: {
      posting: { select: { title: true, description: true, fieldSchema: true } },
    },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");

  const schema = FormSchemaSchema.parse(app.posting.fieldSchema);
  const result = await scoreCandidate({
    jobTitle: app.posting.title,
    jobDescription: app.posting.description ?? undefined,
    formSchema: schema,
    answers: (app.answers ?? {}) as Record<string, unknown>,
    track: { orgId: session.user.org_id, userId: session.user.id },
  });

  await prisma.recruitApplication.update({
    where: { id: applicationId },
    data: {
      aiScore: result.score,
      aiSummary: "[จากคำตอบ] " + result.summary,
      aiStrengths: result.strengths,
      aiRisks: result.risks,
      aiEvaluatedAt: new Date(),
    },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_AI_SCORED",
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { new: { score: result.score } },
  });

  revalidatePath("/recruit");
  revalidatePath(`/recruit/applications/${applicationId}`);
  return result;
}

export async function scoreResumeAction(applicationId: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  const budget = await checkAiBudget({
    userId: session.user.id,
    orgId: session.user.org_id,
    endpoint: "recruit.score-resume",
  });
  if (!budget.allowed) throw new Error(budget.reason ?? "เกิน budget AI ชั่วคราว");

  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    include: {
      posting: { select: { title: true, description: true, fieldSchema: true } },
    },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");

  const files = (app.files ?? []) as Array<{
    key: string;
    name: string;
    size: number;
    mime: string;
  }>;
  // Prefer a PDF résumé over an image so a face/selfie photo is not scored as
  // the "résumé" (bias/PDPA); only fall back to an image if no PDF was attached.
  const resume =
    files.find((f) => f.mime === "application/pdf") ??
    files.find((f) => isResumeReadableMime(f.mime));
  if (!resume) {
    throw new Error(
      "ไม่มีไฟล์ที่ AI อ่านได้ (รองรับ PDF / รูปภาพ) · ถ้าเป็นไฟล์ Word ให้แปลงเป็น PDF ก่อน",
    );
  }
  // Size guard — don't base64 a huge file into a vision call (cost/timeout).
  if (resume.size > 5 * 1024 * 1024) {
    throw new Error("ไฟล์เรซูเม่ใหญ่เกิน 5 MB — ขอไฟล์ที่เล็กกว่า หรือแปลงเป็น PDF");
  }

  const bytes = await getObject(resume.key);

  // Enrich the résumé score with bias-safe form answers (skip อายุ/เพศ/รูป/file)
  let formAnswersText: string | undefined;
  try {
    const schema = FormSchemaSchema.parse(app.posting.fieldSchema);
    const answers = (app.answers ?? {}) as Record<string, unknown>;
    const lines: string[] = [];
    for (const section of schema.sections) {
      for (const field of section.fields) {
        const lower = field.label.toLowerCase();
        if (
          lower.includes("อายุ") ||
          lower.includes("เพศ") ||
          lower.includes("รูป") ||
          field.type === "file"
        ) {
          continue;
        }
        const val = answers[field.id];
        if (val == null || val === "") continue;
        lines.push(
          `${field.label}: ${Array.isArray(val) ? val.join(", ") : String(val)}`,
        );
      }
    }
    formAnswersText = lines.length ? lines.join("\n") : undefined;
  } catch {
    formAnswersText = undefined;
  }

  const result = await scoreResumeFile({
    jobTitle: app.posting.title,
    jobDescription: app.posting.description ?? undefined,
    file: { bytes, mime: resume.mime, name: resume.name },
    formAnswersText,
    track: { orgId: session.user.org_id, userId: session.user.id },
  });

  // updateMany with orgId in the WHERE = defense-in-depth (org scope enforced
  // on the write itself, not just the preceding findFirst).
  await prisma.recruitApplication.updateMany({
    where: { id: applicationId, orgId: session.user.org_id },
    data: {
      aiScore: result.score,
      aiSummary: "[จากเรซูเม่] " + result.summary,
      aiStrengths: result.strengths,
      aiRisks: result.risks,
      aiEvaluatedAt: new Date(),
    },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_AI_SCORED_RESUME",
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { new: { score: result.score, file: resume.name } },
  });

  revalidatePath("/recruit");
  revalidatePath(`/recruit/applications/${applicationId}`);
  return result;
}

export async function draftMessageAction(
  applicationId: string,
  kind: DraftKind,
): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์" };
  }
  const budget = await checkAiBudget({
    userId: session.user.id,
    orgId: session.user.org_id,
    endpoint: "recruit.draft-message",
  });
  if (!budget.allowed)
    return { ok: false, error: budget.reason ?? "เกิน budget AI ชั่วคราว" };

  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    include: {
      applicant: { select: { fullName: true } },
      posting: { select: { title: true } },
      interviews: {
        // Only FUTURE interviews — an old, never-completed one must not be
        // drafted as an invite to a date already in the past.
        where: {
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: "asc" },
        take: 1,
        select: { scheduledAt: true, kind: true, location: true },
      },
    },
  });
  if (!app) return { ok: false, error: "ไม่พบใบสมัคร" };

  let interviewWhen: string | undefined;
  let interviewKind: string | undefined;
  let interviewLocation: string | undefined;
  if (kind === "interview_invite") {
    const iv = app.interviews[0];
    if (!iv) {
      return {
        ok: false,
        error:
          "ยังไม่ได้นัดสัมภาษณ์ · กรุณานัดเวลาสัมภาษณ์ก่อน แล้วค่อยร่างข้อความเชิญ (กัน AI แต่งวันเอง)",
      };
    }
    interviewWhen = iv.scheduledAt.toLocaleString("th-TH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const kindLabel: Record<string, string> = {
      ONSITE: "สัมภาษณ์ที่ออฟฟิศ",
      PHONE: "สัมภาษณ์ทางโทรศัพท์",
      VIDEO: "สัมภาษณ์ผ่านวิดีโอคอล",
    };
    interviewKind = kindLabel[iv.kind] ?? undefined;
    interviewLocation = iv.location ?? undefined;
  }

  const draft = await draftMessage({
    kind,
    candidateName: app.applicant.fullName,
    postingTitle: app.posting.title,
    interviewWhen,
    interviewKind,
    interviewLocation,
    track: { orgId: session.user.org_id, userId: session.user.id },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_AI_DRAFTED",
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { new: { kind } },
  });

  return { ok: true, draft };
}

export async function suggestFieldsAction(input: {
  jobTitle: string;
  companyType?: string;
  salaryRange?: string;
  notes?: string;
}): Promise<FieldSuggestion[]> {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  return suggestFields({
    ...input,
    track: { orgId: session.user.org_id, userId: session.user.id },
  });
}
