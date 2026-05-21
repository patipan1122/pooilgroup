"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canRecruitWrite } from "@/lib/recruit/role-guard";
import { audit } from "@/lib/audit/log";
import {
  scoreCandidate,
  suggestFields,
  type FieldSuggestion,
} from "@/lib/recruit/ai";
import { FormSchemaSchema } from "@/lib/recruit/types";

export async function scoreApplicationAction(applicationId: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

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
  });

  await prisma.recruitApplication.update({
    where: { id: applicationId },
    data: {
      aiScore: result.score,
      aiSummary: result.summary,
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
  return suggestFields(input);
}
