"use server";

// Referral program server actions
// Per Recruit Redesign canvas section 12 (ReferralMobile + ReferralAdmin)

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { canRecruitAdmin } from "./role-guard";

function makeReferralCode(): string {
  // 8-char URL-safe code · base32-like
  return randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}

/** Get or create the referral code for the current employee */
export async function getMyReferralCode() {
  const session = await requireSession();
  // Use the most recent PENDING referral (= active code)
  let existing = await prisma.recruitReferral.findFirst({
    where: {
      orgId: session.user.org_id,
      referrerId: session.user.id,
      status: "PENDING",
      postingId: null,
      applicantId: null,
    },
    select: { code: true },
  });
  if (existing) return { ok: true as const, code: existing.code };

  // Create a new master code (general · not posting-specific)
  for (let i = 0; i < 5; i++) {
    const code = makeReferralCode();
    try {
      await prisma.recruitReferral.create({
        data: {
          orgId: session.user.org_id,
          referrerId: session.user.id,
          code,
          status: "PENDING",
        },
      });
      return { ok: true as const, code };
    } catch {
      // unique conflict · retry
    }
  }
  return { ok: false as const, error: "ไม่สามารถสร้างรหัสได้" };
}

/** Lookup referral by code (used by /refer/[code] public page) */
export async function lookupReferral(code: string) {
  const ref = await prisma.recruitReferral.findUnique({
    where: { code },
    include: {
      referrer: { select: { name: true } },
      org: { select: { name: true } },
      posting: { select: { slug: true, title: true } },
    },
  });
  if (!ref) return null;
  // Mark clicked
  if (!ref.clickedAt) {
    await prisma.recruitReferral.update({
      where: { id: ref.id },
      data: { clickedAt: new Date(), status: ref.status === "PENDING" ? "CLICKED" : ref.status },
    });
  }
  return {
    code: ref.code,
    referrerName: ref.referrer.name,
    orgName: ref.org.name,
    postingSlug: ref.posting?.slug ?? null,
    postingTitle: ref.posting?.title ?? null,
  };
}

/** Mark a referral as APPLIED (called from public apply flow when ?ref=code is present) */
export async function attributeReferral(code: string, applicantId: string) {
  const ref = await prisma.recruitReferral.findUnique({
    where: { code },
    select: { id: true, status: true, applicantId: true, orgId: true },
  });
  if (!ref) return;
  if (ref.applicantId) return; // already attributed

  await prisma.recruitReferral.update({
    where: { id: ref.id },
    data: {
      applicantId,
      appliedAt: new Date(),
      status: "APPLIED",
    },
  });

  await audit({
    orgId: ref.orgId,
    userId: null,
    action: "RECRUIT_REFERRAL_APPLIED",
    resourceType: "recruit_referral",
    resourceId: ref.id,
    diff: { new: { applicantId } },
  });
}

/** Admin marks referral as PAID */
export async function markReferralPaid(referralId: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const ref = await prisma.recruitReferral.findUnique({
    where: { id: referralId },
    select: { orgId: true, status: true },
  });
  if (!ref) throw new Error("ไม่พบรายการ");
  if (ref.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitReferral.update({
    where: { id: referralId },
    data: { status: "PAID", paidAt: new Date() },
  });

  await audit({
    orgId: ref.orgId,
    userId: session.user.id,
    action: "RECRUIT_REFERRAL_PAID",
    resourceType: "recruit_referral",
    resourceId: referralId,
    diff: { old: { status: ref.status }, new: { status: "PAID" } },
  });

  revalidatePath("/recruit/referrals");
  return { ok: true };
}
