// Shared, runner-agnostic assertion cases for findBankCombo (N:1 bank-line matching).
// Used by BOTH reconcile-combo-match.test.ts (vitest) and reconcile-combo-match.run.ts
// (tsx today) — pure, no DB. Mirrors lib/ledger/__tests__/completeness.cases.ts pattern.

import { findBankCombo, type ComboBankCandidate } from "../reconcile-combo-match";
import { MATCH_CONCEPTS } from "../reconcile-match-keywords";

export interface Case {
  name: string;
  /** returns an error string on failure, or null on pass */
  check: () => string | null;
}

export const cases: Case[] = [];

const DAY = 86400000;
const day = (n: number) => n * DAY; // fake epoch-ms anchored at day n

function eq(label: string, actual: unknown, expected: unknown): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function idsEqualUnordered(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

// --- case 1: real CEO scenario — 2 QR bank lines sum to 1 book entry ------
// 2026-08-01: ฿135.00 + ฿4,505.00 = ฿4,640.00 (verified real bank data, exact to satang)
cases.push({
  name: "2-line sum: ฿135 + ฿4,505 = ฿4,640 QR settlement matches (pair)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "bk-135", amountSatang: 13_500, dateMs: day(1), text: "thai qr payment settle a" },
      { id: "bk-4505", amountSatang: 450_500, dateMs: day(1), text: "thai qr payment settle b" },
    ];
    const res = findBankCombo(464_000, day(1), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected a combo, got null";
    if (!idsEqualUnordered(res.ids, ["bk-135", "bk-4505"]))
      return `expected ids [bk-135, bk-4505], got ${JSON.stringify(res.ids)}`;
    return null;
  },
});

// --- case 2: no valid pair, but a valid triple exists ----------------------
cases.push({
  name: "3-line sum: no pair sums to target, but all 3 lines together do (triple)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(2), text: "qr payment a" },
      { id: "b", amountSatang: 100_000, dateMs: day(2), text: "qr payment b" },
      { id: "c", amountSatang: 100_000, dateMs: day(2), text: "qr payment c" },
    ];
    // any 2 sum to 200,000 (≠ 300,000 target, way outside ±100 tol) → no pair
    // all 3 sum to 300,000 exactly → the one triple
    const res = findBankCombo(300_000, day(2), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected a triple combo, got null";
    if (!idsEqualUnordered(res.ids, ["a", "b", "c"]))
      return `expected ids [a,b,c], got ${JSON.stringify(res.ids)}`;
    return null;
  },
});

// --- case 3: ambiguous pairs → must NOT auto-match --------------------------
cases.push({
  name: "ambiguous: 2 different valid pairs both sum to target → returns null (no guess)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(3), text: "" }, // cash: requireName=false
      { id: "b", amountSatang: 400_000, dateMs: day(3), text: "" },
      { id: "c", amountSatang: 200_000, dateMs: day(3), text: "" },
      { id: "d", amountSatang: 300_000, dateMs: day(3), text: "" },
    ];
    // a+b = 500,000 AND c+d = 500,000 → both valid, ambiguous → must skip
    const res = findBankCombo(500_000, day(3), MATCH_CONCEPTS.cash, candidates, []);
    return eq("ambiguous pair result", res, null);
  },
});

// --- case 4: ambiguous pairs must NOT fall through to triples --------------
cases.push({
  name: "ambiguous pairs skip triple search entirely (per spec: only try triples if 0 pairs found)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(4), text: "" },
      { id: "b", amountSatang: 400_000, dateMs: day(4), text: "" },
      { id: "c", amountSatang: 200_000, dateMs: day(4), text: "" },
      { id: "d", amountSatang: 300_000, dateMs: day(4), text: "" },
      { id: "e", amountSatang: 0, dateMs: day(4), text: "" }, // makes a+b+e also = 500,000 (would-be triple)
    ];
    const res = findBankCombo(500_000, day(4), MATCH_CONCEPTS.cash, candidates, []);
    // must be null (ambiguous pairs short-circuit) — NOT the a+b+e triple
    return eq("must not fall through to triple when pairs are ambiguous", res, null);
  },
});

