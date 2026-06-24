// DC Warehouse · LANDED-COST engine (PURE — no prisma, no I/O, fully unit-testable).
//
// ★ The accounting heart. Rules locked by the CPA in the workshop — implement EXACTLY:
//   • Landed cost CAPITALISES: goods (CNY→THB at fxRate) + import DUTY + inbound
//     freight (China-domestic + China→TH) + broker/clearing + insurance.
//   • Import VAT (7%) is NOT capitalised → it's CLAIMABLE input VAT, split out
//     separately (vatClaimableSatang). NEVER added to the unit cost.
//   • Duty + freight + broker + insurance are ALLOCATED across the shipment lines
//     BY CBM (volume) — freight is billed by CBM. Fallback when no line has CBM:
//     allocate by goods-value share. LARGEST-REMAINDER so satang sum EXACTLY to the
//     total (zero rounding leak).
//   • Money is Int satang (THB) everywhere. CNY is a plain number here (Decimal at
//     the DB boundary — the bridge converts).

/**
 * Distribute an integer `totalSatang` across `weights` so the returned array sums
 * EXACTLY to `totalSatang` (largest-remainder / Hamilton method).
 *
 * Each share = floor(total * weight / sumWeights); the leftover units (total minus
 * the sum of floors) are handed out one-by-one to the entries with the largest
 * fractional remainder (ties → lower index first). This guarantees no satang is
 * created or lost — the allocation is exact.
 *
 * Edge cases:
 *   • empty weights → [] (nothing to allocate to).
 *   • all-zero (or all-negative) weights → EQUAL split of total across the slots
 *     (largest-remainder over equal weights — front slots get the extra satang).
 *   • negative total is supported (e.g. a credit) — floor still works downward and
 *     the remainder loop tops up toward zero correctly.
 */
export function largestRemainderAllocate(totalSatang: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const total = Math.trunc(totalSatang);
  // Clamp negative/NaN weights to 0 — a line can't have negative volume/value.
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let sumW = 0;
  for (const x of w) sumW += x;

  // All-zero weights → equal split (treat every slot as weight 1).
  const effW = sumW > 0 ? w : new Array<number>(n).fill(1);
  const effSum = sumW > 0 ? sumW : n;

  // floor share + fractional remainder per slot.
  const base = new Array<number>(n);
  const rem = new Array<{ i: number; frac: number }>(n);
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * effW[i]) / effSum;
    const fl = Math.floor(exact);
    base[i] = fl;
    rem[i] = { i, frac: exact - fl };
    allocated += fl;
  }

  // Hand out the leftover units to the largest remainders (ties → lower index).
  let leftover = total - allocated;
  if (leftover !== 0) {
    const order = rem.slice().sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
    const step = leftover > 0 ? 1 : -1;
    let k = 0;
    while (leftover !== 0) {
      base[order[k % n].i] += step;
      leftover -= step;
      k++;
    }
  }
  return base;
}

export type LandedCostInputLine = {
  productId: string;
  qty: number;
  /** goods unit cost in CNY (per unit). */
  goodsCnyUnit: number;
  /** cubic metres PER UNIT (so volume weight = cbm * qty). null = unknown. */
  cbm: number | null;
};

export type LandedCostInput = {
  lines: LandedCostInputLine[];
  /** CNY → THB. */
  fxRate: number;
  dutyThbSatang: number;
  freightThbSatang: number;
  brokerThbSatang: number;
  insuranceThbSatang: number;
  /** import VAT rate — default 0.07. Informational only (never capitalised). */
  importVatRate?: number;
};

export type LandedCostResultLine = {
  productId: string;
  qty: number;
  goodsThbSatang: number;
  dutyAllocSatang: number;
  freightAllocSatang: number;
  brokerAllocSatang: number;
  insuranceAllocSatang: number;
  landedTotalSatang: number;
  landedUnitSatang: number;
  vatClaimableSatang: number;
};

export type LandedCostResult = {
  lines: LandedCostResultLine[];
  totals: {
    goodsThbSatang: number;
    landedThbSatang: number;
    vatClaimableSatang: number;
  };
};

/**
 * Compute the landed (capitalised) cost per line for one shipment/GRN.
 *
 * Per line:
 *   goodsThbSatang = round(goodsCnyUnit * qty * fxRate * 100)
 *   allocation weight = (cbm * qty) if ANY line has cbm>0, else goodsThbSatang
 *   duty/freight/broker/insurance allocated via largestRemainderAllocate(total, weights)
 *   landedTotalSatang = goods + duty + freight + broker + insurance
 *   landedUnitSatang  = round(landedTotalSatang / qty)
 *   vatClaimableSatang = round((goods + duty + freight + insurance) * importVatRate)
 *                        — CIF+duty base, informational, NOT added to landed.
 */
