// ClawHub (JOLLY PLAY) — zod schemas + TS types.
// Mirrors the Prisma enums (lib/generated/prisma) so other agents validate inputs
// at the edge (LIFF form, webhook, admin actions) before they hit the engine.

import { z } from "zod";

// ---------- Enum mirrors (must match prisma/schema.prisma) ----------
export const ClawhubPointKind = z.enum(["EARN_REFUND", "REDEEM", "EXPIRE", "ADJUST"]);
export type ClawhubPointKind = z.infer<typeof ClawhubPointKind>;

export const ClawhubRefundStatus = z.enum([
  "AUTO_APPROVED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
]);
export type ClawhubRefundStatus = z.infer<typeof ClawhubRefundStatus>;

export const ClawhubRedemptionStatus = z.enum(["PENDING", "FULFILLED", "CANCELLED"]);
export type ClawhubRedemptionStatus = z.infer<typeof ClawhubRedemptionStatus>;

export const ClawhubConvStatus = z.enum(["OPEN", "SNOOZED", "CLOSED"]);
export type ClawhubConvStatus = z.infer<typeof ClawhubConvStatus>;

export const ClawhubMsgDirection = z.enum(["IN", "OUT"]);
export type ClawhubMsgDirection = z.infer<typeof ClawhubMsgDirection>;

export const ClawhubMsgKind = z.enum(["TEXT", "IMAGE", "STICKER", "SYSTEM"]);
export type ClawhubMsgKind = z.infer<typeof ClawhubMsgKind>;

// ---------- Refund decision (engine output) ----------
/** The three terminal outcomes the refund engine can emit. */
export const RefundDecisionKind = z.enum([
  "AUTO_APPROVED",
  "NEEDS_REPHOTO",
  "PENDING_REVIEW",
]);
export type RefundDecisionKind = z.infer<typeof RefundDecisionKind>;

export type RefundDecision = {
  decision: RefundDecisionKind;
  /** Points to credit on AUTO_APPROVED (0 otherwise). */
  points: number;
  /** Human-readable Thai reason shown to the customer / logged for admin. */
  reason: string;
  /** Baht the AI read off the machine screen (null if unreadable). */
  aiReadBaht: number | null;
};

// ---------- Vision (AI screen read) ----------
export const VisionResult = z.object({
  addUp: z.number().nullable(),
  price: z.number().nullable(),
  credit: z.number().nullable(),
  coinPerPlay: z.number().nullable(),
  rawText: z.string(),
  confidence: z.number().min(0).max(1),
});
export type VisionResult = z.infer<typeof VisionResult>;

// ---------- Inbound LIFF refund-request form ----------
export const RefundRequestInput = z.object({
  /** Baht the customer typed they inserted. */
  claimedBaht: z.number().int().positive(),
  /** R2 key of the uploaded machine-screen photo. */
  screenshotR2Key: z.string().min(1),
  /** SHA-256 of the photo bytes (dedup). */
  screenshotSha256: z.string().min(1),
  machineId: z.string().uuid().optional(),
  machineCode: z.string().optional(),
  machineQrToken: z.string().optional(),
  branchId: z.string().uuid().optional(),
});
export type RefundRequestInput = z.infer<typeof RefundRequestInput>;

// ---------- Member upsert input ----------
export const MemberUpsertInput = z.object({
  lineUserId: z.string().min(1),
  displayName: z.string().optional(),
  pictureUrl: z.string().optional(),
});
export type MemberUpsertInput = z.infer<typeof MemberUpsertInput>;
