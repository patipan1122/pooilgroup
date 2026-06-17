// ClawHub (JOLLY PLAY) — refund decision engine (pure function, no DB writes).
//
// MODE (CEO 2026-06-17): "เชื่อลูกค้า ปล่อยคืนอัตโนมัติไปก่อน". By DEFAULT we TRUST the
// customer's typed amount and AUTO-APPROVE — no AI cross-check, no "too frequent"
// review. The only guard kept is the per-claim ceiling (MAX_REFUND_BAHT) which bounds
// max loss. The screenshot is still stored as evidence for the admin.
//
// To RE-TIGHTEN later (re-enable AI cross-check + frequency review), set env
// CLAWHUB_REFUND_STRICT=1 — no code change needed.
//
// Customer types the baht they inserted; AI reads the machine LCD. Inserted baht is
// estimated as Credit (baht still loaded) + Add up × 10 (plays already made, 1 play =
// 10 บาท). 1 POINT = 10 BAHT.

import {
  POINT_TO_BAHT,
  MAX_REFUND_BAHT,
  VISION_CONFIDENCE_FLOOR,
} from "./constants";
import type { RefundDecision, VisionResult } from "./types";

export type EvaluateRefundInput = {
  member: { refundCount: number };
  claimedBaht: number;
  vision: Pick<VisionResult, "addUp" | "credit" | "confidence">;
};

export function evaluateRefund(input: EvaluateRefundInput): RefundDecision {
  const { member, claimedBaht, vision } = input;

  // Best estimate of inserted baht from the screen: Credit (baht loaded, not yet
  // played) + Add up × 10 (plays already made). Stored for the admin's reference; in
  // trust mode it does NOT block the refund. (Old bug: used Add up only → money sitting
  // in "Credit" read as 0 → legit first refunds wrongly flagged "ยอดไม่ตรง".)
  const aiReadBaht =
    (vision.credit ?? 0) + (vision.addUp ?? 0) * POINT_TO_BAHT || null;

  // Basic input validity (not friction — the route already requires a positive int).
  if (!Number.isFinite(claimedBaht) || claimedBaht <= 0) {
    return {
      decision: "NEEDS_REPHOTO",
      points: 0,
      reason: "กรุณากรอกยอดเงินที่หยอดให้ถูกต้อง แล้วแนบรูปหน้าจอตู้",
      aiReadBaht,
    };
  }

  // Max-loss ceiling — the one case that still goes to admin review.
  if (claimedBaht > MAX_REFUND_BAHT) {
    return {
      decision: "PENDING_REVIEW",
      points: 0,
      reason: `ยอดเกิน ${MAX_REFUND_BAHT} บาท/ครั้ง — รอแอดมินตรวจสอบ`,
      aiReadBaht,
    };
  }

  // STRICT mode (opt-in via env) — re-enable AI cross-check + frequency review.
  if (process.env.CLAWHUB_REFUND_STRICT === "1") {
    if (vision.confidence < VISION_CONFIDENCE_FLOOR) {
      return {
        decision: "NEEDS_REPHOTO",
        points: 0,
        reason: "รูปไม่ชัด ถ่ายใหม่ให้เห็นหน้าจอตู้ชัดๆ",
        aiReadBaht,
      };
    }
    if (
      aiReadBaht != null &&
      aiReadBaht > 0 &&
      Math.abs(aiReadBaht - claimedBaht) > Math.max(20, claimedBaht * 0.5)
    ) {
      return {
        decision: "PENDING_REVIEW",
        points: 0,
        reason: "ยอดที่กรอกไม่ตรงกับหน้าจอตู้ รอแอดมินตรวจสอบ",
        aiReadBaht,
      };
    }
    if (member.refundCount >= 1) {
      return {
        decision: "PENDING_REVIEW",
        points: 0,
        reason: "คุณขอคืนบ่อยเกินไป โปรดแนบหลักฐานและรอแอดมินตรวจสอบ",
        aiReadBaht,
      };
    }
  }

  // TRUST mode (default) — auto-approve, trust the customer's typed amount.
  const points = Math.floor(claimedBaht / POINT_TO_BAHT);
  return {
    decision: "AUTO_APPROVED",
    points,
    reason: `อนุมัติอัตโนมัติ ได้รับ ${points} แต้ม (${claimedBaht} บาท)`,
    aiReadBaht,
  };
}
