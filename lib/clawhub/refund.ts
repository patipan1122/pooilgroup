// ClawHub (JOLLY PLAY) — refund money flow (ALL of it lives here).
// The pure decision lives in refund-engine.ts (evaluateRefund); THIS file is the only
// place that touches the DB for refunds: it persists the request, dedups by screenshot
// hash, credits points on auto-approve, and lets an admin approve/reject the rest.
// Money rule: 1 POINT = 10 BAHT, capped at MAX_REFUND_BAHT per claim.

import type { ClawhubMember } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { creditPoints } from "./points";
import { evaluateRefund } from "./refund-engine";
import { MAX_REFUND_BAHT, POINT_TO_BAHT } from "./constants";
import type { VisionResult } from "./types";

/** Pull a Prisma-style error `.code` (e.g. "P2002") off an unknown thrown value. */
function errCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
    ? (e as { code: string }).code
    : null;
}

export type SubmitRefundArgs = {
  orgId: string;
  member: ClawhubMember;
  claimedBaht: number;
  screenshotR2Key: string;
  screenshotSha256: string;
  vision: VisionResult;
  machine?: {
    machineId?: string;
    machineCode?: string;
    machineQrToken?: string;
    branchId?: string;
  };
  // ลูกค้าพิมพ์เลขสาขา 7-11 เอง (รูปไม่ได้ OCR หาเลขสาขา).
  storeBranchCode?: string;
  storeBranchName?: string;
};

export type SubmitRefundResult = {
  status: "AUTO_APPROVED" | "PENDING_REVIEW" | "DUPLICATE" | "NEEDS_REPHOTO";
  pointsAwarded: number;
  reason: string;
  requestId?: string;
};

/**
 * Customer submits a refund claim (typed baht + machine-screen photo).
 *  (a) run the pure engine → NEEDS_REPHOTO short-circuits (nothing persisted).
 *  (b) dedup by (memberId, screenshotSha256) → DUPLICATE if the photo was used before.
 *  (c) in ONE transaction: write the request, credit points if AUTO_APPROVED, and
 *      bump the member's refund counters.
 * The unique(memberId, screenshotSha256) index makes (b) race-proof — a duplicate that
 * slips past the pre-check fires P2002 and is returned as DUPLICATE, not a 500.
 */
export async function submitRefund(
  args: SubmitRefundArgs,
): Promise<SubmitRefundResult> {
  const { orgId, member, claimedBaht, screenshotR2Key, screenshotSha256, vision, machine, storeBranchCode, storeBranchName } = args;

  // (a) Pure decision — unclear image never touches the DB.
  const decision = evaluateRefund({ member, claimedBaht, vision });
  if (decision.decision === "NEEDS_REPHOTO") {
    return { status: "NEEDS_REPHOTO", pointsAwarded: 0, reason: decision.reason };
  }

  // (b) Dedup — same member + same photo can't claim twice.
  const dup = await prisma.clawhubRefundRequest.findFirst({
    where: { memberId: member.id, screenshotSha256 },
    select: { id: true },
  });
  if (dup) {
    return {
      status: "DUPLICATE",
      pointsAwarded: 0,
      reason: "รูปนี้ถูกใช้ขอคืนไปแล้ว",
    };
  }

  const isAuto = decision.decision === "AUTO_APPROVED";
  const pointsAwarded = isAuto ? decision.points : 0;

  try {
    // (c) Persist + (auto) credit + bump counters atomically.
    return await prisma.$transaction(async (tx) => {
      const request = await tx.clawhubRefundRequest.create({
        data: {
          orgId,
          memberId: member.id,
          machineId: machine?.machineId ?? null,
          machineCode: machine?.machineCode ?? null,
          machineQrToken: machine?.machineQrToken ?? null,
          branchId: machine?.branchId ?? null,
          storeBranchCode: storeBranchCode ?? null,
          storeBranchName: storeBranchName ?? null,
          claimedBaht,
          aiReadBaht: decision.aiReadBaht,
          aiAddUp: vision.addUp,
          aiPrice: vision.price,
          aiCredit: vision.credit,
          aiRawText: vision.rawText,
          aiConfidence: vision.confidence,
          screenshotR2Key,
          screenshotSha256,
          pointsAwarded,
          status: isAuto ? "AUTO_APPROVED" : "PENDING_REVIEW",
          decisionReason: decision.reason,
        },
      });

      if (isAuto) {
        await creditPoints(tx, {
          orgId,
          memberId: member.id,
          points: decision.points,
          kind: "EARN_REFUND",
          refType: "refund",
          refId: request.id,
        });
      }

      const now = new Date();
      await tx.clawhubMember.update({
        where: { id: member.id },
        data: {
          refundCount: { increment: 1 },
          lastRefundAt: now,
          firstRefundAt: member.firstRefundAt ?? now,
        },
      });

      return {
        status: isAuto ? "AUTO_APPROVED" : "PENDING_REVIEW",
        pointsAwarded,
        reason: decision.reason,
        requestId: request.id,
      };
    });
  } catch (e: unknown) {
    // Lost the unique-index race → the other request already recorded this photo.
    if (errCode(e) === "P2002") {
      return {
        status: "DUPLICATE",
        pointsAwarded: 0,
        reason: "รูปนี้ถูกใช้ขอคืนไปแล้ว",
      };
    }
    throw e;
  }
}

