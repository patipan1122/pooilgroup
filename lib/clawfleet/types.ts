// ClawFleet — shared types + Zod schemas
// Spec: docs/CLAWFLEET_PLAN.md v2

import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";

// =============================================================
// Enums (mirror Prisma)
// =============================================================
export const MACHINE_KINDS = ["CLAW", "EXCHANGER"] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

export const EVENT_TYPES = ["INITIAL", "COLLECTION", "VOID"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const STOCK_MOVE_TYPES = [
  "RECEIVE",
  "LOAD_TO_MACHINE",
  "COUNT_SNAPSHOT",
  "ADJUST",
] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPES)[number];

export const SESSION_STATUSES = ["OPEN", "CLOSED", "ANOMALY_REVIEW", "LOCKED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PRODUCT_CATEGORIES = [
  "PLUSH",
  "TOY",
  "UTILITY",
  "MYSTERY_BOX",
  "MODEL",
  "KEYCHAIN",
  "SNACK",
  "OTHER",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// =============================================================
// Tolerance + thresholds (default · settings-overridable per org)
// =============================================================
export const DEFAULTS = {
  GROUP_TOLERANCE_BPS: 500, // 5%
  CASH_VARIANCE_ACCEPTABLE_CENTS: 2000, // ฿20
  CASH_VARIANCE_WARN_CENTS: 10000, // ฿100
  DOLL_VARIANCE_ACCEPTABLE: 2, // ตัว
  DOLL_VARIANCE_PCT: 0.1, // 10%
  PROMO_DISCOUNT_PCT_MAX: 0.3, // 30%
  ANOMALY_BASELINE_DAYS: 30,
  ANOMALY_BASELINE_MIN_PCT: 0.3, // < 30% ของ median
  ANOMALY_BASELINE_MAX_PCT: 3.0, // > 300% ของ median
  PHOTO_RETENTION_DAYS: 30,
  SESSION_AUTO_CLOSE_HOURS: 24,
  PHOTO_MAX_SIZE_KB: 500,
} as const;

// =============================================================
// Promo tier (JSON shape ใน cf_exchanger_loadouts.promo_tiers)
// =============================================================
export const PromoTierSchema = z.object({
  thb: z.number().int().positive(),
  coins: z.number().int().positive(),
});
export type PromoTier = z.infer<typeof PromoTierSchema>;

export const PromoTiersSchema = z.array(PromoTierSchema).max(20);

// =============================================================
// Form schemas
// =============================================================

// Create machine (CEO/admin · admin page)
export const CreateMachineSchema = z.object({
  branchId: zUUID(),
  groupId: zUUID().optional(),
  code: z.string().min(1).max(64),
  nickname: z.string().max(128).optional(),
  kind: z.enum(MACHINE_KINDS),
  serial: z.string().max(128).optional(),
  initialCoinMeter: z.number().int().min(0).default(0),
  initialDollMeter: z.number().int().min(0).default(0),
  installedAt: z.string().optional(), // ISO date
  notes: z.string().max(500).optional(),
});
export type CreateMachineInput = z.infer<typeof CreateMachineSchema>;

// Create/update product
export const CreateProductSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  category: z.enum(PRODUCT_CATEGORIES),
  defaultPriceCoins: z.number().int().min(1).default(1),
  unitCostCents: z.number().int().min(0).default(0),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

// Create group
export const CreateGroupSchema = z.object({
  branchId: zUUID(),
  name: z.string().min(1).max(128),
  exchangerId: zUUID().optional(),
  toleranceBps: z.number().int().min(100).max(5000).default(500),
});
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

// Set machine loadout (เปลี่ยนสินค้า/ราคาตู้คีบ)
export const SetMachineLoadoutSchema = z.object({
  machineId: zUUID(),
  productId: zUUID(),
  pricePerPlayCoins: z.number().int().min(1).default(1),
  notes: z.string().max(500).optional(),
});
export type SetMachineLoadoutInput = z.infer<typeof SetMachineLoadoutSchema>;

// Set exchanger loadout (rate + promo)
export const SetExchangerLoadoutSchema = z.object({
  machineId: zUUID(),
  baseCoinPerBaht: z.number().min(0.1).max(10).default(1.0),
  promoTiers: PromoTiersSchema.default([]),
  notes: z.string().max(500).optional(),
});
export type SetExchangerLoadoutInput = z.infer<typeof SetExchangerLoadoutSchema>;

// Start session (พนักงาน เปิดรอบเก็บ)
export const StartSessionSchema = z.object({
  groupId: zUUID(),
});
export type StartSessionInput = z.infer<typeof StartSessionSchema>;

// Submit collection event (ตู้คีบ form 6 ช่อง · ตู้แลก 3 ช่อง)
export const SubmitEventSchema = z
  .object({
    sessionId: zUUID(),
    machineId: zUUID(),
    qrToken: z.string().min(1), // บังคับ scan QR ก่อนกรอก
    // ทุกตู้
    coinMeterAfter: z.number().int().min(0),
    cashCountedCents: z.number().int().min(0),
    // CLAW only
    dollMeterAfter: z.number().int().min(0).optional(),
    stockBefore: z.number().int().min(0).optional(),
    refillQty: z.number().int().min(0).optional(),
    stockAfter: z.number().int().min(0).optional(),
    // EXCHANGER only
    promoCoinsDispensed: z.number().int().min(0).optional(),
    // photos (R2 URLs after upload)
    photoMeterBeforeUrl: z.string().url().optional(),
    photoCashUrl: z.string().url().optional(),
    photoMeterAfterUrl: z.string().url().optional(),
    photoStockUrl: z.string().url().optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type SubmitEventInput = z.infer<typeof SubmitEventSchema>;

// Close session (call cross-check trigger)
export const CloseSessionSchema = z.object({
  sessionId: zUUID(),
  reviewNote: z.string().max(1000).optional(),
});
export type CloseSessionInput = z.infer<typeof CloseSessionSchema>;

// Review anomaly session (หัวหน้าสาขา approve/reject)
export const ReviewSessionSchema = z.object({
  sessionId: zUUID(),
  decision: z.enum(["APPROVE", "REJECT"]),
  reviewNote: z.string().min(10).max(1000), // บังคับ note
});
export type ReviewSessionInput = z.infer<typeof ReviewSessionSchema>;

// =============================================================
// v2 — Branch-based collection (1 พนง = 1 สาขา = N ตู้คีบ · ไม่มีตู้แลก)
// 5 รูป/ตู้: มิเตอร์เหรียญ · มิเตอร์ตุ๊กตา · ตุ๊กตาก่อนเติม · ตุ๊กตาหลังเติม · เงินสด
// =============================================================

// เปิดรอบเก็บระดับสาขา
export const StartBranchSessionSchema = z.object({
  branchId: zUUID(),
});
export type StartBranchSessionInput = z.infer<typeof StartBranchSessionSchema>;

// กรอกข้อมูล 1 ตู้ใน branch session
// มิเตอร์ "ก่อน" ดึงจากระบบ (machine.lastCoinMeter / lastDollMeter / lastDollStock)
// พนักงานกรอกแค่ "วันนี้" + เงิน + นับตุ๊กตา + 5 รูป
export const SubmitBranchEventSchema = z
  .object({
    sessionId: zUUID(),
    machineId: zUUID(),
    qrToken: z.string().min(1).optional(), // optional ใน branch flow (พนง.อยู่สาขาตัวเองแล้ว)
    coinMeterAfter: z.number().int().min(0), // มิเตอร์เหรียญวันนี้
    dollMeterAfter: z.number().int().min(0), // มิเตอร์ตุ๊กตาวันนี้ (sensor)
    cashCountedCents: z.number().int().min(0), // เงินในถาด (นับจริง)
    stockBefore: z.number().int().min(0), // ตุ๊กตาในตู้ ก่อนเติม (นับจริง)
    refillQty: z.number().int().min(0).default(0), // เติมจากคลังสาขา
    stockAfter: z.number().int().min(0), // ตุ๊กตาในตู้ หลังเติม (นับจริง)
    refillProductId: zUUID().optional(), // SKU ที่เติม (ตัดสต๊อกสาขา)
    // 5 รูป (R2 URLs)
    photoCoinMeterUrl: z.string().url(), // → photoMeterAfterUrl
    photoPrizeMeterUrl: z.string().url(), // → photoPrizeMeterUrl
    photoStockBeforeUrl: z.string().url(), // → photoStockUrl
    photoStockAfterUrl: z.string().url(), // → photoMeterBeforeUrl (reused slot)
    photoCashUrl: z.string().url(), // → photoCashUrl
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type SubmitBranchEventInput = z.infer<typeof SubmitBranchEventSchema>;

// ปิดรอบ branch → 2-way cross-check (เงิน + ตุ๊กตา) app-layer
export const CloseBranchSessionSchema = z.object({
  sessionId: zUUID(),
  reviewNote: z.string().max(1000).optional(),
});
export type CloseBranchSessionInput = z.infer<typeof CloseBranchSessionSchema>;

// Stock receive
export const StockReceiveSchema = z.object({
  branchId: zUUID(),
  productId: zUUID(),
  qty: z.number().int().min(1),
  unitCostCents: z.number().int().min(0).default(0),
  receiptR2Key: z.string().optional(),
  notes: z.string().max(500).optional(),
  occurredAt: z.string().datetime().optional(),
});
export type StockReceiveInput = z.infer<typeof StockReceiveSchema>;

// Stock count (daily snapshot · 1 product/row)
export const StockCountSchema = z.object({
  branchId: zUUID(),
  productId: zUUID(),
  actualQty: z.number().int().min(0),
  reason: z.string().max(500).optional(),
});
export type StockCountInput = z.infer<typeof StockCountSchema>;

// Stock count batch (multiple products one submit)
export const StockCountBatchSchema = z.object({
  branchId: zUUID(),
  counts: z.array(StockCountSchema.omit({ branchId: true })).min(1).max(100),
});
export type StockCountBatchInput = z.infer<typeof StockCountBatchSchema>;

// =============================================================
// Anomaly flag taxonomy (string keys ใน cf_collection_sessions.anomaly_flags)
// =============================================================
export const ANOMALY_FLAGS = {
  // C — Continuity
  C1_CONTINUITY_BREAK: "C1_CONTINUITY_BREAK",
  C2_METER_REGRESS: "C2_METER_REGRESS",
  // M — Money
  M2_CASH_SHORT_MINOR: "M2_CASH_SHORT_MINOR",
  M3_CASH_SHORT_MAJOR: "M3_CASH_SHORT_MAJOR",
  M4_CASH_OVER: "M4_CASH_OVER",
  M5_METER_NO_MOVE_BUT_CASH: "M5_METER_NO_MOVE_BUT_CASH",
  // P — Product
  P2_DOLL_VARIANCE_MINOR: "P2_DOLL_VARIANCE_MINOR",
  P3_DOLL_VARIANCE_MAJOR: "P3_DOLL_VARIANCE_MAJOR",
  P4_DOLL_NO_COIN: "P4_DOLL_NO_COIN",
  P5_COIN_NO_DOLL: "P5_COIN_NO_DOLL",
  // A — Anomaly baseline
  A1_REVENUE_OUTLIER: "A1_REVENUE_OUTLIER",
  A3_DOUBLE_SAME_DAY: "A3_DOUBLE_SAME_DAY",
  // G — Group cross-check (set by Postgres trigger)
  COIN_GROUP_MISMATCH: "COIN_GROUP_MISMATCH",
  EXCHANGER_NO_DISPENSE: "EXCHANGER_NO_DISPENSE",
  G6_PROMO_HIGH: "G6_PROMO_HIGH",
  G8_SESSION_TOO_LONG: "G8_SESSION_TOO_LONG",
  G9_EXCHANGER_BROKEN: "G9_EXCHANGER_BROKEN",
  // S — Stock
  S1_COUNT_VARIANCE: "S1_COUNT_VARIANCE",
  // F — Photo
  F1_PHOTO_MISSING: "F1_PHOTO_MISSING",
} as const;

export type AnomalyFlag = (typeof ANOMALY_FLAGS)[keyof typeof ANOMALY_FLAGS];

// Severity → action mapping
export const SEVERITY = {
  P0_BLOCK: "P0",
  P1_FLAG: "P1",
  P2_WARN: "P2",
} as const;

export const FLAG_SEVERITY: Record<AnomalyFlag, "P0" | "P1" | "P2"> = {
  [ANOMALY_FLAGS.C1_CONTINUITY_BREAK]: "P0",
  [ANOMALY_FLAGS.C2_METER_REGRESS]: "P0",
  [ANOMALY_FLAGS.M2_CASH_SHORT_MINOR]: "P2",
  [ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR]: "P1",
  [ANOMALY_FLAGS.M4_CASH_OVER]: "P2",
  [ANOMALY_FLAGS.M5_METER_NO_MOVE_BUT_CASH]: "P0",
  [ANOMALY_FLAGS.P2_DOLL_VARIANCE_MINOR]: "P2",
  [ANOMALY_FLAGS.P3_DOLL_VARIANCE_MAJOR]: "P1",
  [ANOMALY_FLAGS.P4_DOLL_NO_COIN]: "P0",
  [ANOMALY_FLAGS.P5_COIN_NO_DOLL]: "P2",
  [ANOMALY_FLAGS.A1_REVENUE_OUTLIER]: "P1",
  [ANOMALY_FLAGS.A3_DOUBLE_SAME_DAY]: "P2",
  [ANOMALY_FLAGS.COIN_GROUP_MISMATCH]: "P1",
  [ANOMALY_FLAGS.EXCHANGER_NO_DISPENSE]: "P2",
  [ANOMALY_FLAGS.G6_PROMO_HIGH]: "P1",
  [ANOMALY_FLAGS.G8_SESSION_TOO_LONG]: "P2",
  [ANOMALY_FLAGS.G9_EXCHANGER_BROKEN]: "P1",
  [ANOMALY_FLAGS.S1_COUNT_VARIANCE]: "P1",
  [ANOMALY_FLAGS.F1_PHOTO_MISSING]: "P0",
};

export const FLAG_LABEL_TH: Record<AnomalyFlag, string> = {
  [ANOMALY_FLAGS.C1_CONTINUITY_BREAK]: "มิเตอร์ไม่ต่อจากรอบก่อน",
  [ANOMALY_FLAGS.C2_METER_REGRESS]: "มิเตอร์ถอยหลัง",
  [ANOMALY_FLAGS.M2_CASH_SHORT_MINOR]: "เงินขาดเล็กน้อย",
  [ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR]: "เงินขาดเยอะ",
  [ANOMALY_FLAGS.M4_CASH_OVER]: "เงินเกิน",
  [ANOMALY_FLAGS.M5_METER_NO_MOVE_BUT_CASH]: "มิเตอร์ไม่ขยับแต่มีเงิน",
  [ANOMALY_FLAGS.P2_DOLL_VARIANCE_MINOR]: "ตุ๊กตาขาดเล็กน้อย",
  [ANOMALY_FLAGS.P3_DOLL_VARIANCE_MAJOR]: "ตุ๊กตาขาดเยอะ",
  [ANOMALY_FLAGS.P4_DOLL_NO_COIN]: "ตุ๊กตาออกแต่เหรียญไม่ขยับ",
  [ANOMALY_FLAGS.P5_COIN_NO_DOLL]: "เหรียญขยับเยอะ ตุ๊กตาไม่ออก",
  [ANOMALY_FLAGS.A1_REVENUE_OUTLIER]: "รายได้ผิดปกติเทียบเดือนที่ผ่านมา",
  [ANOMALY_FLAGS.A3_DOUBLE_SAME_DAY]: "เก็บ 2 รอบในวันเดียวกัน",
  [ANOMALY_FLAGS.COIN_GROUP_MISMATCH]: "เหรียญตู้แลก vs ตู้คีบ ไม่ตรง (อาจแลกนอกตู้)",
  [ANOMALY_FLAGS.EXCHANGER_NO_DISPENSE]: "ตู้คีบรับเหรียญ แต่ตู้แลกไม่แจกเลย",
  [ANOMALY_FLAGS.G6_PROMO_HIGH]: "Promo discount เกิน 30%",
  [ANOMALY_FLAGS.G8_SESSION_TOO_LONG]: "Session ยาวเกิน 3 ชั่วโมง",
  [ANOMALY_FLAGS.G9_EXCHANGER_BROKEN]: "ตู้แลกเสีย · ข้าม cross-check",
  [ANOMALY_FLAGS.S1_COUNT_VARIANCE]: "สต๊อกนับไม่ตรงระบบ",
  [ANOMALY_FLAGS.F1_PHOTO_MISSING]: "รูปไม่ครบ",
};
