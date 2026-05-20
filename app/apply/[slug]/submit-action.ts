"use server";

// Public submit — no auth · uses adminClient/Prisma to insert
// Validates slug + status=OPEN before inserting

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { checkBlacklist } from "@/lib/recruit/blacklist-match";
import { makeApplicationRefId } from "@/lib/recruit/slug";
import { sendStatusEmail } from "@/lib/recruit/email";
import {
  FormSchemaSchema,
  type FormSchema,
} from "@/lib/recruit/types";

interface SubmitInput {
  slug: string;
  applicant: { fullName: string; phone: string; email?: string };
  answers: Record<string, unknown>;
  files: Array<{ key: string; name: string; size: number; mime: string }>;
}

export async function submitPublicApplication(
  input: SubmitInput,
): Promise<{ refId: string }> {
  // 1. validate posting
  const posting = await prisma.recruitJobPosting.findUnique({
    where: { slug: input.slug },
    include: { company: { select: { name: true } }, org: { select: { name: true } } },
  });
  if (!posting) throw new Error("ไม่พบประกาศ");
  if (posting.status !== "OPEN") throw new Error("ประกาศนี้ปิดรับแล้ว");

  // sanity check schema parse
  let schema: FormSchema;
  try {
    schema = FormSchemaSchema.parse(posting.fieldSchema);
  } catch {
    throw new Error("ฟอร์มของประกาศนี้ผิดพลาด · ติดต่อ HR");
  }

  // validate inputs
  if (!input.applicant.fullName.trim()) throw new Error("กรอกชื่อ");
  if (!/^0\d{8,9}$/.test(input.applicant.phone)) {
    throw new Error("เบอร์โทรไม่ถูกต้อง");
  }
  // file count limit
  if (input.files.length > 9) throw new Error("ไฟล์เยอะเกิน");

  // 2. upsert applicant
  let applicant = await prisma.recruitApplicant.findFirst({
    where: { orgId: posting.orgId, phone: input.applicant.phone },
  });
  if (!applicant) {
    applicant = await prisma.recruitApplicant.create({
      data: {
        orgId: posting.orgId,
        fullName: input.applicant.fullName.trim(),
        phone: input.applicant.phone.trim(),
        email: input.applicant.email?.trim() || null,
      },
    });
  } else if (input.applicant.email && !applicant.email) {
    // backfill email if newly provided
    await prisma.recruitApplicant.update({
      where: { id: applicant.id },
      data: { email: input.applicant.email.trim() },
    });
  }

  // 3. blacklist check
  const bl = await checkBlacklist(posting.orgId, {
    fullName: input.applicant.fullName,
    phone: input.applicant.phone,
  });

  // 4. create application
  const refId = makeApplicationRefId();
  const application = await prisma.recruitApplication.create({
    data: {
      orgId: posting.orgId,
      postingId: posting.id,
      applicantId: applicant.id,
      refId,
      answers: input.answers as unknown as object,
      files: input.files as unknown as object,
      status: "NEW",
      flaggedBlacklist: bl.matched,
      blacklistReason: bl.matched
        ? bl.matches
            .slice(0, 2)
            .map((m) => `${m.matchedBy === "phone" ? "เบอร์" : "ชื่อ"}: ${m.reason}`)
            .join(" · ")
        : null,
      submittedAt: new Date(),
      schemaVersion: schema.version,
    },
  });

  // 5. audit log (no user · public submission)
  await audit({
    orgId: posting.orgId,
    userId: null,
    action: "RECRUIT_APPLICATION_SUBMITTED",
    resourceType: "recruit_application",
    resourceId: application.id,
    diff: { new: { refId, postingId: posting.id, name: applicant.fullName } },
  });

  // 6. send confirmation email to applicant (best-effort)
  if (applicant.email) {
    await sendStatusEmail("NEW", {
      applicantName: applicant.fullName,
      applicantEmail: applicant.email,
      position: posting.title,
      refId,
      company: posting.company?.name ?? posting.org.name,
    });
  }

  return { refId };
}
