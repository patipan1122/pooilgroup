// Recruit — server actions (CRUD + status changes + AI + blacklist)
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import {
  APPLICATION_STATUSES,
  EMPTY_FORM_SCHEMA,
  FormSchemaSchema,
  type ApplicationStatus,
  type FormSchema,
} from "./types";
import { makePostingSlug } from "./slug";
import { canRecruitWrite, canRecruitAdmin } from "./role-guard";
import { sendStatusEmail, type EmailCtx } from "./email";

// =============================================================
// Job Postings CRUD
// =============================================================

export async function createPosting(input: {
  title: string;
  description?: string;
  companyId?: string;
  opensAt?: string;
  closesAt?: string;
  fieldSchema?: FormSchema;
}) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

  const slug = makePostingSlug(input.title);
  const schema = input.fieldSchema ?? EMPTY_FORM_SCHEMA;

  const posting = await prisma.recruitJobPosting.create({
    data: {
      orgId: session.user.org_id,
      companyId: input.companyId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      slug,
      status: "DRAFT",
      fieldSchema: schema as object,
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      createdById: session.user.id,
    },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_POSTING_CREATED",
    resourceType: "recruit_job_posting",
    resourceId: posting.id,
    diff: { new: { title: posting.title, slug } },
  });

  revalidatePath("/recruit");
  revalidatePath("/recruit/postings");
  return { id: posting.id, slug: posting.slug };
}

export async function updatePosting(
  postingId: string,
  input: Partial<{
    title: string;
    description: string;
    companyId: string | null;
    opensAt: string | null;
    closesAt: string | null;
    fieldSchema: FormSchema;
  }>,
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

  const existing = await prisma.recruitJobPosting.findFirst({
    where: { id: postingId, orgId: session.user.org_id },
  });
  if (!existing) throw new Error("ไม่พบประกาศ");

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description;
  if (input.companyId !== undefined) data.companyId = input.companyId;
  if (input.opensAt !== undefined)
    data.opensAt = input.opensAt ? new Date(input.opensAt) : null;
  if (input.closesAt !== undefined)
    data.closesAt = input.closesAt ? new Date(input.closesAt) : null;
  if (input.fieldSchema !== undefined) {
    FormSchemaSchema.parse(input.fieldSchema);
    data.fieldSchema = input.fieldSchema as object;
  }

  await prisma.recruitJobPosting.update({
    where: { id: postingId },
    data,
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_POSTING_UPDATED",
    resourceType: "recruit_job_posting",
    resourceId: postingId,
    diff: { new: Object.keys(data).reduce((acc, k) => ({ ...acc, [k]: true }), {}) },
  });

  revalidatePath("/recruit/postings");
  revalidatePath(`/recruit/postings/${postingId}`);
}

export async function publishPosting(postingId: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  const posting = await prisma.recruitJobPosting.findFirst({
    where: { id: postingId, orgId: session.user.org_id },
  });
  if (!posting) throw new Error("ไม่พบประกาศ");

  await prisma.recruitJobPosting.update({
    where: { id: postingId },
    data: { status: "OPEN" },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_POSTING_PUBLISHED",
    resourceType: "recruit_job_posting",
    resourceId: postingId,
    diff: { old: { status: posting.status }, new: { status: "OPEN" } },
  });

  revalidatePath("/recruit/postings");
  revalidatePath(`/recruit/postings/${postingId}`);
}

export async function closePosting(postingId: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

  // SA agent fix: verify org_id match before updating (cross-org guard)
  const posting = await prisma.recruitJobPosting.findFirst({
    where: { id: postingId, orgId: session.user.org_id },
    select: { id: true, status: true },
  });
  if (!posting) throw new Error("ไม่พบประกาศ");

  await prisma.recruitJobPosting.update({
    where: { id: postingId },
    data: { status: "CLOSED" },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_POSTING_CLOSED",
    resourceType: "recruit_job_posting",
    resourceId: postingId,
    diff: { old: { status: posting.status }, new: { status: "CLOSED" } },
  });

  revalidatePath("/recruit/postings");
  revalidatePath(`/recruit/postings/${postingId}`);
}

export async function deletePosting(postingId: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

  const posting = await prisma.recruitJobPosting.findFirst({
    where: { id: postingId, orgId: session.user.org_id },
  });
  if (!posting) throw new Error("ไม่พบประกาศ");

  await prisma.recruitJobPosting.delete({ where: { id: postingId } });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_POSTING_DELETED",
    resourceType: "recruit_job_posting",
    resourceId: postingId,
    diff: { old: { title: posting.title } },
  });

  revalidatePath("/recruit/postings");
}

// =============================================================
// Application status changes
// =============================================================

const StatusEnum = z.enum(APPLICATION_STATUSES);

