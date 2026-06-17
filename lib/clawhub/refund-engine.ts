// ClawHub (JOLLY PLAY) — refund decision engine (pure function, no DB writes).
//
// Decides whether a refund auto-approves, needs a re-photo, or goes to admin review,
// and how many points to credit. Customer types the baht they inserted; AI reads the
// machine screen ("Add up:" / "Credit" in coins) and we cross-check. 1 POINT = 10 BAHT.
//
// Rules (locked):
//  1. aiReadBaht = addUp*10 if known, else credit*10, else null (coins → baht).
//  2. confidence < floor                 → NEEDS_REPHOTO.
//  3. claimedBaht <= 0                    → NEEDS_REPHOTO (invalid).
//     claimedBaht > MAX_REFUND_BAHT       → PENDING_REVIEW (over auto cap).
//  4. |aiReadBaht - claimedBaht| > max(20, claimedBaht*0.5) → PENDING_REVIEW (mismatch).
//  5. member.refundCount >= 1 (2nd+ time) → PENDING_REVIEW (ขอบ่อยเกินไป).
//  6. else                                → AUTO_APPROVED, points = floor(baht/10).

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

  // Rule 1 — what the screen says, in baht (coins × 10).
  const aiReadBaht =
    vision.addUp != null
      ? vision.addUp * POINT_TO_BAHT
      : vision.credit != null
        ? vision.credit * POINT_TO_BAHT
        : null;

  // Rule 2 — image too unclear to trust.
  if (vision.confidence < VISION_CONFIDENCE_FLOOR) {
    return {
      decision: "NEEDS_REPHOTO",
      points: 0,
      reason: "รูปไม่ชัด ถ่ายใหม่ให้เห็นหน้าจอตู้ชัดๆ",
      aiReadBaht,
    };
  }

  // Rule 3a — invalid amount typed.
  if (claimedBaht <= 0) {
    return {
      decision: "NEEDS_REPHOTO",
      points: 0,
      reason: "กรุณากรอกยอดเงินที่หยอดให้ถูกต้อง แล้วแนบรูปหน้าจอตู้",
      aiReadBaht,
    };
  }

  // Rule 3b — over the auto-approve ceiling.
  if (claimedBaht > MAX_REFUND_BAHT) {
    return {
      decision: "PENDING_REVIEW",
      points: 0,
      reason: "ยอดเกินเพดานคืนอัตโนมัติ รอแอดมินตรวจสอบ",
      aiReadBaht,
    };
  }

  // Rule 4 — typed amount disagrees with the screen.
  if (aiReadBaht != null) {
    const tolerance = Math.max(20, claimedBaht * 0.5);
    if (Math.abs(aiReadBaht - claimedBaht) > tolerance) {
      return {
        decision: "PENDING_REVIEW",
        points: 0,
        reason: "ยอดที่กรอกไม่ตรงกับหน้าจอตู้ รอแอดมินตรวจสอบ",
        aiReadBaht,
      };
    }
  }

  // Rule 5 — not the first refund → human review.
  if (member.refundCount >= 1) {
    return {
      decision: "PENDING_REVIEW",
      points: 0,
      reason: "คุณขอคืนบ่อยเกินไป โปรดแนบหลักฐานและรอแอดมินตรวจสอบ",
      aiReadBaht,
    };
  }

  // Rule 6 — clear first refund → auto approve.
  const points = Math.floor(claimedBaht / POINT_TO_BAHT);
  return {
    decision: "AUTO_APPROVED",
    points,
    reason: `อนุมัติอัตโนมัติ ได้รับ ${points} แต้ม (${claimedBaht} บาท)`,
    aiReadBaht,
  };
}
