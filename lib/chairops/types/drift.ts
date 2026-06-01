// Branded `Drift` type · CEO 2026-06-01 audit P0.
//
// Why this exists
// ────────────────
// ChairOps has TWO conflicting sign conventions for "drift":
//   • drift-engine.ts  →  drift = posTotal − depositTotal  →  positive = shortage
//   • ShortageDriftCell →  amount < 0 = shortage (red)
// Every consumer hand-flips the sign at the boundary. One missed flip and
// the dashboard tells the CEO a falsehood (live incident 2026-06-01:
// "DRIFT +59,352" KPI vs "−59,352" footer made CEO lose trust).
//
// Solution: a branded type that can't be mistakenly assigned to a plain
// number. You must go through `engineSigned` / `cellSigned` to convert,
// and that's where the sign convention is documented + enforced.

declare const __engineBrand: unique symbol;
declare const __cellBrand: unique symbol;

/**
 * Sign-convention: positive = SHORTAGE (POS exceeds bank deposit).
 * This is what `drift-engine.ts` returns and what `ChairopsDrift.driftAmount`
 * stores in the DB.
 *
 *   posTotal − depositTotal > 0 → "ค้างเก็บ" (maid hasn't deposited yet)
 *   posTotal − depositTotal < 0 → "ฝากเกิน" (anomaly · investigate)
 */
export type EngineDrift = number & { readonly [__engineBrand]: true };

/**
 * Sign-convention: negative = SHORTAGE (cell renders shortage as red minus).
 * This is what `ShortageDriftCell` expects — kit primitive's contract,
 * unchanged since the cell was authored.
 *
 *   amount < 0 → shortage / red
 *   amount > 0 → surplus / emerald
 *   amount = 0 → balanced / zinc
 */
export type CellDrift = number & { readonly [__cellBrand]: true };

/**
 * Wrap a raw drift number coming out of `drift-engine.ts` /
 * `ChairopsDrift.driftAmount` so the type system tracks it as the engine
 * convention from that moment on.
 */
export function asEngineDrift(n: number): EngineDrift {
  return n as EngineDrift;
}

/**
 * Convert engine-convention drift to cell-convention drift.
 * SHORTAGE in engine = positive → SHORTAGE in cell = negative.
 * This is the SINGLE function that should appear in JSX components
 * passing drift to ShortageDriftCell. Replaces every ad-hoc
 * `amount={-r.driftAmount}` in the codebase.
 */
export function toCellDrift(drift: EngineDrift): CellDrift {
  return -drift as CellDrift;
}

/**
 * Human label for an engine-convention drift value · CEO-readable Thai.
 * Use this in toasts / banners / dashboard copy so the meaning is
 * unambiguous regardless of which sign convention the local component uses.
 */
export function driftLabel(drift: EngineDrift): "ค้างฝาก" | "ฝากเกิน" | "พอดี" {
  if (drift > 0) return "ค้างฝาก";
  if (drift < 0) return "ฝากเกิน";
  return "พอดี";
}

/**
 * Format engine drift for KPI displays: always show as a SIGNED number
 * (positive = shortage). Caller decides whether to prepend "+" or use
 * abs() based on context. Returns plain string with ฿ suffix.
 */
export function formatEngineDrift(drift: EngineDrift, options?: { showZero?: boolean }): string {
  if (drift === 0) {
    return options?.showZero === false ? "" : "0 ฿";
  }
  return `${drift > 0 ? "+" : ""}${drift.toLocaleString("en-US")} ฿`;
}
