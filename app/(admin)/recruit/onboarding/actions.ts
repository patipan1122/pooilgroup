"use server";

// Recruit Onboarding · HR review server actions (อนุมัติ / ตีกลับ / รับเรื่องมาตรวจ)
//
// This is the ONLY place in the onboarding flow where a real `User` row is
// born. The public form (app/onboard) never touches `users` — a submission is
// just data until a human HR admin presses อนุมัติ here.
//
// Precedent followed exactly: app/api/admin/register-requests/[id]/route.ts
// ("standalone request → HR approves → User created", double-audit
// APPROVE_* + CREATE_USER). Difference: that route does its writes as 3
// independent Supabase calls; here the create-user + mark-approved pair runs
// inside ONE prisma.$transaction with a conditional status update, so a
// double-click / two HR tabs can never produce two Users for one submission
// (RULE I race-condition check — same class of bug as the 2026-06-07 duplicate
// Drive folder incident).
//
// Role gate: lib/recruit/role-guard.ts admin tier (canRecruitAdmin /
// RECRUIT_ADMIN_ROLES) — same tier that decides PDPA erasure requests in
// lib/recruit/erasure-actions.ts.

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { canRecruitAdmin } from "@/lib/recruit/role-guard";
import { ONBOARDING_OPEN_STATUSES, ONBOARDING_STATUS_LABELS_TH } from "./_status";

export interface OnboardingActionResult {
  ok: boolean;
  error?: string;
  /** Set only on a successful approve — the freshly created (inactive) account. */
  userId?: string;
}

/** Thrown inside the transaction when the conditional status update matched
 * 0 rows (someone else decided this submission in the meantime). Throwing —
 * not returning — is deliberate: it rolls the just-created User back. */
const RACE_MARKER = "ONBOARDING_RACE";

/**
 * "รับเรื่องมาตรวจ" — SUBMITTED → HR_REVIEWING, so a second HR person can see
 * on the list that someone already picked this up. Idempotent: re-running on a
 * row that is already HR_REVIEWING is a no-op, and it never moves a decided row.
 */
export async function startOnboardingReview(
  submissionId: string,
): Promise<OnboardingActionResult> {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };
  const orgId = session.user.org_id;

  const moved = await prisma.recruitOnboardingSubmission.updateMany({
    where: { id: submissionId, orgId, status: "SUBMITTED" },
    data: { status: "HR_REVIEWING" },
  });

  if (moved.count === 1) {
    await audit({
      orgId,
      userId: session.user.id,
      action: "RECRUIT_ONBOARDING_REVIEW_STARTED",
      resourceType: "recruit_onboarding_submission",
      resourceId: submissionId,
      diff: { old: { status: "SUBMITTED" }, new: { status: "HR_REVIEWING" } },
    });
  }

  revalidatePath("/recruit/onboarding");
  revalidatePath(`/recruit/onboarding/${submissionId}`);
  return { ok: true };
}

/**
 * อนุมัติ — the critical one. In ONE transaction:
 *   1. re-read the submission and re-check it is still open (SUBMITTED/HR_REVIEWING)
 *   2. create the `User` (isActive:false = "รอเปิดใช้งาน"; HR activates later
 *      via the existing POST /api/admin/users/[id]/reactivate — no new status
 *      field invented)
 *   3. conditional updateMany → APPROVED + reviewer + resultUserId; if it
 *      matches 0 rows another session won the race → throw → the User rolls back
 * Audit (approve + user-created) is written after the transaction commits.
 */
