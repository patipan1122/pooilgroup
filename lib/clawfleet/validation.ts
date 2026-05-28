// ClawFleet — กฎกันโง่ 32 ข้อ (app-layer)
// Note: G1/G2/G7 + machine mirror = Postgres trigger
// This file handles per-event validation flags + display helpers.
// Spec: docs/CLAWFLEET_PLAN.md §6

import { DEFAULTS, ANOMALY_FLAGS, type AnomalyFlag } from "./types";

export type EventInput = {
  kind: "CLAW" | "EXCHANGER";
  coinMeterBefore: number;
  coinMeterAfter: number;
  cashCountedCents: number;
  // CLAW only
  dollMeterBefore?: number | null;
  dollMeterAfter?: number | null;
  stockBefore?: number | null;
  stockAfter?: number | null;
  refillQty?: number | null;
  // EXCHANGER only
  promoCoinsDispensed?: number | null;
  // Per-loadout
  pricePerPlayCoins?: number | null; // CLAW · default 1
  cashPerCoinCents?: number; // ราคาเหรียญ default 1000 = ฿10
  // Baseline for A1
  medianRevenueCents?: number | null; // 30-day median
};

export type EventDerived = {
  coinsDelta: number;
  dollsDelta: number;
  expectedRevenueCents: number;
  cashVarianceCents: number;
  cashVariancePct: number;
  dollIssuedActual: number;
  dollIssuedPhysical: number;
  dollVariance: number;
  flags: AnomalyFlag[];
  blockReason: string | null; // P0 BLOCK reason
};

/**
 * Compute all derived values + flags for an event.
 * Returns blockReason if any P0 rule fires (UI should refuse submit).
 */