export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  const vatRate = input.importVatRate ?? 0.07;
  const lines = input.lines;
  const n = lines.length;

  // 1) goods value per line (satang).
  const goods = lines.map((l) => Math.round(l.goodsCnyUnit * l.qty * input.fxRate * 100));

  // 2) allocation weights — by CBM volume if any line has it, else by goods value.
  const volumeWeights = lines.map((l) => (l.cbm != null && l.cbm > 0 ? l.cbm * l.qty : 0));
  const anyCbm = volumeWeights.some((w) => w > 0);
  const weights = anyCbm ? volumeWeights : goods.slice();

  // 3) allocate each capitalisable cost bucket by largest-remainder.
  const dutyAlloc = largestRemainderAllocate(input.dutyThbSatang, weights);
  const freightAlloc = largestRemainderAllocate(input.freightThbSatang, weights);
  const brokerAlloc = largestRemainderAllocate(input.brokerThbSatang, weights);
  const insuranceAlloc = largestRemainderAllocate(input.insuranceThbSatang, weights);

  const out: LandedCostResultLine[] = [];
  let totalGoods = 0;
  let totalLanded = 0;
  let totalVat = 0;

  for (let i = 0; i < n; i++) {
    const g = goods[i];
    const d = dutyAlloc[i] ?? 0;
    const f = freightAlloc[i] ?? 0;
    const b = brokerAlloc[i] ?? 0;
    const ins = insuranceAlloc[i] ?? 0;
    const landedTotal = g + d + f + b + ins;
    const qty = lines[i].qty;
    const landedUnit = qty > 0 ? Math.round(landedTotal / qty) : 0;
    // CIF + duty base (goods + freight + insurance + duty). Broker is a clearing
    // service fee, not part of the customs import-VAT base.
    const vatBase = g + d + f + ins;
    const vat = Math.round(vatBase * vatRate);

    out.push({
      productId: lines[i].productId,
      qty,
      goodsThbSatang: g,
      dutyAllocSatang: d,
      freightAllocSatang: f,
      brokerAllocSatang: b,
      insuranceAllocSatang: ins,
      landedTotalSatang: landedTotal,
      landedUnitSatang: landedUnit,
      vatClaimableSatang: vat,
    });

    totalGoods += g;
    totalLanded += landedTotal;
    totalVat += vat;
  }

  return {
    lines: out,
    totals: {
      goodsThbSatang: totalGoods,
      landedThbSatang: totalLanded,
      vatClaimableSatang: totalVat,
    },
  };
}

// ── Inline example assertions (exact-sum proofs) ──────────────────────────────
//
// These are documentation-as-proof; run with: `npx tsx -e "require('./lib/dc/landed-cost')"`
// after un-commenting the IIFE, or just read them — every allocation sums EXACTLY.
//
// EXAMPLE 1 — CBM allocation, satang sums exactly:
//   largestRemainderAllocate(10000, [1, 1, 1]) === [3334, 3333, 3333]  (sum 10000) ✓
//   largestRemainderAllocate(100,  [0, 0, 0]) === [34, 33, 33]          (equal split, sum 100) ✓
//
// EXAMPLE 2 — duty 333 satang split by CBM weights [2,1] → [222,111], sum 333 ✓
//   computeLandedCost({
//     lines: [
//       { productId:"A", qty:10, goodsCnyUnit:5, cbm:0.2 },   // vol weight 2.0
//       { productId:"B", qty:5,  goodsCnyUnit:8, cbm:0.2 },   // vol weight 1.0
//     ],
//     fxRate: 5, dutyThbSatang: 333, freightThbSatang: 0,
//     brokerThbSatang: 0, insuranceThbSatang: 0,
//   })
//   → line A goods = round(5*10*5*100)=25000, dutyAlloc=222
//   → line B goods = round(8*5*5*100)=20000,  dutyAlloc=111
//   → totals.landedThbSatang = 25000+20000+333 = 45333,
//     and (dutyAlloc sum) 222+111 = 333 EXACTLY (no leak) ✓
//
// EXAMPLE 3 — fallback to goods-value share when NO cbm:
//   computeLandedCost({
//     lines: [
//       { productId:"A", qty:1, goodsCnyUnit:100, cbm:null }, // goods 50000 satang @fx5
//       { productId:"B", qty:1, goodsCnyUnit:100, cbm:null }, // goods 50000 satang
//     ],
//     fxRate:5, dutyThbSatang:0, freightThbSatang:101,
//     brokerThbSatang:0, insuranceThbSatang:0,
//   })
//   → equal goods weights → freight 101 → [51,50] (largest-remainder), sum 101 ✓