export type ReviewRefundArgs = {
  requestId: string;
  adminUserId: string;
  note?: string;
};

export type ReviewRefundResult = { ok: boolean; reason?: string };

/**
 * Admin approves a PENDING_REVIEW request. Credits floor(min(claimed, cap)/10) points
 * and stamps the review fields. Idempotent: no-op if already APPROVED/REJECTED (a
 * second click never double-credits). Returns reason "not_found"/"not_pending".
 */
export async function approveRefund(
  args: ReviewRefundArgs,
): Promise<ReviewRefundResult> {
  const { requestId, adminUserId, note } = args;
  return prisma.$transaction(async (tx) => {
    const req = await tx.clawhubRefundRequest.findUnique({ where: { id: requestId } });
    if (!req) return { ok: false, reason: "not_found" };
    // Idempotent — already decided.
    if (req.status === "APPROVED" || req.status === "REJECTED") {
      return { ok: true };
    }
    if (req.status !== "PENDING_REVIEW") {
      return { ok: false, reason: "not_pending" };
    }

    const cappedBaht = Math.min(req.claimedBaht, MAX_REFUND_BAHT);
    const points = Math.floor(cappedBaht / POINT_TO_BAHT);

    await tx.clawhubRefundRequest.update({
      where: { id: req.id },
      data: {
        status: "APPROVED",
        reviewedById: adminUserId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
        pointsAwarded: points,
      },
    });

    if (points > 0) {
      await creditPoints(tx, {
        orgId: req.orgId,
        memberId: req.memberId,
        points,
        kind: "EARN_REFUND",
        refType: "refund",
        refId: req.id,
      });
    }

    return { ok: true };
  });
}

/**
 * Admin rejects a PENDING_REVIEW request. No points. Idempotent: no-op if already
 * APPROVED/REJECTED. Returns reason "not_found"/"not_pending".
 */
export async function rejectRefund(
  args: ReviewRefundArgs,
): Promise<ReviewRefundResult> {
  const { requestId, adminUserId, note } = args;
  return prisma.$transaction(async (tx) => {
    const req = await tx.clawhubRefundRequest.findUnique({ where: { id: requestId } });
    if (!req) return { ok: false, reason: "not_found" };
    if (req.status === "APPROVED" || req.status === "REJECTED") {
      return { ok: true };
    }
    if (req.status !== "PENDING_REVIEW") {
      return { ok: false, reason: "not_pending" };
    }

    await tx.clawhubRefundRequest.update({
      where: { id: req.id },
      data: {
        status: "REJECTED",
        reviewedById: adminUserId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
      },
    });

    return { ok: true };
  });
}
