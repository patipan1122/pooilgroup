// ============================================================
// ChairOps reconcile — shared money constants
// ============================================================
// Single source of truth for the coin denomination. StarThing exports the
// coin column as a COUNT of insertions ("จำนวนหยอดเหรียญ"), NOT baht, and it
// does NOT fold that coin revenue into its cash/gross sales totals. The maid
// physically empties the coin box and hands that cash in too, so every coin
// insertion is real revenue the maid is expected to deposit.
//
// CEO 2026-06-25: each coin insertion = 10 baht. Coin baht must flow into BOTH
// the revenue total AND the cash the maid must hand in (pending/drift). Keep
// this constant in ONE place so the display ledger (reconcile-v2) and the
// persisted drift engine never disagree. See
// [[chairops-coin-into-total-and-drift-2026-06-25]].
export const COIN_BAHT = 10;

/** baht value of N coin insertions */
export function coinBahtOf(coinInsertCount: number | null | undefined): number {
  return (coinInsertCount ?? 0) * COIN_BAHT;
}