export function deriveEvent(input: EventInput): EventDerived {
  const cashPerCoin = input.cashPerCoinCents ?? 1000; // ฿10/เหรียญ default
  const coinsDelta = input.coinMeterAfter - input.coinMeterBefore;
  const dollsDelta = (input.dollMeterAfter ?? 0) - (input.dollMeterBefore ?? 0);
  const expectedRevenueCents = coinsDelta * cashPerCoin;
  const cashVarianceCents = input.cashCountedCents - expectedRevenueCents;
  const cashVariancePct =
    expectedRevenueCents > 0 ? cashVarianceCents / expectedRevenueCents : 0;

  // dollIssuedPhysical = (stockBefore + refill) - stockAfter
  const dollIssuedPhysical =
    (input.stockBefore ?? 0) + (input.refillQty ?? 0) - (input.stockAfter ?? 0);
  const dollIssuedActual = dollsDelta;
  const dollVariance = dollIssuedPhysical - dollIssuedActual;

  const flags: AnomalyFlag[] = [];
  let blockReason: string | null = null;

  // ===== C2 — meter regress (BLOCK) =====
  if (input.coinMeterAfter < input.coinMeterBefore) {
    flags.push(ANOMALY_FLAGS.C2_METER_REGRESS);
    blockReason = "มิเตอร์เหรียญถอยหลัง · ตรวจตัวเลข";
  }
  if (
    input.kind === "CLAW" &&
    input.dollMeterAfter != null &&
    input.dollMeterBefore != null &&
    input.dollMeterAfter < input.dollMeterBefore
  ) {
    flags.push(ANOMALY_FLAGS.C2_METER_REGRESS);
    blockReason = "มิเตอร์ตุ๊กตาถอยหลัง · ตรวจตัวเลข";
  }

  // ===== M — Money =====
  const absCash = Math.abs(cashVarianceCents);
  if (cashVarianceCents < 0) {
    if (absCash > DEFAULTS.CASH_VARIANCE_WARN_CENTS || Math.abs(cashVariancePct) > 0.05) {
      flags.push(ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR);
    } else if (absCash > DEFAULTS.CASH_VARIANCE_ACCEPTABLE_CENTS) {
      flags.push(ANOMALY_FLAGS.M2_CASH_SHORT_MINOR);
    }
  } else if (cashVarianceCents > 5000) {
    // > ฿50 over
    flags.push(ANOMALY_FLAGS.M4_CASH_OVER);
  }

  // M5: มิเตอร์ไม่ขยับแต่มีเงิน (BLOCK)
  if (coinsDelta === 0 && input.cashCountedCents > 0) {
    flags.push(ANOMALY_FLAGS.M5_METER_NO_MOVE_BUT_CASH);
    blockReason = "มิเตอร์เหรียญไม่ขยับแต่มีเงินสด · มิเตอร์อาจเสีย";
  }

  // ===== P — Product (CLAW only) =====
  if (input.kind === "CLAW") {
    const absDoll = Math.abs(dollVariance);
    const dollPct = dollIssuedActual > 0 ? absDoll / dollIssuedActual : 0;

    if (absDoll > DEFAULTS.DOLL_VARIANCE_ACCEPTABLE || dollPct > DEFAULTS.DOLL_VARIANCE_PCT) {
      flags.push(ANOMALY_FLAGS.P3_DOLL_VARIANCE_MAJOR);
    } else if (absDoll > 0) {
      flags.push(ANOMALY_FLAGS.P2_DOLL_VARIANCE_MINOR);
    }

    // P4: มิเตอร์ตุ๊กตาขยับ แต่เหรียญไม่ขยับ (BLOCK)
    if (dollsDelta > 0 && coinsDelta === 0) {
      flags.push(ANOMALY_FLAGS.P4_DOLL_NO_COIN);
      blockReason = "ตู้แจกฟรี · ตุ๊กตาออกแต่เหรียญไม่เข้า";
    }

    // P5: เหรียญขยับเยอะ ตุ๊กตาไม่ออก
    if (coinsDelta > 20 && dollsDelta === 0) {
      flags.push(ANOMALY_FLAGS.P5_COIN_NO_DOLL);
    }
  }

  // ===== A1 — Anomaly baseline =====
  if (input.medianRevenueCents != null && input.medianRevenueCents > 0) {
    const ratio = input.cashCountedCents / input.medianRevenueCents;
    if (ratio < DEFAULTS.ANOMALY_BASELINE_MIN_PCT || ratio > DEFAULTS.ANOMALY_BASELINE_MAX_PCT) {
      flags.push(ANOMALY_FLAGS.A1_REVENUE_OUTLIER);
    }
  }

  // ===== G6 — Promo high (EXCHANGER) =====
  if (input.kind === "EXCHANGER" && input.promoCoinsDispensed && coinsDelta > 0) {
    const promoRatio = input.promoCoinsDispensed / coinsDelta;
    if (promoRatio > DEFAULTS.PROMO_DISCOUNT_PCT_MAX) {
      flags.push(ANOMALY_FLAGS.G6_PROMO_HIGH);
    }
  }

  return {
    coinsDelta,
    dollsDelta,
    expectedRevenueCents,
    cashVarianceCents,
    cashVariancePct,
    dollIssuedActual,
    dollIssuedPhysical,
    dollVariance,
    flags,
    blockReason,
  };
}

/**
 * Validate photo URLs are present per rule F1.
 * CLAW = 4 photos. EXCHANGER = 3 photos (no stock).
 */
export function validatePhotos(
  kind: "CLAW" | "EXCHANGER",
  photos: {
    photoMeterBeforeUrl?: string | null;
    photoCashUrl?: string | null;
    photoMeterAfterUrl?: string | null;
    photoStockUrl?: string | null;
  },
): { ok: true } | { ok: false; reason: string } {
  if (!photos.photoMeterBeforeUrl) return { ok: false, reason: "ขาดรูปมิเตอร์ก่อน" };
  if (!photos.photoCashUrl) return { ok: false, reason: "ขาดรูปเงินสด" };
  if (!photos.photoMeterAfterUrl) return { ok: false, reason: "ขาดรูปมิเตอร์หลัง" };
  if (kind === "CLAW" && !photos.photoStockUrl) {
    return { ok: false, reason: "ขาดรูปตุ๊กตาในตู้" };
  }
  return { ok: true };
}

/**
 * Display helpers — Thai labels for severity light
 */
export function severityLight(cashVarianceCents: number): "ok" | "warn" | "danger" {
  const abs = Math.abs(cashVarianceCents);
  if (abs <= DEFAULTS.CASH_VARIANCE_ACCEPTABLE_CENTS) return "ok";
  if (abs <= DEFAULTS.CASH_VARIANCE_WARN_CENTS) return "warn";
  return "danger";
}

export function formatTHB(cents: number): string {
  return `฿${(cents / 100).toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatCoinsDelta(delta: number): string {
  return `${delta.toLocaleString("th-TH")} ครั้ง`;
}