export async function approveOnboarding(
  submissionId: string,
): Promise<OnboardingActionResult> {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };
  const orgId = session.user.org_id;
  const reviewerId = session.user.id;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sub = await tx.recruitOnboardingSubmission.findFirst({
        where: { id: submissionId, orgId },
        select: {
          id: true,
          status: true,
          fullNameTh: true,
          nickname: true,
          phone: true,
          email: true,
        },
      });
      if (!sub) return { ok: false as const, error: "ไม่พบใบสมัครนี้" };
      if (!ONBOARDING_OPEN_STATUSES.includes(sub.status)) {
        return {
          ok: false as const,
          error: `ใบนี้ถูกพิจารณาไปแล้ว (${ONBOARDING_STATUS_LABELS_TH[sub.status]}) · รีเฟรชหน้าเพื่อดูผลล่าสุด`,
        };
      }

      // email is @unique + optional on User → pass undefined (not null/"") when
      // the new hire didn't give one, otherwise two email-less hires collide.
      const email = sub.email?.trim() ? sub.email.trim().toLowerCase() : undefined;
      if (email) {
        const clash = await tx.user.findUnique({
          where: { email },
          select: { id: true, name: true },
        });
        if (clash) {
          return {
            ok: false as const,
            error: `อีเมล ${email} มีบัญชีอยู่แล้ว (${clash.name}) · แก้อีเมลในใบสมัคร หรือใช้บัญชีเดิมแทนการสร้างใหม่`,
          };
        }
      }

      const user = await tx.user.create({
        data: {
          orgId,
          name: sub.fullNameTh.trim(),
          phone: sub.phone,
          email,
          role: "staff",
          // "pending_verification" = isActive:false. The existing login guard
          // already blocks inactive accounts; HR opens it later from /users.
          isActive: false,
          // ไม่มี generator ของรหัสพนักงานในระบบนี้ — คีย์มือจาก Humansoft ทีหลัง
          employeeCode: null,
          mustChangePassword: true,
        },
        select: { id: true },
      });

      // Conditional update = the real race guard. 0 rows ⇒ another HR session
      // decided this submission between our read and now ⇒ roll everything back.
      const moved = await tx.recruitOnboardingSubmission.updateMany({
        where: { id: submissionId, orgId, status: { in: ONBOARDING_OPEN_STATUSES } },
        data: {
          status: "APPROVED",
          reviewedById: reviewerId,
          reviewedAt: now,
          resultUserId: user.id,
        },
      });
      if (moved.count !== 1) throw new Error(RACE_MARKER);

      return { ok: true as const, userId: user.id, name: sub.fullNameTh.trim() };
    });

    if (!result.ok) return result;

    await audit({
      orgId,
      userId: reviewerId,
      action: "RECRUIT_ONBOARDING_APPROVED",
      resourceType: "recruit_onboarding_submission",
      resourceId: submissionId,
      diff: { new: { status: "APPROVED", result_user_id: result.userId } },
    });
    await audit({
      orgId,
      userId: reviewerId,
      action: "CREATE_USER",
      resourceType: "user",
      resourceId: result.userId,
      diff: {
        new: {
          from_onboarding_submission: submissionId,
          name: result.name,
          role: "staff",
          is_active: false,
        },
      },
    });

    revalidatePath("/recruit/onboarding");
    revalidatePath(`/recruit/onboarding/${submissionId}`);
    return { ok: true, userId: result.userId };
  } catch (e) {
    if (e instanceof Error && e.message === RACE_MARKER) {
      return {
        ok: false,
        error: "มีคนอื่นกดพิจารณาใบนี้พร้อมกันพอดี · ไม่มีอะไรถูกบันทึก · รีเฟรชหน้าแล้วลองใหม่",
      };
    }
    // Unique-constraint (email) that slipped past the pre-check — surface a
    // readable Thai message instead of a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        error: "อีเมลนี้มีบัญชีในระบบอยู่แล้ว · ยังไม่ได้สร้างบัญชีใหม่ · แก้อีเมลในใบสมัครก่อน",
      };
    }
    console.error("[recruit onboarding] approve failed", e);
    return { ok: false, error: "สร้างบัญชีไม่สำเร็จ · ยังไม่มีอะไรถูกบันทึก · ลองใหม่อีกครั้ง" };
  }
}

/**
 * ตีกลับ / ไม่รับ — REJECTED + เหตุผล (บังคับ). ไม่มีการสร้าง User.
 * BranchManager persona asked for "ปุ่มตีกลับพร้อมเหตุผล" เพราะเอกสารเบลอ/ถ่ายไม่ครบ
 * เป็นเรื่องที่เกิดบ่อยกว่า "ไม่รับคนนี้จริง ๆ".
 */
export async function rejectOnboarding(
  submissionId: string,
  reason: string,
): Promise<OnboardingActionResult> {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "ต้องระบุเหตุผลที่ตีกลับ" };
  if (trimmed.length > 1000) return { ok: false, error: "เหตุผลยาวเกินไป (เกิน 1,000 ตัวอักษร)" };

  const orgId = session.user.org_id;
  const moved = await prisma.recruitOnboardingSubmission.updateMany({
    where: { id: submissionId, orgId, status: { in: ONBOARDING_OPEN_STATUSES } },
    data: {
      status: "REJECTED",
      rejectReason: trimmed,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });
  if (moved.count !== 1) {
    return { ok: false, error: "ใบนี้ถูกพิจารณาไปแล้ว หรือไม่พบในระบบ · รีเฟรชหน้าเพื่อดูผลล่าสุด" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "RECRUIT_ONBOARDING_REJECTED",
    resourceType: "recruit_onboarding_submission",
    resourceId: submissionId,
    diff: { new: { status: "REJECTED", reject_reason: trimmed } },
  });

  revalidatePath("/recruit/onboarding");
  revalidatePath(`/recruit/onboarding/${submissionId}`);
  return { ok: true };
}