export async function changeApplicationStatus(
  applicationId: string,
  newStatus: string,
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

  const status = StatusEnum.parse(newStatus) as ApplicationStatus;
  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    include: {
      applicant: true,
      posting: { select: { title: true, companyId: true, company: true } },
    },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");
  if (app.status === status) return;

  await prisma.recruitApplication.update({
    where: { id: applicationId },
    data: { status },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_APPLICATION_STATUS_CHANGED",
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { old: { status: app.status }, new: { status } },
  });

  // Cross-module hook: HIRED applicant becomes a Repair technician profile
  // (VENDOR kind by default — no User account assumed at hire time).
  // This solves BA insight: stops paid techs being invisible to dispatch.
  if (status === "HIRED") {
    try {
      const existing = await prisma.repairTechnician.findFirst({
        where: {
          orgId: session.user.org_id,
          phone: app.applicant.phone,
          isActive: true,
        },
      });
      if (!existing) {
        await prisma.repairTechnician.create({
          data: {
            orgId: session.user.org_id,
            kind: "VENDOR",
            name: app.applicant.fullName,
            phone: app.applicant.phone,
            lineId: app.applicant.lineId ?? null,
            specialties: [],
            notes: `Auto-created from recruit ${app.refId} · ${app.posting.title}`,
          },
        });
      }
    } catch (e) {
      console.error("[recruit→repair auto-create technician] failed", e);
    }
  }

  // Send notification email (best-effort · no throw on fail)
  const ctx: EmailCtx = {
    applicantName: app.applicant.fullName,
    applicantEmail: app.applicant.email ?? "",
    position: app.posting.title,
    refId: app.refId,
    company: app.posting.company?.name ?? "Pooilgroup",
  };
  await sendStatusEmail(status, ctx);

  // BA fix #13: when application HIRED · auto-mark its referral as HIRED too
  if (status === "HIRED") {
    try {
      await prisma.recruitReferral.updateMany({
        where: {
          applicantId: app.applicantId,
          orgId: session.user.org_id,
          status: { notIn: ["HIRED", "PAID", "EXPIRED"] },
        },
        data: {
          status: "HIRED",
          hiredAt: new Date(),
        },
      });
    } catch (e) {
      console.error("[recruit→referral HIRED propagation] failed", e);
    }
  }

  revalidatePath("/recruit");
  revalidatePath(`/recruit/applications/${applicationId}`);
  revalidatePath("/recruit/pipeline");
  revalidatePath("/recruit/tasks");
  if (status === "HIRED") revalidatePath("/repairs/technicians");
}

export async function setApplicationRating(
  applicationId: string,
  rating: number | null,
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  if (rating != null && (rating < 1 || rating > 5)) {
    throw new Error("rating ต้อง 1-5");
  }

  // SA agent fix: verify exists in org first
  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    select: { id: true, starRating: true },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");

  await prisma.recruitApplication.update({
    where: { id: applicationId },
    data: { starRating: rating },
  });

  // SA agent fix: add audit log
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_APPLICATION_NOTE_ADDED", // reuse existing audit type
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { old: { starRating: app.starRating }, new: { starRating: rating } },
  });

  revalidatePath(`/recruit/applications/${applicationId}`);
  revalidatePath("/recruit");
}

export async function setApplicationTags(
  applicationId: string,
  tags: string[],
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }

  // SA agent fix: explicit validation instead of silent truncation
  if (tags.length > 10) {
    throw new Error("ป้ายกำกับสูงสุด 10 ป้าย");
  }

  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    select: { id: true, tags: true },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");

  await prisma.recruitApplication.update({
    where: { id: applicationId },
    data: { tags },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_APPLICATION_NOTE_ADDED",
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { old: { tags: app.tags }, new: { tags } },
  });

  revalidatePath(`/recruit/applications/${applicationId}`);
  revalidatePath("/recruit");
}

// =============================================================
// Application notes
// =============================================================

export async function addApplicationNote(
  applicationId: string,
  body: string,
  rating?: number | null,
) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  const trimmed = body.trim();
  if (!trimmed) throw new Error("กรอกข้อความ");

  const app = await prisma.recruitApplication.findFirst({
    where: { id: applicationId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");

  await prisma.recruitApplicationNote.create({
    data: {
      orgId: session.user.org_id,
      applicationId,
      userId: session.user.id,
      body: trimmed,
      rating: rating ?? null,
    },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_APPLICATION_NOTE_ADDED",
    resourceType: "recruit_application",
    resourceId: applicationId,
  });

  revalidatePath(`/recruit/applications/${applicationId}`);
}

// =============================================================
// Blacklist
// =============================================================

export async function addToBlacklist(input: {
  fullName: string;
  phone?: string;
  reason: string;
  companyScope?: "POOIL" | "JPSYNC" | "BOTH";
  expiresInYears?: number;
}) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  if (!input.fullName.trim()) throw new Error("กรอกชื่อ");
  if (input.reason.trim().length < 20) {
    throw new Error("เหตุผลต้องมีอย่างน้อย 20 ตัวอักษร");
  }

  const expiresAt = new Date();
  expiresAt.setFullYear(
    expiresAt.getFullYear() + (input.expiresInYears ?? 5),
  );

  const entry = await prisma.recruitBlacklist.create({
    data: {
      orgId: session.user.org_id,
      fullName: input.fullName.trim(),
      phone: input.phone?.trim() || null,
      reason: input.reason.trim(),
      companyScope: input.companyScope ?? "BOTH",
      addedById: session.user.id,
      expiresAt,
    },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_BLACKLIST_ADDED",
    resourceType: "recruit_blacklist",
    resourceId: entry.id,
    diff: { new: { name: entry.fullName, phone: entry.phone } },
  });

  revalidatePath("/recruit/blacklist");
  return { id: entry.id };
}

export async function removeFromBlacklist(id: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) {
    throw new Error("ต้องเป็น admin");
  }
  const entry = await prisma.recruitBlacklist.findFirst({
    where: { id, orgId: session.user.org_id },
  });
  if (!entry) throw new Error("ไม่พบ");

  await prisma.recruitBlacklist.update({
    where: { id },
    data: { removedAt: new Date(), removedById: session.user.id },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_BLACKLIST_REMOVED",
    resourceType: "recruit_blacklist",
    resourceId: id,
  });

  revalidatePath("/recruit/blacklist");
}
