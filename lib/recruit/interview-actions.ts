"use server";

// Server actions for recruit_interviews CRUD

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { canRecruitWrite } from "./role-guard";
import { addApplicationNote } from "./actions";

export interface ScheduleInput {
  applicationId: string;
  scheduledAt: string; // ISO datetime
  durationMin?: number;
  kind?: "ONSITE" | "PHONE" | "VIDEO";
  location?: string;
  notes?: string;
}

export async function scheduleInterview(input: ScheduleInput) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const app = await prisma.recruitApplication.findUnique({
    where: { id: input.applicationId },
    select: { orgId: true, applicantId: true, postingId: true, status: true },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");
  if (app.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  const scheduledAt = new Date(input.scheduledAt);
  if (isNaN(scheduledAt.getTime())) throw new Error("วันเวลาไม่ถูกต้อง");
  // Guard against silent coercion (e.g., "2026-02-30" → "2026-03-02"):
  // round-trip the input through Date and confirm month + day match if input is ISO-style.
  const isoMatch = input.scheduledAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    if (
      scheduledAt.getFullYear() !== Number(y) ||
      scheduledAt.getMonth() + 1 !== Number(m) ||
      scheduledAt.getDate() !== Number(d)
    ) {
      throw new Error("วันเวลาไม่ถูกต้อง (วันที่ไม่มีในปฏิทิน)");
    }
  }
  // Range guard: reject ridiculous dates (typo / data corruption)
  const year = scheduledAt.getFullYear();
  if (year < 2020 || year > 2100) {
    throw new Error("ปีต้องอยู่ในช่วง 2020–2100");
  }

  const interview = await prisma.recruitInterview.create({
    data: {
      orgId: app.orgId,
      applicationId: input.applicationId,
      scheduledAt,
      durationMin: input.durationMin ?? 60,
      kind: input.kind ?? "ONSITE",
      location: input.location?.trim() ?? null,
      notes: input.notes?.trim() ?? null,
      status: "SCHEDULED",
      createdById: session.user.id,
    },
  });

  // Also add a timeline note for the candidate-visible feed
  const formattedDate = scheduledAt.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const kindLabel =
    input.kind === "PHONE" ? "ทางโทรศัพท์" : input.kind === "VIDEO" ? "วิดีโอคอล" : "ที่สถานที่";
  const noteBody = `[INTERVIEW] นัดสัมภาษณ์ ${kindLabel} วัน ${formattedDate}${
    input.location ? ` ที่ ${input.location}` : ""
  }${input.notes ? ` · ${input.notes}` : ""}`;

  await addApplicationNote(input.applicationId, noteBody);

  await audit({
    orgId: app.orgId,
    userId: session.user.id,
    action: "RECRUIT_INTERVIEW_SCHEDULED",
    resourceType: "recruit_interview",
    resourceId: interview.id,
    diff: { new: { scheduledAt: scheduledAt.toISOString(), kind: input.kind, location: input.location } },
  });

  // BA fix #8: auto-advance status NEW/SCREENING → INTERVIEW when first interview scheduled
  // B-008: re-read status before advancing (concurrent scheduleInterview may have advanced it already)
  if (app.status === "NEW" || app.status === "SCREENING") {
    const fresh = await prisma.recruitApplication.findUnique({
      where: { id: input.applicationId },
      select: { status: true },
    });
    if (fresh && (fresh.status === "NEW" || fresh.status === "SCREENING")) {
      const { changeApplicationStatus } = await import("./actions");
      await changeApplicationStatus(input.applicationId, "INTERVIEW");
    }
  }

  revalidatePath("/recruit/calendar");
  revalidatePath(`/recruit/applications/${input.applicationId}`);
  return { ok: true, interviewId: interview.id };
}

export async function updateInterviewStatus(
  interviewId: string,
  status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "CANCELLED",
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const interview = await prisma.recruitInterview.findUnique({
    where: { id: interviewId },
    select: { orgId: true, applicationId: true, status: true },
  });
  if (!interview) throw new Error("ไม่พบนัดสัมภาษณ์");
  if (interview.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitInterview.update({
    where: { id: interviewId },
    data: { status },
  });

  await audit({
    orgId: interview.orgId,
    userId: session.user.id,
    action: "RECRUIT_INTERVIEW_STATUS_CHANGED",
    resourceType: "recruit_interview",
    resourceId: interviewId,
    diff: { old: { status: interview.status }, new: { status } },
  });

  revalidatePath("/recruit/calendar");
  revalidatePath(`/recruit/applications/${interview.applicationId}`);
  return { ok: true };
}

export async function saveInterviewScorecard(
  interviewId: string,
  scorecard: Record<string, number | string>,
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const interview = await prisma.recruitInterview.findUnique({
    where: { id: interviewId },
    select: { orgId: true, applicationId: true },
  });
  if (!interview) throw new Error("ไม่พบนัดสัมภาษณ์");
  if (interview.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitInterview.update({
    where: { id: interviewId },
    data: {
      scorecard: scorecard as unknown as object,
      status: "COMPLETED",
    },
  });

  await audit({
    orgId: interview.orgId,
    userId: session.user.id,
    action: "RECRUIT_INTERVIEW_SCORED",
    resourceType: "recruit_interview",
    resourceId: interviewId,
    diff: { new: { scorecard, status: "COMPLETED" } },
  });

  revalidatePath(`/recruit/applications/${interview.applicationId}`);
  return { ok: true };
}