// --- case 5: single candidate (< 2) never matches ---------------------------
cases.push({
  name: "fewer than 2 candidates never produces a combo",
  check: () => {
    const res = findBankCombo(
      100_000,
      day(5),
      MATCH_CONCEPTS.qr,
      [{ id: "only-one", amountSatang: 100_000, dateMs: day(5), text: "qr payment" }],
      [],
    );
    return eq("single-candidate result", res, null);
  },
});

// --- case 6: opposite sign is excluded even if |sum| matches ----------------
cases.push({
  name: "opposite-sign candidate excluded (in-money book must not combine with an out-money bank line)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "pos", amountSatang: 250_000, dateMs: day(6), text: "qr payment" },
      { id: "neg", amountSatang: -250_000, dateMs: day(6), text: "qr payment" }, // wrong side
      { id: "pos2", amountSatang: 250_000, dateMs: day(6), text: "qr payment" },
    ];
    // only "pos" + "pos2" are same-side and sum to 500,000
    const res = findBankCombo(500_000, day(6), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected pos+pos2 combo, got null";
    return eq("opposite-sign excluded from combo", res.ids.includes("neg"), false);
  },
});

// --- case 7: concept keyword mismatch excludes a candidate even if sum matches --
cases.push({
  name: "concept name-lock: candidate without required keyword excluded (grab must say grab/แกร็บ)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "grab1", amountSatang: 100_000, dateMs: day(7), text: "แกร็บ payout" },
      { id: "other1", amountSatang: 100_000, dateMs: day(7), text: "random transfer, no keyword" },
    ];
    // sum would be 200,000 but "other1" fails the grab name-lock → filtered out → <2 candidates → null
    const res = findBankCombo(200_000, day(7), MATCH_CONCEPTS.grab, candidates, []);
    return eq("name-lock filters non-matching candidate → no combo", res, null);
  },
});

// --- case 8: outside date window excludes a candidate -----------------------
cases.push({
  name: "date-window: candidate outside concept.dateWindowDays excluded even if sum matches",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "near", amountSatang: 100_000, dateMs: day(8), text: "qr payment" },
      { id: "far", amountSatang: 100_000, dateMs: day(8 + 10), text: "qr payment" }, // qr window = 2 days
    ];
    const res = findBankCombo(200_000, day(8), MATCH_CONCEPTS.qr, candidates, []);
    return eq("out-of-window candidate excluded → no combo", res, null);
  },
});

// --- case 9: candidate cap (MAX_COMBO_CANDIDATES) skips search entirely -----
cases.push({
  name: "candidate cap: exceeding MAX_COMBO_CANDIDATES skips N:1 search for this book entry",
  check: () => {
    const candidates: ComboBankCandidate[] = [];
    for (let i = 0; i < 26; i++) {
      candidates.push({ id: `c${i}`, amountSatang: 1000, dateMs: day(9), text: "qr payment" });
    }
    // any 2 sum to 2000 — would normally be wildly ambiguous anyway, but the cap must
    // short-circuit BEFORE the combinatorial search even runs (26 > 25)
    const res = findBankCombo(2000, day(9), MATCH_CONCEPTS.qr, candidates, []);
    return eq("over-cap candidate list returns null", res, null);
  },
});

// --- case 10: tolerance is the SAME per-concept rule, not loosened for sums --
cases.push({
  name: "tolerance: qr concept tolAbsSatang=100 applies to the SUM, not a looser rule",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(10), text: "qr payment" },
      { id: "b", amountSatang: 100_150, dateMs: day(10), text: "qr payment" }, // sum diff = 150 > tol 100
    ];
    const res = findBankCombo(200_000, day(10), MATCH_CONCEPTS.qr, candidates, []);
    return eq("sum outside tolerance must not match", res, null);
  },
});
