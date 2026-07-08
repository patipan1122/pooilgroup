// ClawFleet — computeCfDrift() · SINGLE SOURCE for per-event drift + verdict.
//
// WHY this exists (blueprint §2 FOUNDATION · CEO revision R1 2026-07-08):
//   The money math already lives in deriveEvent() (validation.ts) and MUST stay
//   there — this helper WRAPS it, never re-implements it. What it adds on top:
//     (a) round-1 (baseline) awareness: on the very first collection of a machine
//         the revenue STILL counts, but the SHORT/OVER *verdict* is suppressed
//         (verdict = null) because there is no prior meter to compare against.
//         DO NOT zero revenue on round-1.
//     (b) a single derived `verdict` field ("OK" | "SHORT" | "OVER" | null) so the
//         mobile mismatch-gate (N5) and every caller read the SAME verdict the
//         server computed — never a client-supplied value.
//
// blockReason (C2 meter regress · M5 meter-no-move-but-cash · P4 free-dispense) is
// a DATA-INTEGRITY block, NOT a verdict — it passes straight through and still
// fires on round-1 (a baseline with a regressing meter is a bad reading, gate it).

import { deriveEvent, type EventInput } from "./validation";
import { ANOMALY_FLAGS, type AnomalyFlag } from "./types";

export type CfDriftVerdict = "OK" | "SHORT" | "OVER";

export type ComputeCfDriftInput = EventInput & {
  /** true = ตู้ยังไม่เคยล็อก baseline (รอบแรก) → verdict ถูกกด (null) · revenue ยังนับ */
  isBaselineRound: boolean;
};

export type CfDriftResult = {
  /** รายได้ที่คาด (จากมิเตอร์เหรียญที่ขยับ × ราคา/ครั้ง) — นับเสมอ แม้ round-1 */
  revenueCents: number;
  coinsDelta: number;
  dollsDelta: number;
  /** เงินนับจริง − revenueCents (ลบ = ขาด · บวก = เกิน) */
  cashVarianceCents: number;
  /** OK/SHORT/OVER สำหรับรอบปกติ · null เมื่อ round-1 (ไม่มีอะไรให้เทียบ) */
  verdict: CfDriftVerdict | null;
  flags: AnomalyFlag[];
  /** เหตุผล BLOCK (P0 data-integrity) — ยังบล็อกแม้ round-1 · null = ผ่าน */
  blockReason: string | null;
};

// ธงเงิน "ขาด" (SHORT) และ "เกิน" (OVER) จาก deriveEvent — ใช้ตัดสิน verdict
// ให้ตรงกับเกณฑ์ tolerance เดียวกับที่ deriveEvent ใช้ (ไม่ตั้งเกณฑ์ใหม่ซ้อน).
const SHORT_FLAGS: ReadonlySet<string> = new Set<string>([
  ANOMALY_FLAGS.M2_CASH_SHORT_MINOR,
  ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR,
]);
const OVER_FLAGS: ReadonlySet<string> = new Set<string>([
  ANOMALY_FLAGS.M4_CASH_OVER,
  ANOMALY_FLAGS.M6_CASH_OVER_MAJOR,
]);

/**
 * คำนวณ drift ต่อ 1 event — wrap deriveEvent (math เดิม) แล้วเติม verdict + round-1 rule.
 *
 * - round-1 (isBaselineRound=true): verdict = null (revenue ยังนับ · ไม่มีรอบก่อนให้เทียบ)
 * - รอบปกติ: verdict = SHORT ถ้ามีธงเงินขาด · OVER ถ้ามีธงเงินเกิน · else OK
 *   (อ้างจากธงของ deriveEvent เพื่อใช้เกณฑ์ tolerance เดียวกัน ไม่ตั้งเพดานใหม่)
 * - blockReason ส่งต่อจาก deriveEvent ตรง ๆ (C2/M5/P4 ยังบล็อกแม้ round-1 = data integrity)
 */
export function computeCfDrift(input: ComputeCfDriftInput): CfDriftResult {
  const derived = deriveEvent(input);

  let verdict: CfDriftVerdict | null;
  if (input.isBaselineRound) {
    // R1 (CEO 2026-07-08): รอบแรก → revenue นับ · verdict ถูกกด
    verdict = null;
  } else {
    const hasShort = derived.flags.some((f) => SHORT_FLAGS.has(f));
    const hasOver = derived.flags.some((f) => OVER_FLAGS.has(f));
    verdict = hasShort ? "SHORT" : hasOver ? "OVER" : "OK";
  }

  return {
    revenueCents: derived.expectedRevenueCents,
    coinsDelta: derived.coinsDelta,
    dollsDelta: derived.dollsDelta,
    cashVarianceCents: derived.cashVarianceCents,
    verdict,
    flags: derived.flags,
    blockReason: derived.blockReason,
  };
}
